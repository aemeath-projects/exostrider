import { describe, it, expect, vi } from 'vitest'

import { Context } from '../../../src'
import { FinishError } from '../../../src/dispatch'

describe('Context', () => {
  it('getText() 通过 textExtractor 回调返回文本', () => {
    const ctx = new Context(
      { text: 'hello world' },
      {},
      { textExtractor: (event: { text: string }) => event.text },
    )
    expect(ctx.getText()).toBe('hello world')
  })

  it('getText() 无 extractor 时返回 undefined', () => {
    const ctx = new Context({ text: 'hello' }, {}, {})
    expect(ctx.getText()).toBeUndefined()
  })

  it('getArgs() 通过 argsExtractor 回调返回参数列表', () => {
    const ctx = new Context(
      { text: '/echo hello world' },
      {},
      {
        argsExtractor: (event: { text: string }, prefix: string) => {
          const text = event.text
          if (!text.startsWith(prefix)) return undefined
          const parts = text.split(/\s+/)
          return parts.slice(1)
        },
        commandPrefix: '/',
      },
    )
    expect(ctx.getArgs()).toEqual(['hello', 'world'])
  })

  it('getArgs() 无 argsExtractor 时返回 undefined', () => {
    const ctx = new Context({ text: '/echo hello' }, {}, {})
    expect(ctx.getArgs()).toBeUndefined()
  })

  it('getArgs() 使用默认 commandPrefix "/"', () => {
    const ctx = new Context(
      { text: '/test arg1' },
      {},
      {
        argsExtractor: (_event: unknown, prefix: string) => {
          // 验证默认 prefix 是 "/"
          expect(prefix).toBe('/')
          return ['arg1']
        },
      },
    )
    ctx.getArgs()
  })

  it('finish() 抛出 FinishError', () => {
    const ctx = new Context({}, {}, {})
    expect(() => ctx.finish()).toThrow(FinishError)
    expect(() => ctx.finish()).toThrow(FinishError)
  })

  it('finish() 支持自定义消息', () => {
    const ctx = new Context({}, {}, {})
    expect(() => ctx.finish('stopping')).toThrow('stopping')
  })

  it('reply() 调用 replyHandler', async () => {
    const replyHandler = vi.fn().mockResolvedValue(undefined)
    const ctx = new Context({}, {}, { replyHandler })
    await ctx.reply('test message')
    expect(replyHandler).toHaveBeenCalledOnce()
    expect(replyHandler).toHaveBeenCalledWith(ctx, 'test message')
  })

  it('reply() 无 replyHandler 时为空操作', async () => {
    const ctx = new Context({}, {}, {})
    await expect(ctx.reply('test')).resolves.toBeUndefined()
  })

  it('getAttribute/setAttribute 存储/获取属性值', () => {
    const ctx = new Context({}, {}, {})
    ctx.setAttribute('userId', 12345)
    ctx.setAttribute('role', 'admin')
    expect(ctx.getAttribute<number>('userId')).toBe(12345)
    expect(ctx.getAttribute<string>('role')).toBe('admin')
    expect(ctx.getAttribute('nonExistent')).toBeUndefined()
  })

  it('attributes 属性映射可直接访问', () => {
    const ctx = new Context({}, {}, {})
    ctx.attributes.set('key', 'value')
    expect(ctx.attributes.get('key')).toBe('value')
  })

  it('regexMatch 初始为 null，可赋值', () => {
    const ctx = new Context({}, {}, {})
    expect(ctx.regexMatch).toBeNull()
    const match = /hello/.exec('hello')
    ctx.regexMatch = match
    expect(ctx.regexMatch).toBe(match)
  })

  it('scope 初始为 undefined，可赋值', () => {
    const ctx = new Context({}, {}, {})
    expect(ctx.scope).toBeUndefined()
    ctx.scope = 'group'
    expect(ctx.scope).toBe('group')
  })

  it('event 和 apis 通过构造函数注入', () => {
    const event = { postType: 'message', text: 'hello' }
    const apis = { sendMsg: () => {} }
    const ctx = new Context(event, apis, {})
    expect(ctx.event).toBe(event)
    expect(ctx.apis).toBe(apis)
  })
})
