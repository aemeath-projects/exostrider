import { describe, it, expect, vi } from 'vitest'

import { Context } from '../../../src'
import { EventDispatcher } from '../../../src/dispatch'
import type { HandlerMapping, HandlerMethod } from '../../../src/dispatch'

interface SimpleEvent {
  text?: string
}
type SimpleApis = Record<string, unknown>

/** 模拟调用方自定义的 Context 子类（例如 aemeath 的 OneBotContext）。 */
class CustomContext extends Context<SimpleEvent, SimpleApis> {
  readonly flag = 'custom'
}

function makeMapping(handler?: HandlerMethod): HandlerMapping<SimpleEvent, SimpleApis> {
  return {
    priority: 0,
    getHandler: () => handler,
  }
}

function makeHandlerMethod(fn: (ctx: unknown) => Promise<void> | void): HandlerMethod {
  return {
    instance: { handle: fn },
    methodName: 'handle',
    handlerName: 'test',
    priority: 50,
    scope: 'all',
    permission: 0,
    mappingType: 'command',
    trigger: {},
    interceptors: [],
    requiredBotCapability: null,
  }
}

describe('EventDispatcher contextFactory（自定义 Context 子类构造）', () => {
  const contextConfig = { textExtractor: (e: SimpleEvent) => e.text }

  it('未提供 contextFactory 时，dispatch() 构造的 ctx 是基类 Context 实例（向后兼容）', async () => {
    let captured: unknown
    const handlerMethod = makeHandlerMethod((ctx) => {
      captured = ctx
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMapping(handlerMethod),
      contextConfig,
    })

    await dispatcher.dispatch({}, {})
    expect(captured).toBeInstanceOf(Context)
    expect(captured instanceof CustomContext).toBe(false)
  })

  it('提供 contextFactory 时，dispatch() 使用它构造 ctx，子类新增成员生效', async () => {
    let captured: unknown
    const handlerMethod = makeHandlerMethod((ctx) => {
      captured = ctx
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMapping(handlerMethod),
      contextConfig,
      contextFactory: (event, apis, config) => new CustomContext(event, apis, config),
    })

    await dispatcher.dispatch({}, {})
    expect(captured).toBeInstanceOf(CustomContext)
    expect((captured as CustomContext).flag).toBe('custom')
  })

  it('contextFactory 构造的 ctx 同样传递给拦截器（preHandle/postHandle/afterCompletion）', async () => {
    const seen: unknown[] = []
    const handlerMethod = makeHandlerMethod(() => {})

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMapping(handlerMethod),
      contextConfig,
      contextFactory: (event, apis, config) => new CustomContext(event, apis, config),
      interceptors: [
        {
          preHandle: async (ctx) => {
            seen.push(ctx)
            return true
          },
        },
      ],
      dispatchInterceptors: [
        {
          preHandle: async (ctx) => {
            seen.push(ctx)
            return true
          },
        },
      ],
    })

    await dispatcher.dispatch({}, {})
    expect(seen).toHaveLength(2)
    for (const ctx of seen) {
      expect(ctx).toBeInstanceOf(CustomContext)
    }
  })

  it('无匹配 handler 时 contextFactory 构造的 ctx 仍传给 dispatchInterceptors', async () => {
    const preHandle = vi.fn().mockResolvedValue(true)

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMapping(undefined),
      contextConfig,
      contextFactory: (event, apis, config) => new CustomContext(event, apis, config),
      dispatchInterceptors: [{ preHandle }],
    })

    await dispatcher.dispatch({}, {})
    expect(preHandle).toHaveBeenCalledWith(expect.any(CustomContext))
  })
})
