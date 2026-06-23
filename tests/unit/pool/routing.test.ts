import { describe, it, expect, vi } from 'vitest'

import { PriorityStickyStrategy } from '../../../src/pool/routing/priority-sticky.js'
import { PriorityStrategy } from '../../../src/pool/routing/priority.js'
import { StickyStrategy } from '../../../src/pool/routing/sticky.js'
import { RoutingTable } from '../../../src/pool/routing/table.js'

const cands = (ids: string[], priorities?: number[]) =>
  ids.map((clientId, i) => ({
    clientId,
    role: 'test',
    priority: priorities?.[i] ?? i * 10,
  }))

describe('StickyStrategy', () => {
  it('当前仍在候选中则保持', () => {
    const s = new StickyStrategy()
    expect(s.select('t', cands(['a', 'b']), 'b')).toBe('b')
  })

  it('当前不在候选中则返回第一个', () => {
    const s = new StickyStrategy()
    expect(s.select('t', cands(['a', 'b']), 'x')).toBe('a')
  })

  it('无当前时返回第一个', () => {
    const s = new StickyStrategy()
    expect(s.select('t', cands(['a', 'b']), undefined)).toBe('a')
  })

  it('候选为空时抛出', () => {
    const s = new StickyStrategy()
    expect(() => s.select('t', [], undefined)).toThrow('No available candidates')
  })
})

describe('PriorityStrategy', () => {
  it('返回 priority 最小的候选', () => {
    const s = new PriorityStrategy()
    expect(s.select('t', cands(['a', 'b'], [10, 0]), undefined)).toBe('b')
  })

  it('候选为空时抛出', () => {
    const s = new PriorityStrategy()
    expect(() => s.select('t', [], undefined)).toThrow()
  })
})

describe('PriorityStickyStrategy', () => {
  it('当前可用时保持（忽略优先级）', () => {
    const s = new PriorityStickyStrategy()
    expect(s.select('t', cands(['a', 'b'], [0, 10]), 'b')).toBe('b')
  })

  it('当前不可用时按优先级选择', () => {
    const s = new PriorityStickyStrategy()
    expect(s.select('t', cands(['a', 'b'], [0, 10]), 'x')).toBe('a')
  })

  it('候选为空时抛出', () => {
    const s = new PriorityStickyStrategy()
    expect(() => s.select('t', [], undefined)).toThrow()
  })
})

describe('RoutingTable', () => {
  it('首次 resolve 传入 undefined 作为 current', () => {
    const strategy = { select: vi.fn().mockReturnValue('a') }
    const table = new RoutingTable({ strategy, keySerializer: String })
    const cs = cands(['a'])
    table.resolve('g1', cs)
    expect(strategy.select).toHaveBeenCalledWith('g1', cs, undefined)
  })

  it('第二次 resolve 传入上次结果作为 current', () => {
    const strategy = { select: vi.fn().mockReturnValue('a') }
    const table = new RoutingTable({ strategy, keySerializer: String })
    const cs = cands(['a'])
    table.resolve('g1', cs)
    table.resolve('g1', cs)
    expect(strategy.select).toHaveBeenLastCalledWith('g1', cs, 'a')
  })

  it('invalidate 清除该客户端的所有映射', () => {
    const strategy = { select: vi.fn().mockReturnValue('a') }
    const table = new RoutingTable({ strategy, keySerializer: String })
    table.resolve('g1', cands(['a']))
    table.resolve('g2', cands(['a']))
    table.invalidate('a')
    expect(table.getActiveClient('g1')).toBeUndefined()
    expect(table.getActiveClient('g2')).toBeUndefined()
  })

  it('invalidateTarget 只清除指定目标', () => {
    const strategy = { select: vi.fn().mockReturnValue('a') }
    const table = new RoutingTable({ strategy, keySerializer: String })
    table.resolve('g1', cands(['a']))
    table.resolve('g2', cands(['a']))
    table.invalidateTarget('g1')
    expect(table.getActiveClient('g1')).toBeUndefined()
    expect(table.getActiveClient('g2')).toBe('a')
  })

  it('clear 清空所有映射', () => {
    const strategy = { select: vi.fn().mockReturnValue('a') }
    const table = new RoutingTable({ strategy, keySerializer: String })
    table.resolve('g1', cands(['a']))
    table.clear()
    expect(table.getActiveClient('g1')).toBeUndefined()
  })
})
