/**
 * dispatch 模块统一导出入口。
 */

export { Context } from './context.js'
export type { ContextConfig } from './context.js'
export { Permission, MessageScope } from './constants.js'
export type { PermissionLevel, MessageScopeValue } from './constants.js'
export { FinishError } from './errors.js'
export type { HandlerInterceptor, ResolvedHandler } from './interceptor.js'
export {
  CompositeHandlerMapping,
  CommandHandlerMapping,
  RegexHandlerMapping,
  KeywordHandlerMapping,
  StartsWithHandlerMapping,
  EndsWithHandlerMapping,
  FullMatchHandlerMapping,
  EventTypeHandlerMapping,
} from './mapping.js'
export type { HandlerMethod, HandlerMapping, MappingType } from './mapping.js'
export { buildHandlerMethod } from './method-builder.js'
export { HandlerRegistry, handlerRegistry } from './registry.js'
export type { HandlerOptions, HandlerRegistryData } from './registry.js'
export { EventDispatcher } from './dispatcher.js'
export type { EventDispatcherOptions } from './dispatcher.js'
// Decorators
export {
  Handler,
  OnCommand,
  OnKeyword,
  OnRegex,
  OnStartsWith,
  OnEndsWith,
  OnFullMatch,
  OnEvent,
  Permission as PermissionDecorator,
  Scope,
  Priority,
  Interceptor,
  SettingNode,
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  HANDLER_SETTINGS,
  HANDLER_NAME,
  HANDLER_OPTIONS,
} from './decorators/index.js'
export type {
  OnCommandOptions,
  EventMatchConfig,
  SettingNodeOptions,
  MethodMetaEntry,
  InterceptorEntry,
  SettingNodeEntry,
  HandlerOptions as HandlerDecoratorOptions,
} from './decorators/index.js'
