/** 路由候选项。 */
export interface RoutingCandidate {
  readonly clientId: string
  readonly role: string
  readonly priority: number
}

/** 路由策略接口。 */
export interface RoutingStrategy<TTarget> {
  select(
    target: TTarget,
    candidates: readonly RoutingCandidate[],
    current: string | undefined,
  ): string
}
