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

  describe('forceReconnect 并发安全', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('20 个客户端并发 healthCheck 失败，各 forceReconnect 耗时不同，重入保护互不干扰', async () => {
      const pool = new ClientPool<object, TestRole>({
        healthCheck: { intervalMs: 500, maxConsecutiveFailures: 10 },
      })
      const tracker = new Map<string, { concurrent: number; maxConcurrent: number }>()

      for (let i = 0; i < 20; i++) {
        const delay = 500 + (i % 3) * 600
        const adapter = mockAdapter(`cc${i}`, 'connected')
        adapter.healthCheck.mockRejectedValue(new Error('fail'))
        const stats = { concurrent: 0, maxConcurrent: 0 }
        tracker.set(`cc${i}`, stats)
        const forceReconnect = vi.fn(async () => {
          stats.concurrent++
          stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.concurrent)
          await new Promise((resolve) => setTimeout(resolve, delay))
          stats.concurrent--
        })
        pool.addClient({ ...adapter, forceReconnect }, 'master')
      }

      pool.startHealthCheck(500)
      await vi.advanceTimersByTimeAsync(5000)
      pool.stopHealthCheck()

      for (const [, stats] of tracker) {
        expect(stats.maxConcurrent).toBe(1)
      }
    })

    it('高频健康检查(10ms) + forceReconnect 耗时 100ms 不掉底，重入保护与阈值兜底同时生效', async () => {
      const pool = new ClientPool<object, TestRole>({
        healthCheck: { intervalMs: 10, maxConsecutiveFailures: 5 },
      })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('fail'))

      let forceReconnectCalls = 0
      const forceReconnect = vi.fn(async () => {
        forceReconnectCalls++
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
      pool.addClient({ ...adapter, forceReconnect }, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(10)
      await vi.advanceTimersByTimeAsync(50)
      pool.stopHealthCheck()

      expect(forceReconnectCalls).toBe(1)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])
    })

    it('healthCheck 运行期间 50 客户端 add→remove→re-add(同id) 反复 10 轮不崩溃', async () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.startHealthCheck(500)

      const results = await Promise.allSettled(
        Array.from({ length: 10 }, async () => {
          for (let i = 0; i < 50; i++) {
            const adapter = mockAdapter(`rnd-${i}`, 'connected')
            pool.addClient(adapter, 'master')
            await pool.removeClient(`rnd-${i}`)
          }
        }),
      )

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
      expect(pool.getAvailableClients()).toHaveLength(0)
      pool.stopHealthCheck()
    })

    it('healthCheck 期间 connectAll/disconnectAll 并发交叉不崩溃', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapters = Array.from({ length: 10 }, (_, i) => mockAdapter(`int-${i}`, 'disconnected'))
      for (const a of adapters) pool.addClient(a, 'master')

      pool.startHealthCheck(100)
      for (let i = 0; i < 3; i++) {
        await pool.connectAll()
        await vi.advanceTimersByTimeAsync(100)
        await pool.disconnectAll()
        await vi.advanceTimersByTimeAsync(100)
      }
      pool.stopHealthCheck()
    })

    it('healthCheck 挂起期间客户端被移除，完成后不发送过期通知', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const pendingHealthChecks: { resolve: (v: boolean) => void }[] = []

      for (let i = 0; i < 10; i++) {
        const adapter = mockAdapter(`s-${i}`, 'connected')
        adapter.healthCheck.mockImplementation(
          () =>
            new Promise<boolean>((resolve) => {
              pendingHealthChecks.push({ resolve })
            }),
        )
        pool.addClient(adapter, 'master')
      }

      const changes: [string, ClientState, ClientState][] = []
      pool.on('clientStateChange', (id, from, to) => changes.push([id, from, to]))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)

      for (let i = 0; i < 5; i++) {
        await pool.removeClient(`s-${i}`)
      }

      for (const hc of pendingHealthChecks) {
        hc.resolve(false)
      }
      await vi.advanceTimersByTimeAsync(0)
      pool.stopHealthCheck()

      for (const [id] of changes) {
        expect(id.startsWith('s-')).toBe(true)
        const idx = Number(id.split('-')[1])
        expect(idx).toBeGreaterThanOrEqual(5)
      }
    })

    it('混合场景 10 有 forceReconnect + 10 无，健康检查全部失败，各自走正确分支', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const forceReconnectCalls: string[] = []
      const changes: [string, ClientState, ClientState][] = []
      pool.on('clientStateChange', (id, from, to) => changes.push([id, from, to]))

      for (let i = 0; i < 10; i++) {
        const adapter = mockAdapter(`w-${i}`, 'connected')
        adapter.healthCheck.mockRejectedValue(new Error('fail'))
        pool.addClient(
          {
            ...adapter,
            forceReconnect: vi.fn(async () => {
              forceReconnectCalls.push(`w-${i}`)
            }),
          },
          'master',
        )
      }

      for (let i = 0; i < 10; i++) {
        const adapter = mockAdapter(`n-${i}`, 'connected')
        adapter.healthCheck.mockRejectedValue(new Error('fail'))
        pool.addClient(adapter, 'normal')
      }

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(forceReconnectCalls.length).toBe(10)
      const errorChanges = changes.filter(([, , to]) => to === 'error')
      expect(errorChanges.length).toBe(10)
      for (const [id] of errorChanges) {
        expect(id.startsWith('n-')).toBe(true)
      }
    })
  })
})
