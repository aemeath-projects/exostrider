/**
 * 会话装饰器 —— 标记会话类和状态处理方法。
 *
 * 使用 TC39 Stage 3 类装饰器规范。
 * 元数据通过函数属性（Property Assignment）附加，与 DecoratorMetadataObject 解耦。
 */

import { SESSION_META_KEY, STATE_META_KEY, INPUT_META_KEY, EXIT_META_KEY } from './base'
import type { SessionClassMeta, StateMethMeta, InputMethMeta, ExitMethMeta } from './base'

export type { SessionClassMeta as SessionOptions, StateMethMeta as StateOptions }

/* 装饰器选项类型 */

/** @interactiveSession 装饰器选项。 */
export interface InteractiveSessionOptions {
  readonly name: string
  readonly description?: string
}

/** @state 装饰器选项。 */
export interface StateDecoratorOptions {
  readonly initial?: boolean
  readonly description?: string
}

/** 带元数据的函数类型（内部使用）。 */
interface FunctionWithMeta {
  [SESSION_META_KEY]?: SessionClassMeta
  [STATE_META_KEY]?: StateMethMeta
  [INPUT_META_KEY]?: InputMethMeta
  [EXIT_META_KEY]?: ExitMethMeta
}

function assignMeta<K extends keyof FunctionWithMeta>(
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  target: Function,
  key: K,
  value: FunctionWithMeta[K],
): void {
  Object.assign(target, { [key]: value })
}

/* 装饰器实现 */

/**
 * 标记类为交互式会话。
 *
 * ```ts
 * @interactiveSession({ name: 'feedback' })
 * class FeedbackSession extends InteractiveSession { ... }
 * ```
 */
export function interactiveSession(options: InteractiveSessionOptions) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    const meta: SessionClassMeta = {
      name: options.name,
      description: options.description,
    }
    assignMeta(target, SESSION_META_KEY, meta)
  }
}

/**
 * 标记方法为状态入口（onEnter）。
 *
 * ```ts
 * @state('ask_name', { initial: true })
 * async askName(ctx: SessionContext): Promise<void> { ... }
 * ```
 */
export function state(id: string, options?: StateDecoratorOptions) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    const meta: StateMethMeta = {
      id,
      initial: options?.initial,
      description: options?.description,
    }
    assignMeta(target, STATE_META_KEY, meta)
  }
}

/**
 * 标记方法为状态输入处理器。
 *
 * 用户在该状态下发送消息时调用此方法。
 * 方法应返回包含 nextState 或 finished 的 StateTransitionResult。
 */
export function onInput(stateId: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    const meta: InputMethMeta = { stateId }
    assignMeta(target, INPUT_META_KEY, meta)
  }
}

/**
 * 标记方法为状态退出回调。
 *
 * 离开该状态时自动调用。
 */
export function onExit(stateId: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (target: Function): void {
    const meta: ExitMethMeta = { stateId }
    assignMeta(target, EXIT_META_KEY, meta)
  }
}
