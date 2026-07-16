/**
 * 超时模式与自动转换并发压力测试 —— NOTIFY/NEVER 超时模式 + 自动转换在并发/竞争场景下的鲁棒性。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

import { InteractiveSession, SessionManager, TimeoutMode } from '../../src/session'
import type { StateDefinition } from '../../src/session'

/** 简单的一步结束会话。 */
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

const makeNotifyManager = (duration: number, warningBefore: number) =>
  new SessionManager<string>({
    config: {
      timeout: {
        duration,
        mode: TimeoutMode.NOTIFY,
        warningBefore,
        timeoutMessage: '会话超时',
        warningMessage: '还剩 {remaining} 秒',
      },
    },
    keyExtractor: (key: string) => key,
  })

const makeNormalManager = (timeoutSeconds: number) =>
  new SessionManager<string>({
    config: { timeout: timeoutSeconds },
    keyExtractor: (key: string) => key,
  })

describe('超时模式与自动转换并发压力测试', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('50 个 NOTIFY 会话并发：警告独立触发、超时后全部清理、锁释放可重启', async () => {
    vi.useFakeTimers()
    const manager = makeNotifyManager(10, 4)
    const replyCalls = new Map<string, string[]>()
    const makeReply = (key: string) => async (content: unknown) => {
      const arr = replyCalls.get(key)
      if (arr) arr.push(String(content))
    }

    const N = 50
    await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const key = `n-${i}`
        replyCalls.set(key, [])
        return manager.start(new NeverEndSession(), key, makeReply(key))
      }),
    )

    // 推进 6 秒：警告触发（duration=10, warningBefore=4 → 警告在 (10-4)=6 秒时触发）
    await vi.advanceTimersByTimeAsync(6000)

    for (let i = 0; i < N; i++) {
      const calls = replyCalls.get(`n-${i}`)!
      expect(calls).toHaveLength(1)
      expect(calls[0]).toBe('还剩 4 秒')
    }
    expect(manager.getActiveCount()).toBe(N)

    // 再推进 4.5 秒：超时触发（总时间 10.5s > 10s 超时阈值）
    await vi.advanceTimersByTimeAsync(4500)

    for (let i = 0; i < N; i++) {
      const calls = replyCalls.get(`n-${i}`)!
      expect(calls).toEqual(['还剩 4 秒', '会话超时'])
    }
    expect(manager.getActiveCount()).toBe(0)

    // 任选 3 个 key 重新启动，验证锁已释放
    for (const idx of [0, 10, 20]) {
      await manager.start(new SimpleSession(), `n-${idx}`)
      expect(manager.isActive(`n-${idx}`)).toBe(true)
    }
  })

  it('一半提前 finish、一半等超时', async () => {
    vi.useFakeTimers()
    const manager = makeNotifyManager(10, 4)
    const replyCalls = new Map<string, string[]>()
    const makeReply = (key: string) => async (content: unknown) => {
      const arr = replyCalls.get(key)
      if (arr) arr.push(String(content))
    }

    class FinishingSession extends InteractiveSession {
      override buildStates(): StateDefinition[] {
        return [
          {
            id: 'w',
            async onInput() {
              return { finished: true }
            },
          },
        ]
      }
    }

    const N = 50
    for (let i = 0; i < N; i++) {
      const key = `h-${i}`
      replyCalls.set(key, [])
      const session = i % 2 === 0 ? new FinishingSession() : new NeverEndSession()
      await manager.start(session, key, makeReply(key))
    }
    expect(manager.getActiveCount()).toBe(N)

    // 推进 3 秒，远未到警告时间（6 秒）
    await vi.advanceTimersByTimeAsync(3000)

    // 偶数 key 发送任意消息结束会话
    for (let i = 0; i < N; i += 2) {
      await manager.processMessage(`h-${i}`, 'done')
    }

    // 推进到超时（剩余 7 秒需覆盖，推进 8 秒足够覆盖超时）
    await vi.advanceTimersByTimeAsync(8000)

    // 偶数 key 的 replyFn 从未被调用
    for (let i = 0; i < N; i += 2) {
      expect(replyCalls.get(`h-${i}`)).toEqual([])
    }
    // 奇数 key 的 replyFn 收到警告 + 超时共两次
    for (let i = 1; i < N; i += 2) {
      expect(replyCalls.get(`h-${i}`)).toEqual(['还剩 4 秒', '会话超时'])
    }
    expect(manager.getActiveCount()).toBe(0)
  })

  it('N 个 NEVER 会话推进一年 + cancelAll → 全部清理可重启', async () => {
    vi.useFakeTimers()
    const manager = new SessionManager<string>({
      config: {
        timeout: {
          duration: 1,
          mode: TimeoutMode.NEVER,
          warningBefore: 0,
          timeoutMessage: '',
          warningMessage: '',
        },
      },
      keyExtractor: (key: string) => key,
    })

    const N = 20
    await Promise.all(
      Array.from({ length: N }, (_, i) => manager.start(new NeverEndSession(), `ne-${i}`)),
    )

    await vi.advanceTimersByTimeAsync(365 * 24 * 60 * 60 * 1000)
    expect(manager.getActiveCount()).toBe(N)

    await manager.cancelAll()
    expect(manager.getActiveCount()).toBe(0)

    // 任选 key 重启成功
    await manager.start(new SimpleSession(), 'ne-5')
    expect(manager.isActive('ne-5')).toBe(true)
  })

  it('超时在 onInput 挂起期间触发，双重清理幂等且可重启', async () => {
    vi.useFakeTimers()
    let resolveInput!: () => void
    const gate = new Promise<void>((r) => {
      resolveInput = r
    })

    class SlowSession extends InteractiveSession<void, string> {
      override buildStates(): StateDefinition<string>[] {
        return [
          {
            id: 'w',
            onInput: async () => {
              await gate
              return {}
            },
          },
        ]
      }
    }

    const manager = makeNormalManager(1)
    await manager.start(new SlowSession(), 'race')
    const pending = manager.processMessage('race', 'msg')
    await vi.advanceTimersByTimeAsync(1500)
    expect(manager.isActive('race')).toBe(false)
    resolveInput()
    await expect(pending).resolves.toBe(true)
    expect(manager.isActive('race')).toBe(false)
    await manager.start(new SlowSession(), 'race')
    expect(manager.isActive('race')).toBe(true)
  })

  it('超时 vs cancel 竞争 → 清理一次、可重启', async () => {
    vi.useFakeTimers()
    const onTimeoutSpy = vi.fn()
    const onCancelSpy = vi.fn()

    class RaceSession extends InteractiveSession {
      override buildStates(): StateDefinition[] {
        return [{ id: 'w' }]
      }
      override async onTimeout(): Promise<void> {
        onTimeoutSpy()
      }
      override async onCancel(): Promise<void> {
        onCancelSpy()
      }
    }

    const manager = makeNormalManager(1)
    await manager.start(new RaceSession(), 'k')
    expect(manager.isActive('k')).toBe(true)

    await Promise.allSettled([manager.cancel('k'), vi.advanceTimersByTimeAsync(1500)])

    expect(manager.isActive('k')).toBe(false)
    const totalCalls = onCancelSpy.mock.calls.length + onTimeoutSpy.mock.calls.length
    expect(totalCalls).toBeGreaterThanOrEqual(1)
    expect(onCancelSpy.mock.calls.length).toBeLessThanOrEqual(1)
    expect(onTimeoutSpy.mock.calls.length).toBeLessThanOrEqual(1)

    await manager.start(new SimpleSession(), 'k')
    expect(manager.isActive('k')).toBe(true)
  })

  it('含自动转换初始状态的会话 50 并发 start → 全部到达预期状态', async () => {
    const enteredKeys: string[] = []

    class AutoSession extends InteractiveSession {
      constructor(private readonly sessionKey: string) {
        super()
      }
      override buildStates(): StateDefinition[] {
        return [
          {
            id: 'init',
            transitions: [{ target: 'ready' }],
          },
          {
            id: 'ready',
            onEnter: async () => {
              enteredKeys.push(this.sessionKey)
            },
          },
        ]
      }
    }

    const manager = makeNormalManager(30)

    const N = 50
    await Promise.all(
      Array.from({ length: N }, (_, i) => {
        const key = `auto-${i}`
        return manager.start(new AutoSession(key), key)
      }),
    )

    expect(enteredKeys).toHaveLength(N)
    expect(manager.getActiveCount()).toBe(N)

    await manager.cancelAll()
  })

  it('自动转换死循环会话 → start rejects、会话清理、锁释放可立即重启', async () => {
    class LoopSession extends InteractiveSession {
      override buildStates(): StateDefinition[] {
        return [{ id: 'loop', transitions: [{ target: 'loop' }] }]
      }
    }

    const manager = makeNormalManager(10)

    await expect(manager.start(new LoopSession(), 'k')).rejects.toThrow('自动转换深度超过上限')
    expect(manager.isActive('k')).toBe(false)

    await manager.start(new SimpleSession(), 'k')
    expect(manager.isActive('k')).toBe(true)
  })
})
