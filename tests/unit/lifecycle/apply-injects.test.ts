import { describe, it, expect, vi } from 'vitest'

import { applyInjects } from '../../../src/lifecycle'
import type { InjectEntry } from '../../../src/lifecycle'

describe('applyInjects', () => {
  it('按 injects 列表把 resolve 解析出的值赋到 target 对应属性上', () => {
    const target: Record<string, unknown> = {}
    const injects: InjectEntry[] = [
      { propertyName: 'db', serviceKey: 'db_key' },
      { propertyName: 'cache', serviceKey: 'cache_key' },
    ]
    const resolve = vi.fn((key: string) => `resolved:${key}`)

    applyInjects(target, injects, resolve)

    expect(target.db).toBe('resolved:db_key')
    expect(target.cache).toBe('resolved:cache_key')
    expect(resolve).toHaveBeenCalledWith('db_key')
    expect(resolve).toHaveBeenCalledWith('cache_key')
  })

  it('空 injects 数组不调用 resolve，也不修改 target', () => {
    const target: Record<string, unknown> = { existing: 'value' }
    const resolve = vi.fn()

    applyInjects(target, [], resolve)

    expect(resolve).not.toHaveBeenCalled()
    expect(target).toEqual({ existing: 'value' })
  })

  it('支持 symbol 类型的 target 属性（Record<string | symbol, unknown>）', () => {
    const sym = Symbol('test')
    const target: Record<string | symbol, unknown> = {}
    // InjectEntry.propertyName 类型是 string | symbol（与装饰器元数据格式一致）
    const injects = [{ propertyName: sym, serviceKey: 'symbol_key' }] as unknown as InjectEntry[]
    const resolve = vi.fn(() => 'symbol-resolved')

    applyInjects(target, injects, resolve)

    expect(target[sym]).toBe('symbol-resolved')
  })
})
