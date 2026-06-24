import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLogger, detectAnsiSupport, logBroadcaster } from '../../../src/logger'

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

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
  it('console 格式输出 Spring Boot 风格日志行', async () => {
    const writes: Buffer[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    })

    const log = createLogger({ format: 'console', level: 'info', windowsCompat: false })
    log.info('hello spring')

    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const output = Buffer.concat(writes).toString()
    // yyyy-MM-dd HH:mm:ss.SSS INFO  [] : hello spring
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}\.\d{3}\s/)
    expect(output).toContain(': hello spring')
    // 不含旧的 --- [main] 片段
    expect(output).not.toContain('---')
  })

  it('console 格式额外键值对同行展开、不换行', async () => {
    const writes: Buffer[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    })

    const log = createLogger({ format: 'console', level: 'info', windowsCompat: false })
    log.info({ key1: 'val1', key2: 42 }, 'with extras')

    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const output = stripAnsi(Buffer.concat(writes).toString())
    // 键值对应在消息之后、同一行内
    expect(output).toMatch(/with extras .*key1=val1.*key2=42/)
    // 不应换行拆分键值对
    expect(output.split('\n').length).toBeLessThanOrEqual(2) // 仅尾部 \n
  })

  it('console 格式不过滤标准字段，不泄漏为键值对', async () => {
    const writes: Buffer[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    })

    const log = createLogger({ format: 'console', level: 'info', windowsCompat: false })
    log.info({ module: 'shouldNotLeak', time: 999, level: 'secret' }, 'clean')

    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const output = Buffer.concat(writes).toString()
    // 标准字段不应该以 key=value 形式出现在尾部
    expect(output).not.toMatch(/\smodule=shouldNotLeak/)
    expect(output).not.toMatch(/\stime=999/)
    expect(output).not.toMatch(/\slevel=secret/)
  })

  it('console 格式 base 字段作为键值对展开', async () => {
    const writes: Buffer[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    })

    const log = createLogger({
      format: 'console',
      level: 'info',
      windowsCompat: false,
      base: { app: 'test' },
    })
    log.info('base check')

    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const output = stripAnsi(Buffer.concat(writes).toString())
    expect(output).toContain('app=test')
  })

  it('console 格式 object 值 JSON 序列化', async () => {
    const writes: Buffer[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    })

    const log = createLogger({ format: 'console', level: 'info', windowsCompat: false })
    log.info({ nested: { a: 1, b: 'two' } }, 'object val')

    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const output = stripAnsi(Buffer.concat(writes).toString())
    expect(output).toContain('nested={"a":1,"b":"two"}')
  })

  it('console 格式 null/undefined 值跳过不输出', async () => {
    const writes: Buffer[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    })

    const log = createLogger({ format: 'console', level: 'info', windowsCompat: false })
    log.info({ present: 'yes', missing: null, gone: undefined }, 'skip nulls')

    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const output = stripAnsi(Buffer.concat(writes).toString())
    expect(output).toContain('present=yes')
    expect(output).not.toMatch(/\smissing=null/)
    expect(output).not.toMatch(/\sgone=undefined/)
  })

  it('console 格式键值对 cyan/yellow 着色', async () => {
    const writes: Buffer[] = []
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return true
    })

    // windowsCompat: false → colorize=true
    const log = createLogger({ format: 'console', level: 'info', windowsCompat: false })
    log.info({ colored: 'yes' }, 'kv color test')

    await new Promise((r) => setTimeout(r, 50))
    spy.mockRestore()

    const output = Buffer.concat(writes).toString()
    // key 用青色 \x1b[36m，value 用黄色 \x1b[33m
    expect(output).toContain('\x1b[36mcolored\x1b[0m=\x1b[33myes\x1b[0m')
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
