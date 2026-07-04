/** @Handler 类装饰器：注册 Handler 类到全局 handlerRegistry。 */

import { handlerRegistry } from '../registry'
import type { HandlerOptions, HandlerRegistryData } from '../registry'

import {
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  type MethodMetaEntry,
  type InterceptorEntry,
} from './symbols'

export type { HandlerOptions, HandlerRegistryData }

/**
 * 注册一个 Handler 类。收集所有方法/类装饰器的元数据，注册到 handlerRegistry。
 */
export function Handler(opts: HandlerOptions) {
  return function (target: new (...args: unknown[]) => unknown, context: ClassDecoratorContext) {
    const metadata = context.metadata
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TC39 规范保证非空，但防御性检查以兼容非标准环境
    if (!metadata) throw new Error(`@Handler: context.metadata 不可用`)
    const defaultPriority = opts.defaultPriority ?? 50

    const methods = (
      Object.hasOwn(metadata, HANDLER_METHODS) ? metadata[HANDLER_METHODS] : []
    ) as MethodMetaEntry[]

    const classInterceptors = (
      Object.hasOwn(metadata, HANDLER_CLASS_INTERCEPTORS)
        ? metadata[HANDLER_CLASS_INTERCEPTORS]
        : []
    ) as InterceptorEntry[]

    // 填充默认优先级（null 表示使用 defaultPriority）
    for (const method of methods) {
      method.priority ??= defaultPriority
    }

    const data: HandlerRegistryData = {
      options: opts,
      handlerClass: target,
      metadata,
      methods,
      classInterceptors,
    }

    handlerRegistry.register(data)
  }
}
