/**
 * HandlerInterceptor 接口 —— Spring 风格的前置/后置/完成后钩子。
 */

import type { Context } from './context.js'

/** 已解析的处理器信息（供拦截器使用）。 */
export interface ResolvedHandler {
  readonly instance: unknown
  readonly methodName: string | symbol
  readonly handlerName: string
  readonly priority: number
}

/**
 * 拦截器接口。
 *
 * 执行顺序：
 *   preHandle -> 处理器执行 -> postHandle -> afterCompletion
 *                                             ^ （异常时也会执行）
 *
 * 所有方法均为可选，未实现时视为通过。
 */
export interface HandlerInterceptor<TEvent = unknown, TApis = unknown> {
  /** 在处理器执行前调用。返回 false 则中止调用链。 */
  preHandle?(ctx: Context<TEvent, TApis>, handler: ResolvedHandler): Promise<boolean>

  /** 在处理器成功执行后调用。 */
  postHandle?(ctx: Context<TEvent, TApis>, handler: ResolvedHandler): Promise<void>

  /** 在完成后调用（无论成功或失败）。用于资源清理。 */
  afterCompletion?(
    ctx: Context<TEvent, TApis>,
    handler: ResolvedHandler,
    error?: Error,
  ): Promise<void>
}
