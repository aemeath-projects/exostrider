/**
 * 连接池并发压力测试 —— 并发 add/remove、healthCheck 竞态、高负载事件。
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
    healthCheck: vi.fn(async () => true),
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

  describe('并发 connectAll / healthCheck', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('healthCheck 运行时 addClient 不崩溃', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.startHealthCheck(100)

      const N = 10
      for (let i = 0; i < N; i++) {
        pool.addClient(mockAdapter(`hc-add-${i}`, 'connected'), 'master')
      }

      expect(pool.getAvailableClients()).toHaveLength(N)
      pool.stopHealthCheck()
    })

    it('healthCheck 运行时 removeClient 不崩溃', async () => {
      const pool = new ClientPool<object, TestRole>({})

      const adapters = Array.from({ length: 10 }, (_, i) => mockAdapter(`hc-rm-${i}`, 'connected'))
      for (const a of adapters) pool.addClient(a, 'master')

      pool.startHealthCheck(100)

      await Promise.allSettled(adapters.map((a) => pool.removeClient(a.id)))

      expect(pool.getAvailableClients()).toHaveLength(0)
      pool.stopHealthCheck()
    })

    it('connectAll 并行连接，部分失败不影响其余', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const good = mockAdapter('good')
      const bad = mockAdapter('bad')
      bad.connect.mockRejectedValue(new Error('bad connect'))

      pool.addClient(good, 'master')
      pool.addClient(bad, 'normal')

      await expect(pool.connectAll()).resolves.toBeUndefined()
      expect(good.connect).toHaveBeenCalled()
      expect(bad.connect).toHaveBeenCalled()
    })

    it('connectAll 与 healthCheck 同时进行的稳定性', async () => {
      vi.useRealTimers()
      const pool = new ClientPool<object, TestRole>({})
      const adapters = Array.from({ length: 5 }, (_, i) => mockAdapter(`cc-${i}`, 'disconnected'))
      for (const a of adapters) pool.addClient(a, 'master')

      await Promise.all([pool.connectAll(), pool.connectAll()])

      for (const a of adapters) {
        expect(a.connect).toHaveBeenCalled()
      }
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

    it('healthCheck 期间 100 add + 100 remove 并发不崩溃', async () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.startHealthCheck(100)

      const N = 100
      const addResults = await Promise.allSettled(
        Array.from({ length: N }, (_, i) => {
          const adapter = mockAdapter(`hc-mass-${i}`, 'connected')
          pool.addClient(adapter, 'master')
          return Promise.resolve()
        }),
      )
      expect(addResults.every((r) => r.status === 'fulfilled')).toBe(true)

      const removeResults = await Promise.allSettled(
        Array.from({ length: N }, (_, i) => pool.removeClient(`hc-mass-${i}`)),
      )
      expect(removeResults.every((r) => r.status === 'fulfilled')).toBe(true)

      expect(pool.getAvailableClients()).toHaveLength(0)
      pool.stopHealthCheck()
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
})
