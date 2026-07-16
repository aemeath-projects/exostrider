/**
 * 会话锁提供者接口与内存实现。
 */

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
