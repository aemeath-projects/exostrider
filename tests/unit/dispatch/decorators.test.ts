import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  Handler,
  Interceptor,
  OnCommand,
  OnKeyword,
  OnRegex,
  OnStartsWith,
  OnEndsWith,
  OnFullMatch,
  OnEvent,
  HANDLER_METHODS,
  HANDLER_CLASS_INTERCEPTORS,
  handlerRegistry,
} from '../../../src/dispatch'
import { Permission, Scope, Priority } from '../../../src/dispatch/decorators'

/**
 * 注意：测试使用函数调用风格（非装饰器语法），
 * 以避免 oxc/ts-node 的装饰器限制。
 */

describe('@Handler', () => {
  beforeEach(() => {
    handlerRegistry.clear()
  })

  afterEach(() => {
    handlerRegistry.clear()
  })

  it('Handler 装饰器将类注册到 handlerRegistry', () => {
    class EchoHandler {}

    const metadata: DecoratorMetadataObject = {}
    const context: ClassDecoratorContext = {
      kind: 'class',
      name: 'EchoHandler',
      metadata,
      addInitializer: () => {},
    }

    Handler({ name: 'echo', displayName: '回声', description: '复读功能' })(EchoHandler, context)

    expect(handlerRegistry.has('echo')).toBe(true)
    const data = handlerRegistry.get('echo')
    expect(data?.options.name).toBe('echo')
    expect(data?.options.displayName).toBe('回声')
    expect(data?.handlerClass).toBe(EchoHandler)
  })

  it('Handler 重复注册时覆盖', () => {
    class H1 {}
    class H2 {}

    const ctx1: ClassDecoratorContext = {
      kind: 'class',
      name: 'H1',
      metadata: {},
      addInitializer: () => {},
    }
    const ctx2: ClassDecoratorContext = {
      kind: 'class',
      name: 'H2',
      metadata: {},
      addInitializer: () => {},
    }

    Handler({ name: 'same' })(H1, ctx1)
    Handler({ name: 'same' })(H2, ctx2)

    expect(handlerRegistry.size).toBe(1)
    expect(handlerRegistry.get('same')?.handlerClass).toBe(H2)
  })

  it('Handler 抛出错误当 metadata 不可用', () => {
    class BadHandler {}
    const context: ClassDecoratorContext = {
      kind: 'class',
      name: 'BadHandler',
      // @ts-expect-error 故意传 null 来触发错误
      metadata: null,
      addInitializer: () => {},
    }

    expect(() => Handler({ name: 'bad' })(BadHandler, context)).toThrow('@Handler')
  })

  it('Handler 填充 methods 的默认优先级', () => {
    class EchoHandler {}

    const methods = [
      {
        methodName: 'handle',
        mappingType: 'command' as const,
        trigger: { cmd: 'echo', aliases: undefined },
        permission: 0,
        scope: 'all',
        priority: null as unknown as number,
        interceptors: [],
      },
    ]

    const metadata: DecoratorMetadataObject = { [HANDLER_METHODS]: methods }
    const context: ClassDecoratorContext = {
      kind: 'class',
      name: 'EchoHandler',
      metadata,
      addInitializer: () => {},
    }

    Handler({ name: 'echo', defaultPriority: 99 })(EchoHandler, context)

    const data = handlerRegistry.get('echo')
    expect(data?.methods[0].priority).toBe(99)
  })
})

