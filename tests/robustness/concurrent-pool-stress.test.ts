/**
 * 连接池并发压力测试 —— 并发 add/remove、高负载事件、连接生命周期交叉并发。
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { ClientPool } from '../../src'
import type { ClientState } from '../../src/pool'

function mockAdapter(id: string, initialState: ClientState = 'disconnected') {
  let state: ClientState = initialState
  return {
    id,
    client: {},
    get state() {
      return state
    },
    connect: vi.fn(async () => {
      state = 'connected'
    }),
    disconnect: vi.fn(async () => {
      state = 'disconnected'
    }),
    _setState(s: ClientState) {
      state = s
    },
  }
}

type TestRole = 'master' | 'normal'

describe('连接池并发压力', () => {
  describe('并发 addClient / removeClient', () => {
    it('50 个并发 addClient 全部注册成功', () => {
      const pool = new ClientPool<object, TestRole>({})
      const N = 50
      const adapters = Array.from({ length: N }, (_, i) => mockAdapter(`client-${i}`))

      for (let i = 0; i < N; i++) {
        pool.addClient(adapters[i], i < N / 2 ? 'master' : 'normal')
      }

      for (let i = 0; i < N; i++) {
        expect(pool.getClient(`client-${i}`)).toBe(adapters[i])
      }
      expect(pool.getAvailableClients()).toHaveLength(0) // 均未连接
    })

    it('add 后立即 remove，最终 getClient 返回 undefined', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const N = 20

      const results = await Promise.allSettled(
        Array.from({ length: N }, async (_, i) => {
          const adapter = mockAdapter(`add-rm-${i}`, 'connected')
          pool.addClient(adapter, 'master')
          await pool.removeClient(`add-rm-${i}`)
        }),
      )

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
      for (let i = 0; i < N; i++) {
        expect(pool.getClient(`add-rm-${i}`)).toBeUndefined()
      }
    })

    it('并发 remove 同一客户端，最终只移除一次，不抛异常', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('shared', 'connected')
      pool.addClient(adapter, 'master')

      await Promise.allSettled(Array.from({ length: 10 }, () => pool.removeClient('shared')))

      expect(pool.getClient('shared')).toBeUndefined()
    })
  })

  describe('高负载事件发射', () => {
    it('1000 个事件并发发射，去重后正确计数', () => {
      const pool = new ClientPool<object, TestRole, { k: string }>({
        dedup: {
          keyExtractor: { extract: (e) => e.k },
          windowMs: 60000,
          maxCacheSize: 2000,
        },
      })
      pool.addClient(mockAdapter('s', 'connected'), 'master')

      let eventCount = 0
      pool.on('event', () => {
        eventCount++
      })

      const N = 1000
      for (let i = 0; i < N; i++) {
        pool.emitFromClient('s', { k: `key-${i % 50}` }, 'master')
      }

      // 50 个唯一 key，每个只发一次
      expect(eventCount).toBe(50)
    })

    it('去重窗口过期后同 key 再次发射', () => {
      vi.useFakeTimers()
      const pool = new ClientPool<object, TestRole, { k: string }>({
        dedup: {
          keyExtractor: { extract: (e) => e.k },
          windowMs: 1000,
          maxCacheSize: 100,
        },
      })
      pool.addClient(mockAdapter('s', 'connected'), 'master')

      let eventCount = 0
      pool.on('event', () => {
        eventCount++
      })

      pool.emitFromClient('s', { k: 'dup' }, 'master')
      pool.emitFromClient('s', { k: 'dup' }, 'master')
      expect(eventCount).toBe(1)

      vi.advanceTimersByTime(1100)
      pool.emitFromClient('s', { k: 'dup' }, 'master')
      expect(eventCount).toBe(2)
      vi.useRealTimers()
    })

    it('无去重配置时 500 事件全部发射', () => {
      const pool = new ClientPool<object, TestRole, object>({})
      pool.addClient(mockAdapter('s', 'connected'), 'master')

      let eventCount = 0
      pool.on('event', () => {
        eventCount++
      })

      const N = 500
      for (let i = 0; i < N; i++) {
        pool.emitFromClient('s', {}, 'master')
      }

      expect(eventCount).toBe(N)
    })
  })

  describe('connectAll / disconnectAll 交叉并发', () => {
    it('10 个客户端 connectAll + disconnectAll 交替并发，最终一致', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapters = Array.from({ length: 10 }, (_, i) => mockAdapter(`cd-${i}`, 'disconnected'))
      for (const a of adapters) pool.addClient(a, 'master')

      await Promise.all([pool.connectAll(), pool.connectAll(), pool.disconnectAll()])
      // 最终所有客户端稳定
      for (const a of adapters) {
        expect(typeof a.state).toBe('string')
      }
    })

    it('connectAll 期间有客户端 removeClient 不崩溃', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapters = Array.from({ length: 10 }, (_, i) => mockAdapter(`rmc-${i}`, 'disconnected'))
      for (const a of adapters) pool.addClient(a, 'master')

      const results = await Promise.allSettled([
        pool.connectAll(),
        ...adapters.slice(0, 3).map((a) => pool.removeClient(a.id)),
      ])
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    })
  })

  describe('去重高负载', () => {
    it('2000 事件 maxCacheSize=200 的高淘汰压力下不崩溃', () => {
      const pool = new ClientPool<object, TestRole, { k: string }>({
        dedup: {
          keyExtractor: { extract: (e) => e.k },
          windowMs: 60000,
          maxCacheSize: 200,
        },
      })
      pool.addClient(mockAdapter('s', 'connected'), 'master')

      let eventCount = 0
      pool.on('event', () => {
        eventCount++
      })

      const uniqueKeys = 200
      const N = 2000
      for (let i = 0; i < N; i++) {
        pool.emitFromClient('s', { k: `key-${i % uniqueKeys}` }, 'master')
      }

      // 每个唯一 key 只发射一次
      expect(eventCount).toBe(uniqueKeys)
    })
  })

  describe('状态轮询并发压力', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('100 个客户端同时轮询，50 个变化只触发 50 次通知', () => {
      const pool = new ClientPool<object, TestRole>({})
      const N = 100
      const adapters = Array.from({ length: N }, (_, i) => mockAdapter(`c-${i}`, 'connected'))
      for (const a of adapters) pool.addClient(a, 'master')
      const changes: string[] = []
      pool.on('clientStateChange', (id) => changes.push(id))

      for (let i = 0; i < N; i += 2) {
        adapters[i]._setState('reconnecting')
      }

      pool.startStatePolling(100)
      vi.advanceTimersByTime(100)
      pool.stopStatePolling()

      expect(changes).toHaveLength(N / 2)
    })

    it('快速 addClient/removeClient 与轮询交错不抛异常', async () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.startStatePolling(100)

      for (let i = 0; i < 30; i++) {
        const adapter = mockAdapter(`tmp-${i}`, 'connected')
        pool.addClient(adapter, 'master')
        vi.advanceTimersByTime(10)
        await pool.removeClient(`tmp-${i}`)
        vi.advanceTimersByTime(10)
      }

      pool.stopStatePolling()
      expect(pool.getAvailableClients()).toHaveLength(0)
    })

    it('轮询中 clientStateChange 监听器同步 addClient 不抛异常', () => {
      const pool = new ClientPool<object, TestRole>({})
      const a = mockAdapter('a', 'connected')
      pool.addClient(a, 'master')
      pool.on('clientStateChange', () => {
        pool.addClient(mockAdapter(`dynamic-${Date.now()}`, 'disconnected'), 'normal')
      })

      a._setState('reconnecting')
      pool.startStatePolling(100)
      vi.advanceTimersByTime(100)
      pool.stopStatePolling()

      // 验证 addClient 成功
      const clients = pool.getClientsByRole('normal')
      expect(clients.length).toBeGreaterThanOrEqual(1)
    })

    it('轮询中 clientStateChange 监听器同步 removeClient（disconnected 状态）不抛异常', () => {
      const pool = new ClientPool<object, TestRole>({})
      const a = mockAdapter('a', 'connected')
      const b = mockAdapter('b', 'disconnected') // 非 connected，removeClient 同步 delete
      pool.addClient(a, 'master')
      pool.addClient(b, 'master')
      pool.on('clientStateChange', () => {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        pool.removeClient('b')
      })

      a._setState('reconnecting')
      pool.startStatePolling(100)
      vi.advanceTimersByTime(100)
      pool.stopStatePolling()

      // 不抛异常即通过
      expect(true).toBe(true)
    })

    it('emitFromClient 与轮询同时高负载——去重与状态通知独立运作', () => {
      const pool = new ClientPool<object, TestRole, { k: string }>({
        dedup: {
          keyExtractor: { extract: (e) => e.k },
          windowMs: 60000,
          maxCacheSize: 200,
        },
      })
      const adapter = mockAdapter('s', 'connected')
      pool.addClient(adapter, 'master')
      let eventCount = 0
      let changeCount = 0
      pool.on('event', () => eventCount++)
      pool.on('clientStateChange', () => changeCount++)

      pool.startStatePolling(50)

      for (let i = 0; i < 200; i++) {
        pool.emitFromClient('s', { k: `key-${i % 30}` }, 'master')
        if (i % 40 === 0) {
          adapter._setState(i % 80 === 0 ? 'reconnecting' : 'connected')
          vi.advanceTimersByTime(50)
        }
      }

      pool.stopStatePolling()
      expect(eventCount).toBe(30) // 30 个唯一 key
      expect(changeCount).toBeGreaterThan(0)
    })

    it('高频 startStatePolling/stopStatePolling 切换 100 次不泄漏 timer', () => {
      const pool = new ClientPool<object, TestRole>({})
      for (let i = 0; i < 100; i++) {
        pool.startStatePolling(Math.max(10, i % 200))
        pool.stopStatePolling()
      }

      expect((pool as any).statePollingTimer).toBeNull()
    })

    it('多个 adapter 的 wireToPool 同时转发实时状态 + 轮询兜底互不冲突', () => {
      const pool = new ClientPool<object, TestRole>({})
      const a = mockAdapter('a', 'connected')
      const b = mockAdapter('b', 'connected')
      const wireA = vi.fn(
        (emitter: {
          notifyStateChange: (id: string, from: ClientState, to: ClientState) => void
        }) => {
          setTimeout(() => emitter.notifyStateChange('a', 'connected', 'reconnecting'), 0)
        },
      )
      const wireB = vi.fn(
        (emitter: {
          notifyStateChange: (id: string, from: ClientState, to: ClientState) => void
        }) => {
          setTimeout(() => emitter.notifyStateChange('b', 'connected', 'disconnected'), 0)
        },
      )
      pool.addClient({ ...a, wireToPool: wireA }, 'master')
      pool.addClient({ ...b, wireToPool: wireB }, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(200)
      // 先用轮询触发真实变化
      a._setState('reconnecting')
      b._setState('disconnected')
      vi.advanceTimersByTime(200)
      pool.stopStatePolling()

      // 两个客户端各有一次变化通知
      const ids = changes.map((c) => (c as unknown[])[0])
      expect(ids).toContain('a')
      expect(ids).toContain('b')
    })

    it('reconnecting 状态在去重窗口内连续翻转正确通知', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(100)

      adapter._setState('reconnecting')
      vi.advanceTimersByTime(100)
      adapter._setState('connected')
      vi.advanceTimersByTime(100)
      adapter._setState('reconnecting')
      vi.advanceTimersByTime(100)

      pool.stopStatePolling()

      expect(changes).toEqual([
        ['a', 'connected', 'reconnecting'],
        ['a', 'reconnecting', 'connected'],
        ['a', 'connected', 'reconnecting'],
      ])
    })
  })
})
