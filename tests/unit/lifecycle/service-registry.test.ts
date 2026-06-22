import { describe, it, expect, beforeEach } from 'vitest'

import { ServiceRegistry } from '../../../src/lifecycle'

describe('ServiceRegistry', () => {
  let registry: ServiceRegistry<{ foo: string; bar: number; baz: boolean }>

  beforeEach(() => {
    registry = new ServiceRegistry()
  })

  it('set + get: 存储后可正确取回', () => {
    registry.set('foo', 'hello')
    expect(registry.get('foo')).toBe('hello')
  })

  it('set + get: 支持多个不同 key', () => {
    registry.set('foo', 'world')
    registry.set('bar', 42)
    expect(registry.get('foo')).toBe('world')
    expect(registry.get('bar')).toBe(42)
  })

  it('set: 覆盖同一 key 应成功', () => {
    registry.set('foo', 'first')
    registry.set('foo', 'second')
    expect(registry.get('foo')).toBe('second')
  })

  it('getOptional: key 不存在时返回 undefined', () => {
    expect(registry.getOptional('foo')).toBeUndefined()
  })

  it('getOptional: key 存在时返回值', () => {
    registry.set('bar', 99)
    expect(registry.getOptional('bar')).toBe(99)
  })

  it('get: key 不存在时抛出 Error', () => {
    expect(() => registry.get('baz')).toThrow(`Service "baz" not found in registry`)
  })

  it('has: key 存在时返回 true', () => {
    registry.set('foo', 'x')
    expect(registry.has('foo')).toBe(true)
  })

  it('has: key 不存在时返回 false', () => {
    expect(registry.has('foo')).toBe(false)
  })

  it('size: 正确反映已注册数量', () => {
    expect(registry.size).toBe(0)
    registry.set('foo', 'a')
    expect(registry.size).toBe(1)
    registry.set('bar', 1)
    expect(registry.size).toBe(2)
  })

  it('frozen: 初始为 false', () => {
    expect(registry.frozen).toBe(false)
  })

  it('freeze: 冻结后 set 抛出 Error', () => {
    registry.set('foo', 'before')
    registry.freeze()
    expect(registry.frozen).toBe(true)
    expect(() => registry.set('foo', 'after')).toThrow('ServiceRegistry 已冻结')
  })

  it('freeze: 冻结后 get 仍可正常读取', () => {
    registry.set('foo', 'value')
    registry.freeze()
    expect(registry.get('foo')).toBe('value')
  })

  it('freeze: 冻结后 getOptional 仍可正常读取', () => {
    registry.set('bar', 7)
    registry.freeze()
    expect(registry.getOptional('bar')).toBe(7)
  })
})
