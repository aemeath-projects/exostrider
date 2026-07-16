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

  it('resolve 中途抛异常 → 异常传播，且之前条目已赋值', () => {
    const target: Record<string, unknown> = {}
    const injects: InjectEntry[] = [
      { propertyName: 'a', serviceKey: 'a_key' },
      { propertyName: 'b', serviceKey: 'b_key' },
      { propertyName: 'c', serviceKey: 'c_key' },
    ]
    const resolve = vi.fn((key: string) => {
      if (key === 'b_key') throw new Error('service not found')
      return `resolved:${key}`
    })

    expect(() => applyInjects(target, injects, resolve)).toThrow('service not found')

    expect(target.a).toBe('resolved:a_key')
    expect(target).not.toHaveProperty('b')
    expect(target).not.toHaveProperty('c')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('重复 propertyName → 按数组顺序后者覆盖前者', () => {
    const target: Record<string, unknown> = {}
    const injects: InjectEntry[] = [
      { propertyName: 'svc', serviceKey: 'first_key' },
      { propertyName: 'svc', serviceKey: 'second_key' },
    ]
    const resolve = vi.fn((key: string) => `resolved:${key}`)

    applyInjects(target, injects, resolve)

    expect(target.svc).toBe('resolved:second_key')
    expect(resolve).toHaveBeenCalledTimes(2)
    expect(resolve).toHaveBeenNthCalledWith(1, 'first_key')
    expect(resolve).toHaveBeenNthCalledWith(2, 'second_key')
  })

  it('resolve 返回 undefined → 属性仍被显式赋值', () => {
    const target: Record<string, unknown> = {}
    const injects: InjectEntry[] = [{ propertyName: 'db', serviceKey: 'db_key' }]
    const resolve = vi.fn(() => undefined)

    applyInjects(target, injects, resolve)

    expect(Object.prototype.hasOwnProperty.call(target, 'db')).toBe(true)
    expect(target.db).toBeUndefined()
  })
})
