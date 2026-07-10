import type { ClientState } from './adapter'
import type { DedupKeyExtractor } from './dedup/extractor'

/** 聚合后的事件信封。 */
export interface AggregatedEvent<TEvent> {
  readonly event: TEvent
  readonly sourceClientId: string
  readonly sourceRole: string
  readonly receivedBy: readonly string[]
}

/** 去重配置。 */
export interface DedupOptions<TEvent> {
  keyExtractor: DedupKeyExtractor<TEvent>
  windowMs: number
  maxCacheSize: number
}

/** 健康检测配置。 */
export interface HealthCheckOptions {
  intervalMs: number
  /**
   * healthCheck() 连续失败达到这个次数后，即使适配器实现了 forceReconnect 且从不抛出异常，
   * 也强制标记为 error 并通知一次——防止连接"看起来一直在尝试重连但从未真正恢复"时，
   * 故障状态因为没有 transport 事件触发 notifyStateChange 而永远不被上报。默认 5。
   */
  maxConsecutiveFailures?: number
}

/** 连接池事件映射。 */
export interface PoolEventMap<TEvent> {
  event: (aggregated: AggregatedEvent<TEvent>) => void
  clientStateChange: (clientId: string, from: ClientState, to: ClientState) => void
  clientAdded: (clientId: string, role: string) => void
  clientRemoved: (clientId: string, role: string) => void
  error: (error: Error, clientId?: string) => void
}
