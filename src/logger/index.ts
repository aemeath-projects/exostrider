/** Pino 日志工厂 —— 支持 JSON 或 pino-pretty 格式输出，并提供全局具名子 logger。 */

import { Writable } from 'node:stream'

import pino from 'pino'
import type { Logger as PinoLogger } from 'pino'
import pinoPretty from 'pino-pretty'

import type { Logger } from '../types'

import { LogBroadcaster } from './broadcast.js'
import type { LogEntry } from './broadcast.js'

export type LogFormat = 'json' | 'console'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'

/** createLogger 配置项。 */
export interface CreateLoggerOptions {
  /** 日志级别，默认 'info'。 */
  level?: LogLevel
  /** 输出格式：'json'（生产）或 'console'（开发），默认 'json'。 */
  format?: LogFormat
  /** 要从日志中遮蔽的字段路径列表。 */
  redact?: string[]
  /** 所有日志条目附带的基础字段。 */
  base?: Record<string, unknown>
}

/** 全局日志广播器单例，供消费者（如 SSE 端点）订阅实时日志流。 */
export const logBroadcaster = new LogBroadcaster()

/**
 * 创建 Pino 日志实例。
 *
 * - `format: 'console'`：通过 pino-pretty 彩色输出，适合开发环境
 * - `format: 'json'`（默认）：JSON 格式写入 stdout，同时广播到 logBroadcaster
 *
 * @param options - 日志配置项
 */
export function createLogger(options?: CreateLoggerOptions): PinoLogger {
  const { level = 'info', format = 'json', redact, base } = options ?? {}

  if (format === 'console') {
    const prettyStream = pinoPretty({ colorize: true })
    return pino({ level, redact, base }, prettyStream)
  }

  // JSON 模式：stdout + broadcast 双写
  const broadcastStream = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
      try {
        const entry = JSON.parse(chunk.toString()) as LogEntry
        logBroadcaster.broadcast(entry)
      } catch {
        // 忽略非 JSON 格式
      }
      callback()
    },
  })

  return pino(
    { level, redact, base },
    pino.multistream([{ stream: process.stdout }, { stream: broadcastStream }]),
  )
}

// 全局 logger 单例（应用启动前的临时 logger）
let globalLogger: PinoLogger = createLogger()

// 具名子 logger 缓存
const proxyCache = new Map<string, Logger>()
const childCache = new Map<string, { parent: PinoLogger; child: PinoLogger }>()

/**
 * 替换全局 logger。
 *
 * 调用后，所有通过 {@link getLogger} 获取的代理将自动切换到新 logger。
 */
export function setLogger(logger: PinoLogger): void {
  globalLogger = logger
  childCache.clear() // 清理旧的 child 实例缓存
}

/** 解析（或重新创建）具名子 logger，setLogger() 后自动跟随新 parent。 */
function resolveChild(name: string): PinoLogger {
  let entry = childCache.get(name)
  if (entry?.parent !== globalLogger) {
    entry = { parent: globalLogger, child: globalLogger.child({ module: name }) }
    childCache.set(name, entry)
  }
  return entry.child
}

/**
 * 获取具名子 logger 代理。
 *
 * 代理对象在 `setLogger()` 后自动委托到新的 parent logger，无需重新获取。
 * 相同 name 返回同一代理实例（引用相等）。
 *
 * @param name - 模块名，如 'scanner'、'Dispatcher'
 */
export function getLogger(name: string): Logger {
  const cached = proxyCache.get(name)
  if (cached !== undefined) return cached

  const proxy = new Proxy({} as Logger, {
    get(_target, prop: string) {
      const child = resolveChild(name)
      const val: unknown = Reflect.get(child, prop)
      return typeof val === 'function' ? (val as (...args: unknown[]) => unknown).bind(child) : val
    },
  })

  proxyCache.set(name, proxy)
  return proxy
}

export type { Logger, PinoLogger, LogEntry }
export { LogBroadcaster } from './broadcast.js'
