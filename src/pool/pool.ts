import { TypedEventEmitter } from '../types'

import type { ClientAdapter, ClientState } from './adapter'
import { DedupPipeline } from './dedup/pipeline'
import type { AggregatedEvent, DedupOptions, PoolEventMap } from './types'

/** `ClientPool` 构造选项。`logger` 由门面类自动注入，直接使用时可手动传入。 */
export interface ClientPoolOptions<TEvent> {
  dedup?: DedupOptions<TEvent>
  logger?: {
    warn(msg: string, ...args: unknown[]): void
    error(msg: string, ...args: unknown[]): void
  }
}

interface ClientEntry<TClient, TRole extends string> {
  adapter: ClientAdapter<TClient>
  role: TRole
  prevState: ClientState
}

/**
 * 多客户端连接池，支持角色分类、事件去重和只读状态观测。
 *
 * 连接生命周期（是否重连、何时放弃）完全由各 `ClientAdapter` 背后的客户端自行决定，
 * 本类只负责注册聚合、事件去重、以及被动观测状态变化（wireToPool 实时转发 + 定时轮询兜底），
 * 不包含任何"发现异常就采取行动"的分支。
 *
 * @typeParam TClient - 具体客户端类型，由宿主传入
 * @typeParam TRole   - 角色枚举类型，约束 `addClient` 的 role 参数
 * @typeParam TEvent  - 聚合事件类型，与 `DedupOptions` 的泛型对齐
 */
export class ClientPool<
  TClient = object,
  TRole extends string = string,
  TEvent = object,
> extends TypedEventEmitter<PoolEventMap<TEvent>> {
  private readonly clients = new Map<string, ClientEntry<TClient, TRole>>()
  private readonly dedup: DedupPipeline<TEvent> | null
  private statePollingTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: ClientPoolOptions<TEvent>) {
    super()
    this.dedup = options.dedup ? new DedupPipeline(options.dedup) : null
  }

  /** 向连接池注册一个客户端适配器，并发射 `clientAdded` 事件。若适配器实现了 `wireToPool`，自动调用完成事件绑定；`wireToPool` 抛出时记录日志但不中止注册流程。 */
  addClient(adapter: ClientAdapter<TClient>, role: TRole): void {
    this.clients.set(adapter.id, {
      adapter,
      role,
      prevState: adapter.state,
    })
    if (adapter.wireToPool) {
      try {
        adapter.wireToPool(this, role)
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        this.options.logger?.error('addClient: wireToPool 调用失败', adapter.id, error.message)
      }
    }
    this.emit('clientAdded', adapter.id, role)
  }

  /** 断开并从连接池移除指定客户端。`disconnect()` 异常时仍会清理条目，避免僵尸客户端。 */
  async removeClient(clientId: string): Promise<void> {
    const entry = this.clients.get(clientId)
    if (!entry) {
      this.options.logger?.warn('removeClient: 客户端不存在', clientId)
      return
    }
    try {
      if (entry.adapter.state === 'connected') await entry.adapter.disconnect()
    } finally {
      // disconnect 是否抛出都需清理条目，避免僵尸客户端
      this.clients.delete(clientId)
      this.emit('clientRemoved', clientId, entry.role)
    }
  }

  /** 按 ID 查询客户端适配器，不存在则返回 `undefined`。 */
  getClient(clientId: string): ClientAdapter<TClient> | undefined {
    return this.clients.get(clientId)?.adapter
  }

  /** 查询指定客户端所属角色，不存在则返回 `undefined`。 */
  getClientRole(clientId: string): TRole | undefined {
    return this.clients.get(clientId)?.role
  }

  /** 返回指定角色的全部客户端（含未连接的）。 */
  getClientsByRole(role: TRole): readonly ClientAdapter<TClient>[] {
    return [...this.clients.values()].filter((e) => e.role === role).map((e) => e.adapter)
  }

  /** 返回当前处于 `connected` 状态的客户端；传入 `role` 则进一步过滤角色。 */
  getAvailableClients(role?: TRole): readonly ClientAdapter<TClient>[] {
    return [...this.clients.values()]
      .filter((e) => e.adapter.state === 'connected' && (role === undefined || e.role === role))
      .map((e) => e.adapter)
  }

  /** 并行连接所有已注册客户端；单个失败不影响其他客户端，错误通过 `error` 事件上报。 */
  async connectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.clients.values()].map(async ({ adapter }) => {
        try {
          await adapter.connect()
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err))
          this.options.logger?.error('connectAll: 客户端连接失败', adapter.id, error.message)
          this.emit('error', error, adapter.id)
        }
      }),
    )
  }

  /** 并行断开所有 `connected` 状态的客户端；单个失败仅记录日志，不中止其余断连。 */
  async disconnectAll(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.clients.values()]
        .filter((e) => e.adapter.state === 'connected')
        .map((e) => e.adapter.disconnect()),
    )
    for (const result of results) {
      if (result.status === 'rejected') {
        const error =
          result.reason instanceof Error ? result.reason : new Error(String(result.reason))
        this.options.logger?.error('disconnectAll: 客户端断连失败', error.message)
      }
    }
  }

  /** 启动定时状态轮询（无副作用，只读 adapter.state 做 diff），重复调用无副作用（不会创建多个定时器）。 */
  startStatePolling(intervalMs: number): void {
    if (this.statePollingTimer) return
    this.statePollingTimer = setInterval(() => {
      this._pollState()
    }, intervalMs)
  }

  /** 停止状态轮询定时器；未启动时调用无副作用。 */
  stopStatePolling(): void {
    if (this.statePollingTimer) {
      clearInterval(this.statePollingTimer)
      this.statePollingTimer = null
    }
  }

  /**
   * 内部：从指定客户端发射事件（供外部回调和测试使用）。
   *
   * @param clientId - 客户端标识符
   * @param event - 待发射的原始事件
   * @param role - 客户端所属角色
   */
  emitFromClient(clientId: string, event: TEvent, role: TRole): void {
    if (this.dedup && !this.dedup.process(event)) return
    const aggregated: AggregatedEvent<TEvent> = {
      event,
      sourceClientId: clientId,
      sourceRole: role,
      receivedBy: [clientId],
    }
    this.emit('event', aggregated)
  }

  /**
   * 通知客户端状态变更 —— entry.prevState 的唯一写入口。
   *
   * 供两处调用：wireToPool 转发的实时 transport 事件、以及 _pollState 的定时轮询。
   * 若新状态与当前记录的 prevState 相同，判定为重复通知，直接跳过（不 emit），
   * 从根本上消除"轮询缓存"和"实时事件"两条路径各自维护一份状态、彼此不同步的问题。
   */
  notifyStateChange(clientId: string, from: ClientState, to: ClientState): void {
    const entry = this.clients.get(clientId)
    if (entry) {
      if (entry.prevState === to) return
      entry.prevState = to
    }
    this.emit('clientStateChange', clientId, from, to)
  }

  /** 无副作用地轮询所有已注册客户端的当前状态，与 prevState 不一致时通知。 */
  private _pollState(): void {
    for (const [id, entry] of this.clients.entries()) {
      const current = entry.adapter.state
      if (current !== entry.prevState) {
        this.notifyStateChange(id, entry.prevState, current)
      }
    }
  }
}
