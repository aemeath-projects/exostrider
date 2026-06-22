/**
 * Exostrider 门面类集成测试。
 */

import { describe, it, expect } from 'vitest'

import { Exostrider } from '../../src'
import type { ExostriderOptions } from '../../src'

describe('Exostrider facade', () => {
  it('should create with minimal config', () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: {
        contextConfig: {
          textExtractor: (event: Record<string, unknown>) => String(event.text ?? ''),
        },
      },
    })
    expect(exo.echo).toBeDefined()
    expect(exo.lifecycle).toBeDefined()
    expect(exo.dispatcher).toBeDefined()
    expect(exo.logger).toBeDefined()
    expect(exo.session).toBeUndefined()
  })

  it('should bootstrap with no handlers', async () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    await expect(exo.bootstrap()).resolves.toBeUndefined()
  })

  it('should dispatch event', async () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: {
        contextConfig: {
          textExtractor: (event: Record<string, unknown>) => String(event.text ?? ''),
        },
      },
    })
    await exo.bootstrap()
    // 无 handler 注册 —— 应静默返回
    await expect(exo.dispatch({ text: 'hello' }, {})).resolves.toBeUndefined()
  })

  it('should shutdown', async () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    await exo.bootstrap()
    await expect(exo.shutdown()).resolves.toBeUndefined()
  })

  it('should use provided CreateLoggerOptions', () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
      logger: { level: 'warn' },
    })
    expect(exo.logger.level).toBe('warn')
  })

  it('should create default logger when not provided', () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(exo.logger).toBeDefined()
    expect(typeof exo.logger.info).toBe('function')
  })

  it('should create session manager when session config provided', () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
      session: {
        config: { sessionTimeout: 60 },
        keyExtractor: () => 'key',
      },
    })
    expect(exo.session).toBeDefined()
  })

  it('should expose logBroadcaster', () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(exo.logBroadcaster).toBeDefined()
  })

  it('should accept a pre-built PinoLogger instance', async () => {
    const { createLogger } = await import('../../src/logger/index.js')
    const customLogger = createLogger({ level: 'error' })
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
      logger: customLogger,
    })
    // 传入的 logger 实例应被直接使用（引用相等）
    expect(exo.logger).toBe(customLogger)
    expect(exo.logger.level).toBe('error')
  })

  it('should expose handlerRegistry', () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(exo.handlerRegistry).toBeDefined()
    expect(typeof exo.handlerRegistry.size).toBe('number')
  })

  it('should expose registry (ServiceRegistry)', () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    expect(exo.registry).toBeDefined()
  })

  it('options type is satisfied by ExostriderOptions', () => {
    // 仅检查类型约束（编译期检查，运行时始终通过）
    const opts: ExostriderOptions = {
      echo: { config: { echoes: {} }, baseDir: '/tmp' },
      dispatch: { contextConfig: {} },
    }
    expect(opts).toBeDefined()
  })

  it('should dispatch silently before bootstrap', async () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    // bootstrap 前 —— 使用空映射的临时 dispatcher，不应抛出异常
    await expect(exo.dispatch({}, {})).resolves.toBeUndefined()
  })

  it('should have a properly built dispatcher after bootstrap', async () => {
    const exo = new Exostrider({
      echo: { config: { echoes: {} }, baseDir: process.cwd() },
      dispatch: { contextConfig: {} },
    })
    // bootstrap 前：dispatcher 为临时实例（_dispatcher === null）
    const preBootstrapDispatcher = exo.dispatcher
    expect(preBootstrapDispatcher).toBeDefined()

    await exo.bootstrap()

    // bootstrap 后：dispatcher 为正式实例，与 bootstrap 前的临时实例为不同对象
    const postBootstrapDispatcher = exo.dispatcher
    expect(postBootstrapDispatcher).toBeDefined()
    expect(postBootstrapDispatcher).not.toBe(preBootstrapDispatcher)
  })
})
