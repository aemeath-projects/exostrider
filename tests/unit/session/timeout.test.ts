import { describe, it, expect } from 'vitest'

import { TimeoutMode } from '../../../src/session/enums'
import { makeTimeoutConfig, resolveTimeout } from '../../../src/session/timeout'

describe('makeTimeoutConfig', () => {
  it('返回默认配置', () => {
    const cfg = makeTimeoutConfig()
    expect(cfg.duration).toBe(300)
    expect(cfg.mode).toBe(TimeoutMode.SILENT)
    expect(cfg.warningBefore).toBe(30)
    expect(typeof cfg.timeoutMessage).toBe('string')
    expect(typeof cfg.warningMessage).toBe('string')
  })

  it('支持覆盖字段', () => {
    const cfg = makeTimeoutConfig({ duration: 120, mode: TimeoutMode.NOTIFY })
    expect(cfg.duration).toBe(120)
    expect(cfg.mode).toBe(TimeoutMode.NOTIFY)
    expect(cfg.warningBefore).toBe(30)
  })
})

describe('resolveTimeout', () => {
  it('number 转换为 TimeoutConfig', () => {
    const cfg = resolveTimeout(60)
    expect(cfg.duration).toBe(60)
    expect(cfg.mode).toBe(TimeoutMode.SILENT)
  })

  it('TimeoutConfig 对象原样返回', () => {
    const input = makeTimeoutConfig({ duration: 90 })
    expect(resolveTimeout(input)).toBe(input)
  })
})
