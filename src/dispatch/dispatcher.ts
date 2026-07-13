/**
 * EventDispatcher —— 统一事件分发（类似 Spring DispatcherServlet）。
 *
 * 平台无关泛型设计：TEvent/TApis 由调用方传入。
 */

import type { Logger } from '../types'

import type { Context, ContextConfig } from './context'
import { Context as ContextImpl } from './context'
import type { InterceptorEntry } from './decorators'
import { FinishError } from './errors'
import type { DispatchInterceptor, HandlerInterceptor, ResolvedHandler } from './interceptor'
import type { HandlerMapping, HandlerMethod } from './mapping'

/** EventDispatcher 构造选项。 */
export interface EventDispatcherOptions<TEvent, TApis> {
  mapping: HandlerMapping<TEvent, TApis>
  interceptors?: HandlerInterceptor<TEvent, TApis>[]
  /**
   * dispatch 级拦截器：每次 dispatch() 调用恰好执行一次，与匹配到 0/1/N 个 handler 无关。
   * 用于"无条件处理每个事件"的场景（如消息归档），与 interceptors（按每个匹配 handler
   * 各执行一次）语义互补，详见 {@link DispatchInterceptor}。
   */
  dispatchInterceptors?: DispatchInterceptor<TEvent, TApis>[]
  contextConfig?: ContextConfig<TEvent, TApis>
  /**
   * 自定义 Context 构造工厂。
   *
   * 不提供时，dispatch() 内部固定使用框架内置的 Context 基类实例化 ctx。若调用方定义了
   * Context 的子类（例如附加平台专属的便捷 getter/方法，如 OneBot 的 groupId/reply()），
   * 必须通过本选项显式传入构造逻辑，否则拦截器与 handler 收到的 ctx 永远是基类实例，
   * 子类新增/覆盖的成员不会生效（TypeScript 的类型标注不会改变运行时实际构造出的类）。
   */
  contextFactory?: (
    event: TEvent,
    apis: TApis,
    config: ContextConfig<TEvent, TApis>,
  ) => Context<TEvent, TApis>
  logger?: Logger
}

/**
 * 接收事件，通过映射解析处理器，并运行拦截器链。
 *
 * 拦截器执行顺序：
 *   dispatch 级 preHandle（每次 dispatch 一次，见 dispatchInterceptors）
 *     → [对每个匹配到的 handler：全局 preHandle → 声明式 preHandle → handler.method →
 *        声明式 postHandle（逆序） → 全局 postHandle（逆序） → afterCompletion（始终，逆序）]
 *   → dispatch 级 postHandle（逆序，无论是否有 handler 匹配都执行）
 *   → dispatch 级 afterCompletion（逆序，始终执行）
 *
 *   FinishError：视为正常流程终止，afterCompletion 不传 error。
 *   其他错误：afterCompletion 传 error。
 */
export class EventDispatcher<TEvent = unknown, TApis = unknown> {
  private readonly _mapping: HandlerMapping<TEvent, TApis>
  private readonly _interceptors: HandlerInterceptor<TEvent, TApis>[]
  private readonly _dispatchInterceptors: DispatchInterceptor<TEvent, TApis>[]
  private readonly _contextConfig: ContextConfig<TEvent, TApis>
  private readonly _contextFactory:
    | ((event: TEvent, apis: TApis, config: ContextConfig<TEvent, TApis>) => Context<TEvent, TApis>)
    | undefined
  private readonly _logger: Logger | undefined
  // 声明式拦截器实例缓存：以 HandlerMethod.interceptors 数组引用为 key，避免每次分发重新实例化
  private readonly _declInterceptorCache = new WeakMap<
    readonly InterceptorEntry[],
    HandlerInterceptor<TEvent, TApis>[]
  >()

  constructor(options: EventDispatcherOptions<TEvent, TApis>) {
    this._mapping = options.mapping
    this._interceptors = options.interceptors ?? []
    this._dispatchInterceptors = options.dispatchInterceptors ?? []
    this._contextConfig = options.contextConfig ?? {}
    this._contextFactory = options.contextFactory
    this._logger = options.logger
  }

