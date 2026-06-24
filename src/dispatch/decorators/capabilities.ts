/** Bot 能力类型与 @RequiresBotCapability 装饰器。 */
import { getOrCreateMethodEntry } from './utils'

/** Bot 在群内需要具备的权限等级。 */
export type BotCapability = 'group_admin' | 'group_owner'

/**
 * 声明 handler 方法执行时 bot 需要在群内具备的权限。
 * 'group_admin'：bot 需为群管理员或群主。
 * 'group_owner'：bot 需为群主。
 */
export function RequiresBotCapability(capability: BotCapability) {
  return function (_target: unknown, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.requiredBotCapability = capability
  }
}
