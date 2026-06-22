/**
 * 泛型事件上下文 —— 封装事件、APIs 及便捷方法。
 *
 * 平台无关设计：事件类型和 API 类型均为泛型参数，
 * 具体平台通过 ContextConfig 注入文本提取/参数解析/回复逻辑。
 */

import { FinishError } from './errors'

/** Context 配置：注入平台相关的提取/回复逻辑。 */
export interface ContextConfig<TEvent, TApis> {
  readonly textExtractor?: (event: TEvent) => string | undefined
  readonly argsExtractor?: (event: TEvent, commandPrefix: string) => string[] | undefined
  readonly replyHandler?: (ctx: Context<TEvent, TApis>, content: unknown) => Promise<void>
  readonly commandPrefix?: string
}

/**
 * 事件处理上下文 —— 传递给拦截器和处理器。
 *
 * 包含：
 * - 当前事件（`event`）
 * - 平台 API（`apis`）
 * - 正则匹配结果（`regexMatch`）
 * - 属性存储（供拦截器链传递数据）
 * - 便捷方法（`getText`、`getArgs`、`reply`、`finish`）
 */
export class Context<TEvent = unknown, TApis = unknown> {
  /** 触发本次事件的原始事件对象。 */
  readonly event: TEvent

  /** 平台 API 集合。 */
  readonly apis: TApis

  /** 属性存储（供拦截器链传递数据）。 */
  readonly attributes = new Map<string, unknown>()

  /** 正则匹配结果（由调度器在 OnRegex 时设置）。 */
  regexMatch: RegExpMatchArray | null = null

  /** 当前消息作用域（由调度器设置）。 */
  scope?: string

  private readonly _config: ContextConfig<TEvent, TApis>

  constructor(event: TEvent, apis: TApis, config: ContextConfig<TEvent, TApis>) {
    this.event = event
    this.apis = apis
    this._config = config
  }

  /**
   * 从事件中提取纯文本内容。
   * 依赖 ContextConfig.textExtractor，未配置时返回 undefined。
   */
  getText(): string | undefined {
    return this._config.textExtractor?.(this.event)
  }

  /**
   * 提取命令参数。
   * 依赖 ContextConfig.argsExtractor，未配置时返回 undefined。
   */
  getArgs(): string[] | undefined {
    return this._config.argsExtractor?.(this.event, this._config.commandPrefix ?? '/')
  }

  /**
   * 获取属性值。
   * @param key 属性键名
   */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- 泛型为调用侧类型推断便利
  getAttribute<T>(key: string): T | undefined {
    return this.attributes.get(key) as T | undefined
  }

  /**
   * 设置属性值。
   * @param key 属性键名
   * @param value 属性值
   */
  setAttribute(key: string, value: unknown): void {
    this.attributes.set(key, value)
  }

  /**
   * 向当前会话发送回复。
   * 依赖 ContextConfig.replyHandler，未配置时为空操作。
   */
  async reply(content: unknown): Promise<void> {
    await this._config.replyHandler?.(this, content)
  }

  /**
   * 发送回复并中止后续处理器执行。
   * 抛出 FinishError，调度器捕获后停止处理器链。
   */
  finish(message?: string): never {
    throw new FinishError(message)
  }
}