  /** 分发事件到匹配的处理器，依次运行拦截器链。 */
  async dispatch(event: TEvent, apis: TApis): Promise<void> {
    const ctx = this._contextFactory
      ? this._contextFactory(event, apis, this._contextConfig)
      : new ContextImpl(event, apis, this._contextConfig)

    // dispatch 级拦截器 preHandle（顺序，每次 dispatch 恰好一次）
    const executedDispatch: DispatchInterceptor<TEvent, TApis>[] = []
    let dispatchError: Error | undefined
    let dispatchBlocked = false
    for (const interceptor of this._dispatchInterceptors) {
      try {
        const ok = interceptor.preHandle ? await interceptor.preHandle(ctx) : true
        executedDispatch.push(interceptor)
        if (!ok) {
          this._logger?.debug(`dispatch 级拦截器阻断了事件处理: ${interceptor.constructor.name}`)
          dispatchBlocked = true
          break
        }
      } catch (err) {
        dispatchError = err instanceof Error ? err : new Error(String(err))
        this._logger?.error(`dispatch 级拦截器 preHandle 中发生错误：${dispatchError.message}`)
        // 抛出异常的拦截器本身也已经"执行过 preHandle"，需要纳入 afterCompletion（与
        // handler 级 _runHandlerWithInterceptors 的对称处理一致），否则该拦截器自己的
        // afterCompletion 不会被调用，无法感知/清理自己刚才抛出的错误。
        executedDispatch.push(interceptor)
        break
      }
    }

    if (dispatchBlocked || dispatchError !== undefined) {
      await this._runDispatchAfterCompletion(executedDispatch, ctx, dispatchError)
      return
    }

    // 获取所有匹配的处理器（可能为空，dispatch 级拦截器仍需走完 postHandle/afterCompletion）
    const handlers = this._getAllHandlers(ctx)
    for (const handler of handlers) {
      await this._runHandlerWithInterceptors(ctx, handler)
    }

    // dispatch 级拦截器 postHandle（逆序）
    for (const interceptor of [...this._dispatchInterceptors].reverse()) {
      try {
        if (interceptor.postHandle) await interceptor.postHandle(ctx)
      } catch (err) {
        dispatchError = err instanceof Error ? err : new Error(String(err))
        this._logger?.error(`dispatch 级拦截器 postHandle 中发生错误：${dispatchError.message}`)
        break
      }
    }

    await this._runDispatchAfterCompletion(this._dispatchInterceptors, ctx, dispatchError)
  }

  /** 批量执行 dispatch 级拦截器的 afterCompletion（逆序，忽略内部错误）。 */
  private async _runDispatchAfterCompletion(
    interceptors: readonly DispatchInterceptor<TEvent, TApis>[],
    ctx: Context<TEvent, TApis>,
    error: Error | undefined,
  ): Promise<void> {
    for (const interceptor of [...interceptors].reverse()) {
      try {
        if (interceptor.afterCompletion) await interceptor.afterCompletion(ctx, error)
      } catch (cleanupErr) {
        this._logger?.error(`dispatch 级拦截器 afterCompletion 中发生错误：${String(cleanupErr)}`)
      }
    }
  }

  /** 获取所有匹配的处理器（按优先级排序）。 */
  private _getAllHandlers(ctx: ContextImpl<TEvent, TApis>): HandlerMethod[] {
    // CompositeHandlerMapping 有 getAllHandlers 方法，其他 HandlerMapping 只有 getHandler
    const mapping = this._mapping
    if (
      'getAllHandlers' in mapping &&
      typeof (mapping as { getAllHandlers?: unknown }).getAllHandlers === 'function'
    ) {
      return (
        mapping as { getAllHandlers: (ctx: ContextImpl<TEvent, TApis>) => HandlerMethod[] }
      ).getAllHandlers(ctx)
    }
    // 降级到单个 handler
    const handler = mapping.getHandler(ctx)
    return handler ? [handler] : []
  }

