import { describe, it, expect, vi } from 'vitest'

import {
  SessionContext,
  state,
  onInput,
  onExit,
  InteractiveSession,
  buildStatesFromDecorators,
  STATE_META_KEY,
  INPUT_META_KEY,
  EXIT_META_KEY,
} from '../../../src/session'
import type { StateDefinition } from '../../../src/session'

describe('InteractiveSession 基类', () => {
  describe('buildStates()', () => {
    it('默认实现返回空数组', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()
      expect(session.buildStates()).toEqual([])
    })

    it('子类可重写 buildStates() 返回自定义状态列表', () => {
      const customState: StateDefinition = { id: 'ask' }

      class MySession extends InteractiveSession {
        override buildStates(): StateDefinition[] {
          return [customState]
        }
      }

      const session = new MySession()
      expect(session.buildStates()).toEqual([customState])
    })
  })

  describe('生命周期钩子（均为可选）', () => {
    it('onStart 默认不定义（可选重写）', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()
      expect(session.onStart).toBeUndefined()
    })

    it('onFinish 默认不定义（可选重写）', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()
      expect(session.onFinish).toBeUndefined()
    })

    it('onCancel 默认不定义（可选重写）', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()
      expect(session.onCancel).toBeUndefined()
    })

    it('onTimeout 默认不定义（可选重写）', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()
      expect(session.onTimeout).toBeUndefined()
    })

    it('onError 默认不定义（可选重写）', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()
      expect(session.onError).toBeUndefined()
    })

    it('子类可重写 onStart', async () => {
      const ctx = new SessionContext('test')
      const startFn = vi.fn().mockResolvedValue(undefined)

      class MySession extends InteractiveSession {
        override async onStart(_ctx: SessionContext): Promise<void> {
          startFn(_ctx)
        }
      }

      const session = new MySession()
      await session.onStart(ctx)
      expect(startFn).toHaveBeenCalledWith(ctx)
    })
  })

  describe('buildStatesFromDecorators()', () => {
    it('无装饰器时返回空数组', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()
      expect(buildStatesFromDecorators(session)).toEqual([])
    })

    it('从 @state 装饰的方法构建状态', () => {
      class MySession extends InteractiveSession {
        async askName(_ctx: SessionContext): Promise<void> {}
      }

      // 手动附加元数据（模拟装饰器）
      const session = new MySession()
      Object.assign(session.askName, { [STATE_META_KEY]: { id: 'ask_name', initial: true } })

      const states = buildStatesFromDecorators(session)
      expect(states).toHaveLength(1)
      expect(states[0]?.id).toBe('ask_name')
    })

    it('从 @onInput 装饰的方法关联 onInput', () => {
      class MySession extends InteractiveSession {
        async askName(_ctx: SessionContext): Promise<void> {}
        async handleInput(_ctx: SessionContext, _input: string) {
          return { finished: true }
        }
      }

      const session = new MySession()
      Object.assign(session.askName, { [STATE_META_KEY]: { id: 'ask_name' } })
      Object.assign(session.handleInput, { [INPUT_META_KEY]: { stateId: 'ask_name' } })

      const states = buildStatesFromDecorators(session)
      expect(states[0]?.onInput).toBeDefined()
    })

    it('从 @onExit 装饰的方法关联 onExit', () => {
      class MySession extends InteractiveSession {
        async askName(_ctx: SessionContext): Promise<void> {}
        async cleanup(_ctx: SessionContext): Promise<void> {}
      }

      const session = new MySession()
      Object.assign(session.askName, { [STATE_META_KEY]: { id: 'ask_name' } })
      Object.assign(session.cleanup, { [EXIT_META_KEY]: { stateId: 'ask_name' } })

      const states = buildStatesFromDecorators(session)
      expect(states[0]?.onExit).toBeDefined()
    })

    it('定义多个初始状态时抛出 Error', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()

      function first() {
        return Promise.resolve()
      }
      function second() {
        return Promise.resolve()
      }
      Object.assign(first, { [STATE_META_KEY]: { id: 'first', initial: true } })
      Object.assign(second, { [STATE_META_KEY]: { id: 'second', initial: true } })

      const proto = Object.getPrototypeOf(session) as Record<string, unknown>
      Object.defineProperty(proto, 'first', { value: first, configurable: true })
      Object.defineProperty(proto, 'second', { value: second, configurable: true })

      expect(() => buildStatesFromDecorators(session)).toThrow()

      delete proto.first
      delete proto.second
    })

    it('多个状态时非初始状态也被包含在结果中', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()

      function askName() {
        return Promise.resolve()
      }
      function askAge() {
        return Promise.resolve()
      }
      Object.assign(askName, { [STATE_META_KEY]: { id: 'ask_name', initial: true } })
      Object.assign(askAge, { [STATE_META_KEY]: { id: 'ask_age' } })

      const proto = Object.getPrototypeOf(session) as Record<string, unknown>
      Object.defineProperty(proto, 'askName', { value: askName, configurable: true })
      Object.defineProperty(proto, 'askAge', { value: askAge, configurable: true })

      const states = buildStatesFromDecorators(session)
      expect(states).toHaveLength(2)
      expect(states[0]?.id).toBe('ask_name')
      expect(states[1]?.id).toBe('ask_age')

      delete proto.askName
      delete proto.askAge
    })

    it('使用函数调用风格的 @state 装饰器', () => {
      class MySession extends InteractiveSession {}
      const session = new MySession()

      // 使用装饰器函数（非语法糖，模拟 oxc 环境）
      function askName(_ctx: SessionContext) {
        return Promise.resolve()
      }
      state('ask_name', { initial: true })(askName)

      // 绑定到实例（模拟装饰器效果）
      Object.defineProperty(Object.getPrototypeOf(session), 'askName', {
        value: askName,
        configurable: true,
      })

      const states = buildStatesFromDecorators(session)
      const askState = states.find((s) => s.id === 'ask_name')
      expect(askState).toBeDefined()
    })
  })
})

describe('session 装饰器函数调用（oxc 风格）', () => {
  it('@state 在函数上附加 STATE_META_KEY', () => {
    function myHandler(_ctx: SessionContext) {
      return Promise.resolve()
    }

    state('my_state', { initial: true })(myHandler)

    expect((myHandler as unknown as Record<string, unknown>)[STATE_META_KEY]).toEqual({
      id: 'my_state',
      initial: true,
      description: undefined,
    })
  })

  it('@onInput 在函数上附加 INPUT_META_KEY', () => {
    function myInput(_ctx: SessionContext, _input: string) {
      return Promise.resolve({ finished: true })
    }

    onInput('my_state')(myInput)

    expect((myInput as unknown as Record<string, unknown>)[INPUT_META_KEY]).toEqual({
      stateId: 'my_state',
    })
  })

  it('@onExit 在函数上附加 EXIT_META_KEY', () => {
    function myExit(_ctx: SessionContext) {
      return Promise.resolve()
    }

    onExit('my_state')(myExit)

    expect((myExit as unknown as Record<string, unknown>)[EXIT_META_KEY]).toEqual({
      stateId: 'my_state',
    })
  })
})
