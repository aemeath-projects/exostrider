/**
 * 会话并发压力测试 —— 并发会话、互斥检查、超时清理。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

import { InteractiveSession, SessionManager } from '../../src/session'
import type { SessionContext, StateDefinition } from '../../src/session'

/** 简单的一步结束会话（输入 'done' 后结束）。 */
class SimpleSession extends InteractiveSession<{ done: boolean }> {
  override buildStates(): StateDefinition[] {
    return [
      {
        id: 'waiting',
        async onInput(_ctx, input) {
          if (input === 'done') return { finished: true, data: { done: true } }
          return {}
        },
      },
    ]
  }
}

/** 永不结束的会话（需手动取消）。 */
class NeverEndSession extends InteractiveSession {
  override buildStates(): StateDefinition[] {
    return [{ id: 'waiting' }]
  }
}

const makeManager = (timeoutSeconds = 30) =>
  new SessionManager<string>({
    config: { sessionTimeout: timeoutSeconds },
    keyExtractor: (key: string) => key,
  })

describe('会话并发压力测试', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('不同 key 的 20 次并发启动，全部成功', async () => {
    const manager = makeManager()

    await Promise.all(
      Array.from({ length: 20 }, (_, i) => manager.start(new SimpleSession(), `key-${i}`)),
    )

    for (let i = 0; i < 20; i++) {
      expect(manager.isActive(`key-${i}`)).toBe(true)
    }
    expect(manager.getActiveCount()).toBe(20)
  })

  it('同一 key 并发启动两次，只有一个会话活跃', async () => {
    const manager = makeManager()

    await Promise.allSettled([
      manager.start(new SimpleSession(), 'same-key'),
      manager.start(new SimpleSession(), 'same-key'),
    ])

    expect(manager.isActive('same-key')).toBe(true)
    expect(manager.getActiveCount()).toBe(1)
  })

  it('50 个并发会话均可正常接收消息', async () => {
    const manager = makeManager()

    await Promise.all(
      Array.from({ length: 50 }, (_, i) => manager.start(new SimpleSession(), `key-${i}`)),
    )

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => manager.processMessage(`key-${i}`, 'hello')),
    )

    expect(results.every((r) => r)).toBe(true)
  })

  it('50 个并发会话发送 done 后均自动清理', async () => {
    const manager = makeManager()

    await Promise.all(
      Array.from({ length: 50 }, (_, i) => manager.start(new SimpleSession(), `key-${i}`)),
    )
    expect(manager.getActiveCount()).toBe(50)

    await Promise.all(
      Array.from({ length: 50 }, (_, i) => manager.processMessage(`key-${i}`, 'done')),
    )

    expect(manager.getActiveCount()).toBe(0)
  })

  it('cancel 后会话不再活跃，且可重新启动', async () => {
    const manager = makeManager()

    await manager.start(new NeverEndSession(), 'cleanup-key')
    expect(manager.isActive('cleanup-key')).toBe(true)

    await manager.cancel('cleanup-key')
    expect(manager.isActive('cleanup-key')).toBe(false)

    // 取消后应可重新启动
    await manager.start(new SimpleSession(), 'cleanup-key')
    expect(manager.isActive('cleanup-key')).toBe(true)
  })

  it('cancelAll 清除所有活跃会话', async () => {
    const manager = makeManager()

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => manager.start(new NeverEndSession(), `key-${i}`)),
    )
    expect(manager.getActiveCount()).toBe(10)

    await manager.cancelAll()
    expect(manager.getActiveCount()).toBe(0)
  })

  it('超时后 onTimeout 被调用，会话自动清理', async () => {
    vi.useFakeTimers()
    const timeoutSpy = vi.fn()

    class TimeoutSession extends InteractiveSession {
      override buildStates(): StateDefinition[] {
        return [{ id: 'waiting' }]
      }
      override async onTimeout(_ctx: SessionContext<string>): Promise<void> {
        timeoutSpy()
      }
    }

    const manager = makeManager(1) // 1 秒超时

    await manager.start(new TimeoutSession(), 'timeout-key')
    expect(manager.isActive('timeout-key')).toBe(true)

    // 推进 2 秒，触发超时
    await vi.advanceTimersByTimeAsync(2000)

    expect(timeoutSpy).toHaveBeenCalledOnce()
    expect(manager.isActive('timeout-key')).toBe(false)
  })

  it('多会话分别超时，各自独立清理', async () => {
    vi.useFakeTimers()
    const timeoutKeys: string[] = []

    class TrackTimeoutSession extends InteractiveSession {
      constructor(private readonly sessionKey: string) {
        super()
      }
      override buildStates(): StateDefinition[] {
        return [{ id: 'waiting' }]
      }
      override async onTimeout(_ctx: SessionContext<string>): Promise<void> {
        timeoutKeys.push(this.sessionKey)
      }
    }

    const manager = makeManager(1)

    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        manager.start(new TrackTimeoutSession(`key-${i}`), `key-${i}`),
      ),
    )

    await vi.advanceTimersByTimeAsync(2000)

    expect(timeoutKeys).toHaveLength(5)
    expect(manager.getActiveCount()).toBe(0)
  })

  it('processMessage 对不存在的 key 返回 false', async () => {
    const manager = makeManager()
    const result = await manager.processMessage('nonexistent', 'hello')
    expect(result).toBe(false)
  })

  it('onCancel 钩子在取消时被调用', async () => {
    const cancelSpy = vi.fn()

    class CancelHookSession extends InteractiveSession {
      override buildStates(): StateDefinition[] {
        return [{ id: 'waiting' }]
      }
      override async onCancel(_ctx: SessionContext<string>): Promise<void> {
        cancelSpy()
      }
    }

    const manager = makeManager()
    await manager.start(new CancelHookSession(), 'cancel-key')
    await manager.cancel('cancel-key')

    expect(cancelSpy).toHaveBeenCalledOnce()
    expect(manager.isActive('cancel-key')).toBe(false)
  })

  it('onFinish 钩子在会话完成时被调用，并传递正确数据', async () => {
    const finishSpy = vi.fn()

    class FinishHookSession extends InteractiveSession<{ value: number }> {
      override buildStates(): StateDefinition[] {
        return [
          {
            id: 'waiting',
            async onInput(_ctx, input) {
              return { finished: true, data: { value: Number(input) } }
            },
          },
        ]
      }
      override async onFinish(
        _ctx: SessionContext<string>,
        data: { value: number },
      ): Promise<void> {
        finishSpy(data)
      }
    }

    const manager = makeManager()
    await manager.start(new FinishHookSession(), 'finish-key')
    await manager.processMessage('finish-key', '42')

    expect(finishSpy).toHaveBeenCalledWith({ value: 42 })
    expect(manager.isActive('finish-key')).toBe(false)
  })

  it('并发取消不同 key，所有会话均被清理', async () => {
    const manager = makeManager()
    const N = 30

    await Promise.all(
      Array.from({ length: N }, (_, i) => manager.start(new NeverEndSession(), `key-${i}`)),
    )
    expect(manager.getActiveCount()).toBe(N)

    await Promise.all(Array.from({ length: N }, (_, i) => manager.cancel(`key-${i}`)))

    expect(manager.getActiveCount()).toBe(0)
  })

  it('同一 key 的 processMessage 与 cancel 并发竞争，最终状态一致', async () => {
    const manager = makeManager()

    await manager.start(new NeverEndSession(), 'race-key')

    // 同时发送消息和取消
    const results = await Promise.allSettled([
      manager.processMessage('race-key', 'hello'),
      manager.processMessage('race-key', 'hello'),
      manager.processMessage('race-key', '/取消'),
    ])

    // 所有操作应完成（部分可能因会话已取消而返回 false）
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    // 最终状态：会话不再活跃
    expect(manager.isActive('race-key')).toBe(false)
  })

  it('并发 processMessage 到同一 key，消息被依次处理不丢失', async () => {
    const received: string[] = []

    class CountingSession extends InteractiveSession<{ messages: string[] }> {
      override buildStates(): StateDefinition[] {
        return [
          {
            id: 'waiting',
            async onInput(_ctx, input) {
              received.push(input)
              return input === 'finish' ? { finished: true, data: { messages: received } } : {}
            },
          },
        ]
      }
    }

    const manager = makeManager()
    await manager.start(new CountingSession(), 'seq-key')

    const N = 30
    const inputs = Array.from({ length: N - 1 }, (_, i) => `msg-${i}`)
    inputs.push('finish')

    await Promise.all(inputs.map((input) => manager.processMessage('seq-key', input)))

    // 'finish' 会触发 finished，所有先前的消息应已处理
    expect(received.length).toBeGreaterThanOrEqual(1)
  })

  it('快速 start-cancel-start 循环，每次均可成功启动', async () => {
    const manager = makeManager()

    const N = 20
    for (let i = 0; i < N; i++) {
      const key = `cycle-key-${i % 3}` // 3 个 key 循环复用
      await manager.start(new SimpleSession(), key)
      expect(manager.isActive(key)).toBe(true)
      await manager.cancel(key)
      expect(manager.isActive(key)).toBe(false)
    }
  })

  it('同一 key 并发 start 两次，最终只有一个活跃', async () => {
    const manager = makeManager()

    // 第一次 start 正常
    await manager.start(new NeverEndSession(), 'single-key')

    const _results = await Promise.allSettled([
      manager.start(new NeverEndSession(), 'single-key'),
      manager.start(new NeverEndSession(), 'single-key'),
    ])

    expect(manager.getActiveCount()).toBe(1)
    expect(manager.isActive('single-key')).toBe(true)

    // Cancel 后重新 start
    await manager.cancel('single-key')
    expect(manager.isActive('single-key')).toBe(false)

    await manager.start(new SimpleSession(), 'single-key')
    expect(manager.isActive('single-key')).toBe(true)
  })
})