  /** 为单个 handler 运行完整的拦截器链（全局 + 声明式）。 */
  private async _runHandlerWithInterceptors(
    ctx: ContextImpl<TEvent, TApis>,
    handler: HandlerMethod,
  ): Promise<void> {
    const resolvedHandler: ResolvedHandler = {
      instance: handler.instance,
      methodName: handler.methodName,
      handlerName: handler.handlerName,
      priority: handler.priority,
      requiredBotCapability: handler.requiredBotCapability,
    }

    // 获取（或缓存复用）声明式拦截器实例
    const declInterceptors = this._getOrCreateDeclInterceptors(handler.interceptors)

    let handlerError: Error | undefined

    // 全局拦截器 preHandle（顺序），追踪已执行的拦截器以确保 afterCompletion 只覆盖已执行的
    const executedGlobal: HandlerInterceptor<TEvent, TApis>[] = []
    for (const interceptor of this._interceptors) {
      try {
        const ok = interceptor.preHandle ? await interceptor.preHandle(ctx, resolvedHandler) : true
        executedGlobal.push(interceptor) // 追踪已执行（含 preHandle 返回 false 的）
        if (!ok) {
          this._logger?.debug(`拦截器阻断了事件处理: ${interceptor.constructor.name}`)
          await this._runAfterCompletion(executedGlobal, ctx, resolvedHandler, undefined)
          // 声明式拦截器 preHandle 未执行，afterCompletion 不应调用（传空列表）
          await this._runAfterCompletion([], ctx, resolvedHandler, undefined)
          return
        }
      } catch (err) {
        handlerError = err instanceof Error ? err : new Error(String(err))
        this._logger?.error(`preHandle 中发生错误：${handlerError.message}`)
        executedGlobal.push(interceptor) // 抛出异常的拦截器也已执行过 preHandle，需纳入 afterCompletion
        await this._runAfterCompletion(executedGlobal, ctx, resolvedHandler, handlerError)
        // 声明式拦截器 preHandle 未执行，afterCompletion 不应调用（传空列表）
        await this._runAfterCompletion([], ctx, resolvedHandler, handlerError)
        return
      }
    }

    // 声明式拦截器 preHandle（顺序）
    const executedDecl: HandlerInterceptor<TEvent, TApis>[] = []
    let declBlocked = false
    for (const interceptor of declInterceptors) {
      try {
        const ok = interceptor.preHandle ? await interceptor.preHandle(ctx, resolvedHandler) : true
        executedDecl.push(interceptor)
        if (!ok) {
          this._logger?.debug(`声明式拦截器阻断了事件处理: ${interceptor.constructor.name}`)
          declBlocked = true
          break
        }
      } catch (err) {
        handlerError = err instanceof Error ? err : new Error(String(err))
        this._logger?.error(`声明式拦截器 preHandle 中发生错误：${handlerError.message}`)
        break
      }
    }

    if (declBlocked || handlerError !== undefined) {
      await this._runAfterCompletion(executedGlobal, ctx, resolvedHandler, handlerError)
      await this._runAfterCompletion(executedDecl, ctx, resolvedHandler, handlerError)
      return
    }

    // 调用处理器方法
    try {
      const instance = handler.instance
      const methodName = handler.methodName
      const fn = (instance as Record<string | symbol, unknown>)[methodName]
      if (typeof fn !== 'function') {
        throw new Error(`handler "${handler.handlerName}" 上找不到方法 "${String(methodName)}"`)
      }
      await (fn as (this: unknown, ...args: unknown[]) => Promise<unknown>).call(instance, ctx)

      // postHandle（声明式逆序，全局逆序）
      for (const interceptor of [...declInterceptors].reverse()) {
        try {
          if (interceptor.postHandle) await interceptor.postHandle(ctx, resolvedHandler)
        } catch (err) {
          handlerError = err instanceof Error ? err : new Error(String(err))
          this._logger?.error(`声明式拦截器 postHandle 中发生错误：${handlerError.message}`)
          break
        }
      }
      // 有意设计：postHandle 阶段 fail-fast，与 preHandle 错误行为对称。
      // 声明式 postHandle 出错后直接跳到 afterCompletion，全局 postHandle 不再执行。
      if (!handlerError) {
        for (const interceptor of [...this._interceptors].reverse()) {
          try {
            if (interceptor.postHandle) await interceptor.postHandle(ctx, resolvedHandler)
          } catch (err) {
            handlerError = err instanceof Error ? err : new Error(String(err))
            this._logger?.error(`postHandle 中发生错误：${handlerError.message}`)
            break
          }
        }
      }
    } catch (err) {
      if (err instanceof FinishError) {
        // 正常流程终止，不视为错误，handlerError 保持 undefined
      } else {
        handlerError = err instanceof Error ? err : new Error(String(err))
        this._logger?.error(
          `handler "${handler.handlerName}.${String(handler.methodName)}" 执行失败：${handlerError.message}`,
        )
      }
    }

    // afterCompletion（始终执行，全局逆序，声明式逆序）
    await this._runAfterCompletion(this._interceptors, ctx, resolvedHandler, handlerError)
    await this._runAfterCompletion(declInterceptors, ctx, resolvedHandler, handlerError)
  }

  /** 批量执行 afterCompletion（逆序，忽略内部错误）。 */
  private async _runAfterCompletion(
    interceptors: readonly HandlerInterceptor<TEvent, TApis>[],
    ctx: Context<TEvent, TApis>,
    resolved: ResolvedHandler,
    error: Error | undefined,
  ): Promise<void> {
    for (const interceptor of [...interceptors].reverse()) {
      try {
        if (interceptor.afterCompletion) {
          await interceptor.afterCompletion(ctx, resolved, error)
        }
      } catch (cleanupErr) {
        this._logger?.error(`afterCompletion 中发生错误：${String(cleanupErr)}`)
      }
    }
  }

  /** 按需实例化声明式拦截器列表，结果缓存到 WeakMap 中复用。 */
  private _getOrCreateDeclInterceptors(
    entries: readonly InterceptorEntry[],
  ): HandlerInterceptor<TEvent, TApis>[] {
    const cached = this._declInterceptorCache.get(entries)
    if (cached !== undefined) return cached
    const instances = entries.map(
      (entry) => new entry.interceptorClass(entry.options) as HandlerInterceptor<TEvent, TApis>,
    )
    this._declInterceptorCache.set(entries, instances)
    return instances
  }
}
