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
export {
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  HANDLER_NAME,
  HANDLER_OPTIONS,
} from './symbols'
export type { MethodMetaEntry, InterceptorEntry } from './symbols'
export { RequiresBotCapability } from './capabilities'
export type { BotCapability } from './capabilities'