describe('路由装饰器', () => {
  it('@OnCommand 设置 mappingType 和 trigger', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    OnCommand('echo', { aliases: ['回声'] })(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as {
      mappingType: string
      trigger: Record<string, unknown>
    }[]
    expect(methods).toHaveLength(1)
    expect(methods[0].mappingType).toBe('command')
    expect(methods[0].trigger.cmd).toBe('echo')
    expect(methods[0].trigger.aliases).toBeInstanceOf(Set)
    expect((methods[0].trigger.aliases as Set<string>).has('回声')).toBe(true)
  })

  it('@OnCommand 无别名时 aliases 为 undefined', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    OnCommand('test')(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as { trigger: Record<string, unknown> }[]
    expect(methods[0].trigger.aliases).toBeUndefined()
  })

  it('@OnKeyword 设置 keywords trigger', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    OnKeyword(['hello', 'world'])(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as {
      mappingType: string
      trigger: Record<string, unknown>
    }[]
    expect(methods[0].mappingType).toBe('keyword')
    expect(methods[0].trigger.keywords).toBeInstanceOf(Set)
    expect((methods[0].trigger.keywords as Set<string>).has('hello')).toBe(true)
  })

  it('@OnRegex 设置 compiledPattern', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    const pattern = /hello (\w+)/i
    OnRegex(pattern)(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as {
      mappingType: string
      trigger: Record<string, unknown>
    }[]
    expect(methods[0].mappingType).toBe('regex')
    expect(methods[0].trigger.compiledPattern).toBe(pattern)
  })

  it('@OnStartsWith 设置 prefix', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    OnStartsWith('!cmd')(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as {
      mappingType: string
      trigger: Record<string, unknown>
    }[]
    expect(methods[0].mappingType).toBe('startswith')
    expect(methods[0].trigger.prefix).toBe('!cmd')
  })

  it('@OnEndsWith 设置 suffix', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    OnEndsWith('吗？')(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as {
      mappingType: string
      trigger: Record<string, unknown>
    }[]
    expect(methods[0].mappingType).toBe('endswith')
    expect(methods[0].trigger.suffix).toBe('吗？')
  })

  it('@OnFullMatch 设置 text', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    OnFullMatch('你好')(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as {
      mappingType: string
      trigger: Record<string, unknown>
    }[]
    expect(methods[0].mappingType).toBe('fullmatch')
    expect(methods[0].trigger.text).toBe('你好')
  })

  it('@OnEvent 设置 matchConfig', () => {
    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    const config = { postType: 'notice', noticeType: 'friend_add' }
    OnEvent(config)(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as {
      mappingType: string
      trigger: Record<string, unknown>
    }[]
    expect(methods[0].mappingType).toBe('event')
    expect(methods[0].trigger.matchConfig).toEqual(config)
  })
})

describe('方法选项装饰器', () => {
  function makeMethodContext(name = 'handle'): ClassMethodDecoratorContext {
    const metadata: DecoratorMetadataObject = {}
    return {
      kind: 'method',
      name,
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }
  }

  it('@Permission 设置 permission 等级', () => {
    const ctx = makeMethodContext()
    Permission(20)(function () {}, ctx)

    const methods = ctx.metadata[HANDLER_METHODS] as { permission: number }[]
    expect(methods[0].permission).toBe(20)
  })

  it('@Scope 设置 scope', () => {
    const ctx = makeMethodContext()
    Scope('group')(function () {}, ctx)

    const methods = ctx.metadata[HANDLER_METHODS] as { scope: string }[]
    expect(methods[0].scope).toBe('group')
  })

  it('@Priority 设置 priority', () => {
    const ctx = makeMethodContext()
    Priority(10)(function () {}, ctx)

    const methods = ctx.metadata[HANDLER_METHODS] as { priority: number }[]
    expect(methods[0].priority).toBe(10)
  })

  it('多个装饰器作用于同一方法时共享同一个 entry', () => {
    const ctx = makeMethodContext()
    OnCommand('test')(function () {}, ctx)
    Permission(30)(function () {}, ctx)
    Scope('private')(function () {}, ctx)

    const methods = ctx.metadata[HANDLER_METHODS] as {
      permission: number
      scope: string
      mappingType: string
    }[]
    expect(methods).toHaveLength(1) // 只有一个 entry
    expect(methods[0].permission).toBe(30)
    expect(methods[0].scope).toBe('private')
    expect(methods[0].mappingType).toBe('command')
  })
})

describe('@Interceptor', () => {
  it('类级 @Interceptor 存入 HANDLER_CLASS_INTERCEPTORS', () => {
    class MyInterceptor {}

    const metadata: DecoratorMetadataObject = {}
    const context: ClassDecoratorContext = {
      kind: 'class',
      name: 'Cls',
      metadata,
      addInitializer: () => {},
    }

    Interceptor(MyInterceptor)(class {}, context)

    const interceptors = metadata[HANDLER_CLASS_INTERCEPTORS] as { interceptorClass: unknown }[]
    expect(interceptors).toHaveLength(1)
    expect(interceptors[0].interceptorClass).toBe(MyInterceptor)
  })

  it('方法级 @Interceptor 存入对应 method entry 的 interceptors', () => {
    class MyInterceptor {}

    const metadata: DecoratorMetadataObject = {}
    const context: ClassMethodDecoratorContext = {
      kind: 'method',
      name: 'handle',
      static: false,
      private: false,
      access: { has: () => true, get: () => () => {} },
      metadata,
      addInitializer: () => {},
    }

    Interceptor(MyInterceptor)(function () {}, context)

    const methods = metadata[HANDLER_METHODS] as { interceptors: { interceptorClass: unknown }[] }[]
    expect(methods[0].interceptors[0].interceptorClass).toBe(MyInterceptor)
  })
})
