import type { RoutingCandidate, RoutingStrategy } from './strategy.js'

/** RoutingTable 构造选项。 */
export interface RoutingTableOptions<TTarget> {
  strategy: RoutingStrategy<TTarget>
  keySerializer: (target: TTarget) => string
}

/** 路由表：维护 target → clientId 映射，委托给策略决策。 */
export class RoutingTable<TTarget> {
  private readonly table = new Map<string, string>()

  constructor(private readonly options: RoutingTableOptions<TTarget>) {}

  /** 根据候选列表解析目标应路由到的客户端，并记录结果。 */
  resolve(target: TTarget, candidates: readonly RoutingCandidate[]): string {
    const key = this.options.keySerializer(target)
    const current = this.table.get(key)
    const selected = this.options.strategy.select(target, candidates, current)
    this.table.set(key, selected)
    return selected
  }

  /** 获取目标当前已路由到的客户端（不触发策略）。 */
  getActiveClient(target: TTarget): string | undefined {
    return this.table.get(this.options.keySerializer(target))
  }

  /** 清除所有指向指定客户端的映射（客户端下线时调用）。 */
  invalidate(clientId: string): void {
    for (const [key, value] of this.table) {
      if (value === clientId) this.table.delete(key)
    }
  }

  /** 清除指定目标的路由映射。 */
  invalidateTarget(target: TTarget): void {
    this.table.delete(this.options.keySerializer(target))
  }

  /** 清空所有路由映射。 */
  clear(): void {
    this.table.clear()
  }
}
