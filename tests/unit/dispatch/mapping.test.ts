import { describe, it, expect, beforeEach } from 'vitest'

import { Context } from '../../../src'
import {
  CommandHandlerMapping,
  RegexHandlerMapping,
  KeywordHandlerMapping,
  StartsWithHandlerMapping,
  EndsWithHandlerMapping,
  FullMatchHandlerMapping,
  EventTypeHandlerMapping,
  CompositeHandlerMapping,
} from '../../../src/dispatch'
import type { HandlerMethod } from '../../../src/dispatch'

/** 创建测试用 HandlerMethod */
function makeHandler(overrides: Partial<HandlerMethod> = {}): HandlerMethod {
  return {
    instance: {},
    methodName: 'handle',
    handlerName: 'test',
    priority: 50,
    scope: 'all',
    permission: 0,
    mappingType: 'command',
    trigger: {},
    interceptors: [],
    ...overrides,
  }
}

/** 创建测试用 Context（带文本提取器） */
function makeCtx(text?: string, scope?: string): Context<any, any> {
  const event = { text }
  const ctx = new Context<any, any>(
    event,
    {},
    {
      textExtractor: (e: any) => e.text,
    },
  )
  if (scope) ctx.scope = scope
  return ctx
}

/** 创建事件 Context（无文本，带事件字段） */
function makeEventCtx(eventObj: Record<string, unknown>): Context<any, any> {
  return new Context<any, any>(
    eventObj,
    {},
    {
      textExtractor: () => undefined,
    },
  )
}

describe('CommandHandlerMapping', () => {
  let mapping: CommandHandlerMapping

  beforeEach(() => {
    mapping = new CommandHandlerMapping('/')
  })

  it('通过命令名匹配', () => {
    const handler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: 'echo', aliases: undefined },
    })
    mapping.register(handler)

    const ctx = makeCtx('/echo hello')
    expect(mapping.getHandler(ctx)).toBe(handler)
  })

  it('带前缀的命令也能匹配', () => {
    const handler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: '/echo', aliases: undefined },
    })
    mapping.register(handler)

    const ctx = makeCtx('/echo hello')
    expect(mapping.getHandler(ctx)).toBe(handler)
  })

  it('通过别名匹配', () => {
    const handler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: 'echo', aliases: new Set(['回声', 'e']) },
    })
    mapping.register(handler)

    const ctx1 = makeCtx('/回声 test')
    expect(mapping.getHandler(ctx1)).toBe(handler)

    const ctx2 = makeCtx('/e test')
    expect(mapping.getHandler(ctx2)).toBe(handler)
  })

  it('未匹配命令返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: 'echo', aliases: undefined },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('/help'))).toBeUndefined()
    expect(mapping.getHandler(makeCtx('echo'))).toBeUndefined() // 无前缀
    expect(mapping.getHandler(makeCtx(undefined))).toBeUndefined()
  })

  it('registeredCount 返回注册的命令数量', () => {
    expect(mapping.registeredCount).toBe(0)
    const handler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: 'echo', aliases: new Set(['e']) },
    })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(2) // 'echo' 和 'e'
  })

  it('cmd 为空字符串时不注册', () => {
    const handler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: '', aliases: undefined },
    })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })

  it('cmd 非字符串时退化为空字符串不注册', () => {
    const handler = makeHandler({
      mappingType: 'command',

      trigger: { cmd: 123 },
    })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })

  it('优先级数值更大的 handler 不覆盖已注册的同命令 handler', () => {
    const first = makeHandler({ trigger: { cmd: 'echo' }, priority: 10, handlerName: 'first' })
    const second = makeHandler({ trigger: { cmd: 'echo' }, priority: 50, handlerName: 'second' })
    mapping.register(first)
    mapping.register(second)
    expect(mapping.getHandler(makeCtx('/echo'))?.handlerName).toBe('first')
  })
})

