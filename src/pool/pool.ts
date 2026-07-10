import { TypedEventEmitter } from '../types'

import type { ClientAdapter, ClientState } from './adapter'
import { DedupPipeline } from './dedup/pipeline'
import type { AggregatedEvent, DedupOptions, HealthCheckOptions, PoolEventMap } from './types'

/** `ClientPool` 构造选项。`logger` 由门面类自动注入，直接使用时可手动传入。 */
export interface ClientPoolOptions<TEvent> {
  dedup?: DedupOptions<TEvent>
  healthCheck?: HealthCheckOptions
  logger?: {
    warn(msg: string, ...args: unknown[]): void
    error(msg: string, ...args: unknown[]): void
  }
}

interface ClientEntry<TClient, TRole extends string> {
  adapter: ClientAdapter<TClient>
  role: TRole
  prevState: ClientState
  /** 上一次健康检查触发的 forceReconnect 是否仍在执行，避免其耗时超过检查间隔时被并发重复调用。 */
  forceReconnectInFlight: boolean
  /** 连续健康检查失败次数；healthCheck() 成功一次即清零。 */
  consecutiveHealthCheckFailures: number
}

/** `maxConsecutiveFailures` 未配置时的默认值。 */
const DEFAULT_MAX_CONSECUTIVE_HEALTH_CHECK_FAILURES = 5

/**
 * 多客户端连接池，支持角色分类、事件去重和健康检查。
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
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null
  /** 连续健康检查失败达到这个次数后，即使适配器一直"看起来在尝试 forceReconnect"，也强制标记为 error 并通知——
   *  防止 forceReconnect 本身从不抛出、但连接实际上一直是"假死"（僵尸连接从未真正恢复）时，
   *  故障状态因为从未有 transport 事件触发 notifyStateChange 而永远不被上报。 */
  private readonly maxConsecutiveHealthCheckFailures: number

  constructor(private readonly options: ClientPoolOptions<TEvent>) {
    super()
    this.dedup = options.dedup ? new DedupPipeline(options.dedup) : null
    this.maxConsecutiveHealthCheckFailures =
      options.healthCheck?.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_HEALTH_CHECK_FAILURES
  }

  /** 向连接池注册一个客户端适配器，并发射 `clientAdded` 事件。若适配器实现了 `wireToPool`，自动调用完成事件绑定；`wireToPool` 抛出时记录日志但不中止注册流程。 */
  addClient(adapter: ClientAdapter<TClient>, role: TRole): void {
    this.clients.set(adapter.id, {
      adapter,
      role,
      prevState: adapter.state,
      forceReconnectInFlight: false,
      consecutiveHealthCheckFailures: 0,
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

  /** 启动定时健康检查，重复调用无副作用（不会创建多个定时器）。 */
  startHealthCheck(intervalMs: number): void {
    if (this.healthCheckTimer) return
    this.healthCheckTimer = setInterval(() => {
      // _runHealthCheck 内部已全量 try/catch，Promise 拒绝不会逃逸，void 安全
      void this._runHealthCheck()
    }, intervalMs)
  }

  /** 停止健康检查定时器；未启动时调用无副作用。 */
  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  /** 内部：从指定客户端发射事件（供外部回调和测试使用）。 */
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

  /** 内部：通知客户端状态变更。 */
  notifyStateChange(clientId: string, from: ClientState, to: ClientState): void {
    this.emit('clientStateChange', clientId, from, to)
  }

  private async _runHealthCheck(): Promise<void> {
    await Promise.allSettled(
      [...this.clients.entries()].map(async ([id, entry]) => {
        const prev = entry.prevState
        try {
          const alive = await entry.adapter.healthCheck()
          // 健康检查等待期间该客户端可能已被 removeClient 移除（或以同 id 重新 addClient
          // 替换成了新条目），此时这次结果已经过期，不应再写回/通知。
          if (this.clients.get(id) !== entry) return
          const current: ClientState = alive ? 'connected' : 'disconnected'
          entry.consecutiveHealthCheckFailures = 0
          if (current !== prev) {
            entry.prevState = current
            this.notifyStateChange(id, prev, current)
          }
        } catch {
          // healthCheck() 等待期间该客户端可能已被 removeClient 移除（或以同 id 重新
          // addClient 替换成了新条目）——此时这次失败结果已经过期，既不该记日志/累加
          // 失败计数，更不该对一个已经不在池子里的适配器调用 forceReconnect()。
          if (this.clients.get(id) !== entry) return
          this.options.logger?.error('healthCheck: 客户端异常', id)
          entry.consecutiveHealthCheckFailures++
          if (entry.adapter.forceReconnect) {
            // 强制重连本身不在这里判定成功与否——真实结果由 transport 的
            // close/connect/giveUp 事件链路驱动 notifyStateChange，避免引入
            // 与该链路冲突的第二套状态源。但如果上一次 forceReconnect 还没
            // 结束，本次 tick 跳过，避免耗时的重连被并发重复调用。
            if (!entry.forceReconnectInFlight) {
              entry.forceReconnectInFlight = true
              try {
                await entry.adapter.forceReconnect()
              } catch (reconnectErr) {
                this.options.logger?.error(
                  'healthCheck: 强制重连失败，等待 transport 自身重连策略',
                  id,
                  reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr),
                )
              } finally {
                entry.forceReconnectInFlight = false
              }
            }
            // forceReconnect 等待期间该客户端同样可能已被移除/替换，过期结果不再处理。
            if (this.clients.get(id) !== entry) return
            // 连续多次健康检查都失败，说明 forceReconnect 从未真正让连接恢复
            // 可用（哪怕 forceReconnect() 本身一直不抛异常）——这种情况下 transport
            // 自身的事件链路可能永远不会触发，必须有一个兜底上报，否则故障会
            // 无限期不可见。
            if (
              entry.consecutiveHealthCheckFailures >= this.maxConsecutiveHealthCheckFailures &&
              prev !== 'error'
            ) {
              entry.prevState = 'error'
              this.notifyStateChange(id, prev, 'error')
            }
            return
          }
          if (prev !== 'error') {
            entry.prevState = 'error'
            this.notifyStateChange(id, prev, 'error')
          }
        }
      }),
    )
  }
}
