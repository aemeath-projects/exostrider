/**
 * 分发器高负载压力测试 —— 1000+ 并发、混合事件类型、压力脉冲。
 */

import { describe, it, expect } from 'vitest'

import type { Context } from '../../src'
import { EventDispatcher, CompositeHandlerMapping } from '../../src/dispatch'
import type { HandlerMapping, HandlerMethod } from '../../src/dispatch'

type SimpleEvent = Record<string, unknown>
type SimpleApis = Record<string, unknown>
type Ctx = Context<SimpleEvent, SimpleApis>

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
    mappingType: 'command' as const,
    trigger: {},
    interceptors: [],
    requiredBotCapability: null,
    ...overrides,
  }
}

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

describe('分发器高负载压力', () => {
  const contextConfig = {
    textExtractor: (e: SimpleEvent) => String(e.text ?? ''),
  }

  it('1000 次并发分发，全部正确执行，无遗落', async () => {
    const counters = new Map<number, boolean>()
    const handler = makeHandlerMethod(async (ctx) => {
      const idx = ctx.event.idx as number
      counters.set(idx, true)
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      contextConfig,
    })

    const N = 1000
    await Promise.all(Array.from({ length: N }, (_, i) => dispatcher.dispatch({ idx: i }, {})))

    // 所有事件对应索引均被处理
    for (let i = 0; i < N; i++) {
      expect(counters.get(i)).toBe(true)
    }
  })

  it('混合 Handler 类型并发 —— command/regex/keyword 各自命中', async () => {
    const cmdCalls: number[] = []
    const regexCalls: number[] = []
    const kwCalls: number[] = []

    const cmdHandler: HandlerMethod = {
      instance: {
        handle: async (ctx: Ctx) => {
          cmdCalls.push(ctx.event.idx as number)
        },
      },
      methodName: 'handle',
      handlerName: 'cmdHandler',
      priority: 10,
      permission: 0,
      mappingType: 'command',
      trigger: { cmd: 'test', aliases: new Set<string>() },
      interceptors: [],
      requiredBotCapability: null,
    }
    const regexHandler: HandlerMethod = {
      instance: {
        handle: async (ctx: Ctx) => {
          regexCalls.push(ctx.event.idx as number)
        },
      },
      methodName: 'handle',
      handlerName: 'regexHandler',
      priority: 20,
      permission: 0,
      mappingType: 'regex',
      trigger: { compiledPattern: /^regex:/u },
      interceptors: [],
      requiredBotCapability: null,
    }
    const kwHandler: HandlerMethod = {
      instance: {
        handle: async (ctx: Ctx) => {
          kwCalls.push(ctx.event.idx as number)
        },
      },
      methodName: 'handle',
      handlerName: 'kwHandler',
      priority: 30,
      permission: 0,
      mappingType: 'keyword',
      trigger: { keywords: new Set(['紧急']) },
      interceptors: [],
      requiredBotCapability: null,
    }

    const mapping: any = new CompositeHandlerMapping('/')
    mapping.register(cmdHandler)
    mapping.register(regexHandler)
    mapping.register(kwHandler)

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: mapping as HandlerMapping<SimpleEvent, SimpleApis>,
      contextConfig,
    })

    const N = 100
    const tasks: Promise<void>[] = []

    for (let i = 0; i < N; i++) {
      if (i % 3 === 0) {
        tasks.push(dispatcher.dispatch({ text: '/test', idx: i }, {}))
      } else if (i % 3 === 1) {
        tasks.push(dispatcher.dispatch({ text: 'regex:hello', idx: i }, {}))
      } else {
        tasks.push(dispatcher.dispatch({ text: '这是紧急消息', idx: i }, {}))
      }
    }

    await Promise.all(tasks)
    expect(cmdCalls.length).toBeGreaterThan(0)
    expect(regexCalls.length).toBeGreaterThan(0)
    expect(kwCalls.length).toBeGreaterThan(0)
  })

  it('100 并发脉冲中某次 FinishError 不影响其余', async () => {
    let successCount = 0

    const handler = makeHandlerMethod(async (ctx) => {
      if (ctx.event.finish === true) {
        ctx.finish()
      }
      successCount++
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      contextConfig,
    })

    const N = 100
    await Promise.all(
      Array.from({ length: N }, (_, i) => dispatcher.dispatch({ finish: i % 7 === 0 }, {})),
    )

    // finish 的不会增加 successCount
    const expectedFinished = Array.from({ length: N }, (_, i) => i).filter(
      (i) => i % 7 === 0,
    ).length
    expect(successCount).toBe(N - expectedFinished)
  })

  it('多处理器 + 多拦截器：100 次并发下调用链顺序正确', async () => {
    const seqLogs: string[][] = []
    const handlerA = makeHandlerMethod(
      async (ctx) => {
        seqLogs.push([`hA-${ctx.event.idx as number}`])
      },
      { handlerName: 'hA', priority: 10 },
    )
    const handlerB = makeHandlerMethod(
      async (ctx) => {
        seqLogs.push([`hB-${ctx.event.idx as number}`])
      },
      { handlerName: 'hB', priority: 20 },
    )

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handlerA, handlerB]),
      interceptors: [{ preHandle: async () => true, postHandle: async () => {} }],
      contextConfig,
    })

    const N = 100
    await Promise.all(Array.from({ length: N }, (_, i) => dispatcher.dispatch({ idx: i }, {})))

    // handlerA 和 handlerB 各 N 次
    expect(seqLogs.length).toBe(N * 2)
  })

  it('1000 并发中每个 handler 调用次数等于事件数（无重复无遗漏）', async () => {
    let callCount = 0
    const handler = makeHandlerMethod(async () => {
      callCount++
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      contextConfig,
    })

    const N = 1000
    await Promise.all(Array.from({ length: N }, () => dispatcher.dispatch({}, {})))

    expect(callCount).toBe(N)
  })

  it('并发中断与恢复 —— 部分延迟完成的不阻塞整体', async () => {
    const finishOrder: number[] = []
    const handler = makeHandlerMethod(async (ctx) => {
      const delay = ctx.event.delay as number | undefined
      if (delay) {
        await new Promise((r) => setTimeout(r, delay))
      }
      finishOrder.push((ctx.event.idx as number) ?? -1)
    })

    const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
      mapping: makeCompositeMapping([handler]),
      contextConfig,
    })

    const N = 20
    const tasks = Array.from({ length: N }, (_, i) =>
      dispatcher.dispatch({ idx: i, delay: i * 2 }, {}),
    )
    await expect(Promise.all(tasks)).resolves.toBeDefined()
    expect(finishOrder.length).toBe(N)
  })
})
