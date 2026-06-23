import { TypedEventEmitter } from '../types/index.js'

import type { ClientAdapter, ClientState } from './adapter.js'
import { DedupPipeline } from './dedup/pipeline.js'
import type { RoleDefinition } from './role.js'
import type { AggregatedEvent, DedupOptions, HealthCheckOptions, PoolEventMap } from './types.js'

export interface ClientPoolOptions<TRole extends string, TEvent> {
  roles: readonly RoleDefinition<TRole>[]
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
}

export class ClientPool<
  TClient = object,
  TRole extends string = string,
  TEvent = object,
> extends TypedEventEmitter<PoolEventMap<TEvent>> {
  private readonly clients = new Map<string, ClientEntry<TClient, TRole>>()
  private readonly roleMap: Map<TRole, RoleDefinition<TRole>>
  private readonly dedup: DedupPipeline<TEvent> | null
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: ClientPoolOptions<TRole, TEvent>) {
    super()
    this.roleMap = new Map(options.roles.map((r) => [r.name, r]))
    this.dedup = options.dedup ? new DedupPipeline(options.dedup) : null
  }

  addClient(adapter: ClientAdapter<TClient>, role: TRole): void {
    this.clients.set(adapter.id, { adapter, role, prevState: adapter.state })
    this.emit('clientAdded', adapter.id, role)
  }

  async removeClient(clientId: string): Promise<void> {
    const entry = this.clients.get(clientId)
    if (!entry) return
    if (entry.adapter.state === 'connected') await entry.adapter.disconnect()
    this.clients.delete(clientId)
    this.emit('clientRemoved', clientId, entry.role)
  }

  getClient(clientId: string): ClientAdapter<TClient> | undefined {
    return this.clients.get(clientId)?.adapter
  }

  getClientsByRole(role: TRole): readonly ClientAdapter<TClient>[] {
    return [...this.clients.values()].filter((e) => e.role === role).map((e) => e.adapter)
  }

  getAvailableClients(role?: TRole): readonly ClientAdapter<TClient>[] {
    return [...this.clients.values()]
      .filter((e) => e.adapter.state === 'connected' && (role === undefined || e.role === role))
      .map((e) => e.adapter)
  }

  async connectAll(): Promise<void> {
    for (const { adapter } of this.clients.values()) {
      try {
        await adapter.connect()
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)), adapter.id)
      }
    }
  }

  async disconnectAll(): Promise<void> {
    for (const { adapter } of this.clients.values()) {
      if (adapter.state === 'connected') await adapter.disconnect()
    }
  }

  startHealthCheck(intervalMs: number): void {
    if (this.healthCheckTimer) return
    this.healthCheckTimer = setInterval(() => {
      void this._runHealthCheck()
    }, intervalMs)
  }

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
    for (const [id, entry] of this.clients) {
      const prev = entry.prevState
      try {
        const alive = await entry.adapter.healthCheck()
        const current: ClientState = alive ? 'connected' : 'disconnected'
        if (current !== prev) {
          entry.prevState = current
          this.notifyStateChange(id, prev, current)
        }
      } catch {
        if (prev !== 'error') {
          entry.prevState = 'error'
          this.notifyStateChange(id, prev, 'error')
        }
      }
    }
  }
}
