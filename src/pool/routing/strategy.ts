/** 路由候选项。 */
export interface RoutingCandidate {
  readonly clientId: string
  readonly role: string
  readonly priority: number
}

/** 路由策略接口。 */
export interface RoutingStrategy<TTarget> {
  /**
   * 从候选中选择一个客户端。
   *
   * @param target - 路由目标标识，由调用方传入
   * @param candidates - 可用客户端候选列表
   * @param current - 当前已路由到的客户端 ID，不存在则为 undefined
   * @returns 选中的客户端 ID
   */
  select(
    target: TTarget,
    candidates: readonly RoutingCandidate[],
    current: string | undefined,
  ): string
}
