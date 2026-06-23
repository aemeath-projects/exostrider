import { describe, it, expect, vi } from 'vitest'

import { DedupPipeline } from '../../../src/pool'

describe('DedupPipeline', () => {
  it('当 key 为 null 时透传（不去重）', () => {
    const pipeline = new DedupPipeline({
      keyExtractor: { extract: () => null },
      windowMs: 5000,
      maxCacheSize: 100,
    })
    expect(pipeline.process({})).toBe(true)
    expect(pipeline.process({})).toBe(true)
  })

  it('相同 key 在窗口内第二次返回 false', () => {
    const pipeline = new DedupPipeline({
      keyExtractor: { extract: () => 'key1' },
      windowMs: 5000,
      maxCacheSize: 100,
    })
    expect(pipeline.process({})).toBe(true)
    expect(pipeline.process({})).toBe(false)
  })

  it('相同 key 超过窗口后重新返回 true', () => {
    vi.useFakeTimers()
    const pipeline = new DedupPipeline({
      keyExtractor: { extract: () => 'key1' },
      windowMs: 1000,
      maxCacheSize: 100,
    })
    expect(pipeline.process({})).toBe(true)
    vi.advanceTimersByTime(1001)
    expect(pipeline.process({})).toBe(true)
    vi.useRealTimers()
  })

  it('缓存满时淘汰最旧条目并写入新 key', () => {
    let key = 'key0'
    const pipeline = new DedupPipeline({
      keyExtractor: { extract: () => key },
      windowMs: 60000,
      maxCacheSize: 2,
    })
    key = 'key0'
    expect(pipeline.process({})).toBe(true) // cache: {key0}
    key = 'key1'
    expect(pipeline.process({})).toBe(true) // cache: {key0, key1}（满）
    key = 'key2'
    expect(pipeline.process({})).toBe(true) // 淘汰 key0，写入 key2；cache: {key1, key2}
    key = 'key2'
    expect(pipeline.process({})).toBe(false) // key2 在窗口内 → 去重
    key = 'key0'
    expect(pipeline.process({})).toBe(true) // key0 已被淘汰 → 淘汰 key1，写入 key0；cache: {key2, key0}
    key = 'key1'
    expect(pipeline.process({})).toBe(true) // key1 被淘汰后重新进入 → 淘汰 key2，写入 key1
  })

  it('缓存满时新 key 写入后，第二次出现被正确去重', () => {
    let key = 'key0'
    const pipeline = new DedupPipeline({
      keyExtractor: { extract: () => key },
      windowMs: 60000,
      maxCacheSize: 2,
    })
    key = 'keyA'
    expect(pipeline.process({})).toBe(true) // cache: {keyA}
    key = 'keyB'
    expect(pipeline.process({})).toBe(true) // cache: {keyA, keyB}（满）
    key = 'keyC'
    expect(pipeline.process({})).toBe(true) // 淘汰 keyA，写入 keyC；cache: {keyB, keyC}
    key = 'keyC'
    expect(pipeline.process({})).toBe(false) // Bug 已修复：第二次同 key 应被阻止
  })

  it('不同 key 不互相干扰', () => {
    const pipeline = new DedupPipeline<{ k: string }>({
      keyExtractor: { extract: (e) => e.k },
      windowMs: 5000,
      maxCacheSize: 100,
    })
    expect(pipeline.process({ k: 'a' })).toBe(true)
    expect(pipeline.process({ k: 'b' })).toBe(true)
    expect(pipeline.process({ k: 'a' })).toBe(false)
    expect(pipeline.process({ k: 'b' })).toBe(false)
  })
})
