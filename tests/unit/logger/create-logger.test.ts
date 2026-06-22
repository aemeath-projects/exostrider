import { describe, it, expect } from 'vitest'

import { createLogger, logBroadcaster } from '../../../src/logger'

describe('createLogger', () => {
  it('should create a logger with default options', () => {
    const log = createLogger()
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
  })

  it('should respect level option', () => {
    const log = createLogger({ level: 'warn' })
    expect(log.level).toBe('warn')
  })

  it('should create json format logger', () => {
    const log = createLogger({ format: 'json' })
    expect(log).toBeDefined()
  })

  it('should create console format logger', () => {
    const log = createLogger({ format: 'console' })
    expect(log).toBeDefined()
  })

  it('should support redact option', () => {
    const log = createLogger({ redact: ['password', 'secret'] })
    expect(log).toBeDefined()
  })

  it('should support base fields', () => {
    const log = createLogger({ base: { app: 'test' } })
    expect(log).toBeDefined()
  })

  it('should broadcast log entries in json format', async () => {
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
