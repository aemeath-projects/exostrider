import { describe, it, expect, vi } from 'vitest'

import { Context } from '../../../src'
import { EventDispatcher, FinishError } from '../../../src/dispatch'
import type {
  HandlerInterceptor,
  HandlerMapping,
  HandlerMethod,
  ResolvedHandler,
} from '../../../src/dispatch'

interface SimpleEvent {
  text?: string
  type?: string
}
type SimpleApis = Record<string, unknown>
type Ctx = Context<SimpleEvent, SimpleApis>

/** 创建简单的 HandlerMapping mock，返回指定 handler */
function makeMockMapping(handler?: HandlerMethod): HandlerMapping<SimpleEvent, SimpleApis> {
  return {
    priority: 0,
    getHandler: () => handler,
  }
}

/** 创建所有 handler 均匹配的 CompositeMapping mock */
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

/** 创建测试用 HandlerMethod */
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
    ...overrides,
  }
}

/** 创建标准拦截器 mock */
function makeInterceptor(
  overrides: {
    preHandle?: (ctx: Ctx, h: ResolvedHandler) => Promise<boolean>
    postHandle?: (ctx: Ctx, h: ResolvedHandler) => Promise<void>
    afterCompletion?: (ctx: Ctx, h: ResolvedHandler, err?: Error) => Promise<void>
  } = {},
): HandlerInterceptor<SimpleEvent, SimpleApis> {
  return {
    preHandle: overrides.preHandle ?? vi.fn().mockResolvedValue(true),
    postHandle: overrides.postHandle ?? vi.fn().mockResolvedValue(undefined),
    afterCompletion: overrides.afterCompletion ?? vi.fn().mockResolvedValue(undefined),
  }
}

