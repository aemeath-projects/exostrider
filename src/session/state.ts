/**
 * 状态定义与转换结果类型。
 */

import type { SessionContext } from './context'

/** 状态定义接口。 */
export interface StateDefinition<TContext = unknown> {
  /** 状态唯一标识。 */
  readonly id: string
  /** 进入状态时的回调。 */
  onEnter?(ctx: SessionContext<TContext>): Promise<void>
  /** 接收用户输入的处理函数，返回转换结果。 */
  onInput?(ctx: SessionContext<TContext>, input: string): Promise<StateTransitionResult>
  /** 退出状态时的回调。 */
  onExit?(ctx: SessionContext<TContext>): Promise<void>
  /**
   * 进入该状态（onEnter 执行完毕）后自动求值的声明式转换列表，按数组顺序对每个
   * guard 求值，第一个返回 true 的执行其 action 后自动跳转到 target，不等待用户输入。
   * 一个都不满足则停留在当前状态，等待用户输入（走 onInput 路径）。
   */
  readonly transitions?: readonly TransitionConfig<TContext>[]
}

/** 状态转换结果。 */
export interface StateTransitionResult {
  /** 下一个状态 ID，不填则停留当前状态。 */
  readonly nextState?: string
  /** 是否结束会话。 */
  readonly finished?: boolean
  /** 附加数据，传递给状态机或上层逻辑。 */
  readonly data?: unknown
}

/** 转换配置（配置式定义使用）。 */
export interface TransitionConfig<TContext = unknown> {
  /** 目标状态 ID。 */
  readonly target: string
  /** 转换守卫，返回 false 则跳过此转换。 */
  readonly guard?: (ctx: SessionContext<TContext>) => Promise<boolean>
  /** 转换动作，在守卫通过后执行。 */
  readonly action?: (ctx: SessionContext<TContext>) => Promise<void>
}
