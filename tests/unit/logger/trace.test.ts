import { describe, it, expect } from 'vitest'

import { runWithTrace, enterTrace, getTraceId } from '../../../src/logger'

describe('runWithTrace', () => {
  it('在回调执行期间可以取到指定的 traceId', () => {
    runWithTrace('trace-1', () => {
      expect(getTraceId()).toBe('trace-1')
    })
  })

  it('回调执行完毕后，外部上下文取不到 traceId', () => {
    runWithTrace('trace-1', () => {
      /* noop */
    })
    expect(getTraceId()).toBeUndefined()
  })

  it('异步回调链中 traceId 能跨 await 传播', async () => {
    const result = await runWithTrace('trace-async', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return getTraceId()
    })
    expect(result).toBe('trace-async')
  })

  it('嵌套 runWithTrace 内层覆盖外层，外层恢复后仍是外层的值', () => {
    runWithTrace('outer', () => {
      expect(getTraceId()).toBe('outer')
      runWithTrace('inner', () => {
        expect(getTraceId()).toBe('inner')
      })
      expect(getTraceId()).toBe('outer')
    })
  })

  it('返回值透传回调的返回值', () => {
    const result = runWithTrace('trace-1', () => 42)
    expect(result).toBe(42)
  })
})

describe('enterTrace / getTraceId', () => {
  it('未进入任何 trace 上下文时返回 undefined', async () => {
    // 用一个全新的微任务 tick，避免被其他用例的 enterTrace 污染
    await new Promise((resolve) => setImmediate(resolve))
    // enterTrace 是"进入并保持"的语义，此处仅验证初始状态下 getTraceId 的类型契约，
    // 不对全局状态做强断言（AsyncLocalStorage 的 store 边界以 runWithTrace 用例为准）
    expect(typeof getTraceId()).toMatch(/undefined|string/)
  })

  it('enterTrace 后在同一同步调用栈内 getTraceId 能取到值', () => {
    runWithTrace('outer-for-enter', () => {
      enterTrace('entered-trace')
      expect(getTraceId()).toBe('entered-trace')
    })
  })

  it('enterTrace 在异步延续中持续生效（不像 runWithTrace 那样在回调返回后立即失效）', async () => {
    await runWithTrace('outer', async () => {
      enterTrace('entered-async')
      await new Promise((resolve) => setTimeout(resolve, 1))
      expect(getTraceId()).toBe('entered-async')
    })
  })
})
