/** 编排器使用的服务注册条目接口定义。 */

import type { InjectEntry, ProvideEntry } from './decorators'

/** Inject 条目 */
export type { InjectEntry, ProvideEntry }

/** 编排器使用的服务注册条目。 */
export interface ServiceEntry {
  readonly name: string
  readonly serviceClass: new (...args: unknown[]) => unknown
  readonly injects: readonly InjectEntry[]
  readonly provides: readonly ProvideEntry[]
  readonly startupMethod: string | symbol | null
  readonly shutdownMethod: string | symbol | null
}
