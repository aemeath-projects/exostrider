import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  InteractiveSession,
  SessionManager,
  STATE_META_KEY,
  INPUT_META_KEY,
  EXIT_META_KEY,
  TimeoutMode,
} from '../../../src/session'
import type { SessionContext, StateDefinition } from '../../../src/session'

/** 简单的测试会话，onInput 触发 finished。 */
class SimpleFinishSession extends InteractiveSession {
  override buildStates(): StateDefinition[] {
    return [
      {
        id: 'start',
        onInput: async (_ctx, input) => {
          if (input === 'done') return { finished: true }
          return {}
        },
      },
    ]
  }
}

/** 从不结束的会话（等待取消）。 */
class NeverEndSession extends InteractiveSession {
  override buildStates(): StateDefinition[] {
    return [{ id: 'waiting' }]
  }
}

const makeManager = (timeoutSeconds = 30) =>
  new SessionManager<string>({
    config: { timeout: timeoutSeconds },
    keyExtractor: (ctx: string) => ctx,
  })

describe('SessionManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('start() & isActive()', () => {
    it('start 后 isActive 返回 true', async () => {
      const manager = makeManager()
      await manager.start(new SimpleFinishSession(), 'user:1')
      expect(manager.isActive('user:1')).toBe(true)
    })

    it('start 后会话数量增加', async () => {
      const manager = makeManager()
      expect(manager.getActiveCount()).toBe(0)
      await manager.start(new SimpleFinishSession(), 'user:1')
      expect(manager.getActiveCount()).toBe(1)
    })

    it('相同 key 二次 start 被锁阻止（仍只有一个活跃会话）', async () => {
      const manager = makeManager()
      await manager.start(new SimpleFinishSession(), 'user:1')
      // 第二次 start 同一 key，锁未释放，应被静默拒绝
      await manager.start(new SimpleFinishSession(), 'user:1')
      expect(manager.getActiveCount()).toBe(1)
    })

    it('不同 key 可并发启动多个会话', async () => {
      const manager = makeManager()
      await manager.start(new SimpleFinishSession(), 'user:1')
      await manager.start(new SimpleFinishSession(), 'user:2')
      expect(manager.getActiveCount()).toBe(2)
    })

    it('start 时调用 onStart 钩子', async () => {
      const onStart = vi.fn().mockResolvedValue(undefined)
      class HookSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'start' }]
        }
        override async onStart(ctx: SessionContext): Promise<void> {
          onStart(ctx)
        }
      }
      const manager = makeManager()
      await manager.start(new HookSession(), 'user:1')
      expect(onStart).toHaveBeenCalledTimes(1)
    })

    it('InMemoryLockProvider 被默认使用（未传 lockProvider）', async () => {
      // 只要不抛错，且 start 后 isActive 正常，即说明默认锁正常工作
      const manager = makeManager()
      await manager.start(new NeverEndSession(), 'user:1')
      expect(manager.isActive('user:1')).toBe(true)
    })

    it('keyExtractor 用于提取 key', async () => {
      interface Ctx {
        id: string
      }
      const manager = new SessionManager<Ctx>({
        config: { timeout: 30 },
        keyExtractor: (ctx) => ctx.id,
      })
      await manager.start(new NeverEndSession(), { id: 'custom-key' })
      expect(manager.isActive('custom-key')).toBe(true)
    })
  })

  describe('processMessage()', () => {
    it('有活跃会话时 processMessage 返回 true', async () => {
      const manager = makeManager()
      await manager.start(new NeverEndSession(), 'user:1')
      const result = await manager.processMessage('user:1', 'hello')
      expect(result).toBe(true)
    })

    it('无活跃会话时 processMessage 返回 false', async () => {
      const manager = makeManager()
      const result = await manager.processMessage('user:1', 'hello')
      expect(result).toBe(false)
    })

    it('会话完成后 isActive 变为 false', async () => {
      const manager = makeManager()
      await manager.start(new SimpleFinishSession(), 'user:1')
      await manager.processMessage('user:1', 'done')
      expect(manager.isActive('user:1')).toBe(false)
    })

    it('会话完成后 onFinish 被调用', async () => {
      const onFinish = vi.fn().mockResolvedValue(undefined)
      class FinishHookSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [
            {
              id: 'start',
              onInput: async () => ({ finished: true, data: { result: 42 } }),
            },
          ]
        }
        override async onFinish(_ctx: SessionContext, _data: unknown): Promise<void> {
          onFinish(_data)
        }
      }
      const manager = makeManager()
      await manager.start(new FinishHookSession(), 'user:1')
      await manager.processMessage('user:1', 'finish')
      expect(onFinish).toHaveBeenCalledTimes(1)
    })

    it('取消命令触发 cancel', async () => {
      const onCancel = vi.fn().mockResolvedValue(undefined)
      class CancelHookSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onCancel(_ctx: SessionContext): Promise<void> {
          onCancel()
        }
      }
      const manager = makeManager()
      await manager.start(new CancelHookSession(), 'user:1')
      await manager.processMessage('user:1', '/取消')
      expect(onCancel).toHaveBeenCalled()
      expect(manager.isActive('user:1')).toBe(false)
    })

    it('onInput 抛出非 Error 对象时也调用 onError 并传入 Error 实例', async () => {
      const onError = vi.fn().mockResolvedValue(undefined)
      class NonErrorThrowSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [
            {
              id: 'start',
              onInput: async () => {
                // eslint-disable-next-line @typescript-eslint/only-throw-error
                throw 'string error'
              },
            },
          ]
        }
        override async onError(_ctx: SessionContext, err: Error): Promise<void> {
          onError(err)
        }
      }
      const manager = makeManager()
      await manager.start(new NonErrorThrowSession(), 'user:1')
      await manager.processMessage('user:1', 'trigger')
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(manager.isActive('user:1')).toBe(false)
    })

    it('自定义取消命令被识别', async () => {
      const onCancel = vi.fn().mockResolvedValue(undefined)
      class CancelHookSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onCancel(_ctx: SessionContext): Promise<void> {
          onCancel()
        }
      }
      const manager = new SessionManager<string>({
        config: { timeout: 30, cancelCommands: ['/quit'] },
        keyExtractor: (ctx) => ctx,
      })
      await manager.start(new CancelHookSession(), 'user:1')
      await manager.processMessage('user:1', '/quit')
      expect(onCancel).toHaveBeenCalled()
    })
  })

  describe('cancel()', () => {
    it('cancel 后 isActive 返回 false', async () => {
      const manager = makeManager()
      await manager.start(new NeverEndSession(), 'user:1')
      await manager.cancel('user:1')
      expect(manager.isActive('user:1')).toBe(false)
    })

    it('cancel 调用 onCancel 钩子', async () => {
      const onCancel = vi.fn().mockResolvedValue(undefined)
      class CancelSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onCancel(_ctx: SessionContext): Promise<void> {
          onCancel()
        }
      }
      const manager = makeManager()
      await manager.start(new CancelSession(), 'user:1')
      await manager.cancel('user:1')
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('cancel 不存在的 key 不报错', async () => {
      const manager = makeManager()
      await expect(manager.cancel('nonexistent')).resolves.toBeUndefined()
    })

    it('cancel 时 onCancel 钩子抛出后 logger.error 被调用且会话仍被清理', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      }
      class ThrowingCancelSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onCancel(_ctx: SessionContext): Promise<void> {
          throw new Error('onCancel failed')
        }
      }
      const manager = new SessionManager<string>({
        config: { timeout: 30 },
        keyExtractor: (ctx) => ctx,
        logger,
      })
      await manager.start(new ThrowingCancelSession(), 'user:1')
      await manager.cancel('user:1')
      expect(logger.error).toHaveBeenCalled()
      expect(manager.isActive('user:1')).toBe(false)
    })

    it('cancel 后锁被释放，可以重新 start', async () => {
      const manager = makeManager()
      await manager.start(new NeverEndSession(), 'user:1')
      await manager.cancel('user:1')
      // 锁已释放，应该可以重新 start
      await manager.start(new NeverEndSession(), 'user:1')
      expect(manager.isActive('user:1')).toBe(true)
    })
  })

  describe('超时机制', () => {
    it('超时后 onTimeout 被调用，会话结束', async () => {
      vi.useFakeTimers()
      const onTimeout = vi.fn().mockResolvedValue(undefined)

      class TimeoutSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onTimeout(_ctx: SessionContext): Promise<void> {
          onTimeout()
        }
      }

      const manager = makeManager(5) // 5 秒超时
      await manager.start(new TimeoutSession(), 'user:1')
      expect(manager.isActive('user:1')).toBe(true)

      // 推进时间超过超时
      await vi.advanceTimersByTimeAsync(5500)

      expect(onTimeout).toHaveBeenCalled()
      expect(manager.isActive('user:1')).toBe(false)
    })

    it('超时后锁被释放', async () => {
      vi.useFakeTimers()

      const manager = makeManager(2) // 2 秒超时
      await manager.start(new NeverEndSession(), 'user:1')

      await vi.advanceTimersByTimeAsync(2500)

      expect(manager.isActive('user:1')).toBe(false)
      // 锁已释放，可以重新 start
      await manager.start(new NeverEndSession(), 'user:1')
      expect(manager.isActive('user:1')).toBe(true)
    })

    it('超时触发前手动 cancel，超时回调安全退出不崩溃', async () => {
      vi.useFakeTimers()
      const onTimeout = vi.fn().mockResolvedValue(undefined)

      class SafeTimeoutSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onTimeout(_ctx: SessionContext): Promise<void> {
          onTimeout()
        }
      }

      const manager = makeManager(5)
      await manager.start(new SafeTimeoutSession(), 'user:1')

      // 在超时前手动取消
      await manager.cancel('user:1')
      expect(manager.isActive('user:1')).toBe(false)

      // 推进时间至超时之后 —— 不应崩溃，onTimeout 不被调用
      await vi.advanceTimersByTimeAsync(6000)
      expect(onTimeout).not.toHaveBeenCalled()
    })
  })

  describe('cancelAll()', () => {
    it('cancelAll 清理所有会话', async () => {
      const manager = makeManager()
      await manager.start(new NeverEndSession(), 'user:1')
      await manager.start(new NeverEndSession(), 'user:2')
      await manager.cancelAll()
      expect(manager.getActiveCount()).toBe(0)
    })
  })

  describe('装饰器 DSL 路径 (buildStatesFromDecorators)', () => {
    it('未重写 buildStates 时从装饰器元数据构建状态', async () => {
      class DecoratedSession extends InteractiveSession {}

      // 模拟 @state('idle', { initial: true }) 装饰器效果 —— 方法必须挂到 prototype 上
      async function idleState(this: DecoratedSession) {}
      Object.assign(idleState, {
        [STATE_META_KEY as string]: { id: 'idle', initial: true },
      })

      // 模拟 @onInput('idle') 装饰器效果
      async function handleInput(this: DecoratedSession) {
        return { finished: true }
      }
      Object.assign(handleInput, {
        [INPUT_META_KEY as string]: { stateId: 'idle' },
      })

      // 模拟 @onExit('idle') 装饰器效果
      async function onExitState(this: DecoratedSession) {}
      Object.assign(onExitState, {
        [EXIT_META_KEY as string]: { stateId: 'idle' },
      })

      // 将方法挂到 prototype 上（模拟 @state / @onInput / @onExit 装饰器的效果）
      ;(DecoratedSession.prototype as unknown as Record<string, unknown>).idleState = idleState
      ;(DecoratedSession.prototype as unknown as Record<string, unknown>).handleInput = handleInput
      ;(DecoratedSession.prototype as unknown as Record<string, unknown>).onExitState = onExitState

      const manager = makeManager()
      await manager.start(new DecoratedSession(), 'dsl-user')
      expect(manager.isActive('dsl-user')).toBe(true)

      // processMessage 应触发 finished（handleInput 返回 { finished: true }）
      await manager.processMessage('dsl-user', 'anything')
      expect(manager.isActive('dsl-user')).toBe(false)
    })
  })

  describe('错误钩子异常处理', () => {
    it('onTimeout 抛出异常时 logger.error 被调用且会话仍被清理', async () => {
      vi.useFakeTimers()
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      }

      class ThrowingTimeoutSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onTimeout(_ctx: SessionContext): Promise<void> {
          throw new Error('timeout error')
        }
      }

      const manager = new SessionManager<string>({
        config: { timeout: 1 },
        keyExtractor: (ctx) => ctx,
        logger,
      })
      await manager.start(new ThrowingTimeoutSession(), 'timeout-err')
      expect(manager.isActive('timeout-err')).toBe(true)

      await vi.advanceTimersByTimeAsync(2000)

      expect(logger.error).toHaveBeenCalled()
      expect(manager.isActive('timeout-err')).toBe(false)
    })

    it('onFinish 抛出异常时 logger.error 被调用且会话仍被清理', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      }

      class ThrowingFinishSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'start', onInput: async () => ({ finished: true }) }]
        }
        override async onFinish(_ctx: SessionContext, _data: unknown): Promise<void> {
          throw new Error('finish error')
        }
      }

      const manager = new SessionManager<string>({
        config: { timeout: 30 },
        keyExtractor: (ctx) => ctx,
        logger,
      })
      await manager.start(new ThrowingFinishSession(), 'finish-err')
      await manager.processMessage('finish-err', 'done')

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('onFinish'),
        expect.any(Error),
      )
      expect(manager.isActive('finish-err')).toBe(false)
    })

    it('onStart 抛出异常时 logger.error 被调用，会话被清理且异常向外传播', async () => {
      const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      }

      class ThrowingStartSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'start' }]
        }
        override async onStart(_ctx: SessionContext): Promise<void> {
          throw new Error('start error')
        }
      }

      const manager = new SessionManager<string>({
        config: { timeout: 30 },
        keyExtractor: (ctx) => ctx,
        logger,
      })

      await expect(manager.start(new ThrowingStartSession(), 'start-err')).rejects.toThrow(
        'start error',
      )

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('启动异常'),
        expect.any(Error),
      )
      expect(manager.isActive('start-err')).toBe(false)
    })

    it('stateMachine.start 抛出异常时 onError 被调用且会话被清理', async () => {
      const onError = vi.fn().mockResolvedValue(undefined)

      class ThrowingStateMachineSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [
            {
              id: 'start',
              onEnter: async () => {
                throw new Error('enter error')
              },
            },
          ]
        }
        override async onError(_ctx: SessionContext, err: Error): Promise<void> {
          onError(err)
        }
      }

      const manager = makeManager()
      await expect(manager.start(new ThrowingStateMachineSession(), 'sm-err')).rejects.toThrow(
        'enter error',
      )

      expect(manager.isActive('sm-err')).toBe(false)
    })
  })

  describe('onError 钩子', () => {
    it('onInput 抛出异常时 onError 被调用且会话被清理', async () => {
      const onError = vi.fn().mockResolvedValue(undefined)

      class InputErrorSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [
            {
              id: 'start',
              onInput: async () => {
                throw new Error('input error')
              },
            },
          ]
        }
        override async onError(_ctx: SessionContext, err: Error): Promise<void> {
          onError(err)
        }
      }

      const manager = makeManager()
      await manager.start(new InputErrorSession(), 'input-err')
      await manager.processMessage('input-err', 'boom')

      expect(onError).toHaveBeenCalledWith(expect.any(Error))
      expect(manager.isActive('input-err')).toBe(false)
    })

    it('cancelAll 部分失败时不阻塞其他会话取消', async () => {
      const manager = makeManager()

      class ThrowCancelSession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [{ id: 'waiting' }]
        }
        override async onCancel(_ctx: SessionContext): Promise<void> {
          throw new Error('cancel error')
        }
      }

      await manager.start(new ThrowCancelSession(), 'fail-key')
      await manager.start(new NeverEndSession(), 'ok-key')

      await manager.cancelAll()

      expect(manager.getActiveCount()).toBe(0)
    })
  })

  describe('NOTIFY 超时模式', () => {
    it('到达 warningBefore 时通过 ctx.reply 发送 warningMessage', async () => {
      vi.useFakeTimers()
      const replyFn = vi.fn().mockResolvedValue(undefined)

      class WaitSession extends InteractiveSession<void, string> {
        override buildStates(): StateDefinition<string>[] {
          return [{ id: 'waiting' }]
        }
      }

      const manager = new SessionManager<string>({
        config: {
          timeout: {
            duration: 10,
            mode: TimeoutMode.NOTIFY,
            warningBefore: 4,
            timeoutMessage: '已超时',
            warningMessage: '还剩 {remaining} 秒',
          },
        },
        keyExtractor: (ctx: string) => ctx,
      })

      await manager.start(new WaitSession(), 'user:1', replyFn)

      // 10 - 4 = 6 秒后应触发警告
      await vi.advanceTimersByTimeAsync(6000)
      expect(replyFn).toHaveBeenCalledWith('还剩 4 秒')
      expect(manager.isActive('user:1')).toBe(true) // 警告不结束会话
    })

    it('到达 duration 时通过 ctx.reply 发送 timeoutMessage 且会话结束', async () => {
      vi.useFakeTimers()
      const replyFn = vi.fn().mockResolvedValue(undefined)

      class WaitSession extends InteractiveSession<void, string> {
        override buildStates(): StateDefinition<string>[] {
          return [{ id: 'waiting' }]
        }
      }

      const manager = new SessionManager<string>({
        config: {
          timeout: {
            duration: 5,
            mode: TimeoutMode.NOTIFY,
            warningBefore: 2,
            timeoutMessage: '会话已超时结束',
            warningMessage: '还剩 {remaining} 秒',
          },
        },
        keyExtractor: (ctx: string) => ctx,
      })

      await manager.start(new WaitSession(), 'user:1', replyFn)
      await vi.advanceTimersByTimeAsync(5500)

      expect(replyFn).toHaveBeenCalledWith('会话已超时结束')
      expect(manager.isActive('user:1')).toBe(false)
    })

    it('会话在警告触发前正常结束，警告定时器被清理不再触发', async () => {
      vi.useFakeTimers()
      const replyFn = vi.fn().mockResolvedValue(undefined)

      class FinishSession extends InteractiveSession<void, string> {
        override buildStates(): StateDefinition<string>[] {
          return [{ id: 'start', onInput: async () => ({ finished: true }) }]
        }
      }

      const manager = new SessionManager<string>({
        config: {
          timeout: {
            duration: 10,
            mode: TimeoutMode.NOTIFY,
            warningBefore: 4,
            timeoutMessage: '已超时',
            warningMessage: '还剩 {remaining} 秒',
          },
        },
        keyExtractor: (ctx: string) => ctx,
      })

      await manager.start(new FinishSession(), 'user:1', replyFn)
      await manager.processMessage('user:1', 'done')
      expect(manager.isActive('user:1')).toBe(false)

      // 推进到原本警告应触发的时间点，不应再触发（会话已清理）
      replyFn.mockClear()
      await vi.advanceTimersByTimeAsync(10000)
      expect(replyFn).not.toHaveBeenCalled()
    })

    it('warningBefore 为 0 时不调度警告定时器，仍正常超时', async () => {
      vi.useFakeTimers()
      const replyFn = vi.fn().mockResolvedValue(undefined)

      class WaitSession extends InteractiveSession<void, string> {
        override buildStates(): StateDefinition<string>[] {
          return [{ id: 'waiting' }]
        }
      }

      const manager = new SessionManager<string>({
        config: {
          timeout: {
            duration: 3,
            mode: TimeoutMode.NOTIFY,
            warningBefore: 0,
            timeoutMessage: '已超时',
            warningMessage: '还剩 {remaining} 秒',
          },
        },
        keyExtractor: (ctx: string) => ctx,
      })

      await manager.start(new WaitSession(), 'user:1', replyFn)
      await vi.advanceTimersByTimeAsync(3500)

      expect(replyFn).toHaveBeenCalledTimes(1)
      expect(replyFn).toHaveBeenCalledWith('已超时')
    })
  })

  describe('NEVER 超时模式', () => {
    it('mode 为 never 时，长时间推进定时器也不会触发 onTimeout 或结束会话', async () => {
      vi.useFakeTimers()
      const onTimeout = vi.fn().mockResolvedValue(undefined)

      class NeverSession extends InteractiveSession<void, string> {
        override buildStates(): StateDefinition<string>[] {
          return [{ id: 'waiting' }]
        }
        override async onTimeout(_ctx: SessionContext<string>): Promise<void> {
          onTimeout()
        }
      }

      const manager = new SessionManager<string>({
        config: {
          timeout: {
            duration: 5,
            mode: TimeoutMode.NEVER,
            warningBefore: 2,
            timeoutMessage: '不应发送',
            warningMessage: '不应发送',
          },
        },
        keyExtractor: (ctx: string) => ctx,
      })

      await manager.start(new NeverSession(), 'user:1')
      // 推进极长时间（远超 duration），会话应仍然活跃
      await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1000) // 一年
      expect(onTimeout).not.toHaveBeenCalled()
      expect(manager.isActive('user:1')).toBe(true)
    })

    it('mode 为 never 的会话仍可被手动 cancel', async () => {
      const manager = new SessionManager<string>({
        config: {
          timeout: {
            duration: 5,
            mode: TimeoutMode.NEVER,
            warningBefore: 0,
            timeoutMessage: '',
            warningMessage: '',
          },
        },
        keyExtractor: (ctx: string) => ctx,
      })

      class NeverSession extends InteractiveSession<void, string> {
        override buildStates(): StateDefinition<string>[] {
          return [{ id: 'waiting' }]
        }
      }

      await manager.start(new NeverSession(), 'user:1')
      await manager.cancel('user:1')
      expect(manager.isActive('user:1')).toBe(false)
    })
  })
})
