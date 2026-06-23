import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { ServiceEntry } from '../../../src/lifecycle'
import { LifecycleOrchestrator, ServiceRegistry } from '../../../src/lifecycle'

/** 辅助函数：构建一个最小可用的 ServiceEntry */
function makeEntry(
  name: string,
  opts: Partial<Omit<ServiceEntry, 'name' | 'serviceClass'>> & {
    serviceClass?: new (...args: unknown[]) => unknown
  } = {},
): ServiceEntry {
  return {
    name,
    serviceClass: opts.serviceClass ?? class {},
    injects: opts.injects ?? [],
    provides: opts.provides ?? [],
    startupMethod: opts.startupMethod ?? null,
    shutdownMethod: opts.shutdownMethod ?? null,
  }
}

describe('LifecycleOrchestrator — startup', () => {
  let registry: ServiceRegistry
  let orchestrator: LifecycleOrchestrator

  beforeEach(() => {
    registry = new ServiceRegistry()
    orchestrator = new LifecycleOrchestrator(registry)
  })

  it('无依赖的单服务正常启动', async () => {
    const startFn = vi.fn()

    class SimpleSvc {
      start(): void {
        startFn()
      }
    }

    const entry = makeEntry('simple', {
      serviceClass: SimpleSvc as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
    })

    await orchestrator.startup([entry])
    expect(startFn).toHaveBeenCalledOnce()
  })

  it('按拓扑顺序启动：provider 先于 consumer', async () => {
    const order: string[] = []

    class ProviderSvc {
      value = 'provided'
      start(): void {
        order.push('provider')
      }
    }

    class ConsumerSvc {
      dep!: ProviderSvc
      start(): void {
        order.push('consumer')
      }
    }

    const provider = makeEntry('provider', {
      serviceClass: ProviderSvc as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
      provides: [{ propertyName: 'value', serviceKey: 'provider_value' }],
    })

    const consumer = makeEntry('consumer', {
      serviceClass: ConsumerSvc as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
      injects: [{ propertyName: 'dep', serviceKey: 'provider_value' }],
    })

    // 故意以 consumer-first 顺序传入，验证拓扑排序
    await orchestrator.startup([consumer, provider])

    expect(order).toEqual(['provider', 'consumer'])
  })

  it('@Provide 字段在 startup 后注册到 registry', async () => {
    class SvcWithProvide {
      myService = { hello: 'world' }

      start(): void {}
    }

    const entry = makeEntry('svc_with_provide', {
      serviceClass: SvcWithProvide as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
      provides: [{ propertyName: 'myService', serviceKey: 'hello_service' }],
    })

    await orchestrator.startup([entry])
    expect(registry.get('hello_service')).toEqual({ hello: 'world' })
  })

  it('@Inject 字段在 startup 时由 registry 赋值', async () => {
    registry.set('db' as never, { query: vi.fn() })

    let capturedDb: unknown
    class SvcWithInject {
      db!: unknown
      start(): void {
        capturedDb = this.db
      }
    }

    const entry = makeEntry('svc_with_inject', {
      serviceClass: SvcWithInject as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
      injects: [{ propertyName: 'db', serviceKey: 'db' }],
    })

    await orchestrator.startup([entry])
    expect(capturedDb).toBeDefined()
    expect((capturedDb as { query: unknown }).query).toBeDefined()
  })

  it('重复调用 startup 抛出 Error', async () => {
    await orchestrator.startup([])
    await expect(orchestrator.startup([])).rejects.toThrow(
      'LifecycleOrchestrator.startup() 已被调用',
    )
  })

  it('@Inject 依赖不存在时抛出 Error（registry.get 抛出）', async () => {
    class SvcMissingDep {
      dep!: unknown
    }

    const entry = makeEntry('missing_dep', {
      serviceClass: SvcMissingDep as unknown as new (...args: unknown[]) => unknown,
      injects: [{ propertyName: 'dep', serviceKey: 'nonexistent_key' }],
    })

    await expect(orchestrator.startup([entry])).rejects.toThrow(
      '服务 "nonexistent_key" 未在注册表中找到',
    )
  })
})

