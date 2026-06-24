/**
 * SessionManager —— 全局会话管理器。
 *
 * 负责会话生命周期管理、消息路由、互斥检查和超时管理。
 */

import type { Logger } from '../types'

import { type InteractiveSession, buildStatesFromDecorators } from './base'
import { SessionContext } from './context'
import type { LockProvider, SessionConfig } from './lock'
import { getCancelCommands, InMemoryLockProvider } from './lock'
import { StateMachine } from './state-machine'

/** 活跃会话记录。 */
interface ActiveSession<TContext> {
  readonly session: InteractiveSession<unknown, TContext>
  readonly ctx: SessionContext<TContext>
  readonly stateMachine: StateMachine<TContext>
  readonly timeout: ReturnType<typeof setTimeout>
  readonly key: string
}

/** SessionManager 构造选项。 */
export interface SessionManagerOptions<TContext> {
  /** 会话配置。 */
  readonly config: SessionConfig
  /** 锁提供者，默认使用 InMemoryLockProvider。 */
  readonly lockProvider?: LockProvider
  /** 从上下文提取会话 key 的函数。 */
  readonly keyExtractor: (ctx: TContext) => string
  /** 可选日志器。 */
  readonly logger?: Logger
}

/**
 * 泛型会话管理器。
 *
 * @template TContext 原始上下文类型（由宿主框架决定）
 */
export class SessionManager<TContext = unknown> {
  private readonly _sessions = new Map<string, ActiveSession<TContext>>()
  private readonly _lock: LockProvider
  private readonly _keyExtractor: (ctx: TContext) => string
  private readonly _config: SessionConfig
  private readonly _logger?: Logger

  constructor(options: SessionManagerOptions<TContext>) {
    this._config = options.config
    this._lock = options.lockProvider ?? new InMemoryLockProvider()
    this._keyExtractor = options.keyExtractor
    this._logger = options.logger
  }

  /**
   * 启动交互式会话。
   *
   * @param session 会话实例。
   * @param ctx 触发会话的原始上下文。
   * @param replyFn 向用户发送消息的函数。
   */
  async start(
    session: InteractiveSession<unknown, TContext>,
    ctx: TContext,
    replyFn?: (content: unknown) => Promise<void>,
  ): Promise<void> {
    const key = this._keyExtractor(ctx)
    const ttl = this._config.sessionTimeout * 1000

    const acquired = await this._lock.acquire(key, ttl)
    if (!acquired) {
      this._logger?.warn(`会话 ${key} 已存在，拒绝重复启动`)
      return
    }

    const sessionCtx = new SessionContext<TContext>(ctx, { reply: replyFn })

    // 构建状态列表（配置式优先，否则从装饰器 DSL 构建）
    let states = session.buildStates()
    if (states.length === 0) {
      states = buildStatesFromDecorators(session)
    }

    const stateMachine = new StateMachine<TContext>(states)

    // 设置超时
    const timeoutMs = this._config.sessionTimeout * 1000
    const timeoutHandle: ReturnType<typeof setTimeout> = setTimeout(() => {
      // setTimeout 回调是同步的，IIFE 内部有完整 try/catch/finally，Promise 拒绝不会逃逸，void 安全
      void (async () => {
        const active = this._sessions.get(key)
        if (active === undefined) return
        try {
          await active.session.onTimeout?.(active.ctx)
        } catch (err) {
          this._logger?.error('onTimeout 钩子异常', err)
        } finally {
          await this._cleanup(key)
        }
      })()
    }, timeoutMs)

    const active: ActiveSession<TContext> = {
      session,
      ctx: sessionCtx,
      stateMachine,
      timeout: timeoutHandle,
      key,
    }
    this._sessions.set(key, active)

    try {
      await session.onStart?.(sessionCtx)
      await stateMachine.start(sessionCtx)
    } catch (err) {
      this._logger?.error(`会话 ${key} 启动异常`, err)
      await this._cleanup(key)
      throw err
    }
  }

  /**
   * 将用户消息路由到活跃会话。
   *
   * @param ctx 原始上下文。
   * @param text 用户输入文本。
   * @returns true 表示消息已被消费，false 表示无活跃会话。
   */
  async processMessage(ctx: TContext, text: string): Promise<boolean> {
    const key = this._keyExtractor(ctx)
    const active = this._sessions.get(key)
    if (active === undefined) return false

    // 检查是否为取消命令
    const cancelCmds = getCancelCommands(this._config)
    if (cancelCmds.has(text.trim())) {
      await this.cancel(key)
      return true
    }

    try {
      const result = await active.stateMachine.processInput(active.ctx, text)
      if (result.finished === true || active.stateMachine.isFinished) {
        try {
          await active.session.onFinish?.(active.ctx, result.data)
        } catch (err) {
          this._logger?.error('onFinish 钩子异常', err)
        }
        await this._cleanup(key)
      }
    } catch (err) {
      this._logger?.error(`会话 ${key} 处理输入异常`, err)
      try {
        await active.session.onError?.(
          active.ctx,
          err instanceof Error ? err : new Error(String(err)),
        )
      } catch {
        // 忽略 onError 本身的异常
      }
      await this._cleanup(key)
    }

    return true
  }

  /**
   * 取消指定会话。
   *
   * @param key 会话 key。
   */
  async cancel(key: string): Promise<void> {
    const active = this._sessions.get(key)
    if (active === undefined) return

    try {
      await active.session.onCancel?.(active.ctx)
    } catch (err) {
      this._logger?.error('onCancel 钩子异常', err)
    } finally {
      await this._cleanup(key)
    }
  }

  /**
   * 检查指定 key 是否有活跃会话。
   */
  isActive(key: string): boolean {
    return this._sessions.has(key)
  }

  /**
   * 返回当前活跃会话数量。
   */
  getActiveCount(): number {
    return this._sessions.size
  }

  /**
   * 取消所有活跃会话（用于优雅关闭）。
   */
  async cancelAll(): Promise<void> {
    const keys = [...this._sessions.keys()]
    await Promise.allSettled(keys.map((k) => this.cancel(k)))
  }

  /* 私有方法 */

  private async _cleanup(key: string): Promise<void> {
    const active = this._sessions.get(key)
    if (active !== undefined) {
      clearTimeout(active.timeout)
      this._sessions.delete(key)
      await this._lock.release(key)
    }
  }
}
