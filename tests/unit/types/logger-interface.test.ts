import { describe, it, expect } from 'vitest'

import type { Logger } from '../../../src/types'

describe('Logger interface', () => {
  it('should be satisfiable by a minimal object', () => {
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
