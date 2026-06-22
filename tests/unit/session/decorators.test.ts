import { describe, it, expect } from 'vitest'

import type { SessionContext } from '../../../src/session'
import {
  SESSION_META_KEY,
  STATE_META_KEY,
  INPUT_META_KEY,
  EXIT_META_KEY,
  InteractiveSession,
  interactiveSession,
  state,
  onInput,
  onExit,
} from '../../../src/session'

/**
 * 测试使用函数调用风格（非装饰器语法），避免 oxc 限制。
 */

describe('@interactiveSession', () => {
  it('在类上附加 SESSION_META_KEY 元数据', () => {
    class FeedbackSession extends InteractiveSession {}
    interactiveSession({ name: 'feedback', description: '用户反馈' })(FeedbackSession)
    const meta = (FeedbackSession as unknown as Record<string, unknown>)[SESSION_META_KEY]
    expect(meta).toEqual({ name: 'feedback', description: '用户反馈' })
  })

  it('不带 description 时 description 为 undefined', () => {
    class MySession extends InteractiveSession {}
    interactiveSession({ name: 'my_session' })(MySession)
    const meta = (MySession as unknown as Record<string, unknown>)[SESSION_META_KEY] as Record<
      string,
      unknown
    >
    expect(meta.name).toBe('my_session')
    expect(meta.description).toBeUndefined()
  })
})

describe('@state', () => {
  it('在方法上附加 STATE_META_KEY 元数据', () => {
    function askName(_ctx: SessionContext): Promise<void> {
      return Promise.resolve()
    }

    state('ask_name', { initial: true, description: '询问姓名' })(askName)

    const meta = (askName as unknown as Record<string, unknown>)[STATE_META_KEY]
    expect(meta).toEqual({ id: 'ask_name', initial: true, description: '询问姓名' })
  })

  it('不带 options 时使用默认值', () => {
    function myState(_ctx: SessionContext): Promise<void> {
      return Promise.resolve()
    }

    state('my_state')(myState)

    const meta = (myState as unknown as Record<string, unknown>)[STATE_META_KEY] as Record<
      string,
      unknown
    >
    expect(meta.id).toBe('my_state')
    expect(meta.initial).toBeUndefined()
  })

  it('initial: false 时 initial 字段为 false', () => {
    function myState(_ctx: SessionContext): Promise<void> {
      return Promise.resolve()
    }

    state('my_state', { initial: false })(myState)

    const meta = (myState as unknown as Record<string, unknown>)[STATE_META_KEY] as Record<
      string,
      unknown
    >
    expect(meta.initial).toBe(false)
  })
})

describe('@onInput', () => {
  it('在方法上附加 INPUT_META_KEY 元数据', () => {
    function handleInput(_ctx: SessionContext, _input: string) {
      return Promise.resolve({ finished: true })
    }

    onInput('ask_name')(handleInput)

    const meta = (handleInput as unknown as Record<string, unknown>)[INPUT_META_KEY]
    expect(meta).toEqual({ stateId: 'ask_name' })
  })
})

describe('@onExit', () => {
  it('在方法上附加 EXIT_META_KEY 元数据', () => {
    function cleanup(_ctx: SessionContext): Promise<void> {
      return Promise.resolve()
    }

    onExit('ask_name')(cleanup)

    const meta = (cleanup as unknown as Record<string, unknown>)[EXIT_META_KEY]
    expect(meta).toEqual({ stateId: 'ask_name' })
  })
})

describe('装饰器组合使用', () => {
  it('同一函数可以同时携带 state 和 onInput 元数据（不同函数）', () => {
    function enterState(_ctx: SessionContext): Promise<void> {
      return Promise.resolve()
    }
    function handleInput(_ctx: SessionContext, _input: string) {
      return Promise.resolve({})
    }

    state('step1', { initial: true })(enterState)
    onInput('step1')(handleInput)

    expect((enterState as unknown as Record<string, unknown>)[STATE_META_KEY]).toBeDefined()
    expect((handleInput as unknown as Record<string, unknown>)[INPUT_META_KEY]).toBeDefined()
  })

  it('@interactiveSession + @state 在不同函数/类上独立附加', () => {
    class TestSession extends InteractiveSession {}
    function enterState(_ctx: SessionContext): Promise<void> {
      return Promise.resolve()
    }

    interactiveSession({ name: 'test' })(TestSession)
    state('start')(enterState)

    expect((TestSession as unknown as Record<string, unknown>)[SESSION_META_KEY]).toBeDefined()
    expect((enterState as unknown as Record<string, unknown>)[STATE_META_KEY]).toBeDefined()
    // 类上没有 STATE_META_KEY
    expect((TestSession as unknown as Record<string, unknown>)[STATE_META_KEY]).toBeUndefined()
  })
})
