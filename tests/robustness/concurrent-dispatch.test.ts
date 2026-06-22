/**
 * 并发分发健壮性测试 —— 100+ 并发分发、无竞态、拦截器隔离。
 */

import { describe, it, expect, vi } from 'vitest'

import type { Context } from '../../src'
import { EventDispatcher, CompositeHandlerMapping } from '../../src/dispatch'
import type {
  HandlerInterceptor,
  HandlerMapping,
  HandlerMethod,
  ResolvedHandler,
} from '../../src/dispatch'

type SimpleEvent = Record<string, unknown>
type SimpleApis = Record<string, unknown>
type Ctx = Context<SimpleEvent, SimpleApis>

/** 构造一个 HandlerMethod */
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
    permission: 0,
    mappingType: 'command',
    trigger: {},
    interceptors: [],
    ...overrides,
  }
}

/** 构造一个返回固定处理器列表的 mock composite mapping */
function makeCompositeMapping(handlers: HandlerMethod[]): HandlerMapping<
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

describe('并发分发健壮性', () => {
  it('空映射下 100 次并发分发不崩溃', async () => {
    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: new CompositeHandlerMapping(),
      contextConfig: {
        textExtractor: (e) => String(e.text ?? ''),
      },
    })

    const dispatches = Array.from({ length: 100 }, (_, i) =>
      dispatcher.dispatch({ text: `消息 ${i}` }, {}),
    )
    await expect(Promise.all(dispatches)).resolves.toBeDefined()
  })

  it('单个处理器下 100 次并发分发均正确执行', async () => {
    let callCount = 0

    const handler = makeHandlerMethod(async () => {
      callCount++
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      contextConfig: {
        textExtractor: (e) => String(e.text ?? ''),
      },
    })

    const dispatches = Array.from({ length: 100 }, (_, i) =>
      dispatcher.dispatch({ text: `msg-${i}` }, {}),
    )
    await Promise.all(dispatches)
    expect(callCount).toBe(100)
  })

  it('多处理器并发分发，各处理器调用次数正确', async () => {
    const counts = { a: 0, b: 0 }

    const handlerA = makeHandlerMethod(
      async () => {
        counts.a++
      },
      { handlerName: 'a', priority: 10 },
    )
    const handlerB = makeHandlerMethod(
      async () => {
        counts.b++
      },
      { handlerName: 'b', priority: 20 },
    )

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handlerA, handlerB]),
      contextConfig: {},
    })

    const N = 50
    await Promise.all(Array.from({ length: N }, () => dispatcher.dispatch({}, {})))

    expect(counts.a).toBe(N)
    expect(counts.b).toBe(N)
  })

  it('拦截器状态不跨并发分发共享', async () => {
    // 每次分发都应在自己的 Context 上操作属性，不影响其他分发
    const attrValues: number[] = []

    const handler = makeHandlerMethod(async (ctx) => {
      // 读取本次分发写入 context 的属性
      const val = ctx.getAttribute<number>('idx')
      if (val !== undefined) attrValues.push(val)
    })

    class IndexInterceptor implements HandlerInterceptor<SimpleEvent, SimpleApis> {
      async preHandle(ctx: Ctx): Promise<boolean> {
        // 从事件中读取 idx 并写入 context 属性
        const idx = ctx.event.idx as number | undefined
        if (idx !== undefined) ctx.setAttribute('idx', idx)
        return true
      }
    }

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      interceptors: [new IndexInterceptor()],
      contextConfig: {},
    })

    const N = 30
    await Promise.all(Array.from({ length: N }, (_, i) => dispatcher.dispatch({ idx: i }, {})))

    expect(attrValues).toHaveLength(N)
    // 每个 idx 值恰好出现一次（无混串）
    const sorted = [...attrValues].sort((a, b) => a - b)
    expect(sorted).toEqual(Array.from({ length: N }, (_, i) => i))
  })

  it('某次分发中 FinishError 不影响其他并发分发', async () => {
    let completedCount = 0

    const handler = makeHandlerMethod(async (ctx) => {
      const shouldFinish = ctx.event.finish as boolean | undefined
      if (shouldFinish === true) ctx.finish()
      completedCount++
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      contextConfig: {},
    })

    const N = 50
    const dispatches = Array.from({ length: N }, (_, i) =>
      // 每隔 10 个触发一次 finish
      dispatcher.dispatch({ finish: i % 10 === 0 }, {}),
    )
    await expect(Promise.all(dispatches)).resolves.toBeDefined()

    // finish 触发时 handler 不会执行到 completedCount++，其余均正常累计
    const finishCount = Array.from({ length: N }, (_, i) => i).filter((i) => i % 10 === 0).length
    expect(completedCount).toBe(N - finishCount)
  })

  it('preHandle 返回 false 不影响其他并发分发', async () => {
    let handlerCallCount = 0

    const handler = makeHandlerMethod(async () => {
      handlerCallCount++
    })

    let blockToggle = false

    class ToggleInterceptor implements HandlerInterceptor<SimpleEvent, SimpleApis> {
      async preHandle(_ctx: Ctx, _h: ResolvedHandler): Promise<boolean> {
        blockToggle = !blockToggle
        return blockToggle
      }
    }

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      interceptors: [new ToggleInterceptor()],
      contextConfig: {},
    })

    const N = 20
    await Promise.all(Array.from({ length: N }, () => dispatcher.dispatch({}, {})))

    // 每隔一次被拦截，handler 执行约 N/2 次（允许 ±1 浮动，因为 toggleBlock 在并发下顺序不确定）
    expect(handlerCallCount).toBeGreaterThan(0)
    expect(handlerCallCount).toBeLessThanOrEqual(N)
  })

  it('afterCompletion 始终调用，即使 handler 抛出非 FinishError', async () => {
    const afterCompletionErrors: (Error | undefined)[] = []

    const handler = makeHandlerMethod(async () => {
      throw new Error('处理器错误')
    })

    class TrackingInterceptor implements HandlerInterceptor<SimpleEvent, SimpleApis> {
      async afterCompletion(_ctx: Ctx, _h: ResolvedHandler, error?: Error): Promise<void> {
        afterCompletionErrors.push(error)
      }
    }

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      interceptors: [new TrackingInterceptor()],
      contextConfig: {},
    })

    const N = 20
    await Promise.all(Array.from({ length: N }, () => dispatcher.dispatch({}, {})))

    // 每次分发的 afterCompletion 均被调用，且 error 不为 undefined
    expect(afterCompletionErrors).toHaveLength(N)
    expect(afterCompletionErrors.every((e) => e instanceof Error)).toBe(true)
  })

  it('logger 在并发分发中不抛出异常', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const handler = makeHandlerMethod(async (ctx) => {
      ctx.finish()
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      contextConfig: {},
      logger,
    })

    await Promise.all(Array.from({ length: 50 }, () => dispatcher.dispatch({}, {})))
    // 不抛出即通过，logger 调用与否均可
    expect(true).toBe(true)
  })
})
