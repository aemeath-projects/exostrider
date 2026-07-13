import { describe, it, expect, beforeEach } from 'vitest'

import { HANDLER_METHODS, CompositeHandlerMapping, HandlerRegistry } from '../../../src/dispatch'
import type { HandlerRegistryData } from '../../../src/dispatch'
import { SERVICE_INJECTS } from '../../../src/lifecycle'

/** 创建测试用 HandlerRegistryData */
function makeRegistryData(
  name: string,
  methods: HandlerRegistryData['methods'] = [],
): HandlerRegistryData {
  const metadata: DecoratorMetadataObject = { [HANDLER_METHODS]: methods }
  return {
    options: { name },
    handlerClass: class TestHandler {},
    metadata,
    methods,
    classInterceptors: [],
  }
}

describe('HandlerRegistry', () => {
  let registry: HandlerRegistry

  beforeEach(() => {
    registry = new HandlerRegistry()
  })

  describe('register()', () => {
    it('注册 handler 后可通过 has() 确认', () => {
      const data = makeRegistryData('echo')
      registry.register(data)
      expect(registry.has('echo')).toBe(true)
    })

    it('重复注册同名 handler 时覆盖', () => {
      const data1 = makeRegistryData('echo')
      const data2 = makeRegistryData('echo')
      registry.register(data1)
      registry.register(data2)
      expect(registry.size).toBe(1)
      expect(registry.get('echo')).toBe(data2)
    })

    it('注册多个不同名 handler', () => {
      registry.register(makeRegistryData('echo'))
      registry.register(makeRegistryData('help'))
      registry.register(makeRegistryData('ping'))
      expect(registry.size).toBe(3)
    })
  })

  describe('get()', () => {
    it('获取已注册的 handler 数据', () => {
      const data = makeRegistryData('echo')
      registry.register(data)
      expect(registry.get('echo')).toBe(data)
    })

    it('获取未注册的 handler 返回 undefined', () => {
      expect(registry.get('unknown')).toBeUndefined()
    })
  })

  describe('unregister()', () => {
    it('注销已注册的 handler', () => {
      registry.register(makeRegistryData('echo'))
      registry.unregister('echo')
      expect(registry.has('echo')).toBe(false)
      expect(registry.size).toBe(0)
    })

    it('注销不存在的 handler 不报错', () => {
      expect(() => registry.unregister('nonexistent')).not.toThrow()
    })
  })

  describe('entries', () => {
    it('返回所有注册条目的只读视图', () => {
      const d1 = makeRegistryData('a')
      const d2 = makeRegistryData('b')
      registry.register(d1)
      registry.register(d2)
      expect(registry.entries).toHaveLength(2)
      expect(registry.entries).toContain(d1)
      expect(registry.entries).toContain(d2)
    })
  })

  describe('instantiate()', () => {
    it('无注入器时直接实例化', () => {
      registry.register(makeRegistryData('echo'))
      expect(() => registry.instantiate()).not.toThrow()
      expect(registry.getInstance('echo')).toBeDefined()
    })

    it('使用注入器注入依赖', () => {
      class ServicedHandler {
        myService?: { greet(): string }
      }

      // 必须使用 @Inject 装饰器写入时的同一个 SERVICE_INJECTS symbol（模块局部
      // Symbol()，而非 Symbol.for() 全局注册表 key），否则测试无法反映真实契约
      const metadata: DecoratorMetadataObject = {
        [SERVICE_INJECTS]: [{ propertyName: 'myService', serviceKey: 'greeter' }],
      }

      const data: HandlerRegistryData = {
        options: { name: 'serviced' },
        handlerClass: ServicedHandler,
        metadata,
        methods: [],
        classInterceptors: [],
      }

      const fakeService = { greet: () => 'Hello!' }
      registry.register(data)
      registry.instantiate((key) => {
        if (key === 'greeter') return fakeService
        return undefined
      })

      const instance = registry.getInstance('serviced') as ServicedHandler
      expect(instance.myService).toBe(fakeService)
    })

    it('多次调用 instantiate 重置实例', () => {
      registry.register(makeRegistryData('echo'))
      registry.instantiate()
      const first = registry.getInstance('echo')
      registry.instantiate()
      const second = registry.getInstance('echo')
      // 重新实例化，得到新实例
      expect(first).not.toBe(second)
    })
  })

  describe('buildMappings()', () => {
    it('返回 CompositeHandlerMapping 实例', () => {
      registry.register(makeRegistryData('echo'))
      registry.instantiate()
      const mapping = registry.buildMappings('/')
      expect(mapping).toBeInstanceOf(CompositeHandlerMapping)
    })

    it('空注册表也能构建映射', () => {
      const mapping = registry.buildMappings('/')
      expect(mapping).toBeInstanceOf(CompositeHandlerMapping)
      expect(mapping.handlerCount).toBe(0)
    })

    it('注册了方法的 handler 会被注册到映射', () => {
      class EchoHandler {
        handle() {}
      }

      const data: HandlerRegistryData = {
        options: { name: 'echo', defaultPriority: 50 },
        handlerClass: EchoHandler,
        metadata: {},
        methods: [
          {
            methodName: 'handle',
            mappingType: 'command',
            trigger: { cmd: 'echo', aliases: undefined },
            permission: 0,
            scope: 'all',
            priority: 50,
            interceptors: [],
            requiredBotCapability: null,
          },
        ],
        classInterceptors: [],
      }

      registry.register(data)
      registry.instantiate()
      const mapping = registry.buildMappings('/')
      expect(mapping.handlerCount).toBe(1)
    })
  })

  describe('clear()', () => {
    it('清除所有注册项', () => {
      registry.register(makeRegistryData('a'))
      registry.register(makeRegistryData('b'))
      registry.clear()
      expect(registry.size).toBe(0)
      expect(registry.has('a')).toBe(false)
    })
  })

  describe('instantiate() 边界情况', () => {
    it('注入器存在但 metadata 中无注入信息时正常工作', () => {
      registry.register(makeRegistryData('echo'))
      // 注入器存在，但 metadata 没有 symbol.for('service:injects')
      expect(() => registry.instantiate(() => undefined)).not.toThrow()
      expect(registry.getInstance('echo')).toBeDefined()
    })
  })

  describe('buildMappings() 边界情况', () => {
    it('未调用 instantiate 时 buildMappings 自动创建实例', () => {
      class EchoHandler {
        handle() {}
      }

      const data: HandlerRegistryData = {
        options: { name: 'auto', defaultPriority: 50 },
        handlerClass: EchoHandler,
        metadata: {},
        methods: [
          {
            methodName: 'handle',
            mappingType: 'command',
            trigger: { cmd: 'auto', aliases: undefined },
            permission: 0,
            scope: 'all',
            priority: null,
            interceptors: [],
            requiredBotCapability: null,
          },
        ],
        classInterceptors: [],
      }

      registry.register(data)
      // 不调用 instantiate，直接 buildMappings
      const mapping = registry.buildMappings('/')
      expect(mapping.handlerCount).toBe(1)
    })

    it('priority 为 null 时使用 defaultPriority', () => {
      class EchoHandler {
        handle() {}
      }

      const data: HandlerRegistryData = {
        options: { name: 'echo2' }, // 没有 defaultPriority，会使用 50
        handlerClass: EchoHandler,
        metadata: {},
        methods: [
          {
            methodName: 'handle',
            mappingType: 'command',
            trigger: { cmd: 'echo2', aliases: undefined },
            permission: 0,
            scope: 'all',
            priority: null,
            interceptors: [],
            requiredBotCapability: null,
          },
        ],
        classInterceptors: [],
      }

      registry.register(data)
      const mapping = registry.buildMappings('/')
      expect(mapping.handlerCount).toBe(1)
    })

    it('buildHandlerMethod 抛出时跳过该方法，不中断注册', () => {
      // 方法名存在但实例上没有该方法
      const data: HandlerRegistryData = {
        options: { name: 'broken' },
        handlerClass: class {},
        metadata: {},
        methods: [
          {
            methodName: 'nonexistent',
            mappingType: 'command',
            trigger: { cmd: 'x', aliases: undefined },
            permission: 0,
            scope: 'all',
            priority: 50,
            interceptors: [],
            requiredBotCapability: null,
          },
        ],
        classInterceptors: [],
      }
      registry.register(data)
      // 不应抛出错误，只是跳过 broken 的方法
      expect(() => registry.buildMappings('/')).not.toThrow()
    })
  })
})
