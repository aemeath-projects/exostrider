import { describe, it, expect } from 'vitest'

import type { Logger } from '../../../src/types'

describe('Logger 接口', () => {
  it('可由包含 debug/info/warn/error 方法的最简对象满足', () => {
    const logger: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    }
    expect(logger).toBeDefined()
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
  })
})
