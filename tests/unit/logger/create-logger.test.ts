import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger, detectAnsiSupport, logBroadcaster } from '../../../src/logger'

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

describe('windowsCompat 选项', () => {
  it('windowsCompat: false 时正常创建 logger', () => {
    const log = createLogger({ format: 'console', windowsCompat: false })
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
  })

  it('windowsCompat: true 时正常创建 logger', () => {
    const log = createLogger({ format: 'console', windowsCompat: true })
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
  })

  it("windowsCompat: 'auto' 时正常创建 logger", () => {
    const log = createLogger({ format: 'console', windowsCompat: 'auto' })
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
  })

  it('windowsCompat 不影响 json 格式 logger', () => {
    const log = createLogger({ format: 'json', windowsCompat: false })
    expect(log).toBeDefined()
  })
})

describe('detectAnsiSupport', () => {
  const ENV_KEYS = ['NO_COLOR', 'TERM', 'FORCE_COLOR', 'WT_SESSION', 'TERM_PROGRAM'] as const
  let saved: Record<string, string | undefined>

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    ENV_KEYS.forEach((k) => Reflect.deleteProperty(process.env, k))
  })

  afterEach(() => {
    ENV_KEYS.forEach((k) => {
      if (saved[k] === undefined) Reflect.deleteProperty(process.env, k)
      else process.env[k] = saved[k]
    })
  })

  it('NO_COLOR 设置时返回 false', () => {
    process.env.NO_COLOR = '1'
    expect(detectAnsiSupport()).toBe(false)
  })

  it('TERM=dumb 时返回 false', () => {
    process.env.TERM = 'dumb'
    expect(detectAnsiSupport()).toBe(false)
  })

  it('NO_COLOR 优先于 FORCE_COLOR', () => {
    process.env.NO_COLOR = '1'
    process.env.FORCE_COLOR = '1'
    expect(detectAnsiSupport()).toBe(false)
  })

  it('FORCE_COLOR 设置时返回 true', () => {
    process.env.FORCE_COLOR = '1'
    expect(detectAnsiSupport()).toBe(true)
  })

  it('WT_SESSION 设置时返回 true（Windows Terminal）', () => {
    process.env.WT_SESSION = 'session-id'
    expect(detectAnsiSupport()).toBe(true)
  })

  it('TERM_PROGRAM 设置时返回 true（VS Code / iTerm2）', () => {
    process.env.TERM_PROGRAM = 'vscode'
    expect(detectAnsiSupport()).toBe(true)
  })

  it('stdout.hasColors() 返回 true 时结果为 true', () => {
    Object.defineProperty(process.stdout, 'hasColors', {
      value: vi.fn().mockReturnValue(true),
      configurable: true,
      writable: true,
    })
    expect(detectAnsiSupport()).toBe(true)
    delete (process.stdout as unknown as Record<string, unknown>).hasColors
  })

  it('stdout.hasColors() 返回 false 时结果为 false', () => {
    Object.defineProperty(process.stdout, 'hasColors', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
      writable: true,
    })
    expect(detectAnsiSupport()).toBe(false)
    delete (process.stdout as unknown as Record<string, unknown>).hasColors
  })

  it('stdout.hasColors 不存在时回退为 false', () => {
    // 测试环境中 process.stdout 通常是管道（非 TTY），hasColors 可能不存在
    const saved = (process.stdout as unknown as Record<string, unknown>).hasColors
    delete (process.stdout as unknown as Record<string, unknown>).hasColors
    expect(detectAnsiSupport()).toBe(false)
    if (saved !== undefined) {
      Object.defineProperty(process.stdout, 'hasColors', {
        value: saved,
        configurable: true,
        writable: true,
      })
    }
  })
})
