import type { RoutingCandidate, RoutingStrategy } from './strategy'

/** 粘性路由策略：当前客户端仍在候选中则保持，否则选第一个。 */
export class StickyStrategy<TTarget> implements RoutingStrategy<TTarget> {
  select(
    _target: TTarget,
    candidates: readonly RoutingCandidate[],
    current: string | undefined,
  ): string {
    if (candidates.length === 0) throw new Error('没有可用的客户端候选')
    if (current !== undefined && candidates.some((c) => c.clientId === current)) return current
    return candidates[0].clientId
  }
}