describe('RegexHandlerMapping', () => {
  let mapping: RegexHandlerMapping

  beforeEach(() => {
    mapping = new RegexHandlerMapping()
  })

  it('正则匹配成功时返回 handler', () => {
    const handler = makeHandler({
      mappingType: 'regex',
      trigger: { compiledPattern: /hello (\w+)/i },
    })
    mapping.register(handler)

    const ctx = makeCtx('Hello World')
    expect(mapping.getHandler(ctx)).toBe(handler)
  })

  it('正则匹配成功时将 regexMatch 写入 ctx', () => {
    const handler = makeHandler({
      mappingType: 'regex',
      trigger: { compiledPattern: /hello (\w+)/i },
    })
    mapping.register(handler)

    const ctx = makeCtx('Hello World')
    mapping.getHandler(ctx)
    expect(ctx.regexMatch).not.toBeNull()
    expect(ctx.regexMatch?.[1]).toBe('World')
  })

  it('正则不匹配时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'regex',
      trigger: { compiledPattern: /^strict$/ },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('strict-ish'))).toBeUndefined()
  })

  it('无文本时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'regex',
      trigger: { compiledPattern: /.*/ },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx(undefined))).toBeUndefined()
  })

  it('trigger 无 compiledPattern 时不注册', () => {
    const handler = makeHandler({ mappingType: 'regex', trigger: {} })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })
})

describe('KeywordHandlerMapping', () => {
  let mapping: KeywordHandlerMapping

  beforeEach(() => {
    mapping = new KeywordHandlerMapping()
  })

  it('文本包含关键词时返回 handler', () => {
    const handler = makeHandler({
      mappingType: 'keyword',
      trigger: { keywords: new Set(['hello', 'world']) },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('say hello there'))).toBe(handler)
    expect(mapping.getHandler(makeCtx('the world is big'))).toBe(handler)
  })

  it('文本不包含任何关键词时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'keyword',
      trigger: { keywords: new Set(['hello', 'world']) },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('goodbye everyone'))).toBeUndefined()
  })

  it('无文本时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'keyword',
      trigger: { keywords: new Set(['hello']) },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx(undefined))).toBeUndefined()
  })

  it('trigger 无 keywords 或为空 Set 时不注册', () => {
    const h1 = makeHandler({ mappingType: 'keyword', trigger: {} })
    const h2 = makeHandler({ mappingType: 'keyword', trigger: { keywords: new Set() } })
    mapping.register(h1)
    mapping.register(h2)
    expect(mapping.registeredCount).toBe(0)
  })
})

describe('StartsWithHandlerMapping', () => {
  let mapping: StartsWithHandlerMapping

  beforeEach(() => {
    mapping = new StartsWithHandlerMapping()
  })

  it('文本以前缀开头时返回 handler', () => {
    const handler = makeHandler({
      mappingType: 'startswith',
      trigger: { prefix: '!cmd ' },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('!cmd do something'))).toBe(handler)
  })

  it('文本不以前缀开头时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'startswith',
      trigger: { prefix: '!cmd' },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('cmd something'))).toBeUndefined()
  })

  it('无文本时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'startswith',
      trigger: { prefix: '!' },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx(undefined))).toBeUndefined()
  })
})

describe('EndsWithHandlerMapping', () => {
  let mapping: EndsWithHandlerMapping

  beforeEach(() => {
    mapping = new EndsWithHandlerMapping()
  })

  it('文本以后缀结尾时返回 handler', () => {
    const handler = makeHandler({
      mappingType: 'endswith',
      trigger: { suffix: '吗？' },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('你好吗？'))).toBe(handler)
  })

  it('文本不以后缀结尾时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'endswith',
      trigger: { suffix: '吗？' },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('你好！'))).toBeUndefined()
  })

  it('无文本时返回 undefined', () => {
    const handler = makeHandler({ mappingType: 'endswith', trigger: { suffix: '？' } })
    mapping.register(handler)
    expect(mapping.getHandler(makeCtx(undefined))).toBeUndefined()
  })

  it('trigger 无 suffix 字段时不注册', () => {
    const handler = makeHandler({ mappingType: 'endswith', trigger: {} })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })
})

