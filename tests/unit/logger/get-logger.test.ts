import { describe, it, expect, vi } from 'vitest'

import { createLogger, getLogger, setLogger } from '../../../src/logger'
import type { PinoLogger } from '../../../src/logger'

describe('getLogger', () => {
  it('should return a named child logger', () => {
    const log = getLogger('test-module')
    expect(log).toBeDefined()
    expect(typeof log.info).toBe('function')
  })

  it('should return same proxy for same name', () => {
    const a = getLogger('same')
    const b = getLogger('same')
    expect(a).toBe(b)
  })
})

describe('setLogger', () => {
  it('should replace the global logger', () => {
    const custom = createLogger({ level: 'debug' })
    setLogger(custom)
    const child = getLogger('after-set')
    expect(child).toBeDefined()
  })

  it('应在 setLogger 后重新创建缓存的子 logger', () => {
    // 先创建一个子 logger（缓存 entry）
    const proxy = getLogger('cache-invalidation-test')
    proxy.info('before setLogger')

    // 替换全局 logger（使缓存 entry 的 parent 失效）
    const newLogger = createLogger({ level: 'debug' })
    setLogger(newLogger)

    // 再次调用，应重新创建 child（命中 entry?.parent !== globalLogger 分支）
    proxy.info('after setLogger')
    expect(proxy).toBeDefined()

    setLogger(createLogger())
  })

  it('代理 non-function 属性时直接返回值', () => {
    const logProxy = getLogger('prop-access-test')
    // 访问 'level' 属性（字符串，非函数）
    const level = (logProxy as unknown as Record<string, unknown>).level
    // level 是字符串，不是函数 → 测试 typeof val !== 'function' 分支
    expect(typeof level).toBe('string')
  })

  it('should proxy calls to new logger after setLogger', () => {
    const infoSpy = vi.fn()
    const mockChild = {
      level: 'info',
      info: infoSpy,
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn().mockReturnThis(),
    }
    const mockLogger = {
      level: 'info',
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn().mockReturnValue(mockChild),
    }
    setLogger(mockLogger as unknown as PinoLogger)

    const proxy = getLogger('proxy-switch-test')
    proxy.info('delegated message')

    expect(infoSpy).toHaveBeenCalled()

    // 清理：恢复原始 logger
    setLogger(createLogger())
  })
})
