import { describe, it, expect, vi } from 'vitest'

import { DedupPipeline } from '../../../src/pool/dedup/pipeline.js'

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

  it('缓存满时淘汰最旧条目', () => {
    let key = 'key0'
    const pipeline = new DedupPipeline({
      keyExtractor: { extract: () => key },
      windowMs: 60000,
      maxCacheSize: 2,
    })
    key = 'key0'
    expect(pipeline.process({})).toBe(true)
    key = 'key1'
    expect(pipeline.process({})).toBe(true) // 缓存满
    key = 'key2'
    expect(pipeline.process({})).toBe(true) // 淘汰 key0
    key = 'key0'
    expect(pipeline.process({})).toBe(true) // key0 已被淘汰，重新进入
    key = 'key1'
    expect(pipeline.process({})).toBe(false) // key1 还在缓存中
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
