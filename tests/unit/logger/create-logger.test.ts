import { describe, it, expect } from 'vitest'

import { createLogger, logBroadcaster } from '../../../src/logger'

describe('createLogger', () => {
  it('使用默认选项创建 logger', () => {
    const log = createLogger()
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
  })

  it('应遵循 level 选项', () => {
    const log = createLogger({ level: 'warn' })
    expect(log.level).toBe('warn')
  })

  it('创建 json 格式 logger', () => {
    const log = createLogger({ format: 'json' })
    expect(log).toBeDefined()
  })

  it('创建 console 格式 logger', () => {
    const log = createLogger({ format: 'console' })
    expect(log).toBeDefined()
  })

  it('支持 redact 选项', () => {
    const log = createLogger({ redact: ['password', 'secret'] })
    expect(log).toBeDefined()
  })

  it('支持 base 字段', () => {
    const log = createLogger({ base: { app: 'test' } })
    expect(log).toBeDefined()
  })

  it('json 格式下广播日志条目', async () => {
    const received: unknown[] = []
    const listener = (entry: unknown) => received.push(entry)
    logBroadcaster.on('log', listener)

    const log = createLogger({ format: 'json', level: 'info' })
    log.info({ testKey: 'testVal' }, 'hello broadcast')

    // 等待异步写入完成
    await new Promise((r) => setTimeout(r, 50))

    logBroadcaster.off('log', listener)
    expect(received.length).toBeGreaterThan(0)
  })
})
