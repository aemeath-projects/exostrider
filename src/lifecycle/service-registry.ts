/**
 * 运行时服务注册表 —— 启动后冻结为只读。
 */

/**
 * 运行时服务注册表。启动完成后冻结为只读，按名称获取服务实例。
 * 泛型参数 TMap 提供编译期类型安全。
 */
export class ServiceRegistry<TMap extends Record<string, unknown> = Record<string, unknown>> {
  private readonly _store = new Map<string, unknown>()
  private _frozen = false

  /** 注册服务实例。冻结后调用抛出 Error。 */
  set<K extends keyof TMap & string>(key: K, value: TMap[K]): void {
    if (this._frozen) {
      throw new Error(`ServiceRegistry 已冻结，禁止在运行期注册服务（key=${key}）`)
    }
    this._store.set(key, value)
  }

  /** 按名称获取服务实例，不存在时抛出 Error。 */
  get<K extends keyof TMap & string>(key: K): TMap[K] {
    if (!this._store.has(key)) {
      throw new Error(`Service "${key}" not found in registry`)
    }
    return this._store.get(key) as TMap[K]
  }

  /** 按名称获取服务实例，不存在时返回 undefined。 */
  getOptional<K extends keyof TMap & string>(key: K): TMap[K] | undefined {
    return this._store.get(key) as TMap[K] | undefined
  }

  /** 检查服务是否已注册。 */
  has(key: string): boolean {
    return this._store.has(key)
  }

  /** 冻结注册表，禁止后续注册。由生命周期编排器在所有服务启动完成后调用。 */
  freeze(): void {
    this._frozen = true
  }

  /** 已注册服务数量。 */
  get size(): number {
    return this._store.size
  }

  /** 是否已冻结。 */
  get frozen(): boolean {
    return this._frozen
  }
}
