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
    settingNodes: [],
    ...overrides,
  }
}

describe('buildHandlerMethod', () => {
  it('正确构建 HandlerMethod', () => {
    class EchoHandler {
      handle() {}
    }
    const instance = new EchoHandler()
    const data = makeData('echo')

    const method = buildHandlerMethod(
      data,
      {
        methodName: 'handle',
        mappingType: 'command',
        trigger: { cmd: 'echo', aliases: undefined },
        permission: 0,
        scope: 'all',
        priority: 50,
        interceptors: [],
      },
      instance,
    )

    expect(method.handlerName).toBe('echo')
    expect(method.methodName).toBe('handle')
    expect(method.priority).toBe(50)
    expect(method.mappingType).toBe('command')
    expect(method.instance).toBe(instance)
  })

  it('合并 classInterceptors 和方法级 interceptors', () => {
    class Handler {
      handle() {}
    }
    const instance = new Handler()
    class CI {}
    class MI {}

    const data = makeData('test', {
      classInterceptors: [{ interceptorClass: CI }],
    })

    const method = buildHandlerMethod(
      data,
      {
        methodName: 'handle',
        mappingType: 'command',
        trigger: {},
        permission: 0,
        scope: 'all',
        priority: 50,
        interceptors: [{ interceptorClass: MI }],
      },
      instance,
    )

    expect(method.interceptors).toHaveLength(2)
    expect(method.interceptors[0].interceptorClass).toBe(CI)
    expect(method.interceptors[1].interceptorClass).toBe(MI)
  })

  it('方法不存在时抛出 Error', () => {
    const instance = {} // 没有 handle 方法
    const data = makeData('broken')

    expect(() =>
      buildHandlerMethod(
        data,
        {
          methodName: 'handle',
          mappingType: 'command',
          trigger: {},
          permission: 0,
          scope: 'all',
          priority: 50,
          interceptors: [],
        },
        instance,
      ),
    ).toThrow('broken')
  })
})
