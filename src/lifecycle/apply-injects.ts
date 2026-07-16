/** 依赖注入应用工具 —— 按 injects 元数据列表，把解析出的服务实例赋值到目标对象属性上。 */

import type { InjectEntry } from './decorators/index'

/**
 * 按 injects 元数据列表，将 resolve 解析出的服务实例赋值到 target 的对应属性上。
 *
 * 供 `LifecycleOrchestrator.startup()`（读取 `ServiceEntry.injects`）和
 * `HandlerRegistry.instantiate()`（读取 TC39 装饰器 metadata 中的 `SERVICE_INJECTS`）
 * 共用，避免"遍历 injects、按 serviceKey 查找服务、赋值到实例属性"这套逻辑
 * 在两处各自实现一遍。
 */
export function applyInjects(
  target: Record<string | symbol, unknown>,
  injects: readonly InjectEntry[],
  resolve: (serviceKey: string) => unknown,
): void {
  for (const inject of injects) {
    target[inject.propertyName] = resolve(inject.serviceKey)
  }
}
