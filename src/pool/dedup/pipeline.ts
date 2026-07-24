/** 去重流水线实现。 */
import type { DedupOptions } from '../types'

interface CacheEntry {
  firstSeenAt: number
}

/** 基于 Map（插入顺序 = 年龄顺序）实现的 LRU 去重流水线。 */
export class DedupPipeline<TEvent> {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly options: DedupOptions<TEvent>) {}

  /** 处理事件。返回 true 表示应当发射，false 表示重复。 */
  process(event: TEvent): boolean {
    const key = this.options.keyExtractor.extract(event)
    if (key === null) return true

    const now = Date.now()
    const entry = this.cache.get(key)

    if (entry !== undefined && now - entry.firstSeenAt < this.options.windowMs) {
      return false
    }

    if (this.cache.size >= this.options.maxCacheSize && entry === undefined) {
      const oldest = this.cache.keys().next().value
      /* c8 ignore next */ if (oldest !== undefined) this.cache.delete(oldest)
      // 缓存满时淘汰最旧条目，同时写入新 key；否则下次相同 key 仍可通过，去重失效
      this.cache.set(key, { firstSeenAt: now })
      return true
    }

    // delete + set 保证 key 移到 Map 末尾（维持 LRU 语义）
    this.cache.delete(key)
    this.cache.set(key, { firstSeenAt: now })
    return true
  }
}
