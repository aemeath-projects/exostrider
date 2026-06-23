import { describe, it, expect, vi } from 'vitest'

import type { ClientState } from '../../../src/pool/adapter.js'
import { ClientPool } from '../../../src/pool/pool.js'
import type { RoleDefinition } from '../../../src/pool/role.js'

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
})