describe('LifecycleOrchestrator — 循环依赖', () => {
  it('循环依赖时抛出 Error', async () => {
    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    // A provides 'key_a'，B inject 'key_a' 并 provides 'key_b'
    // A 也 inject 'key_b'，形成循环：A → B → A
    const entryA = makeEntry('svc_a', {
      injects: [{ propertyName: 'fieldB', serviceKey: 'key_b' }],
      provides: [{ propertyName: 'fieldA', serviceKey: 'key_a' }],
    })
    const entryB = makeEntry('svc_b', {
      injects: [{ propertyName: 'fieldA', serviceKey: 'key_a' }],
      provides: [{ propertyName: 'fieldB', serviceKey: 'key_b' }],
    })

    await expect(orchestrator.startup([entryA, entryB])).rejects.toThrow(
      /循环依赖|Circular dependency/,
    )
  })
})

describe('LifecycleOrchestrator — shutdown', () => {
  it('按启动逆序调用 @Shutdown 方法', async () => {
    const order: string[] = []

    class SvcA {
      stop(): void {
        order.push('A')
      }
    }
    class SvcB {
      stop(): void {
        order.push('B')
      }
    }

    const entryA = makeEntry('svc_a', {
      serviceClass: SvcA as unknown as new (...args: unknown[]) => unknown,
      shutdownMethod: 'stop',
    })
    const entryB = makeEntry('svc_b', {
      serviceClass: SvcB as unknown as new (...args: unknown[]) => unknown,
      shutdownMethod: 'stop',
    })

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    // A 先启动，B 后启动
    await orchestrator.startup([entryA, entryB])
    await orchestrator.shutdown()

    // 关闭顺序应为 B → A
    expect(order).toEqual(['B', 'A'])
  })

  it('shutdown 时某个服务抛出 Error，不影响其他服务关闭', async () => {
    const order: string[] = []

    class SvcA {
      stop(): void {
        order.push('A')
        throw new Error('A shutdown error')
      }
    }
    class SvcB {
      stop(): void {
        order.push('B')
      }
    }

    const entryA = makeEntry('err_svc_a', {
      serviceClass: SvcA as unknown as new (...args: unknown[]) => unknown,
      shutdownMethod: 'stop',
    })
    const entryB = makeEntry('err_svc_b', {
      serviceClass: SvcB as unknown as new (...args: unknown[]) => unknown,
      shutdownMethod: 'stop',
    })

    const registry = new ServiceRegistry()
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const orchestrator = new LifecycleOrchestrator(registry, { logger: mockLogger })

    await orchestrator.startup([entryB, entryA]) // B 先启动，A 后启动
    await orchestrator.shutdown() // 逆序：A 先关，B 后关

    expect(order).toEqual(['A', 'B'])
    expect(mockLogger.error).toHaveBeenCalledOnce()
  })

  it('shutdown 后 _startedEntries 被清空，可再次 startup', async () => {
    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    await orchestrator.startup([])
    await orchestrator.shutdown()

    // 关闭后再次 startup 不应抛出
    await expect(orchestrator.startup([])).resolves.toBeUndefined()
  })

  it('无 @Shutdown 方法的服务正常跳过', async () => {
    class NoShutdownSvc {}

    const entry = makeEntry('no_shutdown', {
      serviceClass: NoShutdownSvc as unknown as new (...args: unknown[]) => unknown,
      shutdownMethod: null,
    })

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    await orchestrator.startup([entry])
    // 不应抛出
    await expect(orchestrator.shutdown()).resolves.toBeUndefined()
  })
})

describe('LifecycleOrchestrator — logger 集成', () => {
  it('startup 调用 logger.debug', async () => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry, { logger: mockLogger })

    const entry = makeEntry('logged_svc')
    await orchestrator.startup([entry])

    expect(mockLogger.debug).toHaveBeenCalledWith('Started service: logged_svc')
  })
})

