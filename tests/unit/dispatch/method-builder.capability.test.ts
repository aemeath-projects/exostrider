import { describe, it, expect } from 'vitest'

import { buildHandlerMethod } from '../../../src/dispatch'
import type { HandlerRegistryData } from '../../../src/dispatch'

function makeData(name: string, overrides: Partial<HandlerRegistryData> = {}): HandlerRegistryData {
  return {
    options: { name, defaultPriority: 50 },
    handlerClass: class {},
    metadata: {},
    methods: [],
    classInterceptors: [],
    ...overrides,
  }
}

describe('buildHandlerMethod - requiredBotCapability', () => {
  describe('capability 透传', () => {
    it('透传 group_admin 到 HandlerMethod', () => {
      const data = makeData('test_handler')
      const instance = { handleRevoke: async () => {} }

      const result = buildHandlerMethod(
        data,
        {
          methodName: 'handleRevoke',
          mappingType: 'command',
          trigger: {},
          permission: 0,
          scope: 'all',
          priority: 10,
          interceptors: [],
          requiredBotCapability: 'group_admin',
        },
        instance,
      )

      expect(result.requiredBotCapability).toBe('group_admin')
    })

    it('透传 group_owner 到 HandlerMethod', () => {
      const data = makeData('test_handler')
      const instance = { handleOwnerOnly: async () => {} }

      const result = buildHandlerMethod(
        data,
        {
          methodName: 'handleOwnerOnly',
          mappingType: 'command',
          trigger: {},
          permission: 0,
          scope: 'all',
          priority: 10,
          interceptors: [],
          requiredBotCapability: 'group_owner',
        },
        instance,
      )

      expect(result.requiredBotCapability).toBe('group_owner')
    })

    it('未声明能力时 requiredBotCapability 为 null', () => {
      const data = makeData('test_handler')
      const instance = { handleNormal: async () => {} }

      const result = buildHandlerMethod(
        data,
        {
          methodName: 'handleNormal',
          mappingType: 'command',
          trigger: {},
          permission: 0,
          scope: 'all',
          priority: 10,
          interceptors: [],
          requiredBotCapability: null,
        },
        instance,
      )

      expect(result.requiredBotCapability).toBeNull()
    })
  })

  describe('capability 与其他字段共存', () => {
    it('类级拦截器存在时 requiredBotCapability 字段不受影响', () => {
      class ClassInterceptor {}

      const data = makeData('test_handler', {
        classInterceptors: [{ interceptorClass: ClassInterceptor }],
      })
      const instance = { handle: async () => {} }

      const result = buildHandlerMethod(
        data,
        {
          methodName: 'handle',
          mappingType: 'command',
          trigger: {},
          permission: 0,
          scope: 'all',
          priority: 10,
          interceptors: [],
          requiredBotCapability: 'group_admin',
        },
        instance,
      )

      expect(result.requiredBotCapability).toBe('group_admin')
      expect(result.interceptors).toHaveLength(1)
    })

    it('方法级拦截器与 capability 同时存在时各字段独立', () => {
      class MethodInterceptor {}

      const data = makeData('test_handler')
      const instance = { handle: async () => {} }

      const result = buildHandlerMethod(
        data,
        {
          methodName: 'handle',
          mappingType: 'regex',
          trigger: { compiledPattern: /test/ },
          permission: 50,
          scope: 'group',
          priority: 20,
          interceptors: [{ interceptorClass: MethodInterceptor }],
          requiredBotCapability: 'group_owner',
        },
        instance,
      )

      expect(result.requiredBotCapability).toBe('group_owner')
      expect(result.interceptors).toHaveLength(1)
      expect(result.mappingType).toBe('regex')
      expect(result.permission).toBe(50)
    })
  })

  describe('多方法 capability 隔离', () => {
    it('同一 handler 的两个方法各自持有独立 capability，互不干扰', () => {
      const data = makeData('test_handler')
      const instance = { methodA: async () => {}, methodB: async () => {} }

      const methodA = buildHandlerMethod(
        data,
        {
          methodName: 'methodA',
          mappingType: 'command',
          trigger: {},
          permission: 0,
          scope: 'all',
          priority: 10,
          interceptors: [],
          requiredBotCapability: 'group_admin',
        },
        instance,
      )
      const methodB = buildHandlerMethod(
        data,
        {
          methodName: 'methodB',
          mappingType: 'command',
          trigger: {},
          permission: 0,
          scope: 'all',
          priority: 20,
          interceptors: [],
          requiredBotCapability: null,
        },
        instance,
      )

      expect(methodA.requiredBotCapability).toBe('group_admin')
      expect(methodB.requiredBotCapability).toBeNull()
    })

    it('不同 handler 的方法各自持有独立 capability', () => {
      const dataA = makeData('handler_a')
      const dataB = makeData('handler_b')
      const instanceA = { handle: async () => {} }
      const instanceB = { handle: async () => {} }

      const entry = {
        methodName: 'handle',
        mappingType: 'command' as const,
        trigger: {},
        permission: 0,
        scope: 'all',
        priority: 50,
        interceptors: [],
        requiredBotCapability: null,
      }

      const resultA = buildHandlerMethod(
        dataA,
        { ...entry, requiredBotCapability: 'group_owner' },
        instanceA,
      )
      const resultB = buildHandlerMethod(
        dataB,
        { ...entry, requiredBotCapability: 'group_admin' },
        instanceB,
      )

      expect(resultA.requiredBotCapability).toBe('group_owner')
      expect(resultB.requiredBotCapability).toBe('group_admin')
    })
  })
})
