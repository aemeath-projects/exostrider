/**
 * 装饰器单元测试
 *
 * 注意：oxc（Vitest 4.x 默认 transform）不支持在测试文件中直接使用
 * TC39 Stage 3 decorator 语法（@Decorator）。
 * 因此此测试文件通过直接调用装饰器函数（而非 @ 语法）来验证装饰器行为，
 * 同时通过导入 src/ 中已装饰的类（在 TypeScript 编译后运行）来验证端对端注册逻辑。
 */
import { describe, it, expect, beforeEach } from 'vitest'

import {
  Service,
  Inject,
  Provide,
  Startup,
  Shutdown,
  serviceEntryRegistry,
  SERVICE_INJECTS,
  SERVICE_PROVIDES,
  SERVICE_STARTUP,
  SERVICE_SHUTDOWN,
} from '../../../src/lifecycle'

// ── 辅助函数：构建 ClassFieldDecoratorContext / ClassMethodDecoratorContext ──

function makeFieldCtx(
  name: string,
  metadata: Record<string | symbol, unknown>,
): ClassFieldDecoratorContext {
  return {
    name,
    metadata,
    kind: 'field' as const,
    static: false,
    private: false,
    access: {
      has: () => false,
      get: () => undefined,
    },
  } as ClassFieldDecoratorContext
}

function makeMethodCtx(
  name: string,
  metadata: Record<string | symbol, unknown>,
): ClassMethodDecoratorContext {
  return {
    name,
    metadata,
    kind: 'method' as const,
    static: false,
    private: false,
    access: {
      has: () => false,
      get: () => undefined as never,
    },
    addInitializer: () => {},
  }
}

function makeClassCtx(
  name: string,
  metadata: Record<string | symbol, unknown>,
): ClassDecoratorContext {
  return {
    name,
    kind: 'class' as const,
    metadata,
    addInitializer: () => {},
  }
}

// ── beforeEach: 每次测试前清空全局注册表 ──

beforeEach(() => {
  serviceEntryRegistry.clear()
})

// ── @Inject 测试 ──

describe('@Inject', () => {
  it('将注入条目存入 metadata', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Inject('db')(undefined, makeFieldCtx('myField', metadata))

    const injects = metadata[SERVICE_INJECTS] as {
      propertyName: string | symbol
      serviceKey: string
    }[]
    expect(injects).toHaveLength(1)
    expect(injects[0]).toEqual({ propertyName: 'myField', serviceKey: 'db' })
  })

  it('多次 @Inject 在同一 metadata 累积条目（不可变风格 — 每次返回新数组）', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Inject('db')(undefined, makeFieldCtx('dbField', metadata))
    Inject('cache')(undefined, makeFieldCtx('cacheField', metadata))

    const injects = metadata[SERVICE_INJECTS] as {
      propertyName: string
      serviceKey: string
    }[]
    expect(injects).toHaveLength(2)
    expect(injects[0]).toEqual({ propertyName: 'dbField', serviceKey: 'db' })
    expect(injects[1]).toEqual({ propertyName: 'cacheField', serviceKey: 'cache' })
  })

  it('第一次调用创建新数组（不依赖 metadata 已有值）', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Inject('db')(undefined, makeFieldCtx('f', metadata))
    // 应有一个条目
    expect(
      (metadata[SERVICE_INJECTS] as { propertyName: string; serviceKey: string }[]).length,
    ).toBe(1)
  })
})

// ── @Provide 测试 ──

describe('@Provide', () => {
  it('将提供条目存入 metadata', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Provide('my_service')(undefined, makeFieldCtx('myService', metadata))

    const provides = metadata[SERVICE_PROVIDES] as {
      propertyName: string | symbol
      serviceKey: string
    }[]
    expect(provides).toHaveLength(1)
    expect(provides[0]).toEqual({ propertyName: 'myService', serviceKey: 'my_service' })
  })

  it('多次 @Provide 在同一 metadata 累积条目', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Provide('svc_a')(undefined, makeFieldCtx('serviceA', metadata))
    Provide('svc_b')(undefined, makeFieldCtx('serviceB', metadata))

    const provides = metadata[SERVICE_PROVIDES] as {
      propertyName: string
      serviceKey: string
    }[]
    expect(provides).toHaveLength(2)
    expect(provides[0]).toEqual({ propertyName: 'serviceA', serviceKey: 'svc_a' })
    expect(provides[1]).toEqual({ propertyName: 'serviceB', serviceKey: 'svc_b' })
  })
})

