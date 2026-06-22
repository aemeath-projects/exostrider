import { describe, it, expect, vi } from 'vitest'

import { SessionContext } from '../../../src/session'

describe('SessionContext', () => {
  it('original 持有原始上下文', () => {
    const raw = { userId: 123, text: 'hello' }
    const ctx = new SessionContext(raw)
    expect(ctx.original).toBe(raw)
  })

  it('data 是可读写的 Map', () => {
    const ctx = new SessionContext('ctx')
    ctx.data.set('name', '测试用户')
    expect(ctx.data.get('name')).toBe('测试用户')
  })

  it('data 初始为空 Map', () => {
    const ctx = new SessionContext({})
    expect(ctx.data.size).toBe(0)
  })

  it('reply 调用注入的回调', async () => {
    const replyFn = vi.fn().mockResolvedValue(undefined)
    const ctx = new SessionContext('ctx', { reply: replyFn })
    await ctx.reply('你好')
    expect(replyFn).toHaveBeenCalledWith('你好')
  })

  it('reply 传递复杂对象给回调', async () => {
    const replyFn = vi.fn().mockResolvedValue(undefined)
    const ctx = new SessionContext('ctx', { reply: replyFn })
    const message = { type: 'text', content: 'hello' }
    await ctx.reply(message)
    expect(replyFn).toHaveBeenCalledWith(message)
  })

  it('无 replyFn 时 reply 静默不报错', async () => {
    const ctx = new SessionContext('ctx')
    await expect(ctx.reply('hello')).resolves.toBeUndefined()
  })

  it('不同 SessionContext 实例的 data 互相独立', () => {
    const ctx1 = new SessionContext('ctx1')
    const ctx2 = new SessionContext('ctx2')
    ctx1.data.set('key', 'value1')
    expect(ctx2.data.has('key')).toBe(false)
  })
})
