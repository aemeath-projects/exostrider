/**
 * 会话锁提供者接口与内存实现。
 */

import { DEFAULT_CANCEL_COMMANDS, DEFAULT_CONFIRM_COMMANDS } from './commands.js'

/** 会话全局配置。 */
export interface SessionConfig {
  /** 会话超时秒数。 */
  readonly sessionTimeout: number
  /** 超时前提前多少秒发出警告（可选）。 */
  readonly warningBeforeTimeout?: number
  /** 取消命令列表，默认为 DEFAULT_CANCEL_COMMANDS。 */
  readonly cancelCommands?: readonly string[]
  /** 确认命令列表，默认为 DEFAULT_CONFIRM_COMMANDS。 */
  readonly confirmCommands?: readonly string[]
}

/** 获取生效的取消命令集合。 */
export function getCancelCommands(config: SessionConfig): ReadonlySet<string> {
  return new Set(config.cancelCommands ?? DEFAULT_CANCEL_COMMANDS)
}

/** 获取生效的确认命令集合。 */
export function getConfirmCommands(config: SessionConfig): ReadonlySet<string> {
  return new Set(config.confirmCommands ?? DEFAULT_CONFIRM_COMMANDS)
}

/** 锁提供者接口，用于会话互斥。 */
export interface LockProvider {
  /**
   * 尝试获取指定 key 的锁。
   * @param key 锁的唯一标识。
   * @param ttl 锁持有时长（毫秒）。
   * @returns 获取成功返回 true，已被持有返回 false。
   */
  acquire(key: string, ttl: number): Promise<boolean>

  /**
   * 释放指定 key 的锁。
   * @param key 锁的唯一标识。
   */
  release(key: string): Promise<void>

  /**
   * 清理匹配 pattern 的所有锁。
   * @param pattern 支持末尾 `*` 通配符。
   */
  cleanup(pattern: string): Promise<void>
}

/** 基于内存的锁提供者实现。 */
export class InMemoryLockProvider implements LockProvider {
  private readonly _locks = new Map<string, number>() // key → 过期时间戳（ms）

  async acquire(key: string, ttl: number): Promise<boolean> {
    const now = Date.now()
    const expiry = this._locks.get(key)
    if (expiry !== undefined && expiry > now) return false
    this._locks.set(key, now + ttl)
    return true
  }

  async release(key: string): Promise<void> {
    this._locks.delete(key)
  }

  async cleanup(pattern: string): Promise<void> {
    const prefix = pattern.replace(/\*$/, '')
    for (const key of this._locks.keys()) {
      if (key.startsWith(prefix)) this._locks.delete(key)
    }
  }
}
