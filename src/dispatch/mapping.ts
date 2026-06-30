/**
 * HandlerMapping —— 将事件路由到处理器方法。
 *
 * 平台无关泛型设计：通过 Context<TEvent, TApis>.getText() 提取文本，
 * 具体事件类型由泛型参数 TEvent 决定。
 */

import type { Context } from './context'
import type { InterceptorEntry, BotCapability } from './decorators'

/** 处理器方法类型 */
export type MappingType =
  'command' | 'regex' | 'keyword' | 'startswith' | 'endswith' | 'fullmatch' | 'event'

/** 封装已注册的处理器方法及其路由信息。 */
export interface HandlerMethod {
  /** 处理器所在类的实例。 */
  readonly instance: unknown
  /** 方法名。 */
  readonly methodName: string | symbol
  /** Handler 名称。 */
  readonly handlerName: string
  /** 优先级（越小越先执行）。 */
  readonly priority: number
  /** 消息作用域。 */
  readonly scope?: string
  /** 权限等级。 */
  readonly permission: number
  /** 映射类型。 */
  readonly mappingType: MappingType
  /** 触发配置（命令名/正则/关键词等）。 */
  readonly trigger: Record<string, unknown>
  /** 声明式拦截器列表。 */
  readonly interceptors: readonly InterceptorEntry[]
  /** Bot 在群内需要具备的权限等级（null 表示无要求）。 */
  readonly requiredBotCapability: BotCapability | null
}

/** HandlerMapping 接口 —— 将 Context 映射到 HandlerMethod。 */
export interface HandlerMapping<TEvent = unknown, TApis = unknown> {
  readonly priority: number
  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined
}

/* ================================================================
   具体映射实现
   ================================================================ */

/** 通过命令前缀匹配消息文本（例如 /echo、/help）。 */
export class CommandHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 10
  private readonly _prefix: string
  private readonly _handlers = new Map<string, HandlerMethod>()

  constructor(commandPrefix = '/') {
    this._prefix = commandPrefix
  }

  register(handler: HandlerMethod): void {
    const trigger = handler.trigger
    const cmd = typeof trigger.cmd === 'string' ? trigger.cmd : ''
    const aliases =
      trigger.aliases instanceof Set ? (trigger.aliases as Set<string>) : new Set<string>()

    const allNames = new Set([cmd, ...aliases])
    for (const name of allNames) {
      if (!name) continue
      const key = name.startsWith(this._prefix) ? name.slice(this._prefix.length) : name
      // 优先保留优先级最高（数值最小）的 handler
      const existing = this._handlers.get(key)
      if (!existing || handler.priority < existing.priority) {
        this._handlers.set(key, handler)
      }
    }
  }

  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    const text = ctx.getText()
    if (!text?.startsWith(this._prefix)) return undefined
    const afterPrefix = text.slice(this._prefix.length)
    const cmdName = afterPrefix.split(/\s/u)[0] ?? ''
    return this._handlers.get(cmdName)
  }

  /** 已注册的命令数量。 */
  get registeredCount(): number {
    return this._handlers.size
  }
}

/** 通过正则表达式匹配消息文本。 */
export class RegexHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 20
  private readonly _handlers: [RegExp, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const pattern = handler.trigger.compiledPattern
    if (pattern instanceof RegExp) {
      this._handlers.push([pattern, handler])
    }
  }

  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    const text = ctx.getText()
    if (text === undefined) return undefined
    for (const [pattern, handler] of this._handlers) {
      const match = text.match(pattern)
      if (match) {
        // 将正则匹配结果写入 ctx
        ctx.regexMatch = match
        return handler
      }
    }
    return undefined
  }

  get registeredCount(): number {
    return this._handlers.length
  }
}

/** 匹配包含任意关键词的消息文本。 */
export class KeywordHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 30
  private readonly _handlers: [Set<string>, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const keywords = handler.trigger.keywords
    if (keywords instanceof Set && keywords.size > 0) {
      this._handlers.push([keywords as Set<string>, handler])
    }
  }

  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    const text = ctx.getText()
    if (text === undefined) return undefined
    for (const [keywords, handler] of this._handlers) {
      if ([...keywords].some((kw) => text.includes(kw))) {
        return handler
      }
    }
    return undefined
  }

  get registeredCount(): number {
    return this._handlers.length
  }
}

/** 匹配以指定前缀开头的消息。 */
export class StartsWithHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 40
  private readonly _handlers: [string, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const prefix = handler.trigger.prefix
    if (typeof prefix === 'string' && prefix.length > 0) {
      this._handlers.push([prefix, handler])
    }
  }

  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    const text = ctx.getText()
    if (text === undefined) return undefined
    for (const [prefix, handler] of this._handlers) {
      if (text.startsWith(prefix)) return handler
    }
    return undefined
  }

  get registeredCount(): number {
    return this._handlers.length
  }
}

/** 匹配以指定后缀结尾的消息。 */
export class EndsWithHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 50
  private readonly _handlers: [string, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const suffix = handler.trigger.suffix
    if (typeof suffix === 'string' && suffix.length > 0) {
      this._handlers.push([suffix, handler])
    }
  }

  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    const text = ctx.getText()
    if (text === undefined) return undefined
    for (const [suffix, handler] of this._handlers) {
      if (text.endsWith(suffix)) return handler
    }
    return undefined
  }

  get registeredCount(): number {
    return this._handlers.length
  }
}

