/**
 * capability 端到端集成测试
 * 验证 requiredBotCapability 在完整分发链中的传递，以及 capability-aware 拦截器行为。
 *
 * 测试链路：HandlerMethod.requiredBotCapability
 *          → EventDispatcher._runHandlerWithInterceptors
 *          → ResolvedHandler.requiredBotCapability
 *          → 拦截器 preHandle 读取并决策
 */
import { describe, it, expect, vi } from 'vitest'

import { Context } from '../../../src'
import { EventDispatcher } from '../../../src/dispatch'
import type {
  HandlerInterceptor,
  HandlerMapping,
  HandlerMethod,
  ResolvedHandler,
} from '../../../src/dispatch'

interface BotEvent {
  text?: string
  botRole?: 'none' | 'admin' | 'owner'
}
type BotApis = Record<string, unknown>
type BotCtx = Context<BotEvent, BotApis>

const contextConfig = {
  textExtractor: (e: BotEvent) => e.text,
}

function makeMockMapping(handler?: HandlerMethod): HandlerMapping<BotEvent, BotApis> {
  return {
    priority: 0,
    getHandler: () => handler,
  }
}

function makeMockCompositeMapping(handlers: HandlerMethod[]): HandlerMapping<BotEvent, BotApis> & {
  getAllHandlers: (ctx: BotCtx) => HandlerMethod[]
} {
  return {
    priority: 0,
    getHandler: () => handlers[0],
    getAllHandlers: () => handlers,
  }
}

