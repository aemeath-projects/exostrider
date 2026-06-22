/** dispatch 装饰器模块统一导出入口。 */

export { Handler } from './handler.js'
export type { HandlerOptions, HandlerRegistryData } from './handler.js'
export {
  OnCommand,
  OnKeyword,
  OnRegex,
  OnStartsWith,
  OnEndsWith,
  OnFullMatch,
  OnEvent,
} from './routing.js'
export type { OnCommandOptions, EventMatchConfig } from './routing.js'
export { Permission, Scope, Priority } from './method-options.js'
export { Interceptor } from './interceptor.js'
export { SettingNode } from './setting-node.js'
export type { SettingNodeOptions } from './setting-node.js'
export {
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  HANDLER_SETTINGS,
  HANDLER_NAME,
  HANDLER_OPTIONS,
} from './symbols.js'
export type { MethodMetaEntry, InterceptorEntry, SettingNodeEntry } from './symbols.js'
