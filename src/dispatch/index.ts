/**
 * dispatch 模块统一导出入口。
 */

export { Context } from './context'
export type { ContextConfig } from './context'
export { Permission, MessageScope } from './constants'
export type { PermissionLevel, MessageScopeValue } from './constants'
export { FinishError } from './errors'
export type { HandlerInterceptor, ResolvedHandler } from './interceptor'
export {
  CompositeHandlerMapping,
  CommandHandlerMapping,
  RegexHandlerMapping,
  KeywordHandlerMapping,
  StartsWithHandlerMapping,
  EndsWithHandlerMapping,
  FullMatchHandlerMapping,
  EventTypeHandlerMapping,
} from './mapping'
export type { HandlerMethod, HandlerMapping, MappingType } from './mapping'
export { buildHandlerMethod } from './method-builder'
export { HandlerRegistry, handlerRegistry } from './registry'
export type { HandlerOptions, HandlerRegistryData } from './registry'
export { EventDispatcher } from './dispatcher'
export type { EventDispatcherOptions } from './dispatcher'
// 装饰器
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
  RequiresBotCapability,
} from './decorators'
export type {
  OnCommandOptions,
  EventMatchConfig,
  SettingNodeOptions,
  MethodMetaEntry,
  InterceptorEntry,
  SettingNodeEntry,
  HandlerOptions as HandlerDecoratorOptions,
  BotCapability,
} from './decorators'
