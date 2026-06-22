import { describe, it, expect, vi } from 'vitest'

import { LogBroadcaster } from '../../../src'

describe('LogBroadcaster', () => {
  it('should emit log events to subscribers', () => {
    const broadcaster = new LogBroadcaster()
    const listener = vi.fn()
    broadcaster.on('log', listener)

    const entry = { level: 30, time: Date.now(), msg: 'test' }
    broadcaster.broadcast(entry)

    expect(listener).toHaveBeenCalledWith(entry)
  })

  it('should not throw when no subscribers', () => {
    const broadcaster = new LogBroadcaster()
    expect(() =>
      broadcaster.broadcast({ level: 30, time: Date.now(), msg: 'no listener' }),
    ).not.toThrow()
  })

  it('should support multiple subscribers', () => {
    const broadcaster = new LogBroadcaster()
    const listener1 = vi.fn()
    const listener2 = vi.fn()
    broadcaster.on('log', listener1)
    broadcaster.on('log', listener2)

    broadcaster.broadcast({ level: 30, time: Date.now(), msg: 'multi' })
    expect(listener1).toHaveBeenCalledOnce()
    expect(listener2).toHaveBeenCalledOnce()
  })
})
