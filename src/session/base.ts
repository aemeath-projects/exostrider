/**
 * InteractiveSession 基类 —— 会话实例的核心抽象。
 */

import type { SessionContext } from './context'
import type { StateDefinition, StateTransitionResult } from './state'

// 装饰器元数据键（与 decorators.ts 保持一致）
export const SESSION_META_KEY = '__exostrider_session_meta__'
export const STATE_META_KEY = '__exostrider_state_meta__'
export const INPUT_META_KEY = '__exostrider_input_meta__'
export const EXIT_META_KEY = '__exostrider_exit_meta__'

/** @interactiveSession 装饰器元数据接口（内部使用）。 */
export interface SessionClassMeta {
  readonly name: string
  readonly description?: string
}

/** @state 装饰器元数据接口（内部使用）。 */
export interface StateMethMeta {
  readonly id: string
  readonly initial?: boolean
  readonly description?: string
}

/** @onInput 装饰器元数据接口（内部使用）。 */
export interface InputMethMeta {
  readonly stateId: string
}

/** @onExit 装饰器元数据接口（内部使用）。 */
export interface ExitMethMeta {
  readonly stateId: string
}

/** 带元数据键的函数对象接口。 */
interface FunctionWithMeta {
  [SESSION_META_KEY]?: SessionClassMeta
  [STATE_META_KEY]?: StateMethMeta
  [INPUT_META_KEY]?: InputMethMeta
  [EXIT_META_KEY]?: ExitMethMeta
}

/**
 * 交互式会话基类。
 *
 * 状态定义支持两种方式：
 * 1. 装饰器 DSL：使用 @state / @onInput / @onExit 装饰方法
 * 2. 配置式：重写 buildStates() 方法返回 StateDefinition 列表
 *
 * @template TData 会话完成后产出的数据类型
 * @template TContext 原始上下文类型
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export abstract class InteractiveSession<TData = unknown, TContext = unknown> {
  /**
   * 子类重写此方法以配置式定义状态，不重写则使用装饰器 DSL。
   */
  buildStates(): StateDefinition<TContext>[] {
    return []
  }

  // 生命周期钩子（均为可选重写）

  /** 会话启动时调用。 */
  onStart?(ctx: SessionContext<TContext>): Promise<void>

  /** 会话正常结束时调用（状态机 finished）。 */
  onFinish?(ctx: SessionContext<TContext>, data: TData): Promise<void>

  /** 用户取消会话时调用。 */
  onCancel?(ctx: SessionContext<TContext>): Promise<void>

  /** 会话超时时调用。 */
  onTimeout?(ctx: SessionContext<TContext>): Promise<void>

  /** 会话处理异常时调用。 */
  onError?(ctx: SessionContext<TContext>, error: Error): Promise<void>

  // 内部工具方法

  /**
   * 从装饰器元数据构建状态定义列表。
   *
   * 扫描实例原型链上的方法，收集 @state / @onInput / @onExit 元数据，
   * 组装成 StateDefinition 列表。
   *
   * @internal 供框架基础设施（SessionManager）调用，不面向子类或外部使用者。
   * 外部代码请使用模块导出的 `buildStatesFromDecorators()` 辅助函数。
   */
  // eslint-disable-next-line @typescript-eslint/naming-convention
  _buildStatesFromDecorators(): StateDefinition<TContext>[] {
    type InputHandler = (
      ctx: SessionContext<TContext>,
      input: string,
    ) => Promise<StateTransitionResult>
    type ExitHandler = (ctx: SessionContext<TContext>) => Promise<void>
    type EnterHandler = (ctx: SessionContext<TContext>) => Promise<void>

    const stateDefs = new Map<
      string,
      {
        onEnter: EnterHandler | undefined
        initial: boolean
      }
    >()
    const inputHandlers = new Map<string, InputHandler>()
    const exitHandlers = new Map<string, ExitHandler>()

    // 扫描原型链上的方法
    let proto = Object.getPrototypeOf(this) as object | null
    const seenNames = new Set<string>()
    const orderedAttrs: [string, FunctionWithMeta][] = []

    while (proto !== null && proto !== Object.prototype) {
      for (const attrName of Object.getOwnPropertyNames(proto)) {
        if (!seenNames.has(attrName)) {
          seenNames.add(attrName)
          const val = (this as Record<string, unknown>)[attrName]
          if (typeof val === 'function') {
            orderedAttrs.push([attrName, val as FunctionWithMeta])
          }
        }
      }
      proto = Object.getPrototypeOf(proto) as object | null
    }

    let initialState: string | null = null

    for (const [, attr] of orderedAttrs) {
      // @state 装饰器元数据
      const smeta = attr[STATE_META_KEY]
      if (smeta !== undefined) {
        stateDefs.set(smeta.id, {
          onEnter: attr as unknown as EnterHandler,
          initial: smeta.initial ?? false,
        })
        if (smeta.initial === true) {
          if (initialState !== null) {
            throw new Error(
              `会话 ${this.constructor.name} 定义了多个初始状态: '${initialState}' 和 '${smeta.id}'`,
            )
          }
          initialState = smeta.id
        }
      }

      // @onInput 装饰器元数据
      const imeta = attr[INPUT_META_KEY]
      if (imeta !== undefined) {
        inputHandlers.set(imeta.stateId, attr as unknown as InputHandler)
      }

      // @onExit 装饰器元数据
      const emeta = attr[EXIT_META_KEY]
      if (emeta !== undefined) {
        exitHandlers.set(emeta.stateId, attr as unknown as ExitHandler)
      }
    }

    if (stateDefs.size === 0) {
      return []
    }

    // 若没有显式 initial，取第一个
    const resolvedInitial = initialState ?? stateDefs.keys().next().value ?? ''

    // 组装 StateDefinition 列表（初始状态排首位）
    const makeStateDef = (
      id: string,
      sdef: { onEnter: EnterHandler | undefined },
    ): StateDefinition<TContext> => {
      const onEnter = sdef.onEnter
      const onInput = inputHandlers.get(id)
      const onExit = exitHandlers.get(id)
      return {
        id,
        ...(onEnter !== undefined ? { onEnter } : {}),
        ...(onInput !== undefined ? { onInput } : {}),
        ...(onExit !== undefined ? { onExit } : {}),
      }
    }

    const states: StateDefinition<TContext>[] = []
    // 确保 initial 状态排在第一位
    const initialDef = stateDefs.get(resolvedInitial)
    if (initialDef !== undefined) {
      states.push(makeStateDef(resolvedInitial, initialDef))
    }
    for (const [id, sdef] of stateDefs) {
      if (id !== resolvedInitial) {
        states.push(makeStateDef(id, sdef))
      }
    }

    return states
  }
}

/**
 * 框架内部辅助函数：从装饰器元数据构建会话状态定义列表。
 *
 * @internal 供 SessionManager 等框架基础设施调用，不对外暴露给业务代码。
 */
export function buildStatesFromDecorators<TContext>(
  session: InteractiveSession<unknown, TContext>,
): StateDefinition<TContext>[] {
  return session._buildStatesFromDecorators()
}