describe('LifecycleOrchestrator — startup 失败回滚', () => {
  it('某个服务 @Startup 抛出时，已启动的服务调用 @Shutdown 回滚', async () => {
    const shutdownCalled: string[] = []

    class SvcA {
      stop(): void {
        shutdownCalled.push('A')
      }
    }

    class SvcB {
      start(): void {
        throw new Error('SvcB startup failed')
      }
    }

    const entryA = makeEntry('rollback_svc_a', {
      serviceClass: SvcA as unknown as new (...args: unknown[]) => unknown,
      startupMethod: null,
      shutdownMethod: 'stop',
    })

    const entryB = makeEntry('rollback_svc_b', {
      serviceClass: SvcB as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
      shutdownMethod: null,
    })

    const registry = new ServiceRegistry()
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const orchestrator = new LifecycleOrchestrator(registry, { logger: mockLogger })

    // A 先启动（无 startupMethod），B 后启动（startup 抛出）
    await expect(orchestrator.startup([entryA, entryB])).rejects.toThrow('SvcB startup failed')

    // A 已启动，需要被回滚 shutdown
    expect(shutdownCalled).toContain('A')
    // logger.error 应被调用记录回滚
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Startup 失败'))
  })

  it('startup 失败后 _started 仍为 false，允许重试', async () => {
    class FailSvc {
      start(): void {
        throw new Error('fail')
      }
    }

    const entry = makeEntry('fail_svc', {
      serviceClass: FailSvc as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
    })

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    await expect(orchestrator.startup([entry])).rejects.toThrow('fail')

    // startup 失败后 orchestrator 不处于 started 状态，不应重复抛出 "already started" 错误
    // 而是再次抛出业务错误
    await expect(orchestrator.startup([entry])).rejects.toThrow('fail')
  })
})

describe('LifecycleOrchestrator — 依赖排序', () => {
  it('有实际 inject/provide 依赖时 BFS 拓扑排序正确执行', async () => {
    const order: string[] = []

    class ProviderSvc {
      start(): void {
        order.push('provider')
      }
    }
    class ConsumerSvc {
      dep?: unknown
      start(): void {
        order.push('consumer')
      }
    }

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    const providerEntry = makeEntry('provider_svc', {
      serviceClass: ProviderSvc as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
      provides: [{ propertyName: 'myService', serviceKey: 'my_service' }],
    })

    const consumerEntry = makeEntry('consumer_svc', {
      serviceClass: ConsumerSvc as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
      injects: [{ propertyName: 'dep', serviceKey: 'my_service' }],
    })

    // consumer 依赖 provider，应先启动 provider
    await orchestrator.startup([consumerEntry, providerEntry])
    expect(order[0]).toBe('provider')
    expect(order[1]).toBe('consumer')
  })
})

describe('LifecycleOrchestrator — 边界情况', () => {
  it('@Startup 方法名存在但实例上不是函数时抛出', async () => {
    class BrokenStartup {
      start = 'not a function'
    }

    const entry = makeEntry('broken_startup', {
      serviceClass: BrokenStartup as unknown as new (...args: unknown[]) => unknown,
      startupMethod: 'start',
    })

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry)

    await expect(orchestrator.startup([entry])).rejects.toThrow('@Startup')
  })

  it('@Shutdown 方法名存在但实例上不是函数时 warn 并跳过', async () => {
    class BrokenShutdown {
      stop = 'not a function'
    }

    const entry = makeEntry('broken_shutdown', {
      serviceClass: BrokenShutdown as unknown as new (...args: unknown[]) => unknown,
      shutdownMethod: 'stop',
    })

    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const registry = new ServiceRegistry()
    const orchestrator = new LifecycleOrchestrator(registry, { logger: mockLogger })

    await orchestrator.startup([entry])
    await orchestrator.shutdown()

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('stop'))
  })
})
