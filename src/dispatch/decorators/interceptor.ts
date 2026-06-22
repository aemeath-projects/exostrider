/** @Interceptor 装饰器：声明式绑定拦截器，可作用于类或方法。 */

import { HANDLER_CLASS_INTERCEPTORS, type InterceptorEntry } from './symbols'
import { getOrCreateMethodEntry } from './utils'

/**
 * 声明式绑定拦截器。可用于类（对所有方法生效）或方法（仅对该方法生效）。
 *
 * @param interceptorClass - 拦截器构造函数
 * @param options - 传递给拦截器构造函数的可选配置
 */
export function Interceptor(
  interceptorClass: new (options?: unknown) => unknown,
  options?: unknown,
) {
  const entry: InterceptorEntry = { interceptorClass, options }

  function decorator(
    _target: unknown,
    context: ClassDecoratorContext | ClassMethodDecoratorContext,
  ) {
    if (context.kind === 'class') {
      const metadata = context.metadata
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TC39 规范保证非空，但防御性检查以兼容非标准环境
      if (!metadata) throw new Error('[dispatch] @Interceptor: context.metadata 不可用')
      const list: InterceptorEntry[] = ((metadata[HANDLER_CLASS_INTERCEPTORS] as
        | InterceptorEntry[]
        | undefined) ??= [])
      list.push(entry)
    } else {
      const methodEntry = getOrCreateMethodEntry(context)
      methodEntry.interceptors.push(entry)
    }
  }

  return decorator
}
