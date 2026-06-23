/**
 * 生命周期编排器 —— 读取 ServiceEntry 列表，拓扑排序后按序实例化、注入、启动/关闭。
 */

import type { Logger } from '../types'

import type { ServiceEntry } from './service-entry'
import type { ServiceRegistry } from './service-registry'

/**
 * 管理业务模块的启动与关闭。
 *
 * 典型用法：
 * ```ts
 * const registry = new ServiceRegistry()
 * const orchestrator = new LifecycleOrchestrator(registry)
 * await orchestrator.startup(entries)
 * // ...
 * await orchestrator.shutdown()
 * ```
 */
export class LifecycleOrchestrator<TMap extends Record<string, unknown> = Record<string, unknown>> {
  private readonly _registry: ServiceRegistry<TMap>
  private readonly _logger?: Logger
  private _startedEntries: { entry: ServiceEntry; instance: Record<string | symbol, unknown> }[] =
    []
  private _started = false

  constructor(registry: ServiceRegistry<TMap>, options?: { logger?: Logger }) {
    this._registry = registry
    this._logger = options?.logger
  }

  /**
   * 按拓扑顺序实例化并启动所有已注册业务模块。
   *
   * @param entries - 服务条目列表（由 @Service 装饰器注册）
   */
  async startup(entries: readonly ServiceEntry[]): Promise<void> {
    if (this._started) {
      throw new Error('LifecycleOrchestrator.startup() 已被调用，不可重复启动')
    }

    const ordered = this._topoSort(entries)

    try {
      for (const entry of ordered) {
        // 1. 实例化服务类
        const instance = new (entry.serviceClass as new () => Record<string | symbol, unknown>)()

        // 2. 注入 @Inject 字段
        for (const inject of entry.injects) {
          instance[inject.propertyName] = this._registry.get(inject.serviceKey)
        }

        // 3. 调用 @Startup 方法
        if (entry.startupMethod !== null) {
          const method = instance[entry.startupMethod]
          if (typeof method !== 'function') {
            throw new Error(
              `[${entry.name}] @Startup 方法 '${String(entry.startupMethod)}' 不是函数`,
            )
          }
          await (method as () => Promise<void>).call(instance)
        }

        // 4. 注册 @Provide 声明的额外 key（读取字段值）
        for (const provide of entry.provides) {
          this._registry.set(
            provide.serviceKey,
            instance[provide.propertyName] as TMap[keyof TMap & string],
          )
        }

        this._startedEntries.push({ entry, instance })
        this._logger?.debug(`服务已启动: ${entry.name}`)
      }

      // 所有服务启动完成后冻结注册表，禁止运行时再次注册
      this._registry.freeze()
      this._started = true
    } catch (err) {
      this._logger?.error(`Startup 失败，正在回滚已启动服务: ${String(err)}`)
      await this.shutdown()
      throw err
    }
  }

  /**
   * 按启动逆序关闭所有已注册 @Shutdown 方法的模块。
   */
  async shutdown(): Promise<void> {
    for (const { entry, instance } of [...this._startedEntries].reverse()) {
      if (entry.shutdownMethod === null) continue

      try {
        const method = instance[entry.shutdownMethod]
        if (typeof method !== 'function') {
          this._logger?.warn(
            `[${entry.name}] @Shutdown 方法 '${String(entry.shutdownMethod)}' 不是函数，跳过`,
          )
          continue
        }
        await (method as () => Promise<void>).call(instance)
        this._logger?.debug(`服务已关闭: ${entry.name}`)
      } catch (err) {
        this._logger?.error(`关闭服务 ${entry.name} 时发生错误: ${String(err)}`)
      }
    }
    this._startedEntries = []
    this._started = false
  }

  /**
   * Kahn 算法拓扑排序。
   *
   * @param entries - 待排序的服务条目列表
   * @returns 按依赖顺序排列的条目列表
   * @throws {Error} 存在循环依赖或未满足的依赖时抛出
   */
  private _topoSort(entries: readonly ServiceEntry[]): ServiceEntry[] {
    const entryMap = new Map(entries.map((e) => [e.name, e]))

    // 构建：serviceKey → 提供该 key 的 entry.name
    const provideMap = new Map<string, string>()
    for (const entry of entries) {
      for (const provide of entry.provides) {
        const existing = provideMap.get(provide.serviceKey)
        if (existing !== undefined) {
          throw new Error(
            `serviceKey "${provide.serviceKey}" 被多个服务提供: "${existing}" 与 "${entry.name}"`,
          )
        }
        provideMap.set(provide.serviceKey, entry.name)
      }
    }

    // 构建邻接表和入度表：若 A inject X 且 B provides X，则 B 必须在 A 之前启动（B → A 边）
    const adj = new Map<string, Set<string>>() // provider → dependents
    const inDegree = new Map<string, number>()

    for (const entry of entries) {
      if (!adj.has(entry.name)) adj.set(entry.name, new Set())
      if (!inDegree.has(entry.name)) inDegree.set(entry.name, 0)
    }

    for (const entry of entries) {
      for (const inject of entry.injects) {
        const provider = provideMap.get(inject.serviceKey)
        if (provider !== undefined && provider !== entry.name) {
          const providerSet = adj.get(provider)
          if (providerSet) providerSet.add(entry.name)
          inDegree.set(entry.name, (inDegree.get(entry.name) ?? 0) + 1)
        }
      }
    }

    // Kahn's BFS
    const queue: string[] = []
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name)
    }

    const result: ServiceEntry[] = []

    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) break
      const entry = entryMap.get(current)
      if (!entry) continue
      result.push(entry)

      for (const dependent of adj.get(current) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 0) - 1
        inDegree.set(dependent, newDegree)
        if (newDegree === 0) queue.push(dependent)
      }
    }

    if (result.length !== entries.length) {
      const remaining = entries.filter((e) => !result.includes(e)).map((e) => e.name)
      throw new Error(`循环依赖或未满足依赖检测到: ${remaining.join(', ')}`)
    }

    return result
  }
}
