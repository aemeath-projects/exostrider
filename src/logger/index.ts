/** Pino 日志工厂 —— 支持 JSON 或 Spring Boot 风格 console 格式输出，并提供全局具名子 logger。 */

import { execSync } from 'node:child_process'
import { Writable } from 'node:stream'

import pino from 'pino'
import type { Logger as PinoLogger } from 'pino'

import type { Logger } from '../types'

import { LogBroadcaster } from './broadcast'
import type { LogEntry } from './broadcast'

export type LogFormat = 'json' | 'console'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'
/** Windows 终端兼容层行为控制。 */
export type WindowsCompatMode = boolean | 'auto'

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
  /**
   * Windows 终端兼容层：将控制台代码页切换为 UTF-8（`chcp 65001`），
   * 并按终端能力自动决定是否启用 ANSI 着色。仅在 `format: 'console'` 时生效。
   *
   * - `'auto'`（默认）：Windows 平台自动启用，其他平台不干预
   * - `true`：强制启用（chcp 仍仅在 Windows 执行，其他平台仅做 ANSI 检测）
   * - `false`：关闭兼容层（colorize: true）
   */
  windowsCompat?: WindowsCompatMode
}

/** 全局日志广播器单例，供消费者（如 SSE 端点）订阅实时日志流。 */
export const logBroadcaster = new LogBroadcaster()

/**
 * 检测当前终端是否支持 ANSI 转义序列（颜色输出）。
 *
 * 优先遵循 `NO_COLOR` / `FORCE_COLOR` 等标准环境变量，
 * 再检测已知支持 ANSI 的终端标识，最后通过 `process.stdout.hasColors()` 兜底。
 */
export function detectAnsiSupport(): boolean {
  if (process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') return false
  if (process.env.FORCE_COLOR !== undefined) return true
  if (process.env.WT_SESSION !== undefined) return true // Windows Terminal
  if (process.env.TERM_PROGRAM !== undefined) return true // VS Code / iTerm2 等
  return (process.stdout as { hasColors?: () => boolean }).hasColors?.() ?? false
}

/** 应用 Windows 兼容层，返回 console 模式应使用的 colorize 值。 */
function applyWindowsCompat(mode: WindowsCompatMode = 'auto'): boolean {
  const active = mode === true || (mode === 'auto' && process.platform === 'win32')
  if (!active) return true

  if (process.platform === 'win32') {
    try {
      execSync('chcp 65001', { stdio: 'pipe' })
    } catch {
      // CI 或受限沙箱下 chcp 可能不可用，静默忽略
    }
  }

  return detectAnsiSupport()
}

/** 将 epoch 毫秒时间戳格式化为 Spring Boot 风格的 `yyyy-MM-dd HH:mm:ss.SSS`。 */
function formatTimestamp(epochMs: number): string {
  const d = new Date(epochMs)
  const yyyy = String(d.getFullYear())
  const MM = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const HH = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const SSS = String(d.getMilliseconds()).padStart(3, '0')
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}.${SSS}`
}

/** 安全地将任意值转为字符串，对象则 JSON 序列化。 */
function safeToString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  // number, boolean, bigint, symbol, function — String() is well-defined
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v)
}

/** ANSI 转义序列常量。 */
const ANSI_RESET = '\x1b[0m'
const ANSI_KV_KEY = '\x1b[36m' // cyan — 键名
const ANSI_KV_VAL = '\x1b[33m' // yellow — 键值
const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '\x1b[36m', // cyan
  INFO: '\x1b[32m', // green
  WARN: '\x1b[33m', // yellow
  ERROR: '\x1b[31m', // red
  FATAL: '\x1b[31m', // red
}

/** pino 日志级别数字 → 标签映射。 */
const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
}

/**
 * 将 pino 日志条目格式化为单行字符串。
 *
 * 格式：`yyyy-MM-dd HH:mm:ss.SSS LEVEL [module] : message key=val ...`
 * 额外键值对直接在同行尾部展开，key 染青色、value 染黄色。
 */
function formatSpringLine(log: Record<string, unknown>, colorize: boolean): string {
  const standardKeys = new Set([
    'level',
    'time',
    'pid',
    'hostname',
    'msg',
    'module',
    'name',
    'v',
    'ns',
  ])

  // 时间戳
  const time = formatTimestamp(log.time as number)

  // 日志级别（着色 + 5 字符对齐）
  const levelNum = log.level as number
  const levelRaw = LEVEL_LABELS[levelNum] ?? 'INFO'
  const levelPadded = levelRaw.padEnd(5)
  const levelDisplay = colorize
    ? `${LEVEL_COLORS[levelRaw] ?? ''}${levelPadded}${ANSI_RESET}`
    : levelPadded

  // 模块名
  const moduleName = safeToString(log.module ?? log.name ?? '')

  // 消息体
  const msg = safeToString(log.msg ?? '')

  // 收集额外键值对（过滤标准字段）
  const extraParts: string[] = []
  for (const [key, value] of Object.entries(log)) {
    if (standardKeys.has(key)) continue
    if (value === undefined || value === null) continue
    const strValue = safeToString(value)
    extraParts.push(
      colorize
        ? `${ANSI_KV_KEY}${key}${ANSI_RESET}=${ANSI_KV_VAL}${strValue}${ANSI_RESET}`
        : `${key}=${strValue}`,
    )
  }

  let line = `${time} ${levelDisplay} [${moduleName}] : ${msg}`
  if (extraParts.length > 0) {
    line += ' ' + extraParts.join(' ')
  }
  return line + '\n'
}

/**
 * 创建 Pino 日志实例。
 *
 * - `format: 'console'`：Spring Boot 风格彩色输出，适合开发环境
 * - `format: 'json'`（默认）：JSON 格式写入 stdout，同时广播到 logBroadcaster
 *
 * @param options - 日志配置项
 */
export function createLogger(options?: CreateLoggerOptions): PinoLogger {
  const { level = 'info', format = 'json', redact, base, windowsCompat } = options ?? {}

  if (format === 'console') {
    const colorize = applyWindowsCompat(windowsCompat)
    const springStream = new Writable({
      write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
        try {
          const log = JSON.parse(chunk.toString()) as Record<string, unknown>
          process.stdout.write(formatSpringLine(log, colorize))
        } catch /* c8 ignore next */ {
          // 非 JSON 数据直接透传（pino 始终输出 JSON，此分支为防御性代码）
          process.stdout.write(chunk)
        }
        callback()
      },
    })
    return pino({ level, redact, base }, springStream)
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
export { LogBroadcaster } from './broadcast'
export { runWithTrace, enterTrace, getTraceId } from './trace'
