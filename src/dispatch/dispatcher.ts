/**
 * EventDispatcher —— 统一事件分发（类似 Spring DispatcherServlet）。
 *
 * 平台无关泛型设计：TEvent/TApis 由调用方传入。
 */

import type { Logger } from '../types'

import type { Context, ContextConfig } from './context.js'
import { Context as ContextImpl } from './context.js'
import type { InterceptorEntry } from './decorators'
import { FinishError } from './errors.js'
import type { HandlerInterceptor, ResolvedHandler } from './interceptor.js'
import type { HandlerMapping, HandlerMethod } from './mapping.js'

/** EventDispatcher 构造选项。 */
export interface EventDispatcherOptions<TEvent, TApis> {
  mapping: HandlerMapping<TEvent, TApis>
  interceptors?: HandlerInterceptor<TEvent, TApis>[]
  contextConfig?: ContextConfig<TEvent, TApis>
  logger?: Logger
}

/**
 * 接收事件，通过映射解析处理器，并运行拦截器链。
 *
 * 拦截器执行顺序（每个 handler 独立执行一次）：
 *   全局 preHandle → 声明式 preHandle → handler.method → 声明式 postHandle（逆序） → 全局 postHandle（逆序） → afterCompletion（始终，逆序）
 *   FinishError：视为正常流程终止，afterCompletion 不传 error。
 *   其他错误：afterCompletion 传 error。
 */
export class EventDispatcher<TEvent = unknown, TApis = unknown> {
  private readonly _mapping: HandlerMapping<TEvent, TApis>
  private readonly _interceptors: HandlerInterceptor<TEvent, TApis>[]
  private readonly _contextConfig: ContextConfig<TEvent, TApis>
  private readonly _logger: Logger | undefined

  constructor(options: EventDispatcherOptions<TEvent, TApis>) {
    this._mapping = options.mapping
    this._interceptors = options.interceptors ?? []
    this._contextConfig = options.contextConfig ?? {}
    this._logger = options.logger
  }

  /** 分发事件到匹配的处理器，依次运行拦截器链。 */
  async dispatch(event: TEvent, apis: TApis): Promise<void> {
    const ctx = new ContextImpl(event, apis, this._contextConfig)

    // 获取所有匹配的处理器
    const handlers = this._getAllHandlers(ctx)
    if (handlers.length === 0) {
      return
    }

    // 按优先级执行处理器
    for (const handler of handlers) {
      await this._runHandlerWithInterceptors(ctx, handler)
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
    }

    // 实例化声明式拦截器
    const declInterceptors = this._instantiateInterceptors(handler.interceptors)

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
          await this._runAfterCompletion(declInterceptors, ctx, resolvedHandler, undefined)
          return
        }
      } catch (err) {
        handlerError = err instanceof Error ? err : new Error(String(err))
        this._logger?.error(`preHandle 中发生错误：${handlerError.message}`)
        executedGlobal.push(interceptor) // 抛出异常的拦截器也已执行过 preHandle，需纳入 afterCompletion
        await this._runAfterCompletion(executedGlobal, ctx, resolvedHandler, handlerError)
        await this._runAfterCompletion(declInterceptors, ctx, resolvedHandler, handlerError)
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
      await this._runAfterCompletion(this._interceptors, ctx, resolvedHandler, handlerError)
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

  /** 按需实例化声明式拦截器列表。 */
  private _instantiateInterceptors(
    entries: readonly InterceptorEntry[],
  ): HandlerInterceptor<TEvent, TApis>[] {
    return entries.map(
      (entry) => new entry.interceptorClass(entry.options) as HandlerInterceptor<TEvent, TApis>,
    )
  }
}