describe('EventDispatcher', () => {
  const contextConfig = {
    textExtractor: (e: SimpleEvent) => e.text,
  }

  describe('正常分发', () => {
    it('事件 → 映射 → handler 被调用', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(handlerFn)

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await dispatcher.dispatch({ text: '/echo' }, {})
      expect(handlerFn).toHaveBeenCalledOnce()
    })

    it('无匹配处理器时静默返回（不抛出错误）', async () => {
      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(undefined),
        contextConfig,
      })

      await expect(dispatcher.dispatch({ text: '/unknown' }, {})).resolves.toBeUndefined()
    })

    it('handler 接收到正确的 Context', async () => {
      let capturedCtx: Ctx | undefined

      const handlerFn = async (ctx: Ctx) => {
        capturedCtx = ctx
      }
      const handlerMethod = makeHandlerMethod(handlerFn)

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      const event = { text: '/echo hello' }
      await dispatcher.dispatch(event, {})

      expect(capturedCtx).toBeDefined()
      expect(capturedCtx!.event).toBe(event)
    })
  })

  describe('拦截器链顺序', () => {
    it('preHandle → handler → postHandle → afterCompletion 顺序', async () => {
      const calls: string[] = []

      const interceptor = makeInterceptor({
        preHandle: async () => {
          calls.push('preHandle')
          return true
        },
        postHandle: async () => {
          calls.push('postHandle')
        },
        afterCompletion: async () => {
          calls.push('afterCompletion')
        },
      })

      const handlerFn = async () => {
        calls.push('handler')
      }
      const handlerMethod = makeHandlerMethod(handlerFn)

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({ text: '/cmd' }, {})
      expect(calls).toEqual(['preHandle', 'handler', 'postHandle', 'afterCompletion'])
    })

    it('多个拦截器时 postHandle/afterCompletion 逆序执行', async () => {
      const calls: string[] = []

      const i1 = makeInterceptor({
        preHandle: async () => {
          calls.push('pre1')
          return true
        },
        postHandle: async () => {
          calls.push('post1')
        },
        afterCompletion: async () => {
          calls.push('after1')
        },
      })
      const i2 = makeInterceptor({
        preHandle: async () => {
          calls.push('pre2')
          return true
        },
        postHandle: async () => {
          calls.push('post2')
        },
        afterCompletion: async () => {
          calls.push('after2')
        },
      })

      const handlerFn = async () => {
        calls.push('handler')
      }
      const handlerMethod = makeHandlerMethod(handlerFn)

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [i1, i2],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(calls).toEqual(['pre1', 'pre2', 'handler', 'post2', 'post1', 'after2', 'after1'])
    })
  })

  describe('preHandle 返回 false', () => {
    it('preHandle 返回 false 时中止分发', async () => {
      const handlerFn = vi.fn()
      const handlerMethod = makeHandlerMethod(handlerFn)

      const interceptor = makeInterceptor({
        preHandle: async () => false,
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).not.toHaveBeenCalled()
    })

    it('preHandle 返回 false 时仍调用 afterCompletion', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(vi.fn())

      const interceptor = makeInterceptor({
        preHandle: async () => false,
        afterCompletion,
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(afterCompletion).toHaveBeenCalledOnce()
    })
  })

  describe('FinishError 处理', () => {
    it('FinishError 视为正常完成，afterCompletion 不传 error', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)

      const handlerFn = (_ctx: Ctx) => {
        throw new FinishError('done')
      }
      const handlerMethod = makeHandlerMethod(handlerFn)

      const interceptor = makeInterceptor({ afterCompletion })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})

      // afterCompletion 被调用，error 参数为 undefined
      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.objectContaining({ handlerName: 'test' }),
        undefined, // FinishError 不传 error
      )
    })

    it('FinishError 不向外抛出', async () => {
      const handlerFn = (_ctx: Ctx) => {
        throw new FinishError()
      }
      const handlerMethod = makeHandlerMethod(handlerFn)

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await expect(dispatcher.dispatch({}, {})).resolves.toBeUndefined()
    })
  })

  describe('真实错误处理', () => {
    it('handler 抛出非 FinishError 时 afterCompletion 传入 error', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const err = new Error('handler failed')

      const handlerFn = () => {
        throw err
      }
      const handlerMethod = makeHandlerMethod(handlerFn)

      const interceptor = makeInterceptor({ afterCompletion })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})

      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.objectContaining({ handlerName: 'test' }),
        err,
      )
    })
  })

  describe('afterCompletion 始终运行', () => {
    it('handler 成功时 afterCompletion 被调用', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(async () => {})

      const interceptor = makeInterceptor({ afterCompletion })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(afterCompletion).toHaveBeenCalledOnce()
    })

    it('handler 失败时 afterCompletion 也被调用', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(() => {
        throw new Error('fail')
      })

      const interceptor = makeInterceptor({ afterCompletion })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(afterCompletion).toHaveBeenCalledOnce()
    })
  })

  describe('可选拦截器方法', () => {
    it('拦截器可以只实现部分方法', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(handlerFn)

      // 只有 preHandle 的拦截器
      const partialInterceptor: HandlerInterceptor<SimpleEvent, SimpleApis> = {
        preHandle: async () => true,
      }

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [partialInterceptor],
        contextConfig,
      })

      await expect(dispatcher.dispatch({}, {})).resolves.toBeUndefined()
      expect(handlerFn).toHaveBeenCalledOnce()
    })
  })

  describe('多处理器按优先级执行', () => {
    it('CompositeMapping 返回的多个处理器均被执行', async () => {
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
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(calls).toEqual(['h1', 'h2'])
    })
  })

  describe('声明式拦截器', () => {
    it('通过 handler.interceptors 实例化并执行声明式拦截器', async () => {
      const calls: string[] = []

      class DeclInterceptor {
        async preHandle(_ctx: unknown, _h: unknown): Promise<boolean> {
          calls.push('declPre')
          return true
        }
        async postHandle(): Promise<void> {
          calls.push('declPost')
        }
        async afterCompletion(): Promise<void> {
          calls.push('declAfter')
        }
      }

      const handlerFn = async () => {
        calls.push('handler')
      }
      const handlerMethod = makeHandlerMethod(handlerFn, {
        interceptors: [{ interceptorClass: DeclInterceptor }],
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(calls).toEqual(['declPre', 'handler', 'declPost', 'declAfter'])
    })

    it('声明式拦截器无 preHandle 时默认放行（handler 正常执行）', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)

      class NoPre {
        async afterCompletion(): Promise<void> {}
      }

      const handlerMethod = makeHandlerMethod(handlerFn, {
        interceptors: [{ interceptorClass: NoPre }],
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).toHaveBeenCalledOnce()
    })

    it('声明式拦截器无 postHandle 时 handler 执行不报错', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)

      class NoPost {
        async preHandle(): Promise<boolean> {
          return true
        }
      }

      const handlerMethod = makeHandlerMethod(handlerFn, {
        interceptors: [{ interceptorClass: NoPost }],
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).toHaveBeenCalledOnce()
    })

    it('声明式拦截器 preHandle 返回 false 阻断执行', async () => {
      const handlerFn = vi.fn()

      class BlockingInterceptor {
        async preHandle(): Promise<boolean> {
          return false
        }
      }

      const handlerMethod = makeHandlerMethod(handlerFn, {
        interceptors: [{ interceptorClass: BlockingInterceptor }],
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).not.toHaveBeenCalled()
    })

    it('声明式拦截器 preHandle 抛出错误时中止执行', async () => {
      const handlerFn = vi.fn()
      const globalAfterCompletion = vi.fn().mockResolvedValue(undefined)

      class ThrowingPreInterceptor {
        async preHandle(): Promise<boolean> {
          throw new Error('pre error')
        }
      }

      const handlerMethod = makeHandlerMethod(handlerFn, {
        interceptors: [{ interceptorClass: ThrowingPreInterceptor }],
      })

      // 全局拦截器的 afterCompletion 应被调用
      const globalInterceptor = makeInterceptor({ afterCompletion: globalAfterCompletion })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [globalInterceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).not.toHaveBeenCalled()
      // 全局拦截器的 afterCompletion 被调用（传入 error）
      expect(globalAfterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.any(Object),
        expect.any(Error),
      )
    })
  })

  describe('错误边界', () => {
    it('全局 preHandle 抛出错误时 afterCompletion 传入 error', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const handlerFn = vi.fn()

      const handlerMethod = makeHandlerMethod(handlerFn)

      const interceptor: HandlerInterceptor<SimpleEvent, SimpleApis> = {
        preHandle: async () => {
          throw new Error('pre threw')
        },
        afterCompletion,
      }

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).not.toHaveBeenCalled()
      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.any(Object),
        expect.any(Error),
      )
    })

    it('handler 方法不存在时抛出错误并由 afterCompletion 捕获', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const interceptor = makeInterceptor({ afterCompletion })

      const handlerMethod: HandlerMethod = {
        instance: {}, // 没有 handle 方法
        methodName: 'handle',
        handlerName: 'missing',
        priority: 50,
        scope: 'all',
        permission: 0,
        mappingType: 'command',
        trigger: {},
        interceptors: [],
      }

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.any(Object),
        expect.any(Error),
      )
    })

    it('afterCompletion 自身抛出错误时不向外传播', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(handlerFn)

      const interceptor: HandlerInterceptor<SimpleEvent, SimpleApis> = {
        afterCompletion: async () => {
          throw new Error('cleanup error')
        },
      }

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await expect(dispatcher.dispatch({}, {})).resolves.toBeUndefined()
    })

    it('使用 logger 时 logger 方法被调用', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }

      const handlerMethod = makeHandlerMethod(() => {
        throw new Error('test error')
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        logger,
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(logger.error).toHaveBeenCalled()
    })

    it('非 Error 对象被转换为 Error', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)

      const handlerFn = () => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string error'
      }
      const handlerMethod = makeHandlerMethod(handlerFn)

      const interceptor = makeInterceptor({ afterCompletion })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.any(Object),
        expect.any(Error),
      )
    })
  })

  describe('降级映射（无 getAllHandlers）', () => {
    it('仅有 getHandler 的映射也能正常分发', async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(handlerFn)

      // 不带 getAllHandlers 的普通映射
      const simpleMapping: HandlerMapping<SimpleEvent, SimpleApis> = {
        priority: 0,
        getHandler: () => handlerMethod,
      }

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: simpleMapping,
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).toHaveBeenCalledOnce()
    })
  })

  describe('非 Error 对象在声明式拦截器中的处理', () => {
    it('声明式拦截器 preHandle 抛出非 Error 对象时被转换为 Error', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)

      class ThrowNonError {
        async preHandle(): Promise<boolean> {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'not an error'
        }
        async afterCompletion(): Promise<void> {
          afterCompletion()
        }
      }

      const handlerMethod = makeHandlerMethod(vi.fn(), {
        interceptors: [{ interceptorClass: ThrowNonError }],
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await expect(dispatcher.dispatch({}, {})).resolves.toBeUndefined()
    })
  })

  describe('postHandle 错误路径', () => {
    it('声明式拦截器 postHandle 抛出时 afterCompletion 被调用', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)

      class ThrowingPostDeclInterceptor {
        async preHandle(): Promise<boolean> {
          return true
        }
        async postHandle(): Promise<void> {
          throw new Error('post decl error')
        }
        async afterCompletion(_ctx: unknown, _h: unknown, err?: Error): Promise<void> {
          afterCompletion(err)
        }
      }

      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(handlerFn, {
        interceptors: [{ interceptorClass: ThrowingPostDeclInterceptor }],
      })

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).toHaveBeenCalledOnce()
      // afterCompletion 调用时传了 error（来自 declInterceptors）
      expect(afterCompletion).toHaveBeenCalledWith(expect.any(Error))
    })

    it('全局拦截器 postHandle 抛出时 afterCompletion 被调用', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)

      const handlerFn = vi.fn().mockResolvedValue(undefined)
      const handlerMethod = makeHandlerMethod(handlerFn)

      const interceptor: HandlerInterceptor<SimpleEvent, SimpleApis> = {
        postHandle: async () => {
          throw new Error('post global error')
        },
        afterCompletion,
      }

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(handlerMethod),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(handlerFn).toHaveBeenCalledOnce()
      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.any(Object),
        expect.any(Error),
      )
    })

    it('全局拦截器 postHandle 抛出非 Error 对象时被封装为 Error 传给 afterCompletion', async () => {
      const afterCompletion = vi.fn().mockResolvedValue(undefined)
      const handlerFn = vi.fn().mockResolvedValue(undefined)

      const interceptor: HandlerInterceptor<SimpleEvent, SimpleApis> = {
        postHandle: async () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'string error from postHandle'
        },
        afterCompletion,
      }

      const dispatcher = new EventDispatcher<SimpleEvent, SimpleApis>({
        mapping: makeMockMapping(makeHandlerMethod(handlerFn)),
        interceptors: [interceptor],
        contextConfig,
      })

      await dispatcher.dispatch({}, {})
      expect(afterCompletion).toHaveBeenCalledWith(
        expect.any(Context),
        expect.any(Object),
        expect.any(Error),
      )
    })
  })
})
