/**
 * HandlerInterceptor 接口 —— Spring 风格的前置/后置/完成后钩子。
 */

import type { Context } from './context'
import type { BotCapability } from './decorators'

/** 已解析的处理器信息（供拦截器使用）。 */
export interface ResolvedHandler {
  readonly instance: unknown
  readonly methodName: string | symbol
  readonly handlerName: string
  readonly priority: number
  /** Bot 在群内需要具备的权限等级（null 表示无要求）。 */
  readonly requiredBotCapability: BotCapability | null
}

/**
 * 拦截器接口。
 *
 * 执行顺序（每个匹配到的 handler 各自独立执行一次）：
 *   preHandle -> 处理器执行 -> postHandle -> afterCompletion
 *                                             ^ （异常时也会执行）
 *
 * 所有方法均为可选，未实现时视为通过。
 *
 * 注意：这里的执行粒度是"每个匹配到的 handler"——如果一个事件同时匹配 N 个 handler，
 * 本拦截器的 preHandle/postHandle/afterCompletion 会被完整调用 N 次；如果事件没有匹配
 * 到任何 handler，则一次都不会被调用。这对于依赖某个具体 handler 信息（权限校验、
 * 日志记录 handler 名称等）的拦截器是正确语义。如果需要"无论是否匹配到 handler，
 * 每次 dispatch() 调用都只执行一次"的语义（例如无条件归档每一条消息），改用
 * {@link DispatchInterceptor} 并注册到 EventDispatcherOptions.dispatchInterceptors。
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

/**
 * dispatch 级拦截器接口。
 *
 * 与 {@link HandlerInterceptor} 的关键区别：本接口不与任何具体 handler 绑定，
 * preHandle/postHandle/afterCompletion 在每次 EventDispatcher.dispatch() 调用中
 * 恰好各执行一次，与该次 dispatch 最终匹配到 0 个、1 个还是 N 个 handler 完全无关。
 *
 * 适用场景：需要对"每一个到达的事件"做一次性处理，且该处理不依赖具体命中哪个业务
 * handler 的场景（例如无条件归档消息、埋点上报整体事件量）。若拦截器逻辑需要感知
 * 具体匹配到的 handler（权限校验、按 handler 名称记录日志等），应使用
 * {@link HandlerInterceptor} 并注册到 EventDispatcherOptions.interceptors。
 *
 * 执行顺序：
 *   preHandle（多个 dispatch 级拦截器按注册顺序）
 *     -> 所有匹配 handler 的完整拦截器链 + handler.method（若有匹配）
 *   -> postHandle（逆序）
 *   -> afterCompletion（逆序，无论成功/失败/无 handler 匹配都会执行）
 *
 * preHandle 返回 false 会中止整次 dispatch（包括所有 handler 的执行）。
 */
export interface DispatchInterceptor<TEvent = unknown, TApis = unknown> {
  /** 在解析 handler 之前调用。返回 false 则中止本次 dispatch（所有 handler 均不执行）。 */
  preHandle?(ctx: Context<TEvent, TApis>): Promise<boolean>

  /** 在所有匹配 handler 执行完毕后调用（无论是否有 handler 匹配）。 */
  postHandle?(ctx: Context<TEvent, TApis>): Promise<void>

  /** 在本次 dispatch 完成后调用（无论成功、失败还是被阻断）。用于资源清理。 */
  afterCompletion?(ctx: Context<TEvent, TApis>, error?: Error): Promise<void>
}
