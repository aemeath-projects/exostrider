import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { ClientPool } from '../../../src'
import type { ClientState, PoolEmitter } from '../../../src/pool'

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

describe('ClientPool', () => {
  describe('addClient / getClient / getClientsByRole', () => {
    it('addClient 后可通过 id 查询', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('bot-1')
      pool.addClient(adapter, 'master')
      expect(pool.getClient('bot-1')).toBe(adapter)
    })

    it('getClientsByRole 只返回对应角色', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('a'), 'master')
      pool.addClient(mockAdapter('b'), 'normal')
      pool.addClient(mockAdapter('c'), 'normal')
      expect(pool.getClientsByRole('master').map((c) => c.id)).toEqual(['a'])
      expect(pool.getClientsByRole('normal').map((c) => c.id)).toHaveLength(2)
    })

    it('getAvailableClients 只返回 connected 状态的客户端', () => {
      const pool = new ClientPool<object, TestRole>({})
      const connected = mockAdapter('a', 'connected')
      const disconnected = mockAdapter('b', 'disconnected')
      pool.addClient(connected, 'master')
      pool.addClient(disconnected, 'normal')
      const available = pool.getAvailableClients()
      expect(available.map((c) => c.id)).toEqual(['a'])
    })
  })

  describe('getClientRole', () => {
    it('返回已注册客户端的角色', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('a'), 'master')
      pool.addClient(mockAdapter('b'), 'normal')
      expect(pool.getClientRole('a')).toBe('master')
      expect(pool.getClientRole('b')).toBe('normal')
    })

    it('客户端不存在时返回 undefined', () => {
      const pool = new ClientPool<object, TestRole>({})
      expect(pool.getClientRole('nonexistent')).toBeUndefined()
    })
  })

  describe('removeClient', () => {
    it('removeClient 断开连接并移除', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      await pool.removeClient('a')
      expect(pool.getClient('a')).toBeUndefined()
      expect(adapter.disconnect).toHaveBeenCalled()
    })
  })

  describe('connectAll / disconnectAll', () => {
    it('connectAll 连接所有客户端', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const a = mockAdapter('a')
      const b = mockAdapter('b')
      pool.addClient(a, 'master')
      pool.addClient(b, 'normal')
      await pool.connectAll()
      expect(a.connect).toHaveBeenCalled()
      expect(b.connect).toHaveBeenCalled()
    })
  })

  describe('事件聚合与去重', () => {
    it('无去重配置时每个事件都发射', () => {
      const pool = new ClientPool<object, TestRole, object>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')

      const events: unknown[] = []
      pool.on('event', (e) => events.push(e))

      pool.emitFromClient('a', {}, 'master')
      pool.emitFromClient('a', {}, 'master')
      expect(events).toHaveLength(2)
    })

    it('去重配置下相同 key 的第二次不发射', () => {
      const pool = new ClientPool<object, TestRole, { k: string }>({
        dedup: {
          keyExtractor: { extract: (e) => e.k },
          windowMs: 5000,
          maxCacheSize: 100,
        },
      })
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')

      const events: unknown[] = []
      pool.on('event', (e) => events.push(e))

      pool.emitFromClient('a', { k: 'x' }, 'master')
      pool.emitFromClient('a', { k: 'x' }, 'master')
      expect(events).toHaveLength(1)
    })

    it('AggregatedEvent 包含 sourceClientId 和 sourceRole', () => {
      const pool = new ClientPool<object, TestRole, object>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')

      let received: unknown
      pool.on('event', (e) => {
        received = e
      })
      pool.emitFromClient('a', { data: 1 }, 'master')

      expect(received).toMatchObject({
        sourceClientId: 'a',
        sourceRole: 'master',
        event: { data: 1 },
      })
    })
  })

  describe('clientStateChange 事件', () => {
    it('状态变化时发射 clientStateChange', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'disconnected')
      pool.addClient(adapter, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.notifyStateChange('a', 'disconnected', 'connected')
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'disconnected', 'connected'])
    })
  })

  describe('addClient 事件', () => {
    it('addClient 发射 clientAdded 事件', () => {
      const pool = new ClientPool<object, TestRole>({})
      const added: [string, string][] = []
      pool.on('clientAdded', (id, role) => added.push([id, role]))
      pool.addClient(mockAdapter('x'), 'master')
      expect(added).toEqual([['x', 'master']])
    })

    it('适配器实现 wireToPool 时 addClient 自动调用', () => {
      const pool = new ClientPool<object, TestRole>({})
      const wireToPool = vi.fn()
      const adapter = { ...mockAdapter('w'), wireToPool }
      pool.addClient(adapter, 'master')
      expect(wireToPool).toHaveBeenCalledOnce()
      expect(wireToPool).toHaveBeenCalledWith(pool, 'master')
    })

    it('适配器未实现 wireToPool 时 addClient 正常完成不抛出', () => {
      const pool = new ClientPool<object, TestRole>({})
      expect(() => pool.addClient(mockAdapter('no-wire'), 'normal')).not.toThrow()
    })

    it('wireToPool 抛出 Error 时客户端仍注册成功且 clientAdded 正常发射', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = {
        ...mockAdapter('err-wire'),
        wireToPool: vi.fn(() => {
          throw new Error('wire failed')
        }),
      }
      const added: string[] = []
      pool.on('clientAdded', (id) => added.push(id))

      expect(() => pool.addClient(adapter, 'master')).not.toThrow()
      expect(pool.getClient('err-wire')).toBe(adapter)
      expect(added).toEqual(['err-wire'])
    })

    it('wireToPool 抛出非 Error 值时仍不中止注册', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = {
        ...mockAdapter('str-wire'),
        wireToPool: vi.fn(() => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw 'something went wrong'
        }),
      }
      expect(() => pool.addClient(adapter, 'normal')).not.toThrow()
      expect(pool.getClient('str-wire')).toBe(adapter)
    })

    it('wireToPool 抛出时有 logger 则调用 logger.error', () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      const adapter = {
        ...mockAdapter('log-wire'),
        wireToPool: vi.fn(() => {
          throw new Error('wire error')
        }),
      }
      pool.addClient(adapter, 'master')
      expect(logger.error).toHaveBeenCalledWith(
        'addClient: wireToPool 调用失败',
        'log-wire',
        'wire error',
      )
    })

    it('wireToPool 收到的 PoolEmitter 可调用 emitFromClient 和 notifyStateChange', () => {
      const pool = new ClientPool<object, TestRole, object>({})
      let capturedEmitter: PoolEmitter | undefined

      const adapter = {
        ...mockAdapter('e', 'connected'),
        wireToPool(emitter: PoolEmitter) {
          capturedEmitter = emitter
        },
      }
      pool.addClient(adapter, 'master')

      const events: unknown[] = []
      const changes: unknown[] = []
      pool.on('event', (e) => events.push(e))
      pool.on('clientStateChange', (...args) => changes.push(args))

      capturedEmitter!.emitFromClient('e', { msg: 'hi' }, 'master')
      capturedEmitter!.notifyStateChange('e', 'disconnected', 'connected')

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({ sourceClientId: 'e', event: { msg: 'hi' } })
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['e', 'disconnected', 'connected'])
    })
  })

  describe('removeClient 额外路径', () => {
    it('removeClient 客户端未连接时不调用 disconnect', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'disconnected')
      pool.addClient(adapter, 'master')
      await pool.removeClient('a')
      expect(adapter.disconnect).not.toHaveBeenCalled()
      expect(pool.getClient('a')).toBeUndefined()
    })

    it('removeClient 发射 clientRemoved 事件', async () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('a', 'connected'), 'normal')
      const removed: [string, string][] = []
      pool.on('clientRemoved', (id, role) => removed.push([id, role]))
      await pool.removeClient('a')
      expect(removed).toEqual([['a', 'normal']])
    })

    it('removeClient 找不到客户端时调用 logger.warn', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      await pool.removeClient('nonexistent')
      expect(logger.warn).toHaveBeenCalledWith('removeClient: 客户端不存在', 'nonexistent')
    })
  })

  describe('getAvailableClients 按角色过滤', () => {
    it('传入 role 时只返回该角色的已连接客户端', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('m1', 'connected'), 'master')
      pool.addClient(mockAdapter('n1', 'connected'), 'normal')
      pool.addClient(mockAdapter('n2', 'disconnected'), 'normal')
      expect(pool.getAvailableClients('master').map((c) => c.id)).toEqual(['m1'])
      expect(pool.getAvailableClients('normal').map((c) => c.id)).toEqual(['n1'])
    })
  })

  describe('disconnectAll', () => {
    it('只断开 connected 状态的客户端，跳过未连接的', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const connected = mockAdapter('a', 'connected')
      const disconnected = mockAdapter('b', 'disconnected')
      pool.addClient(connected, 'master')
      pool.addClient(disconnected, 'normal')
      await pool.disconnectAll()
      expect(connected.disconnect).toHaveBeenCalled()
      expect(disconnected.disconnect).not.toHaveBeenCalled()
    })
  })

  describe('connectAll 错误处理', () => {
    it('connect() 抛出 Error 实例时发射 error 事件', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a')
      adapter.connect.mockRejectedValue(new Error('conn failed'))
      pool.addClient(adapter, 'master')

      const errors: { err: Error; id: string | undefined }[] = []
      pool.on('error', (err, id) => errors.push({ err, id }))
      await pool.connectAll()

      expect(errors).toHaveLength(1)
      expect(errors[0].err.message).toBe('conn failed')
      expect(errors[0].id).toBe('a')
    })

    it('connect() 抛出非 Error 值时包装为 Error 再发射', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a')
      adapter.connect.mockRejectedValue('string error')
      pool.addClient(adapter, 'master')

      const errors: Error[] = []
      pool.on('error', (err) => errors.push(err))
      await pool.connectAll()

      expect(errors[0]).toBeInstanceOf(Error)
      expect(errors[0].message).toBe('string error')
    })

    it('有 logger 时记录连接错误', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      const adapter = mockAdapter('a')
      adapter.connect.mockRejectedValue(new Error('fail'))
      pool.addClient(adapter, 'master')
      pool.on('error', () => {}) // 防止 error 事件无监听器时抛出

      await pool.connectAll()
      expect(logger.error).toHaveBeenCalledWith('connectAll: 客户端连接失败', 'a', 'fail')
    })
  })

  describe('startHealthCheck / stopHealthCheck', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('重复调用 startHealthCheck 不创建重复定时器', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')

      pool.startHealthCheck(1000)
      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)

      expect(adapter.healthCheck).toHaveBeenCalledTimes(1)
      pool.stopHealthCheck()
    })

    it('stopHealthCheck 无定时器时无副作用', () => {
      const pool = new ClientPool<object, TestRole>({})
      expect(() => pool.stopHealthCheck()).not.toThrow()
    })

    it('stopHealthCheck 后不再触发健康检查', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')

      pool.startHealthCheck(1000)
      pool.stopHealthCheck()
      await vi.advanceTimersByTimeAsync(3000)

      expect(adapter.healthCheck).not.toHaveBeenCalled()
    })
  })

  describe('_runHealthCheck', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('healthCheck 返回 true 且 prevState 未变时不发射 clientStateChange', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockResolvedValue(true)
      pool.addClient(adapter, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(changes).toHaveLength(0)
    })

    it('healthCheck 返回 false 时发射 clientStateChange(connected → disconnected)', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockResolvedValue(false)
      pool.addClient(adapter, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'disconnected'])
    })

    it('healthCheck 抛出时状态变为 error 并发射 clientStateChange', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      pool.addClient(adapter, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])
    })

    it('healthCheck 连续抛出且 prevState 已为 error 时不重复发射', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('error'))
      pool.addClient(adapter, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000) // connected → error
      await vi.advanceTimersByTimeAsync(1000) // 已是 error，不重复发射
      pool.stopHealthCheck()

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])
    })

    it('healthCheck 抛出时有 logger 则调用 logger.error', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('error'))
      pool.addClient(adapter, 'master')

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(logger.error).toHaveBeenCalledWith('healthCheck: 客户端异常', 'a')
    })

    it('healthCheck 抛出且适配器实现 forceReconnect 时，调用 forceReconnect 而非直接标记 error', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(forceReconnect).toHaveBeenCalledTimes(1)
      expect(changes).toHaveLength(0)
    })

    it('forceReconnect 失败时仍不直接标记 error，只记录日志等待 transport 自身重连', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockRejectedValue(new Error('reconnect failed'))
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(forceReconnect).toHaveBeenCalledTimes(1)
      expect(changes).toHaveLength(0)
      expect(logger.error).toHaveBeenCalledWith(
        'healthCheck: 强制重连失败，等待 transport 自身重连策略',
        'a',
        'reconnect failed',
      )
    })

    it('forceReconnect 耗时超过健康检查间隔时，不会被下一次 tick 并发重复调用', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      let concurrent = 0
      let maxConcurrent = 0
      const forceReconnect = vi.fn(async () => {
        concurrent++
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await new Promise((resolve) => setTimeout(resolve, 2500))
        concurrent--
      })
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      pool.startHealthCheck(1000)
      // 4 次 tick（4000ms）远超单次 forceReconnect 耗时（2500ms），
      // 如果没有重入保护，第 2/3 次 tick 会在第 1 次还没结束时再次调用
      await vi.advanceTimersByTimeAsync(4000)
      pool.stopHealthCheck()

      expect(maxConcurrent).toBe(1)
    })

    it('forceReconnect 从不抛出但连接持续假死时，连续失败达到阈值后仍会标记 error 并通知一次', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      // forceReconnect 本身从不抛异常，但连接实际上一直没有真正恢复
      // （模拟"transport 自身事件链路从未触发 notifyStateChange"的僵尸连接场景）
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      // 连续 5 次健康检查失败（阈值），第 5 次应该标记 error 并通知
      await vi.advanceTimersByTimeAsync(5000)
      pool.stopHealthCheck()

      expect(forceReconnect).toHaveBeenCalledTimes(5)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])
    })

    it('达到阈值标记 error 后，healthCheck 恢复成功会重新清零并允许再次走向 error', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(5000) // 达到阈值，标记一次 error
      expect(changes).toHaveLength(1)

      // 健康检查恢复成功：清零连续失败计数，并因为 prevState 已变为 error 而重新通知一次 connected
      adapter.healthCheck.mockResolvedValue(true)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(changes).toHaveLength(2)
      expect(changes[1]).toEqual(['a', 'error', 'connected'])
    })

    it('maxConsecutiveFailures 可通过 healthCheck 配置项自定义阈值', async () => {
      const pool = new ClientPool<object, TestRole>({
        healthCheck: { intervalMs: 1000, maxConsecutiveFailures: 2 },
      })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      // 自定义阈值为 2：第 2 次 tick 就应该标记 error，而不是默认的第 5 次
      await vi.advanceTimersByTimeAsync(2000)
      pool.stopHealthCheck()

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])
    })

    it('forceReconnect 等待期间该客户端被 removeClient 移除时，不会对已移除的 id 发出过期通知', async () => {
      const pool = new ClientPool<object, TestRole>({
        healthCheck: { intervalMs: 1000, maxConsecutiveFailures: 1 },
      })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      let resolveForceReconnect: (() => void) | undefined
      const forceReconnect = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveForceReconnect = resolve
          }),
      )
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000) // 触发第 1 次健康检查，forceReconnect 挂起中

      // 在 forceReconnect 挂起期间移除该客户端（模拟账号被禁用/删除）
      await pool.removeClient('a')

      // forceReconnect 终于完成——此时 clients map 里已经没有这个 id 了。
      // maxConsecutiveFailures=1 意味着"是否通知"这条分支一定会执行到，
      // 若缺少存活性检查，这里会对已移除的 id 发出一次 error 通知。
      resolveForceReconnect?.()
      await vi.advanceTimersByTimeAsync(0)
      pool.stopHealthCheck()

      expect(changes).toHaveLength(0)
      expect(pool.getClient('a')).toBeUndefined()
    })

    it('healthCheck() 本身在 removeClient 移除该客户端之后才 reject 时，不会对已移除的适配器调用 forceReconnect', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      let rejectHealthCheck: ((err: Error) => void) | undefined
      adapter.healthCheck.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectHealthCheck = reject
          }),
      )
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000) // 触发第 1 次健康检查，healthCheck() 挂起中

      // 在 healthCheck() 挂起期间移除该客户端
      await pool.removeClient('a')

      // healthCheck() 此刻才 reject——此时 clients map 里已经没有这个 id 了，
      // 不应该再对这个已经被移除的适配器调用 forceReconnect()
      rejectHealthCheck?.(new Error('network error'))
      await vi.advanceTimersByTimeAsync(0)
      pool.stopHealthCheck()

      expect(forceReconnect).not.toHaveBeenCalled()
    })

    it('forceReconnect 抛出非 Error 值时日志仍正确格式化', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockRejectedValue('raw string rejection')
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(logger.error).toHaveBeenCalledWith(
        'healthCheck: 强制重连失败，等待 transport 自身重连策略',
        'a',
        'raw string rejection',
      )
    })

    it('同 id 的 removeClient + addClient 后，旧 forceReconnect 完成时不污染新 entry', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter1 = mockAdapter('a', 'connected')
      adapter1.healthCheck.mockRejectedValue(new Error('network error'))
      let resolveOldForceReconnect: (() => void) | undefined
      const forceReconnect1 = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveOldForceReconnect = resolve
          }),
      )
      const adapterWithForce1 = { ...adapter1, forceReconnect: forceReconnect1 }
      pool.addClient(adapterWithForce1, 'master')

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)

      await pool.removeClient('a')
      const adapter2 = mockAdapter('a', 'connected')
      const forceReconnect2 = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce2 = { ...adapter2, forceReconnect: forceReconnect2 }
      pool.addClient(adapterWithForce2, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      resolveOldForceReconnect?.()
      await vi.advanceTimersByTimeAsync(0)

      expect(forceReconnect2).not.toHaveBeenCalled()
      expect(changes).toHaveLength(0)
      pool.stopHealthCheck()
    })

    it('healthCheck 成功但同 id 已被新 addClient 替换时，旧结果不写回新 entry', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter1 = mockAdapter('a', 'connected')
      let resolveOldHealthCheck: ((alive: boolean) => void) | undefined
      adapter1.healthCheck.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveOldHealthCheck = resolve
          }),
      )
      pool.addClient(adapter1, 'master')

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)

      await pool.removeClient('a')
      const adapter2 = mockAdapter('a', 'disconnected')
      pool.addClient(adapter2, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      resolveOldHealthCheck?.(true)
      await vi.advanceTimersByTimeAsync(0)

      expect(changes).toHaveLength(0)
      pool.stopHealthCheck()
    })

    it('多个客户端部分实现 forceReconnect、部分未实现，混合池中各自走正确分支', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapterWith = mockAdapter('with', 'connected')
      adapterWith.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      pool.addClient({ ...adapterWith, forceReconnect }, 'master')

      const adapterWithout = mockAdapter('without', 'connected')
      adapterWithout.healthCheck.mockRejectedValue(new Error('network error'))
      pool.addClient(adapterWithout, 'normal')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(forceReconnect).toHaveBeenCalledTimes(1)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['without', 'connected', 'error'])
    })

    it('forceReconnect 连续抛出后 healthCheck 恢复成功一次即清零计数器，后续失败重新计数', async () => {
      const pool = new ClientPool<object, TestRole>({
        healthCheck: { intervalMs: 1000, maxConsecutiveFailures: 3 },
      })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockRejectedValue(new Error('reconnect failed'))
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(2000)
      expect(changes).toHaveLength(0)

      adapter.healthCheck.mockResolvedValue(true)
      await vi.advanceTimersByTimeAsync(1000)
      expect(changes).toHaveLength(0)

      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      await vi.advanceTimersByTimeAsync(3000)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])

      pool.stopHealthCheck()
    })

    it('maxConsecutiveFailures=1 时第一次失败即标记 error', async () => {
      const pool = new ClientPool<object, TestRole>({
        healthCheck: { intervalMs: 1000, maxConsecutiveFailures: 1 },
      })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(forceReconnect).toHaveBeenCalledTimes(1)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])
    })

    it('maxConsecutiveFailures=0 时第一次失败即标记 error', async () => {
      const pool = new ClientPool<object, TestRole>({
        healthCheck: { intervalMs: 1000, maxConsecutiveFailures: 0 },
      })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('network error'))
      const forceReconnect = vi.fn().mockResolvedValue(undefined)
      const adapterWithForce = { ...adapter, forceReconnect }
      pool.addClient(adapterWithForce, 'master')

      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(forceReconnect).toHaveBeenCalledTimes(1)
      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'error'])
    })
  })

  describe('disconnectAll 非 Error 拒绝', () => {
    it('disconnect 抛出 Error 实例时直接使用原 Error 记录日志', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      const adapter = mockAdapter('a', 'connected')
      adapter.disconnect.mockRejectedValue(new Error('network error'))
      pool.addClient(adapter, 'master')

      await pool.disconnectAll()

      expect(logger.error).toHaveBeenCalledWith('disconnectAll: 客户端断连失败', 'network error')
    })

    it('disconnect 抛出非 Error 值时被转换为 Error 并记录日志', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool<object, TestRole>({ logger })
      const adapter = mockAdapter('a', 'connected')
      adapter.disconnect.mockRejectedValue('string rejection')
      pool.addClient(adapter, 'master')

      await pool.disconnectAll()

      expect(logger.error).toHaveBeenCalledWith('disconnectAll: 客户端断连失败', 'string rejection')
    })
  })
})
