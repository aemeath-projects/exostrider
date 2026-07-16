/**
 * 状态机引擎 —— 管理状态图和转换逻辑。
 */

import type { SessionContext } from './context'
import type { StateDefinition, StateTransitionResult } from './state'

/** 单次 start()/transitionTo() 调用内，最多允许连续自动转换的层数，防止 guard 配置错误导致死循环。 */
const MAX_AUTO_TRANSITION_DEPTH = 10

/** 状态机异常基类。 */
export class StateMachineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateMachineError'
  }
}

/** 无效的状态转换异常。 */
export class InvalidTransitionError extends StateMachineError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidTransitionError'
  }
}

/**
 * 泛型有限状态机。
 *
 * 支持进入/退出回调、输入处理、显式转换，以及进入状态后自动求值的声明式转换
 * （`StateDefinition.transitions`，语义类似 XState 的 `always` transition）。
 */
export class StateMachine<TContext = unknown> {
  private readonly _states: Map<string, StateDefinition<TContext>>
  private _started = false
  private _currentState: string | null = null

  constructor(states: readonly StateDefinition<TContext>[]) {
    this._states = new Map(states.map((s) => [s.id, s]))
  }

  /** 当前状态 ID，未启动时为 null。 */
  getCurrentState(): string | null {
    return this._currentState
  }

  /** 状态机是否已到达终止（finished）状态。未启动时返回 false。 */
  get isFinished(): boolean {
    return this._started && this._currentState === null
  }

  /**
   * 启动状态机，进入初始状态。
   *
   * @param ctx 会话上下文。
   * @param initialStateId 初始状态 ID，默认使用状态列表中的第一个。
   */
  async start(ctx: SessionContext<TContext>, initialStateId?: string): Promise<void> {
    this._started = true
    const firstState = initialStateId ?? this._states.keys().next().value
    if (firstState === undefined) {
      throw new StateMachineError('状态机未注册任何状态')
    }

    if (!this._states.has(firstState)) {
      throw new InvalidTransitionError(`初始状态 '${firstState}' 不存在`)
    }

    this._currentState = firstState
    const state = this._states.get(firstState)
    if (state?.onEnter !== undefined) {
      await state.onEnter(ctx)
    }
    await this._runAutoTransitions(ctx, 0)
  }

  /**
   * 处理用户输入，返回转换结果。
   *
   * @param ctx 会话上下文。
   * @param input 用户输入文本。
   */
  async processInput(ctx: SessionContext<TContext>, input: string): Promise<StateTransitionResult> {
    if (!this._started || this._currentState === null) {
      throw new StateMachineError('状态机未启动')
    }

    const state = this._states.get(this._currentState)
    if (state === undefined) {
      throw new StateMachineError(`当前状态 '${this._currentState}' 不存在`)
    }

    if (state.onInput === undefined) {
      return {}
    }

    const result = await state.onInput(ctx, input)

    if (result.finished === true) {
      // 退出当前状态后标记结束
      if (state.onExit !== undefined) {
        await state.onExit(ctx)
      }
      this._currentState = null
      return result
    }

    if (result.nextState !== undefined) {
      await this.transitionTo(ctx, result.nextState)
    }

    return result
  }

  /**
   * 显式转换到目标状态。
   *
   * @param ctx 会话上下文。
   * @param stateId 目标状态 ID。
   */
  async transitionTo(ctx: SessionContext<TContext>, stateId: string): Promise<void> {
    await this._enterState(ctx, stateId, 0)
  }

  /** 退出当前状态、进入目标状态并执行 onEnter，然后对目标状态的 transitions 求值。 */
  private async _enterState(
    ctx: SessionContext<TContext>,
    stateId: string,
    depth: number,
  ): Promise<void> {
    if (!this._states.has(stateId)) {
      throw new InvalidTransitionError(`目标状态 '${stateId}' 不存在`)
    }

    // 退出当前状态
    if (this._currentState !== null) {
      const current = this._states.get(this._currentState)
      if (current?.onExit !== undefined) {
        await current.onExit(ctx)
      }
    }

    // 进入目标状态
    this._currentState = stateId
    const next = this._states.get(stateId)
    if (next?.onEnter !== undefined) {
      await next.onEnter(ctx)
    }
    await this._runAutoTransitions(ctx, depth)
  }

  /**
   * 按 `transitions` 数组顺序对当前状态求值，第一个 guard 通过的执行 action 后
   * 递归进入 target（depth 加一）；一个都不满足则停留在当前状态。
   */
  private async _runAutoTransitions(ctx: SessionContext<TContext>, depth: number): Promise<void> {
    if (this._currentState === null) return
    const state = this._states.get(this._currentState)
    const transitions = state?.transitions
    if (transitions === undefined || transitions.length === 0) return

    if (depth >= MAX_AUTO_TRANSITION_DEPTH) {
      throw new StateMachineError('自动转换深度超过上限，可能存在循环')
    }

    for (const transition of transitions) {
      const shouldTransition = transition.guard === undefined ? true : await transition.guard(ctx)
      if (shouldTransition) {
        if (transition.action !== undefined) {
          await transition.action(ctx)
        }
        await this._enterState(ctx, transition.target, depth + 1)
        return
      }
    }
  }
}
