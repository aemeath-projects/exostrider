import type { RoutingCandidate, RoutingStrategy } from './strategy.js'

/** 优先级粘性策略：当前客户端可用时保持，否则按 priority 升序选择。 */
export class PriorityStickyStrategy<TTarget> implements RoutingStrategy<TTarget> {
  select(
    _target: TTarget,
    candidates: readonly RoutingCandidate[],
    current: string | undefined,
  ): string {
    if (candidates.length === 0) throw new Error('No available candidates')
    if (current !== undefined && candidates.some((c) => c.clientId === current)) return current
    return [...candidates].sort((a, b) => a.priority - b.priority)[0].clientId
  }
}
