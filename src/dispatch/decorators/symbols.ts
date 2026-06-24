/** Handler 装饰器元数据 Symbol key 定义。 */

import type { BotCapability } from './capabilities'

/** 方法路由元数据数组 key */
export const HANDLER_METHODS = Symbol('handler:methods')

/** 类级别拦截器数组 key */
export const HANDLER_CLASS_INTERCEPTORS = Symbol('handler:class-interceptors')

/** SettingNode 列表 key */
export const HANDLER_SETTINGS = Symbol('handler:settings')

/** Handler 名称 key */
export const HANDLER_NAME = Symbol('handler:name')

/** Handler 选项 key */
export const HANDLER_OPTIONS = Symbol('handler:options')

/** 方法元数据条目类型 */
export interface MethodMetaEntry {
  methodName: string | symbol
  mappingType: 'command' | 'regex' | 'keyword' | 'startswith' | 'endswith' | 'fullmatch' | 'event'
  trigger: Record<string, unknown>
  permission: number
  scope: string
  priority: number | null
  interceptors: InterceptorEntry[]
  requiredBotCapability: BotCapability | null
}

/** 拦截器条目 */
export interface InterceptorEntry {
  interceptorClass: new (options?: unknown) => unknown
  options?: unknown
}

/** SettingNode 配置项选项 */
export interface SettingNodeOptions {
  readonly type: 'boolean' | 'number' | 'string' | 'enum'
  readonly default: unknown
  readonly description?: string
  readonly enumOptions?: Record<string, unknown>
  readonly scope?: 'global' | 'group'
  readonly category?: string
}

/** SettingNode 条目 */
export interface SettingNodeEntry {
  readonly key: string
  readonly options: SettingNodeOptions
}
