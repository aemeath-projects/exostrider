/** @SettingNode 装饰器：声明 Handler 上的可配置项。 */

import { HANDLER_SETTINGS, type SettingNodeEntry, type SettingNodeOptions } from './symbols.js'

export type { SettingNodeOptions }

/**
 * 声明可配置项。可叠加多个。
 * key 为原始 key（不含前缀），前缀由 @Handler 在注册阶段拼接。
 */
export function SettingNode(key: string, options: SettingNodeOptions) {
  return function (_target: unknown, context: ClassDecoratorContext) {
    const metadata = context.metadata
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- TC39 规范保证非空，但防御性检查以兼容非标准环境
    if (!metadata) return

    const entry: SettingNodeEntry = { key, options }

    const handlerSettings: SettingNodeEntry[] = ((metadata[HANDLER_SETTINGS] as
      | SettingNodeEntry[]
      | undefined) ??= [])
    handlerSettings.push(entry)
  }
}
