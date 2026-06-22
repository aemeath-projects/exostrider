import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import { InMemoryLockProvider } from '../../../src/session'
import { getCancelCommands, getConfirmCommands } from '../../../src/session/lock'

describe('InMemoryLockProvider', () => {
  let provider: InMemoryLockProvider

  beforeEach(() => {
    provider = new InMemoryLockProvider()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquire 未持有的 key 返回 true', async () => {
    const result = await provider.acquire('test-key', 5000)
    expect(result).toBe(true)
  })

  it('acquire 已持有的 key 返回 false', async () => {
    await provider.acquire('test-key', 5000)
    const result = await provider.acquire('test-key', 5000)
    expect(result).toBe(false)
  })

  it('release 后可以重新 acquire', async () => {
    await provider.acquire('test-key', 5000)
    await provider.release('test-key')
    const result = await provider.acquire('test-key', 5000)
    expect(result).toBe(true)
  })

  it('TTL 过期后可以重新 acquire', async () => {
    vi.useFakeTimers()
    await provider.acquire('test-key', 1000) // 1 秒

    // 推进时间 1001ms，使 TTL 过期
    vi.advanceTimersByTime(1001)

    const result = await provider.acquire('test-key', 1000)
    expect(result).toBe(true)
  })

  it('TTL 未过期时无法 acquire', async () => {
    vi.useFakeTimers()
    await provider.acquire('test-key', 5000) // 5 秒

    // 推进时间 2000ms，TTL 未过期
    vi.advanceTimersByTime(2000)

    const result = await provider.acquire('test-key', 5000)
    expect(result).toBe(false)
  })

  it('cleanup 清理匹配前缀的所有 key', async () => {
    await provider.acquire('session:user:1', 5000)
    await provider.acquire('session:user:2', 5000)
    await provider.acquire('other:key', 5000)

    await provider.cleanup('session:*')

    // session:user:1 和 session:user:2 应被清理
    expect(await provider.acquire('session:user:1', 5000)).toBe(true)
    expect(await provider.acquire('session:user:2', 5000)).toBe(true)
    // other:key 应保留
    expect(await provider.acquire('other:key', 5000)).toBe(false)
  })

  it('不同 key 之间互不影响', async () => {
    await provider.acquire('key-a', 5000)
    const resultB = await provider.acquire('key-b', 5000)
    expect(resultB).toBe(true)
  })

  it('release 不存在的 key 不报错', async () => {
    await expect(provider.release('nonexistent')).resolves.toBeUndefined()
  })
})

describe('getCancelCommands', () => {
  it('使用默认取消命令', () => {
    const cmds = getCancelCommands({ sessionTimeout: 60 })
    expect(cmds.has('/取消')).toBe(true)
    expect(cmds.has('/cancel')).toBe(true)
  })

  it('使用自定义取消命令', () => {
    const cmds = getCancelCommands({ sessionTimeout: 60, cancelCommands: ['/quit'] })
    expect(cmds.has('/quit')).toBe(true)
    expect(cmds.has('/取消')).toBe(false)
  })
})

describe('getConfirmCommands', () => {
  it('使用默认确认命令', () => {
    const cmds = getConfirmCommands({ sessionTimeout: 60 })
    expect(cmds.has('/确认')).toBe(true)
    expect(cmds.has('/confirm')).toBe(true)
  })

  it('使用自定义确认命令', () => {
    const cmds = getConfirmCommands({ sessionTimeout: 60, confirmCommands: ['/ok', '/yes'] })
    expect(cmds.has('/ok')).toBe(true)
    expect(cmds.has('/yes')).toBe(true)
    expect(cmds.has('/确认')).toBe(false)
  })
})
