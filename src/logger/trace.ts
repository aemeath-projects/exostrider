/**
 * Trace context —— 基于 Node.js 内置 AsyncLocalStorage 的轻量单层 traceId 传播。
 *
 * 不引入 OpenTelemetry 或任何第三方可观测性依赖，仅提供跨异步调用链关联同一次
 * 事件/请求处理的最小能力，供 createLogger() 的 mixin() 自动读取并附加到每条日志。
 */
import { AsyncLocalStorage } from 'node:async_hooks'

interface TraceContext {
  traceId: string
}

const traceStorage = new AsyncLocalStorage<TraceContext>()

/**
 * 在指定 traceId 的上下文中执行函数，适合有明确函数作用域可以整体包裹的场景
 * （如 Bot 事件分发入口）。函数返回后，外部上下文自动恢复为调用前的状态。
 */
export function runWithTrace<T>(traceId: string, fn: () => T): T {
  return traceStorage.run({ traceId }, fn)
}

/**
 * 进入 trace 上下文而不要求整体包裹回调链，适合 Fastify hook 这类无法用单个
 * 函数体包裹后续处理链路的场景（如 HTTP 请求生命周期）。
 */
export function enterTrace(traceId: string): void {
  traceStorage.enterWith({ traceId })
}

/** 获取当前异步上下文中的 traceId，不存在时返回 undefined。 */
export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId
}