/** 完全匹配消息文本。 */
export class FullMatchHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 60
  private readonly _handlers = new Map<string, HandlerMethod>()

  register(handler: HandlerMethod): void {
    const text = handler.trigger.text
    if (typeof text === 'string' && text.length > 0) {
      const existing = this._handlers.get(text)
      if (!existing || handler.priority < existing.priority) {
        this._handlers.set(text, handler)
      }
    }
  }

  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    const text = ctx.getText()
    if (text === undefined) return undefined
    return this._handlers.get(text)
  }

  get registeredCount(): number {
    return this._handlers.size
  }
}

/**
 * 按 key-value 匹配事件对象字段。
 * matchConfig 中的每个 key-value 对都必须与事件对象中的对应字段匹配。
 */
export class EventTypeHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 70
  private readonly _handlers: [Record<string, unknown>, HandlerMethod][] = []

  register(handler: HandlerMethod): void {
    const matchConfig = handler.trigger.matchConfig
    if (matchConfig && typeof matchConfig === 'object') {
      this._handlers.push([matchConfig as Record<string, unknown>, handler])
    }
  }

  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    const event = ctx.event as Record<string, unknown>
    for (const [config, handler] of this._handlers) {
      const matches = Object.entries(config).every(([key, value]) => event[key] === value)
      if (matches) return handler
    }
    return undefined
  }

  get registeredCount(): number {
    return this._handlers.length
  }
}

/* ================================================================
   CompositeHandlerMapping — 聚合所有子映射
   ================================================================ */

/** 聚合所有 HandlerMapping，按优先级依次尝试匹配，返回第一个命中的处理器。 */
export class CompositeHandlerMapping<TEvent = unknown, TApis = unknown> implements HandlerMapping<
  TEvent,
  TApis
> {
  readonly priority = 0

  private readonly _commandMapping: CommandHandlerMapping<TEvent, TApis>
  private readonly _regexMapping: RegexHandlerMapping<TEvent, TApis>
  private readonly _keywordMapping: KeywordHandlerMapping<TEvent, TApis>
  private readonly _startsWithMapping: StartsWithHandlerMapping<TEvent, TApis>
  private readonly _endsWithMapping: EndsWithHandlerMapping<TEvent, TApis>
  private readonly _fullMatchMapping: FullMatchHandlerMapping<TEvent, TApis>
  private readonly _eventTypeMapping: EventTypeHandlerMapping<TEvent, TApis>

  private readonly _allMappings: HandlerMapping<TEvent, TApis>[]

  constructor(commandPrefix = '/') {
    this._commandMapping = new CommandHandlerMapping(commandPrefix)
    this._regexMapping = new RegexHandlerMapping()
    this._keywordMapping = new KeywordHandlerMapping()
    this._startsWithMapping = new StartsWithHandlerMapping()
    this._endsWithMapping = new EndsWithHandlerMapping()
    this._fullMatchMapping = new FullMatchHandlerMapping()
    this._eventTypeMapping = new EventTypeHandlerMapping()

    // 按子映射 priority 升序排列
    this._allMappings = [
      this._commandMapping,
      this._regexMapping,
      this._keywordMapping,
      this._startsWithMapping,
      this._endsWithMapping,
      this._fullMatchMapping,
      this._eventTypeMapping,
    ].sort((a, b) => a.priority - b.priority)
  }

  /**
   * 注册处理器到对应的子映射。
   * 根据 mappingType 路由到正确的 HandlerMapping 实例。
   */
  register(handler: HandlerMethod): void {
    const type = handler.mappingType
    switch (type) {
      case 'command':
        this._commandMapping.register(handler)
        break
      case 'regex':
        this._regexMapping.register(handler)
        break
      case 'keyword':
        this._keywordMapping.register(handler)
        break
      case 'startswith':
        this._startsWithMapping.register(handler)
        break
      case 'endswith':
        this._endsWithMapping.register(handler)
        break
      case 'fullmatch':
        this._fullMatchMapping.register(handler)
        break
      case 'event':
        this._eventTypeMapping.register(handler)
        break
    }
  }

  /**
   * 按子映射优先级依次尝试匹配，返回第一个命中的处理器。
   * Scope 过滤：handler.scope 与 ctx.scope 比较（undefined 表示接受所有作用域）。
   */
  getHandler(ctx: Context<TEvent, TApis>): HandlerMethod | undefined {
    for (const mapping of this._allMappings) {
      const handler = mapping.getHandler(ctx)
      if (handler) {
        // Scope 过滤
        if (handler.scope && handler.scope !== 'all' && handler.scope !== ctx.scope) {
          continue
        }
        return handler
      }
    }
    return undefined
  }

  /**
   * 获取所有匹配的处理器（按优先级排序），供 dispatcher 批量执行。
   */
  getAllHandlers(ctx: Context<TEvent, TApis>): HandlerMethod[] {
    const results: HandlerMethod[] = []
    for (const mapping of this._allMappings) {
      const handler = mapping.getHandler(ctx)
      if (handler) {
        // Scope 过滤
        if (handler.scope && handler.scope !== 'all' && handler.scope !== ctx.scope) {
          continue
        }
        results.push(handler)
      }
    }
    results.sort((a, b) => a.priority - b.priority)
    return results
  }

  /** 所有子映射中已注册的处理器总数。 */
  get handlerCount(): number {
    return (
      this._commandMapping.registeredCount +
      this._regexMapping.registeredCount +
      this._keywordMapping.registeredCount +
      this._startsWithMapping.registeredCount +
      this._endsWithMapping.registeredCount +
      this._fullMatchMapping.registeredCount +
      this._eventTypeMapping.registeredCount
    )
  }
}
