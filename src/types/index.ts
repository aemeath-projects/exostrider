/** 通用日志接口，所有模块通过此接口接受外部日志器。 */
export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}
