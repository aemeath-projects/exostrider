/** dispatch 装饰器模块统一导出入口。 */

export { Handler } from './handler'
export type { HandlerOptions, HandlerRegistryData } from './handler'
export {
  OnCommand,
  OnKeyword,
  OnRegex,
  OnStartsWith,
  OnEndsWith,
  OnFullMatch,
  OnEvent,
} from './routing'
export type { OnCommandOptions, EventMatchConfig } from './routing'
export { Permission, Scope, Priority } from './method-options'
export { Interceptor } from './interceptor'
export { SettingNode } from './setting-node'
export type { SettingNodeOptions } from './setting-node'
export {
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  HANDLER_SETTINGS,
  HANDLER_NAME,
  HANDLER_OPTIONS,
} from './symbols'
export type { MethodMetaEntry, InterceptorEntry, SettingNodeEntry } from './symbols'