function makeHandlerMethod(
  fn: (ctx: BotCtx) => Promise<void> | void,
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

/**
 * 模拟现实场景的 capability-aware 拦截器。
 * 根据 handler.requiredBotCapability 检查 ctx.event.botRole。
 * group_admin: admin 或 owner 均满足。
 * group_owner: 仅 owner 满足。
 */
class BotCapabilityInterceptor implements HandlerInterceptor<BotEvent, BotApis> {
  async preHandle(ctx: BotCtx, handler: ResolvedHandler): Promise<boolean> {
    const required = handler.requiredBotCapability
    if (required === null) return true

    const role = ctx.event.botRole ?? 'none'
    if (required === 'group_admin') return role === 'admin' || role === 'owner'
    if (required === 'group_owner') return role === 'owner'
    return false
  }
}

describe('capability 端到端集成', () => {
  describe('ResolvedHandler 中 capability 字段的传递', () => {
    it('group_admin 正确出现在拦截器接收的 ResolvedHandler 中', async () => {
      let capturedCapability: string | null | undefined

      const handler = makeHandlerMethod(vi.fn(), { requiredBotCapability: 'group_admin' })
      const spy: HandlerInterceptor<BotEvent, BotApis> = {
        preHandle: async (_ctx, h) => {
          capturedCapability = h.requiredBotCapability
          return true
        },
      }

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [spy],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'admin' }, {})
      expect(capturedCapability).toBe('group_admin')
    })

    it('group_owner 正确出现在 ResolvedHandler 中', async () => {
      let capturedCapability: string | null | undefined

      const handler = makeHandlerMethod(vi.fn(), { requiredBotCapability: 'group_owner' })
      const spy: HandlerInterceptor<BotEvent, BotApis> = {
        preHandle: async (_ctx, h) => {
          capturedCapability = h.requiredBotCapability
          return true
        },
      }

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [spy],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'owner' }, {})
      expect(capturedCapability).toBe('group_owner')
    })

    it('null capability 正确出现在 ResolvedHandler 中（非 sentinel 值）', async () => {
      let capturedCapability: string | null | undefined = 'sentinel'

      const handler = makeHandlerMethod(vi.fn(), { requiredBotCapability: null })
      const spy: HandlerInterceptor<BotEvent, BotApis> = {
        preHandle: async (_ctx, h) => {
          capturedCapability = h.requiredBotCapability
          return true
        },
      }

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [spy],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(capturedCapability).toBeNull()
    })

    it('capability 字段在 afterCompletion 阶段的 ResolvedHandler 中同样正确', async () => {
      let capabilityInAfter: string | null | undefined

      const handler = makeHandlerMethod(vi.fn(), { requiredBotCapability: 'group_owner' })
      const spy: HandlerInterceptor<BotEvent, BotApis> = {
        afterCompletion: async (_ctx, h) => {
          capabilityInAfter = h.requiredBotCapability
        },
      }

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [spy],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'owner' }, {})
      expect(capabilityInAfter).toBe('group_owner')
    })
  })

  describe('BotCapabilityInterceptor 权限检查', () => {
    it('null capability：无论 botRole 如何均放行', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: null })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      for (const role of ['none', 'admin', 'owner'] as const) {
        await dispatcher.dispatch({ botRole: role }, {})
      }
      expect(handlerFn).toHaveBeenCalledTimes(3)
    })

    it('group_admin：admin 角色可通过', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_admin' })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'admin' }, {})
      expect(handlerFn).toHaveBeenCalledOnce()
    })

    it('group_admin：owner 角色满足 admin 要求，可通过', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_admin' })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'owner' }, {})
      expect(handlerFn).toHaveBeenCalledOnce()
    })

    it('group_admin：none 角色被拦截，handler 不执行', async () => {
      const handlerFn = vi.fn()
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_admin' })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'none' }, {})
      expect(handlerFn).not.toHaveBeenCalled()
    })

    it('group_admin：botRole 未设置时（undefined → none）被拦截', async () => {
      const handlerFn = vi.fn()
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_admin' })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({}, {}) // 无 botRole 字段
      expect(handlerFn).not.toHaveBeenCalled()
    })

    it('group_owner：仅 owner 可通过', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_owner' })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'owner' }, {})
      expect(handlerFn).toHaveBeenCalledOnce()
    })

    it('group_owner：admin 不满足 owner 要求，被拦截', async () => {
      const handlerFn = vi.fn()
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_owner' })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'admin' }, {})
      expect(handlerFn).not.toHaveBeenCalled()
    })

    it('group_owner：none 被拦截', async () => {
      const handlerFn = vi.fn()
      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_owner' })
      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'none' }, {})
      expect(handlerFn).not.toHaveBeenCalled()
    })
  })

  describe('capability 拦截时的 afterCompletion 行为', () => {
    it('capability 检查失败（preHandle 返回 false）时 afterCompletion 仍被调用', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)

      const handler = makeHandlerMethod(vi.fn(), { requiredBotCapability: 'group_admin' })
      const tracingInterceptor: HandlerInterceptor<BotEvent, BotApis> = {
        afterCompletion,
      }

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        // 追踪拦截器在前（被追踪到 afterCompletion）；能力拦截器在后（阻断）
        interceptors: [tracingInterceptor, new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'none' }, {})

      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.objectContaining({ requiredBotCapability: 'group_admin' }),
        undefined, // preHandle 返回 false 不是错误
      )
    })

    it('capability 检查通过后 handler 正常执行，afterCompletion 也被调用', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const handlerFn = vi.fn().mockResolvedValue(undefined)

      const handler = makeHandlerMethod(handlerFn, { requiredBotCapability: 'group_admin' })
      const tracingInterceptor: HandlerInterceptor<BotEvent, BotApis> = {
        afterCompletion,
      }

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [tracingInterceptor, new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'admin' }, {})

      expect(handlerFn).toHaveBeenCalledOnce()
      expect(afterCompletion).toHaveBeenCalledOnce()
    })
  })

  describe('多 handler 各自独立的 capability', () => {
    it('bot 无 admin 权限：group_admin handler 被拦截，无要求的 handler 正常执行', async () => {
      const calls: string[] = []

      const h1 = makeHandlerMethod(
        async () => {
          calls.push('h1')
        },
        { handlerName: 'h1', priority: 10, requiredBotCapability: 'group_admin' },
      )
      const h2 = makeHandlerMethod(
        async () => {
          calls.push('h2')
        },
        { handlerName: 'h2', priority: 20, requiredBotCapability: null },
      )

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockCompositeMapping([h1, h2]),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'none' }, {})
      expect(calls).toEqual(['h2']) // h1 被拦截，h2 无要求
    })

    it('bot 有 owner 权限：group_admin 和 group_owner handler 均可执行', async () => {
      const calls: string[] = []

      const h1 = makeHandlerMethod(
        async () => {
          calls.push('h1')
        },
        { handlerName: 'h1', priority: 10, requiredBotCapability: 'group_admin' },
      )
      const h2 = makeHandlerMethod(
        async () => {
          calls.push('h2')
        },
        { handlerName: 'h2', priority: 20, requiredBotCapability: 'group_owner' },
      )

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockCompositeMapping([h1, h2]),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'owner' }, {})
      expect(calls).toEqual(['h1', 'h2'])
    })

    it('bot 为 admin：group_admin 通过，group_owner 被拦截', async () => {
      const calls: string[] = []

      const h1 = makeHandlerMethod(
        async () => {
          calls.push('h1-admin')
        },
        { handlerName: 'h1', priority: 10, requiredBotCapability: 'group_admin' },
      )
      const h2 = makeHandlerMethod(
        async () => {
          calls.push('h2-owner')
        },
        { handlerName: 'h2', priority: 20, requiredBotCapability: 'group_owner' },
      )

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockCompositeMapping([h1, h2]),
        interceptors: [new BotCapabilityInterceptor()],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'admin' }, {})
      expect(calls).toEqual(['h1-admin'])
    })
  })

  describe('声明式拦截器访问 capability', () => {
    it('声明式 capability-aware 拦截器通过 ResolvedHandler 读取并阻断', async () => {
      const handlerFn = vi.fn()
      let capturedCapability: string | null | undefined

      class DeclCapabilityInterceptor {
        async preHandle(_ctx: BotCtx, handler: ResolvedHandler): Promise<boolean> {
          capturedCapability = handler.requiredBotCapability
          return handler.requiredBotCapability === null
        }
      }

      const blockedHandler = makeHandlerMethod(handlerFn, {
        requiredBotCapability: 'group_admin',
        interceptors: [{ interceptorClass: DeclCapabilityInterceptor }],
      })

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(blockedHandler),
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).not.toHaveBeenCalled()
      expect(capturedCapability).toBe('group_admin')
    })

    it('声明式拦截器在 postHandle 阶段也能读取 capability', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      let capabilityInPost: string | null | undefined

      class DeclPostInterceptor {
        async postHandle(_ctx: BotCtx, handler: ResolvedHandler): Promise<void> {
          capabilityInPost = handler.requiredBotCapability
        }
      }

      const h = makeHandlerMethod(handlerFn, {
        requiredBotCapability: 'group_owner',
        interceptors: [{ interceptorClass: DeclPostInterceptor }],
      })

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(h),
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).toHaveBeenCalledOnce()
      expect(capabilityInPost).toBe('group_owner')
    })
  })

  describe('capability 与 FinishError 交互', () => {
    it('handler 抛出 FinishError 时 capability 相关 afterCompletion 正常执行', async () => {
      const { FinishError } = await import('../../../src/dispatch')
      const afterCompletion = vi.fn().mockResolvedValue(undefined)

      const handler = makeHandlerMethod(
        () => {
          throw new FinishError('done')
        },
        { requiredBotCapability: 'group_admin' },
      )

      const spy: HandlerInterceptor<BotEvent, BotApis> = {
        afterCompletion,
      }

      const dispatcher = new EventDispatcher<BotEvent, BotApis>({
        mapping: makeMockMapping(handler),
        interceptors: [new BotCapabilityInterceptor(), spy],
        contextConfig,
      })

      await dispatcher.dispatch({ botRole: 'admin' }, {})

      // FinishError 不是真正的错误，afterCompletion 的 error 参数为 undefined
      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.objectContaining({ requiredBotCapability: 'group_admin' }),
        undefined,
      )
    })
  })
})
