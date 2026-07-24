/** 编排器使用的服务注册条目接口定义。 */

import type { InjectEntry, ProvideEntry } from './decorators'

/** Inject 条目 */
export type { InjectEntry, ProvideEntry }

/** 编排器使用的服务注册条目。 */
export interface ServiceEntry {
  /** 服务唯一名称。 */
  readonly name: string
  /** 服务类构造函数。 */
  readonly serviceClass: new (...args: unknown[]) => unknown
  /** 注入依赖列表。 */
  readonly injects: readonly InjectEntry[]
  /** 对外提供实例列表。 */
  readonly provides: readonly ProvideEntry[]
  /** 启动方法名或 Symbol，null 表示未声明。 */
  readonly startupMethod: string | symbol | null
  /** 关闭方法名或 Symbol，null 表示未声明。 */
  readonly shutdownMethod: string | symbol | null
}