describe('FullMatchHandlerMapping', () => {
  let mapping: FullMatchHandlerMapping

  beforeEach(() => {
    mapping = new FullMatchHandlerMapping()
  })

  it('文本完全匹配时返回 handler', () => {
    const handler = makeHandler({
      mappingType: 'fullmatch',
      trigger: { text: '你好' },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('你好'))).toBe(handler)
  })

  it('文本不完全匹配时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'fullmatch',
      trigger: { text: '你好' },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeCtx('你好呀'))).toBeUndefined()
    expect(mapping.getHandler(makeCtx('  你好  '))).toBeUndefined()
  })

  it('无文本时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'fullmatch',
      trigger: { text: '你好' },
    })
    mapping.register(handler)
    expect(mapping.getHandler(makeCtx(undefined))).toBeUndefined()
  })

  it('优先级更低（数值更小）的 handler 会覆盖同文本的已有 handler', () => {
    const lower = makeHandler({
      mappingType: 'fullmatch',
      trigger: { text: '你好' },
      priority: 10,
      handlerName: 'lower',
    })
    const higher = makeHandler({
      mappingType: 'fullmatch',
      trigger: { text: '你好' },
      priority: 50,
      handlerName: 'higher',
    })
    mapping.register(higher)
    mapping.register(lower)
    // lower 优先级（数值小）覆盖 higher
    expect(mapping.getHandler(makeCtx('你好'))?.handlerName).toBe('lower')
  })

  it('trigger 无 text 字段时不注册', () => {
    const handler = makeHandler({ mappingType: 'fullmatch', trigger: {} })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })

  it('优先级数值更大的 handler 不覆盖已注册的同文本 handler', () => {
    const first = makeHandler({
      mappingType: 'fullmatch',
      trigger: { text: '你好' },
      priority: 10,
      handlerName: 'first',
    })
    const second = makeHandler({
      mappingType: 'fullmatch',
      trigger: { text: '你好' },
      priority: 50,
      handlerName: 'second',
    })
    mapping.register(first)
    mapping.register(second)
    expect(mapping.getHandler(makeCtx('你好'))?.handlerName).toBe('first')
  })
})

describe('StartsWithHandlerMapping (extra)', () => {
  it('trigger 无 prefix 字段时不注册', () => {
    const mapping = new StartsWithHandlerMapping()
    const handler = makeHandler({ mappingType: 'startswith', trigger: {} })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })
})

describe('EventTypeHandlerMapping', () => {
  let mapping: EventTypeHandlerMapping

  beforeEach(() => {
    mapping = new EventTypeHandlerMapping()
  })

  it('事件字段 key-value 全部匹配时返回 handler', () => {
    const handler = makeHandler({
      mappingType: 'event',
      trigger: { matchConfig: { postType: 'notice', noticeType: 'friend_add' } },
    })
    mapping.register(handler)

    const ctx = makeEventCtx({ postType: 'notice', noticeType: 'friend_add' })
    expect(mapping.getHandler(ctx)).toBe(handler)
  })

  it('任意字段不匹配时返回 undefined', () => {
    const handler = makeHandler({
      mappingType: 'event',
      trigger: { matchConfig: { postType: 'notice', noticeType: 'friend_add' } },
    })
    mapping.register(handler)

    // postType 不匹配
    expect(
      mapping.getHandler(makeEventCtx({ postType: 'message', noticeType: 'friend_add' })),
    ).toBeUndefined()
    // noticeType 不匹配
    expect(
      mapping.getHandler(makeEventCtx({ postType: 'notice', noticeType: 'group_ban' })),
    ).toBeUndefined()
  })

  it('单字段匹配', () => {
    const handler = makeHandler({
      mappingType: 'event',
      trigger: { matchConfig: { postType: 'request' } },
    })
    mapping.register(handler)

    expect(mapping.getHandler(makeEventCtx({ postType: 'request', requestType: 'friend' }))).toBe(
      handler,
    )
    expect(mapping.getHandler(makeEventCtx({ postType: 'notice' }))).toBeUndefined()
  })

  it('trigger 无 matchConfig 时不注册', () => {
    const handler = makeHandler({ mappingType: 'event', trigger: {} })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })

  it('matchConfig 为非对象时不注册', () => {
    const handler = makeHandler({ mappingType: 'event', trigger: { matchConfig: 'invalid' } })
    mapping.register(handler)
    expect(mapping.registeredCount).toBe(0)
  })
})

