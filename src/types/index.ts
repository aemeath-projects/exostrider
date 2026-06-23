import { EventEmitter } from 'node:events'

/** 通用日志接口，所有模块通过此接口接受外部日志器。 */
export interface Logger {
  debug(msg: string, ...args: unknown[]): void
  info(msg: string, ...args: unknown[]): void
  warn(msg: string, ...args: unknown[]): void
  error(msg: string, ...args: unknown[]): void
}

/** 类型安全的 EventEmitter 封装，基于 Node.js EventEmitter + 泛型重载。 */
export class TypedEventEmitter<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEvents extends { [K in keyof TEvents]: (...args: any[]) => void },
> extends EventEmitter {
  declare on: <K extends keyof TEvents & string>(event: K, listener: TEvents[K]) => this
  declare once: <K extends keyof TEvents & string>(event: K, listener: TEvents[K]) => this
  declare off: <K extends keyof TEvents & string>(event: K, listener: TEvents[K]) => this
  declare emit: <K extends keyof TEvents & string>(
    event: K,
    ...args: Parameters<TEvents[K]>
  ) => boolean
  declare removeAllListeners: (event?: keyof TEvents & string) => this
}
