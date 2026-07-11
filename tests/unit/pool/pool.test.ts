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

      // 初始状态为 disconnected，后面 notifyStateChange 的 to 是 'connected'，
      // 与初始状态不同，才会被 notifyStateChange 的去重逻辑判定为真实变化并发射事件。
      const adapter = {
        ...mockAdapter('e', 'disconnected'),
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

  describe('startStatePolling / stopStatePolling', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('重复调用 startStatePolling 不创建重复定时器', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(1000)
      pool.startStatePolling(1000)

      adapter._setState('disconnected')
      vi.advanceTimersByTime(1000)

      // 只有一个定时器在跑：变化只会被观测并通知一次，而不是两次
      expect(changes).toHaveLength(1)
      pool.stopStatePolling()
    })

    it('stopStatePolling 无定时器时无副作用', () => {
      const pool = new ClientPool<object, TestRole>({})
      expect(() => pool.stopStatePolling()).not.toThrow()
    })

    it('stopStatePolling 后不再轮询状态', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(1000)
      pool.stopStatePolling()

      adapter._setState('disconnected')
      vi.advanceTimersByTime(2000)

      expect(changes).toHaveLength(0)
    })
  })

  describe('_pollState', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('adapter.state 未变化时不发射 clientStateChange', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(1000)
      vi.advanceTimersByTime(1000)
      pool.stopStatePolling()

      expect(changes).toHaveLength(0)
    })

    it('adapter.state 变化时发射一次 clientStateChange 并更新 prevState', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      adapter._setState('reconnecting')
      pool.startStatePolling(1000)
      vi.advanceTimersByTime(1000)
      pool.stopStatePolling()

      expect(changes).toEqual([['a', 'connected', 'reconnecting']])
    })

    it('轮询与 wireToPool 转发的实时事件并发触发同一次状态变化时，只发射一次（去重）', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      adapter._setState('disconnected')
      // 模拟 wireToPool 实时事件先到达，更新了 entry.prevState
      pool.notifyStateChange('a', 'connected', 'disconnected')
      // 轮询随后也发现了同一次变化——不应该重复通知
      pool.startStatePolling(1000)
      vi.advanceTimersByTime(1000)
      pool.stopStatePolling()

      expect(changes).toEqual([['a', 'connected', 'disconnected']])
    })

    it('客户端被移除后，不再对已移除的 id 继续轮询', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(1000)
      await pool.removeClient('a')
      adapter._setState('disconnected') // 移除之后底层状态变化不该再被轮询到
      vi.advanceTimersByTime(1000)
      pool.stopStatePolling()

      expect(changes).toHaveLength(0)
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

  describe('notifyStateChange 边界', () => {
    it('不存在的 clientId 仍发射 clientStateChange（不依赖 entry 存在）', () => {
      const pool = new ClientPool<object, TestRole>({})
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.notifyStateChange('nonexistent', 'connected', 'disconnected')

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['nonexistent', 'connected', 'disconnected'])
    })

    it('同一个 to 状态只发射一次 clientStateChange（直接调用去重）', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.notifyStateChange('a', 'connected', 'reconnecting')
      pool.notifyStateChange('a', 'reconnecting', 'reconnecting')

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'reconnecting'])
    })

    it('to 与 prevState 相同且 entry 存在时不 emit', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('a', 'disconnected'), 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.notifyStateChange('a', 'disconnected', 'disconnected')

      expect(changes).toHaveLength(0)
    })

    it('连续多次不同状态变化，每一次都正确通知并更新 prevState', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.notifyStateChange('a', 'connected', 'reconnecting')
      pool.notifyStateChange('a', 'reconnecting', 'disconnected')
      pool.notifyStateChange('a', 'disconnected', 'connected')

      expect(changes).toHaveLength(3)
      expect(changes[0]).toEqual(['a', 'connected', 'reconnecting'])
      expect(changes[1]).toEqual(['a', 'reconnecting', 'disconnected'])
      expect(changes[2]).toEqual(['a', 'disconnected', 'connected'])
    })

    it('clientStateChange 无监听器时不抛异常', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('a', 'connected'), 'master')
      expect(() => pool.notifyStateChange('a', 'connected', 'error')).not.toThrow()
    })
  })

  describe('reconnecting 状态', () => {
    it('reconnecting 状态不在 getAvailableClients 中', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('a', 'reconnecting'), 'master')
      expect(pool.getAvailableClients().map((c) => c.id)).toEqual([])
    })

    it('getAvailableClients 包含 connected 但不含 reconnecting', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('c', 'connected'), 'master')
      pool.addClient(mockAdapter('r', 'reconnecting'), 'master')
      pool.addClient(mockAdapter('d', 'disconnected'), 'normal')
      const ids = pool.getAvailableClients().map((c) => c.id)
      expect(ids).toEqual(['c'])
    })

    it('notifyStateChange 正确传播 reconnecting → connected', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'reconnecting')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.notifyStateChange('a', 'reconnecting', 'connected')

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'reconnecting', 'connected'])
    })

    it('notifyStateChange 正确传播 connected → reconnecting', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.notifyStateChange('a', 'connected', 'reconnecting')

      expect(changes).toHaveLength(1)
      expect(changes[0]).toEqual(['a', 'connected', 'reconnecting'])
    })

    it('removeClient 对 reconnecting 状态客户端不调用 disconnect（仅 connected 才调用）', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'reconnecting')
      pool.addClient(adapter, 'master')
      await pool.removeClient('a')
      expect(adapter.disconnect).not.toHaveBeenCalled()
      expect(pool.getClient('a')).toBeUndefined()
    })
  })

  describe('_pollState 并发与多客户端', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('多客户端同时轮询：部分状态变化、部分不变，只通知变化的', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapters = [
        mockAdapter('a', 'connected'),
        mockAdapter('b', 'connected'),
        mockAdapter('c', 'disconnected'),
        mockAdapter('d', 'disconnected'),
      ]
      for (const a of adapters) pool.addClient(a, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      // 只改 a 和 c
      adapters[0]._setState('reconnecting')
      adapters[2]._setState('connected')

      pool.startStatePolling(100)
      vi.advanceTimersByTime(100)
      pool.stopStatePolling()

      expect(changes).toHaveLength(2)
      const changeIds = changes.map((c) => (c as unknown[])[0])
      expect(changeIds).toContain('a')
      expect(changeIds).toContain('c')
    })

    it('轮询中新增客户端（prevState 与 adapter.state 一致）不误报变化', () => {
      const pool = new ClientPool<object, TestRole>({})
      pool.addClient(mockAdapter('a', 'connected'), 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(100)
      pool.addClient(mockAdapter('b', 'connected'), 'master')
      vi.advanceTimersByTime(100)
      pool.stopStatePolling()

      expect(changes).toHaveLength(0)
    })

    it('跨多次轮询 tick 的连续状态迁移', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(100)

      adapter._setState('reconnecting')
      vi.advanceTimersByTime(100)
      adapter._setState('disconnected')
      vi.advanceTimersByTime(100)

      pool.stopStatePolling()

      expect(changes).toEqual([
        ['a', 'connected', 'reconnecting'],
        ['a', 'reconnecting', 'disconnected'],
      ])
    })

    it('轮询期间 removeClient 后不再对同一 id 轮询', async () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(100)
      await pool.removeClient('a')
      adapter._setState('disconnected')
      vi.advanceTimersByTime(100)
      pool.stopStatePolling()

      expect(changes).toHaveLength(0)
    })
  })

  describe('startStatePolling / stopStatePolling 高频切换', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('快速多次开关轮询，timer 不泄漏', () => {
      const pool = new ClientPool<object, TestRole>({})
      for (let i = 0; i < 50; i++) {
        pool.startStatePolling(100)
        pool.stopStatePolling()
      }

      expect((pool as any).statePollingTimer).toBeNull()
    })

    it('stopStatePolling → startStatePolling 重新启动可正常工作', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(100)
      pool.stopStatePolling()

      // 重新启动
      pool.startStatePolling(200)
      adapter._setState('reconnecting')
      vi.advanceTimersByTime(200)
      pool.stopStatePolling()

      expect(changes).toHaveLength(1)
    })

    it('同时连续 startStatePolling 多次不创建多余定时器', () => {
      const pool = new ClientPool<object, TestRole>({})
      const adapter = mockAdapter('a', 'connected')
      pool.addClient(adapter, 'master')
      const changes: unknown[] = []
      pool.on('clientStateChange', (...args) => changes.push(args))

      pool.startStatePolling(100)
      pool.startStatePolling(200)
      pool.startStatePolling(300)

      adapter._setState('disconnected')
      vi.advanceTimersByTime(300)
      pool.stopStatePolling()

      expect(changes).toHaveLength(1) // 只一个定时器注册
    })
  })
})