describe('CompositeHandlerMapping', () => {
  it('按映射类型优先级返回第一个命中的处理器', () => {
    const composite = new CompositeHandlerMapping('/')

    const cmdHandler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: 'echo', aliases: undefined },
      priority: 50,
    })
    const kwHandler = makeHandler({
      mappingType: 'keyword',
      trigger: { keywords: new Set(['echo']) },
      priority: 50,
    })

    composite.register(cmdHandler)
    composite.register(kwHandler)

    // CommandHandlerMapping 优先级更高（10 < 30），应先返回命令 handler
    const ctx = makeCtx('/echo hello')
    const result = composite.getHandler(ctx)
    expect(result).toBe(cmdHandler)
  })

  it('scope 过滤：handler.scope 与 ctx.scope 不匹配时跳过', () => {
    const composite = new CompositeHandlerMapping('/')

    const groupHandler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: 'cmd', aliases: undefined },
      scope: 'group',
      priority: 50,
    })
    composite.register(groupHandler)

    // ctx.scope 为 'private'，handler.scope 为 'group' → 跳过
    const ctx = makeCtx('/cmd')
    ctx.scope = 'private'
    expect(composite.getHandler(ctx)).toBeUndefined()
  })

  it('scope="all" 的 handler 不受 ctx.scope 限制', () => {
    const composite = new CompositeHandlerMapping('/')

    const handler = makeHandler({
      mappingType: 'command',
      trigger: { cmd: 'cmd', aliases: undefined },
      scope: 'all',
      priority: 50,
    })
    composite.register(handler)

    const ctx = makeCtx('/cmd')
    ctx.scope = 'group'
    expect(composite.getHandler(ctx)).toBe(handler)
  })

  it('无匹配时返回 undefined', () => {
    const composite = new CompositeHandlerMapping('/')
    expect(composite.getHandler(makeCtx('/unknown'))).toBeUndefined()
  })

  it('handlerCount 返回所有子映射的注册数量总和', () => {
    const composite = new CompositeHandlerMapping('/')
    expect(composite.handlerCount).toBe(0)

    composite.register(
      makeHandler({ mappingType: 'command', trigger: { cmd: 'a', aliases: undefined } }),
    )
    composite.register(makeHandler({ mappingType: 'regex', trigger: { compiledPattern: /test/ } }))
    composite.register(
      makeHandler({ mappingType: 'keyword', trigger: { keywords: new Set(['kw']) } }),
    )
    expect(composite.handlerCount).toBe(3)
  })

  it('支持所有映射类型注册', () => {
    const composite = new CompositeHandlerMapping('/')

    composite.register(makeHandler({ mappingType: 'startswith', trigger: { prefix: '!' } }))
    composite.register(makeHandler({ mappingType: 'endswith', trigger: { suffix: '？' } }))
    composite.register(makeHandler({ mappingType: 'fullmatch', trigger: { text: 'hi' } }))
    composite.register(
      makeHandler({ mappingType: 'event', trigger: { matchConfig: { postType: 'notice' } } }),
    )

    expect(composite.handlerCount).toBe(4)
  })

  it('getAllHandlers 中 scope 过滤：scope 不匹配时跳过', () => {
    const composite = new CompositeHandlerMapping('/')

    // 注册一个 'group' scope 的关键词处理器
    const groupHandler = makeHandler({
      mappingType: 'keyword',
      trigger: { keywords: new Set(['hello']) },
      scope: 'group',
      priority: 20,
    })
    composite.register(groupHandler)

    // 使用 'private' scope 的 ctx，文本包含 'hello' 触发关键词匹配，但 scope 不符合
    const ctx = makeCtx('hello world')
    ctx.scope = 'private'

    const results = composite.getAllHandlers(ctx)
    // groupHandler 匹配了文本，但 scope 不匹配 → 被过滤掉
    expect(results).toHaveLength(0)
  })

  it('getAllHandlers 返回 scope 匹配的多个处理器', () => {
    const composite = new CompositeHandlerMapping('/')

    const handler1 = makeHandler({
      mappingType: 'keyword',
      trigger: { keywords: new Set(['hello']) },
      scope: 'group',
      priority: 10,
    })
    const handler2 = makeHandler({
      mappingType: 'startswith',
      trigger: { prefix: 'hello' },
      scope: 'all',
      priority: 30,
    })
    composite.register(handler1)
    composite.register(handler2)

    const ctx = makeCtx('hello world')
    ctx.scope = 'group'
    const results = composite.getAllHandlers(ctx)
    // 两个都匹配（keyword + startswith），scope 都允许
    expect(results).toHaveLength(2)
  })

  it('getAllHandlers 返回所有匹配的处理器并按优先级排序', () => {
    const composite = new CompositeHandlerMapping('/')

    const handler1 = makeHandler({
      mappingType: 'keyword',
      trigger: { keywords: new Set(['echo']) },
      priority: 30,
    })
    const handler2 = makeHandler({
      mappingType: 'regex',
      trigger: { compiledPattern: /echo/ },
      priority: 10,
    })

    composite.register(handler1)
    composite.register(handler2)

    const ctx = makeCtx('echo hello')
    const results = composite.getAllHandlers(ctx)
    expect(results.length).toBeGreaterThanOrEqual(2)
    // 按优先级升序
    expect(results[0].priority).toBeLessThanOrEqual(results[1].priority)
  })
})
