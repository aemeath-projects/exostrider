/**
 * Exostrider 主入口 —— 门面类，组装全部五个模块，提供一行启动能力。
 *
 * 这是唯一允许从多个子模块同时 import 的文件。
 */

import type { Logger as PinoLogger } from 'pino'

import { handlerRegistry, EventDispatcher, CompositeHandlerMapping, Context } from './dispatch'
import type { ContextConfig, HandlerInterceptor, HandlerRegistry } from './dispatch'
import { EchoLoader } from './echo'
import type { EchoConfig, EchoValidator } from './echo'
import { LifecycleOrchestrator, ServiceRegistry, serviceEntryRegistry } from './lifecycle'
import { createLogger, setLogger, logBroadcaster, LogBroadcaster } from './logger'
import type { CreateLoggerOptions } from './logger'
import { SessionManager } from './session'
import type { SessionConfig, LockProvider } from './session'

export type { EchoConfig, EchoValidator }
export { Context }
export type { ContextConfig, HandlerInterceptor }
export type { SessionConfig, LockProvider }
export type { CreateLoggerOptions, PinoLogger }
export { LogBroadcaster }

/** Exostrider 构造选项。 */
export interface ExostriderOptions<
  TEvent = unknown,
  TApis = unknown,
  // TServiceMap 由 Exostrider 类使用，接口中仅占位确保泛型约束对齐
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TServiceMap extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly echo: {
    readonly config: EchoConfig
    readonly baseDir: string
    readonly validators?: Record<string, EchoValidator>
  }
  readonly dispatch: {
    readonly contextConfig: ContextConfig<TEvent, TApis>
    readonly interceptors?: HandlerInterceptor<TEvent, TApis>[]
  }
  readonly session?: {
    readonly config: SessionConfig
    readonly lockProvider?: LockProvider
    readonly keyExtractor: (ctx: Context<TEvent, TApis>) => string
  }
  /**
   * 日志器配置：
   * - 不提供 → 使用默认参数调用 createLogger()
   * - 提供 CreateLoggerOptions → 调用 createLogger(opts)
   * - 提供 PinoLogger 实例（含 .info 方法）→ 直接使用
   */
  readonly logger?: CreateLoggerOptions | PinoLogger
}

/**
 * Exostrider 门面类 —— 组装 echo、lifecycle、dispatch、session、logger 五个模块。
 *
 * 用法示例：
 * ```ts
 * const exo = new Exostrider({ echo: { ... }, dispatch: { ... } })
 * await exo.bootstrap()
 * await exo.dispatch(event, apis)
 * await exo.shutdown()
 * ```
 */