// ── @Startup 测试 ──

describe('@Startup', () => {
  it('将方法名存入 metadata', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Startup(undefined, makeMethodCtx('start', metadata))
    expect(metadata[SERVICE_STARTUP]).toBe('start')
  })

  it('重复 @Startup 抛出 Error', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Startup(undefined, makeMethodCtx('start', metadata))
    expect(() => Startup(undefined, makeMethodCtx('start2', metadata))).toThrow(
      '@Startup 只能标记一个方法',
    )
  })
})

// ── @Shutdown 测试 ──

describe('@Shutdown', () => {
  it('将方法名存入 metadata', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Shutdown(undefined, makeMethodCtx('stop', metadata))
    expect(metadata[SERVICE_SHUTDOWN]).toBe('stop')
  })

  it('重复 @Shutdown 抛出 Error', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Shutdown(undefined, makeMethodCtx('stop', metadata))
    expect(() => Shutdown(undefined, makeMethodCtx('stop2', metadata))).toThrow(
      '@Shutdown 只能标记一个方法',
    )
  })
})

// ── @Service 测试（通过函数调用触发） ──

describe('@Service', () => {
  it('将服务注册到 serviceEntryRegistry', () => {
    class TestService {}
    const ctx = makeClassCtx('TestService', {})
    Service({ name: 'test_service' })(TestService, ctx)

    expect(serviceEntryRegistry.has('test_service')).toBe(true)
    const entry = serviceEntryRegistry.get('test_service')!
    expect(entry.name).toBe('test_service')
    expect(entry.serviceClass).toBe(TestService)
  })

  it('无 @Inject/@Provide/@Startup/@Shutdown 时，对应字段为空/null', () => {
    class EmptyService {}
    const ctx = makeClassCtx('EmptyService', {})
    Service({ name: 'empty_service' })(EmptyService, ctx)

    const entry = serviceEntryRegistry.get('empty_service')!
    expect(entry.injects).toEqual([])
    expect(entry.provides).toEqual([])
    expect(entry.startupMethod).toBeNull()
    expect(entry.shutdownMethod).toBeNull()
  })

  it('名称冲突时抛出 Error', () => {
    class ServiceA {}
    class ServiceB {}
    const ctx1 = makeClassCtx('ServiceA', {})
    const ctx2 = makeClassCtx('ServiceB', {})

    Service({ name: 'dup_service' })(ServiceA, ctx1)
    expect(() =>
      Service({ name: 'dup_service' })(
        ServiceB as unknown as new (...args: unknown[]) => unknown,
        ctx2,
      ),
    ).toThrow('@Service 名称冲突: "dup_service" 已注册')
  })

  it('@Service 能读取 metadata 中的 @Inject 条目', () => {
    class SvcWithInjects {}
    const metadata: Record<string | symbol, unknown> = {}
    Inject('db')(undefined, makeFieldCtx('db', metadata))
    Inject('cache')(undefined, makeFieldCtx('cache', metadata))
    const ctx = makeClassCtx('SvcWithInjects', metadata)

    Service({ name: 'inject_read_service' })(SvcWithInjects, ctx)

    const entry = serviceEntryRegistry.get('inject_read_service')!
    expect(entry.injects).toHaveLength(2)
    expect(entry.injects[0]).toMatchObject({ serviceKey: 'db' })
    expect(entry.injects[1]).toMatchObject({ serviceKey: 'cache' })
  })

  it('@Service 能读取 metadata 中的 @Provide 条目', () => {
    class SvcWithProvides {}
    const metadata: Record<string | symbol, unknown> = {}
    Provide('exposed_svc')(undefined, makeFieldCtx('exposedSvc', metadata))
    const ctx = makeClassCtx('SvcWithProvides', metadata)

    Service({ name: 'provide_read_service' })(SvcWithProvides, ctx)

    const entry = serviceEntryRegistry.get('provide_read_service')!
    expect(entry.provides).toHaveLength(1)
    expect(entry.provides[0]).toMatchObject({ serviceKey: 'exposed_svc' })
  })

  it('@Service 能读取 metadata 中的 @Startup 方法名', () => {
    class SvcWithStartup {}
    const metadata: Record<string | symbol, unknown> = {}
    Startup(undefined, makeMethodCtx('init', metadata))
    const ctx = makeClassCtx('SvcWithStartup', metadata)

    Service({ name: 'startup_read_service' })(SvcWithStartup, ctx)

    const entry = serviceEntryRegistry.get('startup_read_service')!
    expect(entry.startupMethod).toBe('init')
  })

  it('@Service 能读取 metadata 中的 @Shutdown 方法名', () => {
    class SvcWithShutdown {}
    const metadata: Record<string | symbol, unknown> = {}
    Shutdown(undefined, makeMethodCtx('cleanup', metadata))
    const ctx = makeClassCtx('SvcWithShutdown', metadata)

    Service({ name: 'shutdown_read_service' })(SvcWithShutdown, ctx)

    const entry = serviceEntryRegistry.get('shutdown_read_service')!
    expect(entry.shutdownMethod).toBe('cleanup')
  })

  it('@Startup 重复标记时抛出错误（existing 为 string）', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Startup(undefined, makeMethodCtx('start1', metadata))

    expect(() => Startup(undefined, makeMethodCtx('start2', metadata))).toThrow('@Startup')
    expect(() => Startup(undefined, makeMethodCtx('start2', metadata))).toThrow('start1')
  })

  it('@Shutdown 重复标记时抛出错误（existing 为 string）', () => {
    const metadata: Record<string | symbol, unknown> = {}
    Shutdown(undefined, makeMethodCtx('stop1', metadata))

    expect(() => Shutdown(undefined, makeMethodCtx('stop2', metadata))).toThrow('@Shutdown')
    expect(() => Shutdown(undefined, makeMethodCtx('stop2', metadata))).toThrow('stop1')
  })

  it('@Startup 重复标记时 existing 为非 string/symbol 时提示 (unknown)', () => {
    const metadata: Record<string | symbol, unknown> = {}
    // 手动预设一个非 string/symbol 值（触发 existingStr 为 "(unknown)" 的路径）
    metadata[SERVICE_STARTUP] = 42

    expect(() => Startup(undefined, makeMethodCtx('start2', metadata))).toThrow('(unknown)')
  })

  it('@Shutdown 重复标记时 existing 为非 string/symbol 时提示 (unknown)', () => {
    const metadata: Record<string | symbol, unknown> = {}
    metadata[SERVICE_SHUTDOWN] = { not: 'a-string' }

    expect(() => Shutdown(undefined, makeMethodCtx('stop2', metadata))).toThrow('(unknown)')
  })

  it('全量装饰器组合：@Inject × 2 + @Provide × 2 + @Startup + @Shutdown', () => {
    class FullSvc {}
    const metadata: Record<string | symbol, unknown> = {}
    Inject('dep_a')(undefined, makeFieldCtx('depA', metadata))
    Inject('dep_b')(undefined, makeFieldCtx('depB', metadata))
    Provide('svc_x')(undefined, makeFieldCtx('svcX', metadata))
    Provide('svc_y')(undefined, makeFieldCtx('svcY', metadata))
    Startup(undefined, makeMethodCtx('start', metadata))
    Shutdown(undefined, makeMethodCtx('stop', metadata))
    const ctx = makeClassCtx('FullSvc', metadata)

    Service({ name: 'full_service' })(FullSvc, ctx)

    const entry = serviceEntryRegistry.get('full_service')!
    expect(entry.injects).toHaveLength(2)
    expect(entry.provides).toHaveLength(2)
    expect(entry.startupMethod).toBe('start')
    expect(entry.shutdownMethod).toBe('stop')
  })
})
