/** @Startup / @Shutdown 方法装饰器，标记服务的启动和关闭方法。 */

import { SERVICE_STARTUP, SERVICE_SHUTDOWN } from './symbols.js'

/** 标记服务启动方法。每个类最多一个。 */
export function Startup(_target: unknown, context: ClassMethodDecoratorContext): void {
  const existing = context.metadata[SERVICE_STARTUP]
  if (existing !== undefined) {
    const existingStr =
      typeof existing === 'string' || typeof existing === 'symbol' ? String(existing) : '(unknown)'
    throw new Error(`@Startup 只能标记一个方法，已标记: ${existingStr}`)
  }
  context.metadata[SERVICE_STARTUP] = context.name
}

/** 标记服务关闭方法。每个类最多一个。 */
export function Shutdown(_target: unknown, context: ClassMethodDecoratorContext): void {
  const existing = context.metadata[SERVICE_SHUTDOWN]
  if (existing !== undefined) {
    const existingStr =
      typeof existing === 'string' || typeof existing === 'symbol' ? String(existing) : '(unknown)'
    throw new Error(`@Shutdown 只能标记一个方法，已标记: ${existingStr}`)
  }
  context.metadata[SERVICE_SHUTDOWN] = context.name
}
