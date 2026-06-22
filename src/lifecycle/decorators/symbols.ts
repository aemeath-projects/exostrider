/** Service 装饰器元数据 Symbol key 定义。 */

/** 预留，供消费者通过 context.metadata 读取服务名。 */
export const SERVICE_NAME = Symbol('SERVICE_NAME')

/** @Inject 字段列表 key */
export const SERVICE_INJECTS = Symbol('SERVICE_INJECTS')

/** @Provide 字段列表 key */
export const SERVICE_PROVIDES = Symbol('SERVICE_PROVIDES')

/** @Startup 方法名 key */
export const SERVICE_STARTUP = Symbol('SERVICE_STARTUP')

/** @Shutdown 方法名 key */
export const SERVICE_SHUTDOWN = Symbol('SERVICE_SHUTDOWN')

/** Inject 条目 */
export interface InjectEntry {
  readonly propertyName: string | symbol
  readonly serviceKey: string
}

/** Provide 条目 */
export interface ProvideEntry {
  readonly propertyName: string | symbol
  readonly serviceKey: string
}
