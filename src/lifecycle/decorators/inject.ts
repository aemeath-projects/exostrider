/** @Inject 字段装饰器：声明依赖注入字段，编排器启动时自动赋值。 */

import { SERVICE_INJECTS, type InjectEntry } from './symbols.js'

/**
 * 声明依赖注入字段，编排器启动时自动从服务注册表中读取对应 key 并赋值。
 * @param serviceKey 服务注册表中的 key 名称
 */
export function Inject(
  serviceKey: string,
): (target: undefined, context: ClassFieldDecoratorContext) => void {
  return (_target, context) => {
    const existing = (context.metadata[SERVICE_INJECTS] as InjectEntry[] | undefined) ?? []
    context.metadata[SERVICE_INJECTS] = [...existing, { propertyName: context.name, serviceKey }]
  }
}
