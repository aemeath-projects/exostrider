/** @Service 类装饰器：将类注册为可被编排器管理的服务。 */

import type { ServiceEntry } from '../service-entry.js'

import {
  SERVICE_INJECTS,
  SERVICE_PROVIDES,
  SERVICE_STARTUP,
  SERVICE_SHUTDOWN,
  type InjectEntry,
  type ProvideEntry,
} from './symbols.js'

/** 全局服务注册表，由 @Service 装饰器在 import 副作用阶段写入。 */
export const serviceEntryRegistry = new Map<string, ServiceEntry>()

export interface ServiceOptions {
  name: string
}

/** 声明一个可被编排器管理的服务类。 */
export function Service(options: ServiceOptions) {
  return function (
    target: new (...args: unknown[]) => unknown,
    context: ClassDecoratorContext,
  ): void {
    const metadata = context.metadata
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TC39 规范保证 context.metadata 始终非空，但在降级 polyfill 环境中可能缺失，保留此防御性检查
    if (!metadata) throw new Error(`@Service: Symbol.metadata 不可用`)

    const injects = (
      Object.hasOwn(metadata, SERVICE_INJECTS) ? metadata[SERVICE_INJECTS] : []
    ) as InjectEntry[]

    const provides = (
      Object.hasOwn(metadata, SERVICE_PROVIDES) ? metadata[SERVICE_PROVIDES] : []
    ) as ProvideEntry[]

    const startupMethod = (
      Object.hasOwn(metadata, SERVICE_STARTUP) ? metadata[SERVICE_STARTUP] : null
    ) as string | symbol | null

    const shutdownMethod = (
      Object.hasOwn(metadata, SERVICE_SHUTDOWN) ? metadata[SERVICE_SHUTDOWN] : null
    ) as string | symbol | null

    const entry: ServiceEntry = {
      name: options.name,
      serviceClass: target,
      injects,
      provides,
      startupMethod,
      shutdownMethod,
    }

    if (serviceEntryRegistry.has(options.name)) {
      throw new Error(`@Service 名称冲突: "${options.name}" 已注册`)
    }
    serviceEntryRegistry.set(options.name, entry)
  }
}
