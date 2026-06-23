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
}

/** 连接池事件映射。 */
export interface PoolEventMap<TEvent> {
  event: (aggregated: AggregatedEvent<TEvent>) => void
  clientStateChange: (clientId: string, from: ClientState, to: ClientState) => void
  clientAdded: (clientId: string, role: string) => void
  clientRemoved: (clientId: string, role: string) => void
  error: (error: Error, clientId?: string) => void
}
