import { describe, it, expect, vi } from 'vitest'

import { Context } from '../../../src'
import { EventDispatcher } from '../../../src/dispatch'
import type {
  DispatchInterceptor,
  HandlerInterceptor,
  HandlerMapping,
  HandlerMethod,
} from '../../../src/dispatch'

interface SimpleEvent {
  text?: string
}
type SimpleApis = Record<string, unknown>
type Ctx = Context<SimpleEvent, SimpleApis>

/** 创建 getHandler 返回 undefined（无匹配）的映射。 */
function makeEmptyMapping(): HandlerMapping<SimpleEvent, SimpleApis> {
  return {
    priority: 0,
    getHandler: () => undefined,
  }
}

/** 创建所有 handler 均匹配的 CompositeMapping mock（可返回 0/1/N 个）。 */
function makeMockCompositeMapping(handlers: HandlerMethod[]): HandlerMapping<
  SimpleEvent,
  SimpleApis
> & {
  getAllHandlers: (ctx: Ctx) => HandlerMethod[]
} {
  return {
    priority: 0,
    getHandler: () => handlers[0],
    getAllHandlers: () => handlers,
  }
}

function makeHandlerMethod(
  fn: (ctx: Ctx) => Promise<void> | void,
  overrides: Partial<HandlerMethod> = {},
): HandlerMethod {
  const instance = { handle: fn }
  return {
    instance,
    methodName: 'handle',
    handlerName: 'test',
    priority: 50,
    scope: 'all',
    permission: 0,
    mappingType: 'command',
    trigger: {},
    interceptors: [],
    requiredBotCapability: null,
    ...overrides,
  }
}

function makeDispatchInterceptor(
  overrides: {
    preHandle?: (ctx: Ctx) => Promise<boolean>
    postHandle?: (ctx: Ctx) => Promise<void>
    afterCompletion?: (ctx: Ctx, err?: Error) => Promise<void>
  } = {},
): DispatchInterceptor<SimpleEvent, SimpleApis> {
  return {
    preHandle: overrides.preHandle ?? vi.fn().mockResolvedValue(true),
    postHandle: overrides.postHandle ?? vi.fn().mockResolvedValue(undefined),
    afterCompletion: overrides.afterCompletion ?? vi.fn().mockResolvedValue(undefined),
  }
}

describe('EventDispatcher dispatchInterceptors（dispatch 级拦截器）', () => {
  const contextConfig = { textExtractor: (e: SimpleEvent) => e.text }

  it('无匹配 handler 时仍执行一次 preHandle/postHandle/afterCompletion（修复：全局拦截器原本被整体跳过）', async () => {
    const calls: string[] = []
    const interceptor = makeDispatchInterceptor({
      preHandle: async () => {
        calls.push('pre')
        return true
      },
      postHandle: async () => {
        calls.push('post')
      },
      afterCompletion: async () => {
        calls.push('after')
      },
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeEmptyMapping(),
      dispatchInterceptors: [interceptor],
      contextConfig,
    })

    await dispatcher.dispatch({ text: '普通聊天' }, {})
    expect(calls).toEqual(['pre', 'post', 'after'])
  })

  it('命中多个 handler 时 dispatch 级拦截器只执行一次（修复：原本会按 handler 数量重复执行）', async () => {
    const preHandle = vi.fn().mockResolvedValue(true)
    const postHandle = vi.fn().mockResolvedValue(undefined)
    const afterCompletion = vi.fn().mockResolvedValue(undefined)
    const interceptor = makeDispatchInterceptor({ preHandle, postHandle, afterCompletion })

    const calls: string[] = []
    const h1 = makeHandlerMethod(
      async () => {
        calls.push('h1')
      },
      { priority: 10, handlerName: 'h1' },
    )
    const h2 = makeHandlerMethod(
      async () => {
        calls.push('h2')
      },
      { priority: 20, handlerName: 'h2' },
    )

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMockCompositeMapping([h1, h2]),
      dispatchInterceptors: [interceptor],
      contextConfig,
    })

    await dispatcher.dispatch({ text: '/cmd' }, {})

    expect(calls).toEqual(['h1', 'h2'])
    expect(preHandle).toHaveBeenCalledOnce()
    expect(postHandle).toHaveBeenCalledOnce()
    expect(afterCompletion).toHaveBeenCalledOnce()
  })

  it('preHandle 返回 false 时阻断所有 handler 执行，仍调用 afterCompletion 一次', async () => {
    const h1 = makeHandlerMethod(vi.fn())
    const afterCompletion = vi.fn().mockResolvedValue(undefined)

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMockCompositeMapping([h1]),
      dispatchInterceptors: [
        makeDispatchInterceptor({ preHandle: async () => false, afterCompletion }),
      ],
      contextConfig,
    })

    await dispatcher.dispatch({}, {})

    expect((h1.instance as { handle: ReturnType<typeof vi.fn> }).handle).not.toHaveBeenCalled()
    expect(afterCompletion).toHaveBeenCalledOnce()
  })

  it('preHandle 抛出错误时 afterCompletion 收到该 error，handler 不执行', async () => {
    const handlerFn = vi.fn()
    const handlerMethod = makeHandlerMethod(handlerFn)
    const afterCompletion = vi.fn().mockResolvedValue(undefined)

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMockCompositeMapping([handlerMethod]),
      dispatchInterceptors: [
        {
          preHandle: async () => {
            throw new Error('dispatch pre 出错')
          },
          afterCompletion,
        },
      ],
      contextConfig,
    })

    await dispatcher.dispatch({}, {})

    expect(handlerFn).not.toHaveBeenCalled()
    expect(afterCompletion).toHaveBeenCalledWith(expect.any(Context), expect.any(Error))
  })

  it('dispatch 级 preHandle 在所有 handler 执行之前运行，postHandle 在其后运行', async () => {
    const calls: string[] = []
    const dispatchInterceptor = makeDispatchInterceptor({
      preHandle: async () => {
        calls.push('dispatch:pre')
        return true
      },
      postHandle: async () => {
        calls.push('dispatch:post')
      },
    })
    const handlerScopedInterceptor: HandlerInterceptor<SimpleEvent, SimpleApis> = {
      preHandle: async () => {
        calls.push('handler:pre')
        return true
      },
      postHandle: async () => {
        calls.push('handler:post')
      },
    }

    const handlerMethod = makeHandlerMethod(async () => {
      calls.push('handler:exec')
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMockCompositeMapping([handlerMethod]),
      interceptors: [handlerScopedInterceptor],
      dispatchInterceptors: [dispatchInterceptor],
      contextConfig,
    })

    await dispatcher.dispatch({}, {})

    expect(calls).toEqual([
      'dispatch:pre',
      'handler:pre',
      'handler:exec',
      'handler:post',
      'dispatch:post',
    ])
  })

  it('未提供 dispatchInterceptors 时行为与此前完全一致（向后兼容）', async () => {
    const handlerFn = vi.fn().mockResolvedValue(undefined)
    const handlerMethod = makeHandlerMethod(handlerFn)

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeMockCompositeMapping([handlerMethod]),
      contextConfig,
    })

    await expect(dispatcher.dispatch({}, {})).resolves.toBeUndefined()
    expect(handlerFn).toHaveBeenCalledOnce()
  })
})
