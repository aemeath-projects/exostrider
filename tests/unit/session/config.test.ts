import { describe, it, expect } from 'vitest'

import { getCancelCommands, getConfirmCommands } from '../../../src/session'

describe('getCancelCommands', () => {
  it('使用默认取消命令', () => {
    const cmds = getCancelCommands({ timeout: 60 })
    expect(cmds.has('/取消')).toBe(true)
    expect(cmds.has('/cancel')).toBe(true)
  })

  it('使用自定义取消命令', () => {
    const cmds = getCancelCommands({ timeout: 60, cancelCommands: ['/quit'] })
    expect(cmds.has('/quit')).toBe(true)
    expect(cmds.has('/取消')).toBe(false)
  })
})

describe('getConfirmCommands', () => {
  it('使用默认确认命令', () => {
    const cmds = getConfirmCommands({ timeout: 60 })
    expect(cmds.has('/确认')).toBe(true)
    expect(cmds.has('/confirm')).toBe(true)
  })

  it('使用自定义确认命令', () => {
    const cmds = getConfirmCommands({ timeout: 60, confirmCommands: ['/ok', '/yes'] })
    expect(cmds.has('/ok')).toBe(true)
    expect(cmds.has('/yes')).toBe(true)
    expect(cmds.has('/确认')).toBe(false)
  })
})
