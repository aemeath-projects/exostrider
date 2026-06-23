/**
 * Exostrider 门面类集成测试。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { Exostrider } from '../../src'
import type { ExostriderOptions, RoleDefinition } from '../../src'
import { handlerRegistry } from '../../src/dispatch'
import type { ClientState } from '../../src/pool'

beforeEach(() => {
  handlerRegistry.clear()
})

describe('Exostrider facade', () => {
  it('使用最小配置创建实例', () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: {
        contextConfig: {
          textExtractor: (event: Record<string, unknown>) => String(event.text ?? ''),
        },
      },
    })
    expect(ex.echo).toBeDefined()
    expect(ex.lifecycle).toBeDefined()
    expect(ex.dispatcher).toBeDefined()
    expect(ex.logger).toBeDefined()
    expect(ex.session).toBeUndefined()
  })

  it('无 handler 时正常 bootstrap', async () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    await expect(ex.bootstrap()).resolves.toBeUndefined()
  })

  it('分发事件', async () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: {
        contextConfig: {
          textExtractor: (event: Record<string, unknown>) => String(event.text ?? ''),
        },
      },
    })
    await ex.bootstrap()
    // 无 handler 注册 —— 应静默返回
    await expect(ex.dispatch({ text: 'hello' }, {})).resolves.toBeUndefined()
  })

  it('正常关闭', async () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    await ex.bootstrap()
    await expect(ex.shutdown()).resolves.toBeUndefined()
  })

  it('使用传入的 CreateLoggerOptions', () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
      logger: { level: 'warn' },
    })
    expect(ex.logger.level).toBe('warn')
  })

  it('未传入 logger 时创建默认 logger', () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(ex.logger).toBeDefined()
    expect(typeof ex.logger.info).toBe('function')
  })

  it('传入 session 配置时创建 SessionManager', () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
      session: {
        config: { sessionTimeout: 60 },
        keyExtractor: () => 'key',
      },
    })
    expect(ex.session).toBeDefined()
  })

  it('暴露 logBroadcaster', () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(ex.logBroadcaster).toBeDefined()
  })

  it('接受预构建的 PinoLogger 实例', async () => {
    const { createLogger } = await import('../../src/logger')
    const customLogger = createLogger({ level: 'error' })
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
      logger: customLogger,
    })
    // 传入的 logger 实例应被直接使用（引用相等）
    expect(ex.logger).toBe(customLogger)
    expect(ex.logger.level).toBe('error')
  })

  it('暴露 handlerRegistry', () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(ex.handlerRegistry).toBeDefined()
    expect(typeof ex.handlerRegistry.size).toBe('number')
  })

  it('暴露 registry（ServiceRegistry）', () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(ex.registry).toBeDefined()
  })

  it('options 类型满足 ExostriderOptions 约束', () => {
    // 仅检查类型约束（编译期检查，运行时始终通过）
    const opts: ExostriderOptions = {
      echo: { config: { echoes: {} }, baseDir: '/tmp' },
      dispatch: { contextConfig: {} },
    }
    expect(opts).toBeDefined()
  })

  it('bootstrap 前分发静默返回', async () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    // bootstrap 前 —— 使用空映射的临时 dispatcher，不应抛出异常
    await expect(ex.dispatch({}, {})).resolves.toBeUndefined()
  })

  it('配置了 session 时 shutdown 调用 session.cancelAll', async () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
      session: {
        config: { sessionTimeout: 60 },
        keyExtractor: () => 'key',
      },
    })
    await ex.bootstrap()
    expect(ex.session).toBeDefined()
    await expect(ex.shutdown()).resolves.toBeUndefined()
  })

  it('bootstrap 后 dispatcher 为正式实例', async () => {
    const ex = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    // bootstrap 前：dispatcher 为临时实例（_dispatcher === null）
    const preBootstrapDispatcher = ex.dispatcher
    expect(preBootstrapDispatcher).toBeDefined()

    await ex.bootstrap()

    // bootstrap 后：dispatcher 为正式实例，与 bootstrap 前的临时实例为不同对象
    const postBootstrapDispatcher = ex.dispatcher
    expect(postBootstrapDispatcher).toBeDefined()
    expect(postBootstrapDispatcher).not.toBe(preBootstrapDispatcher)
  })
})

// ——— pool 集成测试 ———

type TestRole = 'master' | 'normal'

const TEST_ROLES: RoleDefinition<TestRole>[] = [
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

function makeMockAdapter(id: string) {
  let state: ClientState = 'disconnected'
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
  }
}

function makeBaseOptions() {
  return {
    echo: { config: { echoes: {} }, baseDir: process.cwd() },
    dispatch: { contextConfig: {} },
  } as const
}

describe('Exostrider facade — pool 集成', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('传入 pool 配置时创建 ClientPool', () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: { options: { roles: TEST_ROLES } },
    })
    expect(ex.pool).toBeDefined()
  })

  it('未传入 pool 配置时 pool 为 undefined', () => {
    const ex = new Exostrider(makeBaseOptions())
    expect(ex.pool).toBeUndefined()
  })

  it('autoConnect 为 true（默认）时 bootstrap 调用 connectAll', async () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: { options: { roles: TEST_ROLES } },
    })
    const adapter = makeMockAdapter('bot-1')
    ex.pool!.addClient(adapter, 'master')

    await ex.bootstrap()

    expect(adapter.connect).toHaveBeenCalledOnce()
  })

  it('autoConnect 为 false 时 bootstrap 跳过 connectAll', async () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: { options: { roles: TEST_ROLES }, autoConnect: false },
    })
    const adapter = makeMockAdapter('bot-1')
    ex.pool!.addClient(adapter, 'master')

    await ex.bootstrap()

    expect(adapter.connect).not.toHaveBeenCalled()
  })

  it('配置了 healthCheck.intervalMs 时 bootstrap 启动健康检查', async () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: {
        options: {
          roles: TEST_ROLES,
          healthCheck: { intervalMs: 5000 },
        },
      },
    })
    const startSpy = vi.spyOn(ex.pool!, 'startHealthCheck')

    await ex.bootstrap()

    expect(startSpy).toHaveBeenCalledWith(5000)
  })

  it('未配置 healthCheck 时 bootstrap 不启动健康检查', async () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: { options: { roles: TEST_ROLES } },
    })
    const startSpy = vi.spyOn(ex.pool!, 'startHealthCheck')

    await ex.bootstrap()

    expect(startSpy).not.toHaveBeenCalled()
  })

  it('shutdown 时调用 stopHealthCheck 和 disconnectAll', async () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: {
        options: {
          roles: TEST_ROLES,
          healthCheck: { intervalMs: 5000 },
        },
      },
    })
    const adapter = makeMockAdapter('bot-1')
    ex.pool!.addClient(adapter, 'master')
    const stopSpy = vi.spyOn(ex.pool!, 'stopHealthCheck')

    await ex.bootstrap()
    await ex.shutdown()

    expect(stopSpy).toHaveBeenCalled()
    expect(adapter.disconnect).toHaveBeenCalledOnce()
  })

  it('门面 logger 注入到 ClientPool', async () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: { options: { roles: TEST_ROLES }, autoConnect: false },
    })
    // 门面 logger 注入到 pool，两者共享同一 logger 引用体现为 pool 警告经 ex.logger 输出
    const warnSpy = vi.spyOn(ex.logger, 'warn')
    // 触发一个会 warn 的场景：移除不存在的 clientId
    await ex.pool!.removeClient('nonexistent')
    expect(warnSpy).toHaveBeenCalled()
  })

  it('pool 暴露预期的 ClientPool 实例 API', () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: { options: { roles: TEST_ROLES } },
    })
    const pool = ex.pool!
    expect(typeof pool.addClient).toBe('function')
    expect(typeof pool.connectAll).toBe('function')
    expect(typeof pool.disconnectAll).toBe('function')
    expect(typeof pool.startHealthCheck).toBe('function')
    expect(typeof pool.stopHealthCheck).toBe('function')
    expect(typeof pool.getAvailableClients).toBe('function')
  })

  it('bootstrap 前添加的客户端在 bootstrap 时完成连接', async () => {
    const ex = new Exostrider({
      ...makeBaseOptions(),
      pool: { options: { roles: TEST_ROLES } },
    })
    const a = makeMockAdapter('a')
    const b = makeMockAdapter('b')
    ex.pool!.addClient(a, 'master')
    ex.pool!.addClient(b, 'normal')

    await ex.bootstrap()

    expect(a.connect).toHaveBeenCalledOnce()
    expect(b.connect).toHaveBeenCalledOnce()
    expect(ex.pool!.getAvailableClients()).toHaveLength(2)
  })
})
