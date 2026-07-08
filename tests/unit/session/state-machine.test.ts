import { describe, it, expect, vi } from 'vitest'

import {
  SessionContext,
  StateMachine,
  StateMachineError,
  InvalidTransitionError,
} from '../../../src/session'
import type { StateDefinition } from '../../../src/session'

describe('StateMachine', () => {
  const makeCtx = () => new SessionContext('test')

  describe('start()', () => {
    it('进入第一个状态并调用 onEnter', async () => {
      const onEnter = vi.fn().mockResolvedValue(undefined)
      const states: StateDefinition[] = [{ id: 'start', onEnter }]
      const sm = new StateMachine(states)
      const ctx = makeCtx()
      await sm.start(ctx)
      expect(sm.getCurrentState()).toBe('start')
      expect(onEnter).toHaveBeenCalledWith(ctx)
    })

    it('start 时指定初始状态 ID', async () => {
      const onEnter1 = vi.fn().mockResolvedValue(undefined)
      const onEnter2 = vi.fn().mockResolvedValue(undefined)
      const states: StateDefinition[] = [
        { id: 'a', onEnter: onEnter1 },
        { id: 'b', onEnter: onEnter2 },
      ]
      const sm = new StateMachine(states)
      await sm.start(makeCtx(), 'b')
      expect(sm.getCurrentState()).toBe('b')
      expect(onEnter2).toHaveBeenCalled()
      expect(onEnter1).not.toHaveBeenCalled()
    })

    it('无状态时抛出 StateMachineError', async () => {
      const sm = new StateMachine([])
      await expect(sm.start(makeCtx())).rejects.toThrow(StateMachineError)
    })

    it('指定不存在的初始状态时抛出 InvalidTransitionError', async () => {
      const states: StateDefinition[] = [{ id: 'a' }]
      const sm = new StateMachine(states)
      await expect(sm.start(makeCtx(), 'nonexistent')).rejects.toThrow(InvalidTransitionError)
    })
  })

  describe('processInput()', () => {
    it('将输入路由到当前状态的 onInput', async () => {
      const onInput = vi.fn().mockResolvedValue({})
      const states: StateDefinition[] = [{ id: 'a', onInput }]
      const sm = new StateMachine(states)
      const ctx = makeCtx()
      await sm.start(ctx)
      await sm.processInput(ctx, 'hello')
      expect(onInput).toHaveBeenCalledWith(ctx, 'hello')
    })

    it('onInput 返回 nextState 触发状态转换', async () => {
      const onExitA = vi.fn().mockResolvedValue(undefined)
      const onEnterB = vi.fn().mockResolvedValue(undefined)
      const states: StateDefinition[] = [
        {
          id: 'a',
          onExit: onExitA,
          onInput: async (_ctx, _input) => ({ nextState: 'b' }),
        },
        { id: 'b', onEnter: onEnterB },
      ]
      const sm = new StateMachine(states)
      const ctx = makeCtx()
      await sm.start(ctx)
      await sm.processInput(ctx, 'go')
      expect(onExitA).toHaveBeenCalled()
      expect(onEnterB).toHaveBeenCalled()
      expect(sm.getCurrentState()).toBe('b')
    })

    it('onInput 返回 finished:true 标记状态机完成', async () => {
      const states: StateDefinition[] = [
        {
          id: 'a',
          onInput: async () => ({ finished: true }),
        },
      ]
      const sm = new StateMachine(states)
      await sm.start(makeCtx())
      await sm.processInput(makeCtx(), 'done')
      expect(sm.getCurrentState()).toBeNull()
      expect(sm.isFinished).toBe(true)
    })

    it('onInput 返回 finished:true 时调用 onExit', async () => {
      const onExit = vi.fn().mockResolvedValue(undefined)
      const states: StateDefinition[] = [
        {
          id: 'a',
          onExit,
          onInput: async () => ({ finished: true }),
        },
      ]
      const sm = new StateMachine(states)
      const ctx = makeCtx()
      await sm.start(ctx)
      await sm.processInput(ctx, 'done')
      expect(onExit).toHaveBeenCalledWith(ctx)
    })

    it('无 onInput 时返回空结果不报错', async () => {
      const states: StateDefinition[] = [{ id: 'a' }]
      const sm = new StateMachine(states)
      await sm.start(makeCtx())
      const result = await sm.processInput(makeCtx(), 'hello')
      expect(result).toEqual({})
    })

    it('未启动时调用 processInput 抛出 StateMachineError', async () => {
      const states: StateDefinition[] = [{ id: 'a' }]
      const sm = new StateMachine(states)
      await expect(sm.processInput(makeCtx(), 'hello')).rejects.toThrow(StateMachineError)
    })
  })

  describe('transitionTo()', () => {
    it('直接跳转到目标状态', async () => {
      const onEnterB = vi.fn().mockResolvedValue(undefined)
      const states: StateDefinition[] = [{ id: 'a' }, { id: 'b', onEnter: onEnterB }]
      const sm = new StateMachine(states)
      const ctx = makeCtx()
      await sm.start(ctx)
      await sm.transitionTo(ctx, 'b')
      expect(sm.getCurrentState()).toBe('b')
      expect(onEnterB).toHaveBeenCalledWith(ctx)
    })

    it('转换时调用当前状态 onExit', async () => {
      const onExitA = vi.fn().mockResolvedValue(undefined)
      const states: StateDefinition[] = [{ id: 'a', onExit: onExitA }, { id: 'b' }]
      const sm = new StateMachine(states)
      const ctx = makeCtx()
      await sm.start(ctx)
      await sm.transitionTo(ctx, 'b')
      expect(onExitA).toHaveBeenCalledWith(ctx)
    })

    it('目标状态不存在时抛出 InvalidTransitionError', async () => {
      const states: StateDefinition[] = [{ id: 'a' }]
      const sm = new StateMachine(states)
      await sm.start(makeCtx())
      await expect(sm.transitionTo(makeCtx(), 'nonexistent')).rejects.toThrow(
        InvalidTransitionError,
      )
    })

    it('finished 后调用 transitionTo 跳过 onExit（_currentState 为 null）', async () => {
      const onExit = vi.fn().mockResolvedValue(undefined)
      const onEnterB = vi.fn().mockResolvedValue(undefined)
      const states: StateDefinition[] = [
        { id: 'a', onExit, onInput: async () => ({ finished: true }) },
        { id: 'b', onEnter: onEnterB },
      ]
      const sm = new StateMachine(states)
      await sm.start(makeCtx())
      await sm.processInput(makeCtx(), 'done')
      expect(sm.isFinished).toBe(true)

      await sm.transitionTo(makeCtx(), 'b')
      expect(sm.getCurrentState()).toBe('b')
      expect(onExit).toHaveBeenCalledTimes(1) // 仅在 processInput finished 时调用一次
      expect(onEnterB).toHaveBeenCalled()
    })

    it('未启动时调用 transitionTo 跳过 onExit 直接进入目标状态', async () => {
      const onEnter = vi.fn().mockResolvedValue(undefined)
      const sm = new StateMachine([{ id: 'a', onEnter }])
      await sm.transitionTo(makeCtx(), 'a')
      expect(sm.getCurrentState()).toBe('a')
      expect(onEnter).toHaveBeenCalled()
    })
  })

  describe('getCurrentState() & isFinished', () => {
    it('未启动时 getCurrentState() 返回 null', () => {
      const sm = new StateMachine([{ id: 'a' }])
      expect(sm.getCurrentState()).toBeNull()
    })

    it('未启动时 isFinished 为 false（未初始化不等于已完成）', () => {
      const sm = new StateMachine([{ id: 'a' }])
      expect(sm.isFinished).toBe(false)
    })

    it('启动后 isFinished 为 false', async () => {
      const sm = new StateMachine([{ id: 'a' }])
      await sm.start(makeCtx())
      expect(sm.isFinished).toBe(false)
    })

    it('当前状态在 map 中不存在时抛出 StateMachineError', async () => {
      const states: StateDefinition[] = [{ id: 'a', onInput: async () => ({}) }]
      const sm = new StateMachine(states)
      await sm.start(makeCtx())
      // 直接通过私有字段破坏状态以模拟 corrupted state
      ;(sm as unknown as { _currentState: string })._currentState = 'nonexistent'
      await expect(sm.processInput(makeCtx(), 'hello')).rejects.toThrow(StateMachineError)
    })
  })
})
