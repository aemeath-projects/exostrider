/**
 * Handler 注册表 —— 统一管理 Handler 类级元数据与方法级元数据。
 *
 * 泛型 TEvent/TApis 供 buildMappings 用于生成类型安全的 CompositeHandlerMapping。
 */

import type { Logger } from '../types'

import type { MethodMetaEntry, InterceptorEntry, SettingNodeEntry } from './decorators'
import { CompositeHandlerMapping } from './mapping'
import { buildHandlerMethod } from './method-builder'

/** @Handler 类装饰器选项。 */
export interface HandlerOptions {
  name: string
  displayName?: string
  description?: string
  tags?: string[]
  defaultPriority?: number
  system?: boolean
}

/** Handler 注册表条目（TC39 Stage 3 装饰器格式）。 */
export interface HandlerRegistryData {
  readonly options: HandlerOptions
  readonly handlerClass: new (...args: unknown[]) => unknown
  readonly metadata: DecoratorMetadataObject
  readonly methods: MethodMetaEntry[]
  readonly classInterceptors: InterceptorEntry[]
  readonly settingNodes: SettingNodeEntry[]
}

/** Handler 统一注册表（平台无关泛型版本）。 */
export class HandlerRegistry<TEvent = unknown, TApis = unknown> {
  private readonly _entries: HandlerRegistryData[] = []
  private readonly _instances = new Map<string, unknown>()
  private _logger?: Logger

  /** 注入可选 logger，供 buildMappings 记录无效方法警告。 */
  setLogger(logger: Logger): void {
    this._logger = logger
  }

  /** 注册 handler。名称相同时覆盖。 */
  register(data: HandlerRegistryData): void {
    const idx = this._entries.findIndex((e) => e.options.name === data.options.name)
    if (idx >= 0) {
      this._entries[idx] = data
    } else {
      this._entries.push(data)
    }
  }

  /** 注销 handler（测试用）。 */
  unregister(name: string): void {
    const idx = this._entries.findIndex((e) => e.options.name === name)
    if (idx >= 0) {
      this._entries.splice(idx, 1)
      this._instances.delete(name)
    }
  }

  /** 判断是否已注册。 */
  has(name: string): boolean {
    return this._entries.some((e) => e.options.name === name)
  }

  /** 获取注册数据。 */
  get(name: string): HandlerRegistryData | undefined {
    return this._entries.find((e) => e.options.name === name)
  }

  /** 所有注册条目（只读视图）。 */
  get entries(): readonly HandlerRegistryData[] {
    return this._entries
  }

  /** 已注册的 handler 数量。 */
  get size(): number {
    return this._entries.length
  }

  /**
   * 实例化所有 handler，支持可选的依赖注入器。
   * @param injector - 按 key 获取服务实例的函数（可选）
   */
  instantiate(injector?: (key: string) => unknown): void {
    this._instances.clear()
    for (const data of this._entries) {
      const instance = new data.handlerClass()
      // 通过 metadata 中存储的注入信息注入依赖（SERVICE_INJECTS 兼容）
      if (injector) {
        const injectsKey = Symbol.for('service:injects')
        const injects = (data.metadata as Record<symbol, unknown>)[injectsKey] as
          | { propertyName: string | symbol; serviceKey: string }[]
          | undefined
        if (Array.isArray(injects)) {
          for (const inject of injects) {
            const svc = injector(inject.serviceKey)
            ;(instance as Record<string | symbol, unknown>)[inject.propertyName] = svc
          }
        }
      }
      this._instances.set(data.options.name, instance)
    }
  }

  /**
   * 获取已实例化的 handler 实例（需先调用 instantiate）。
   */
  getInstance(name: string): unknown {
    return this._instances.get(name)
  }

  /**
   * 构建 CompositeHandlerMapping，注册所有已实例化 handler 的方法。
   * 若尚未调用 instantiate，则自动实例化。
   * @param commandPrefix - 命令前缀（默认 '/'）
   */
  buildMappings(commandPrefix = '/'): CompositeHandlerMapping<TEvent, TApis> {
    const composite = new CompositeHandlerMapping<TEvent, TApis>(commandPrefix)

    for (const data of this._entries) {
      const instance = this._instances.get(data.options.name) ?? new data.handlerClass()

      for (const methodEntry of data.methods) {
        const priority = methodEntry.priority ?? data.options.defaultPriority ?? 50
        const resolvedEntry = { ...methodEntry, priority }
        try {
          const handlerMethod = buildHandlerMethod(data, resolvedEntry, instance as object)
          composite.register(handlerMethod)
        } catch (err) {
          this._logger?.warn(
            `buildMappings: handler "${data.options.name}" 方法 "${String(methodEntry.methodName)}" 注册失败，已跳过: ${String(err)}`,
          )
        }
      }
    }

    return composite
  }

  /** 清空所有注册项（测试用）。 */
  clear(): void {
    this._entries.length = 0
    this._instances.clear()
  }
}

/** 全局单例 Handler 注册表。 */
export const handlerRegistry = new HandlerRegistry()
