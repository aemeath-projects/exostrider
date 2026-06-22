/**
 * 会话上下文 —— 封装会话内的交互信息。
 */

/**
 * 会话上下文，代理原始上下文并提供会话专属方法。
 *
 * 每次会话内消息到达时，SessionManager 会将原始上下文和 reply 函数
 * 封装为 SessionContext 传递给状态机。
 */
export class SessionContext<TContext = unknown> {
  /** 原始上下文（框架无关）。 */
  readonly original: TContext
  /** 会话内键值存储，可在状态间传递数据。 */
  readonly data = new Map<string, unknown>()
  private readonly _reply?: (content: unknown) => Promise<void>

  constructor(original: TContext, options?: { reply?: (content: unknown) => Promise<void> }) {
    this.original = original
    this._reply = options?.reply
  }

  /**
   * 发送回复消息。
   *
   * @param content 消息内容，格式由上层应用决定。
   */
  async reply(content: unknown): Promise<void> {
    await this._reply?.(content)
  }
}
