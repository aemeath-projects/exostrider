/** 日志广播器 —— EventEmitter，供消费者订阅实时日志流。 */

import { EventEmitter } from 'node:events'

/** 结构化日志条目（通常为 Pino JSON 格式）。 */
export interface LogEntry {
  level: number
  time: number
  msg: string
  [key: string]: unknown
}

/**
 * 日志广播器。
 *
 * 日志写入器调用 {@link LogBroadcaster.broadcast} 推送日志条目，
 * 消费者监听 `'log'` 事件接收条目。
 */
export class LogBroadcaster extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(100)
  }

  /**
   * 广播一条日志条目到所有监听器。
   *
   * @param entry - 结构化日志条目
   */
  broadcast(entry: LogEntry): void {
    this.emit('log', entry)
  }
}