export class Exostrider<
  TEvent = unknown,
  TApis = unknown,
  TServiceMap extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly echo: EchoLoader
  readonly lifecycle: LifecycleOrchestrator<TServiceMap>
  readonly registry: ServiceRegistry<TServiceMap>
  readonly handlerRegistry: HandlerRegistry<TEvent, TApis>
  readonly session?: SessionManager<Context<TEvent, TApis>>
  readonly logger: PinoLogger
  readonly logBroadcaster: LogBroadcaster

  // dispatcher 在 bootstrap 后才可用，初始为 null
  private _dispatcher: EventDispatcher<TEvent, TApis> | null = null
  private readonly _options: ExostriderOptions<TEvent, TApis, TServiceMap>

  constructor(options: ExostriderOptions<TEvent, TApis, TServiceMap>) {
    this._options = options

    // 1. 确定 logger
    // 检测策略：PinoLogger 实例必然含有 .info 方法；CreateLoggerOptions 是普通配置对象，不含该方法。
    // 因此以 'info' in logOpts 区分"已构造的 logger 实例"与"待传入 createLogger() 的选项对象"。
    const logOpts = options.logger
    if (!logOpts || (typeof logOpts === 'object' && !('info' in logOpts))) {
      // 未提供或为 CreateLoggerOptions（无 .info 方法）
      this.logger = createLogger(logOpts)
    } else {
      // 已是 PinoLogger 实例（含 .info 方法）
      this.logger = logOpts
    }
    setLogger(this.logger)
    this.logBroadcaster = logBroadcaster

    // 2. 创建各模块实例，注入 logger
    this.registry = new ServiceRegistry<TServiceMap>()
    this.lifecycle = new LifecycleOrchestrator<TServiceMap>(this.registry, { logger: this.logger })
    // 使用全局 handlerRegistry 单例：
    // - @Handler 装饰器在模块加载时以副作用形式向该单例写入注册项，
    //   因此所有 Exostrider 实例天然共享同一个注册表。
    // - 预期使用模式为单实例：整个进程只创建一个 Exostrider。
    // - 若需要隔离（如测试场景），在创建新实例前调用 handlerRegistry.clear() 清空注册表。
    this.handlerRegistry = handlerRegistry as unknown as HandlerRegistry<TEvent, TApis>
    this.echo = new EchoLoader(options.echo.config, options.echo.baseDir, {
      validators: options.echo.validators,
      logger: this.logger,
    })

    // 3. 可选 session
    if (options.session) {
      this.session = new SessionManager<Context<TEvent, TApis>>({
        config: options.session.config,
        lockProvider: options.session.lockProvider,
        keyExtractor: options.session.keyExtractor,
        logger: this.logger,
      })
    }
  }

  /**
   * dispatcher 属性访问器 —— bootstrap 前返回空映射的临时实例，bootstrap 后返回正式实例。
   *
   * 注意：在 bootstrap() 调用之前调用 dispatch() 不会路由到任何 handler。
   */
  get dispatcher(): EventDispatcher<TEvent, TApis> {
    if (this._dispatcher !== null) return this._dispatcher
    // 返回一个空映射的临时实例（bootstrap 前调用不会命中任何 handler）
    return new EventDispatcher<TEvent, TApis>({
      mapping: new CompositeHandlerMapping(),
      interceptors: this._options.dispatch.interceptors,
      contextConfig: this._options.dispatch.contextConfig,
      logger: this.logger,
    })
  }

  /**
   * 启动框架：发现模块 → 启动服务生命周期 → 实例化 handler → 构建分发映射。
   */
  async bootstrap(): Promise<void> {
    // 1. 发现所有 echo 模块（副作用：@Handler / @Service 装饰器自动注册到全局注册表）
    await this.echo.discoverAll()

    // 2. 收集 @Service 装饰器注册的服务条目
    const entries = [...serviceEntryRegistry.values()]

    // 3. 启动生命周期（拓扑排序 + 依赖注入）
    if (entries.length > 0) {
      await this.lifecycle.startup(entries)
    }

    // 4. 实例化 handler，支持从 ServiceRegistry 注入依赖
    this.handlerRegistry.instantiate((key) => {
      try {
        return this.registry.get(key)
      } catch {
        return undefined
      }
    })

    // 5. 构建 mapping 并创建正式 EventDispatcher
    const mapping = this.handlerRegistry.buildMappings()
    this._dispatcher = new EventDispatcher<TEvent, TApis>({
      mapping,
      interceptors: this._options.dispatch.interceptors,
      contextConfig: this._options.dispatch.contextConfig,
      logger: this.logger,
    })
  }

  /**
   * 分发事件到已注册的 handler。
   *
   * @param event - 原始事件对象
   * @param apis - 平台 API 对象
   */
  async dispatch(event: TEvent, apis: TApis): Promise<void> {
    await this.dispatcher.dispatch(event, apis)
  }

  /**
   * 优雅关闭：取消所有活跃会话，然后关闭服务生命周期。
   *
   * 关闭完成后，dispatcher 被重置为 null；此后调用 dispatch() 将使用空映射的临时实例，
   * 静默返回而不抛出异常（不会路由到任何 handler）。
   */
  async shutdown(): Promise<void> {
    if (this.session) {
      await this.session.cancelAll()
    }
    await this.lifecycle.shutdown()
    this._dispatcher = null
  }
}
