/**
 * 装饰器元数据隔离测试 —— Handler/Service 类元数据不跨类泄漏，边界输入处理。
 *
 * 注意：oxc（Vitest 默认 transform）不支持在测试文件中使用 @ 装饰器语法，
 * 因此所有装饰器均以函数调用形式使用。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { Context } from '../../src'
import {
  Handler,
  HANDLER_METHODS,
  HANDLER_SETTINGS,
  CompositeHandlerMapping,
  handlerRegistry,
} from '../../src/dispatch'
import { Service, serviceEntryRegistry, SERVICE_INJECTS } from '../../src/lifecycle'

// ── 辅助函数 ──

function makeClassCtx(name: string, metadata: DecoratorMetadataObject = {}): ClassDecoratorContext {
  return {
    kind: 'class',
    name,
    metadata,
    addInitializer: () => {},
  }
}

// ── 清理全局注册表 ──

beforeEach(() => {
  handlerRegistry.clear()
  serviceEntryRegistry.clear()
})

afterEach(() => {
  handlerRegistry.clear()
  serviceEntryRegistry.clear()
})

describe('Handler 装饰器元数据隔离', () => {
  it('两个 Handler 类的 metadata 对象互不相同', () => {
    const metaA: DecoratorMetadataObject = {}
    const metaB: DecoratorMetadataObject = {}

    class HandlerA {}
    class HandlerB {}

    Handler({ name: 'handler-a', displayName: 'A' })(HandlerA, makeClassCtx('HandlerA', metaA))
    Handler({ name: 'handler-b', displayName: 'B' })(HandlerB, makeClassCtx('HandlerB', metaB))

    const entryA = handlerRegistry.get('handler-a')
    const entryB = handlerRegistry.get('handler-b')

    expect(entryA).toBeDefined()
    expect(entryB).toBeDefined()
    expect(entryA!.metadata).not.toBe(entryB!.metadata)
    expect(entryA!.metadata).toBe(metaA)
    expect(entryB!.metadata).toBe(metaB)
  })

  it('两个 Handler 类注册的 options 各自独立', () => {
    const metaA: DecoratorMetadataObject = {}
    const metaB: DecoratorMetadataObject = {}

    class HA {}
    class HB {}

    Handler({ name: 'h-opts-a', displayName: 'Alpha', tags: ['a'] })(HA, makeClassCtx('HA', metaA))
    Handler({ name: 'h-opts-b', displayName: 'Beta', tags: ['b'] })(HB, makeClassCtx('HB', metaB))

    const a = handlerRegistry.get('h-opts-a')!
    const b = handlerRegistry.get('h-opts-b')!

    expect(a.options.displayName).toBe('Alpha')
    expect(a.options.tags).toEqual(['a'])
    expect(b.options.displayName).toBe('Beta')
    expect(b.options.tags).toEqual(['b'])
    expect(a.options).not.toBe(b.options)
  })

  it('Handler 类的方法元数据不会泄漏到另一个 Handler', () => {
    const metaA: DecoratorMetadataObject = {}
    const metaB: DecoratorMetadataObject = {}

    class HA {}
    class HB {}

    // 向 metaA 写入方法元数据（模拟 @OnCommand 副作用）
    metaA[HANDLER_METHODS] = [
      {
        methodName: 'handleA',
        mappingType: 'command',
        trigger: { command: 'cmd-a', aliases: [] },
        permission: 0,
        scope: 'all',
        priority: 50,
        interceptors: [],
      },
    ]

    Handler({ name: 'h-methods-a' })(HA, makeClassCtx('HA', metaA))
    Handler({ name: 'h-methods-b' })(HB, makeClassCtx('HB', metaB))

    const entryA = handlerRegistry.get('h-methods-a')!
    const entryB = handlerRegistry.get('h-methods-b')!

    expect(entryA.methods).toHaveLength(1)
    expect(entryB.methods).toHaveLength(0)
  })

  it('Handler 类的 settingNodes 不会泄漏到另一个 Handler', () => {
    const metaA: DecoratorMetadataObject = {}
    const metaB: DecoratorMetadataObject = {}

    class HA {}
    class HB {}

    // 向 metaA 写入 setting 元数据
    metaA[HANDLER_SETTINGS] = [{ key: 'enabled', options: { type: 'boolean', default: true } }]

    Handler({ name: 'h-settings-a' })(HA, makeClassCtx('HA', metaA))
    Handler({ name: 'h-settings-b' })(HB, makeClassCtx('HB', metaB))

    const entryA = handlerRegistry.get('h-settings-a')!
    const entryB = handlerRegistry.get('h-settings-b')!

    // SettingNode 的 key 会被添加 handler name 前缀
    expect(entryA.settingNodes).toHaveLength(1)
    expect(entryA.settingNodes[0].key).toBe('h-settings-a.enabled')
    expect(entryB.settingNodes).toHaveLength(0)
  })

  it('Handler 注册相同名称时覆盖，不保留旧条目', () => {
    const meta1: DecoratorMetadataObject = {}
    const meta2: DecoratorMetadataObject = {}

    class H1 {}
    class H2 {}

    Handler({ name: 'dup', displayName: 'First' })(H1, makeClassCtx('H1', meta1))
    Handler({ name: 'dup', displayName: 'Second' })(H2, makeClassCtx('H2', meta2))

    expect(handlerRegistry.size).toBe(1)
    expect(handlerRegistry.get('dup')?.options.displayName).toBe('Second')
    expect(handlerRegistry.get('dup')?.handlerClass).toBe(H2)
  })

  it('10 个不同的 Handler 类注册后各自独立，总数正确', () => {
    for (let i = 0; i < 10; i++) {
      const meta: DecoratorMetadataObject = {}

      const HandlerClass = class {}
      Object.defineProperty(HandlerClass, 'name', { value: `H${i}` })
      Handler({ name: `bulk-handler-${i}` })(HandlerClass, makeClassCtx(`H${i}`, meta))
    }

    expect(handlerRegistry.size).toBe(10)
    for (let i = 0; i < 10; i++) {
      expect(handlerRegistry.has(`bulk-handler-${i}`)).toBe(true)
    }
  })
})

describe('Service 装饰器元数据隔离', () => {
  it('两个 Service 类的条目各自独立', () => {
    class SA {}
    class SB {}

    Service({ name: 'service-a' })(SA, makeClassCtx('SA'))
    Service({ name: 'service-b' })(SB, makeClassCtx('SB'))

    expect(serviceEntryRegistry.has('service-a')).toBe(true)
    expect(serviceEntryRegistry.has('service-b')).toBe(true)

    const entryA = serviceEntryRegistry.get('service-a')!
    const entryB = serviceEntryRegistry.get('service-b')!

    expect(entryA.name).toBe('service-a')
    expect(entryB.name).toBe('service-b')
    expect(entryA).not.toBe(entryB)
    expect(entryA.serviceClass).toBe(SA)
    expect(entryB.serviceClass).toBe(SB)
  })

  it('Service 注册相同名称抛出冲突错误', () => {
    class S1 {}
    class S2 {}

    Service({ name: 'dup-service' })(S1, makeClassCtx('S1'))

    expect(() => {
      Service({ name: 'dup-service' })(S2, makeClassCtx('S2'))
    }).toThrow(/dup-service/)
  })

  it('两个 Service 类的 injects/provides 各自独立', () => {
    const metaA: DecoratorMetadataObject = {}
    const metaB: DecoratorMetadataObject = {}

    class SA {}
    class SB {}

    // 模拟 @Inject 写入（使用 SERVICE_INJECTS symbol）
    metaA[SERVICE_INJECTS] = [{ propertyName: 'db', serviceKey: 'db' }]
    // metaB 无注入

    Service({ name: 'svc-injects-a' })(SA, makeClassCtx('SA', metaA))
    Service({ name: 'svc-injects-b' })(SB, makeClassCtx('SB', metaB))

    const entryA = serviceEntryRegistry.get('svc-injects-a')!
    const entryB = serviceEntryRegistry.get('svc-injects-b')!

    expect(entryA.injects).toHaveLength(1)
    expect(entryB.injects).toHaveLength(0)
  })
})

describe('CompositeHandlerMapping 边界输入', () => {
  it('空文本 getText() 返回 undefined 时 getHandler 不崩溃', () => {
    const mapping = new CompositeHandlerMapping()
    const ctx = new Context<any, any>({}, {}, {})
    expect(() => mapping.getHandler(ctx)).not.toThrow()
    expect(mapping.getHandler(ctx)).toBeUndefined()
  })

  it('极长文本输入不崩溃', () => {
    const mapping = new CompositeHandlerMapping()
    const longText = 'a'.repeat(100_000)
    const ctx = new Context<any, any>({ text: longText }, {}, { textExtractor: (e: any) => e.text })
    expect(() => mapping.getHandler(ctx)).not.toThrow()
  })

  it('特殊字符文本不崩溃', () => {
    const mapping = new CompositeHandlerMapping()
    const specialText = '/<>{}[]!@#$%^&*()~`\n\t\r'
    const ctx = new Context<any, any>(
      { text: specialText },
      {},
      { textExtractor: (e: any) => e.text },
    )
    expect(() => mapping.getHandler(ctx)).not.toThrow()
  })

  it('已注册命令处理器在正确前缀下匹配', () => {
    const instance = { handle: async () => {} }
    // CommandHandlerMapping 使用 trigger.cmd 和 trigger.aliases（Set）
    const handler = {
      instance,
      methodName: 'handle',
      handlerName: 'test',
      priority: 50,
      permission: 0,
      mappingType: 'command' as const,
      trigger: { cmd: 'hello', aliases: new Set<string>() },
      interceptors: [],
    }

    const mapping = new CompositeHandlerMapping('/')
    mapping.register(handler)

    const ctxMatch = new Context<any, any>(
      { text: '/hello' },
      {},
      { textExtractor: (e: any) => e.text },
    )
    const ctxNoMatch = new Context<any, any>(
      { text: '!hello' },
      {},
      { textExtractor: (e: any) => e.text },
    )

    expect(mapping.getHandler(ctxMatch)).toBeDefined()
    expect(mapping.getHandler(ctxNoMatch)).toBeUndefined()
  })

  it('空字符串命令不匹配任何注册的处理器', () => {
    const instance = { handle: async () => {} }
    const handler = {
      instance,
      methodName: 'handle',
      handlerName: 'test',
      priority: 50,
      permission: 0,
      mappingType: 'command' as const,
      trigger: { cmd: 'cmd', aliases: new Set<string>() },
      interceptors: [],
    }

    const mapping = new CompositeHandlerMapping('/')
    mapping.register(handler)

    const ctx = new Context<any, any>({ text: '' }, {}, { textExtractor: (e: any) => e.text })

    expect(mapping.getHandler(ctx)).toBeUndefined()
  })
})
