import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'

import { ClientPool } from '../../../src'
import type { ClientState, PoolEmitter, RoleDefinition } from '../../../src/pool'

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

const ROLES: RoleDefinition<TestRole>[] = [
  {
    name: 'master',
    priority: 0,
    capabilities: { canSend: true, canReceive: true, canRoute: true },
  },
  {
    name: 'normal',
    priority: 10,
    capabilities: { canSend: true, canReceive: true, canRoute: true },
  },
]

describe('ClientPool', () => {
  describe('addClient / getClient / getClientsByRole', () => {
    it('addClient 后可通过 id 查询', () => {
      const pool = new ClientPool({ roles: ROLES })
      const adapter = mockAdapter('bot-1')
      pool.addClient(adapter, 'master')
      expect(pool.getClient('bot-1')).toBe(adapter)
    })

    it('getClientsByRole 只返回对应角色', () => {
      const pool = new ClientPool({ roles: ROLES })
      pool.addClient(mockAdapter('a'), 'master')
      pool.addClient(mockAdapter('b'), 'normal')
      pool.addClient(mockAdapter('c'), 'normal')
      expect(pool.getClientsByRole('master').map((c) => c.id)).toEqual(['a'])
      expect(pool.getClientsByRole('normal').map((c) => c.id)).toHaveLength(2)
    })

    it('getAvailableClients 只返回 connected 状态的客户端', () => {
      const pool = new ClientPool({ roles: ROLES })
      const connected = mockAdapter('a', 'connected')
      const disconnected = mockAdapter('b', 'disconnected')
      pool.addClient(connected, 'master')
      pool.addClient(disconnected, 'normal')
      const available = pool.getAvailableClients()
      expect(available.map((c) => c.id)).toEqual(['a'])
    })
  })

  describe('removeClient', () => {
    it('removeClient 断开连接并移除', async () => {
      const pool = new ClientPool({ roles: ROLES })
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      await pool.removeClient('a')
      expect(pool.getClient('a')).toBeUndefined()
      expect(adapter.disconnect).toHaveBeenCalled()
    })
  })

  describe('connectAll / disconnectAll', () => {
    it('connectAll 连接所有客户端', async () => {
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool<object, TestRole, object>({ roles: ROLES })
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
        roles: ROLES,
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
      const pool = new ClientPool<object, TestRole, object>({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
      const added: [string, string][] = []
      pool.on('clientAdded', (id, role) => added.push([id, role]))
      pool.addClient(mockAdapter('x'), 'master')
      expect(added).toEqual([['x', 'master']])
    })

    it('适配器实现 wireToPool 时 addClient 自动调用', () => {
      const pool = new ClientPool({ roles: ROLES })
      const wireToPool = vi.fn()
      const adapter = { ...mockAdapter('w'), wireToPool }
      pool.addClient(adapter, 'master')
      expect(wireToPool).toHaveBeenCalledOnce()
      expect(wireToPool).toHaveBeenCalledWith(pool, 'master')
    })

    it('适配器未实现 wireToPool 时 addClient 正常完成不抛出', () => {
      const pool = new ClientPool({ roles: ROLES })
      expect(() => pool.addClient(mockAdapter('no-wire'), 'normal')).not.toThrow()
    })

    it('wireToPool 抛出 Error 时客户端仍注册成功且 clientAdded 正常发射', () => {
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES, logger })
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
      const pool = new ClientPool<object, TestRole, object>({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
      const adapter = mockAdapter('a', 'disconnected')
      pool.addClient(adapter, 'master')
      await pool.removeClient('a')
      expect(adapter.disconnect).not.toHaveBeenCalled()
      expect(pool.getClient('a')).toBeUndefined()
    })

    it('removeClient 发射 clientRemoved 事件', async () => {
      const pool = new ClientPool({ roles: ROLES })
      pool.addClient(mockAdapter('a', 'connected'), 'normal')
      const removed: [string, string][] = []
      pool.on('clientRemoved', (id, role) => removed.push([id, role]))
      await pool.removeClient('a')
      expect(removed).toEqual([['a', 'normal']])
    })

    it('removeClient 找不到客户端时调用 logger.warn', async () => {
      const logger = { warn: vi.fn(), error: vi.fn() }
      const pool = new ClientPool({ roles: ROLES, logger })
      await pool.removeClient('nonexistent')
      expect(logger.warn).toHaveBeenCalledWith('removeClient: 客户端不存在', 'nonexistent')
    })
  })

  describe('getAvailableClients 按角色过滤', () => {
    it('传入 role 时只返回该角色的已连接客户端', () => {
      const pool = new ClientPool({ roles: ROLES })
      pool.addClient(mockAdapter('m1', 'connected'), 'master')
      pool.addClient(mockAdapter('n1', 'connected'), 'normal')
      pool.addClient(mockAdapter('n2', 'disconnected'), 'normal')
      expect(pool.getAvailableClients('master').map((c) => c.id)).toEqual(['m1'])
      expect(pool.getAvailableClients('normal').map((c) => c.id)).toEqual(['n1'])
    })
  })

  describe('disconnectAll', () => {
    it('只断开 connected 状态的客户端，跳过未连接的', async () => {
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES, logger })
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
      const pool = new ClientPool({ roles: ROLES })
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')

      pool.startHealthCheck(1000)
      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)

      expect(adapter.healthCheck).toHaveBeenCalledTimes(1)
      pool.stopHealthCheck()
    })

    it('stopHealthCheck 无定时器时无副作用', () => {
      const pool = new ClientPool({ roles: ROLES })
      expect(() => pool.stopHealthCheck()).not.toThrow()
    })

    it('stopHealthCheck 后不再触发健康检查', async () => {
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES })
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
      const pool = new ClientPool({ roles: ROLES, logger })
      const adapter = mockAdapter('a', 'connected')
      adapter.healthCheck.mockRejectedValue(new Error('error'))
      pool.addClient(adapter, 'master')

      pool.startHealthCheck(1000)
      await vi.advanceTimersByTimeAsync(1000)
      pool.stopHealthCheck()

      expect(logger.error).toHaveBeenCalledWith('healthCheck: 客户端异常', 'a')
    })
  })
})
