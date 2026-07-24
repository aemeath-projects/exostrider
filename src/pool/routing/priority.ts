/** 优先级路由策略实现。 */
import type { RoutingCandidate, RoutingStrategy } from './strategy'

/** 优先级路由策略：始终选 priority 最小的候选。 */
export class PriorityStrategy<TTarget> implements RoutingStrategy<TTarget> {
  select(
    _target: TTarget,
    candidates: readonly RoutingCandidate[],
    _current: string | undefined,
  ): string {
    if (candidates.length === 0) throw new Error('没有可用的客户端候选')
    return [...candidates].sort((a, b) => a.priority - b.priority)[0].clientId
  }
}
