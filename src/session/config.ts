/**
 * 会话全局配置与命令解析工具函数。
 */

import { DEFAULT_CANCEL_COMMANDS, DEFAULT_CONFIRM_COMMANDS } from './commands'
import type { TimeoutConfig } from './timeout'

/** 会话全局配置。 */
export interface SessionConfig {
  /**
   * 超时配置：可传纯数字（等价于 SILENT 模式该秒数超时，行为与旧版 sessionTimeout
   * 字段完全一致），或传完整 TimeoutConfig 以使用 NOTIFY/NEVER 策略。
   */
  readonly timeout: TimeoutConfig | number
  /** 取消命令列表，默认为 DEFAULT_CANCEL_COMMANDS。 */
  readonly cancelCommands?: readonly string[]
  /** 确认命令列表，默认为 DEFAULT_CONFIRM_COMMANDS。 */
  readonly confirmCommands?: readonly string[]
}

/** 获取生效的取消命令集合。 */
export function getCancelCommands(config: SessionConfig): ReadonlySet<string> {
  return new Set(config.cancelCommands ?? DEFAULT_CANCEL_COMMANDS)
}

/** 获取生效的确认命令集合。 */
export function getConfirmCommands(config: SessionConfig): ReadonlySet<string> {
  return new Set(config.confirmCommands ?? DEFAULT_CONFIRM_COMMANDS)
}
