/**
 * 将 HandlerRegistryData + MethodMetaEntry 转换为
 * CompositeHandlerMapping 消费的 HandlerMethod 格式。
 */

import type { MethodMetaEntry, InterceptorEntry } from './decorators'
import type { HandlerMethod } from './mapping.js'
import type { HandlerRegistryData } from './registry.js'

/**
 * 将单条方法元数据条目转换为 HandlerMethod。
 *
 * @param data        - handler 注册数据（含类引用、选项、方法列表）
 * @param methodEntry - 单个方法的路由元数据（priority 必须已填充，不为 null）
 * @param instance    - handler 类的实例（已完成依赖注入）
 */
export function buildHandlerMethod(
  data: HandlerRegistryData,
  methodEntry: MethodMetaEntry & { priority: number },
  instance: object,
): HandlerMethod {
  const methodFn = (instance as Record<string | symbol, unknown>)[methodEntry.methodName]
  if (typeof methodFn !== 'function') {
    throw new Error(
      `buildHandlerMethod: handler "${data.options.name}" 上找不到方法 "${String(methodEntry.methodName)}"`,
    )
  }

  // 合并拦截器：类级（classInterceptors）在前，方法级在后
  const interceptors: readonly InterceptorEntry[] = [
    ...data.classInterceptors,
    ...methodEntry.interceptors,
  ]

  return {
    instance,
    methodName: methodEntry.methodName,
    handlerName: data.options.name,
    priority: methodEntry.priority,
    scope: methodEntry.scope,
    permission: methodEntry.permission,
    mappingType: methodEntry.mappingType,
    trigger: methodEntry.trigger,
    interceptors,
  }
}
