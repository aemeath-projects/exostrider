/** Handler 方法路由装饰器：@OnCommand、@OnKeyword、@OnRegex 等。 */

import { getOrCreateMethodEntry } from './utils.js'

export interface OnCommandOptions {
  aliases?: string[]
}

/** key-value 事件匹配配置 */
export type EventMatchConfig = Record<string, unknown>

/** 将方法注册为指令处理器（匹配命令格式的消息）。 */
export function OnCommand(cmd: string, opts?: OnCommandOptions) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'command'
    entry.trigger = { cmd, aliases: opts?.aliases ? new Set(opts.aliases) : undefined }
  }
}

/** 将方法注册为关键词处理器（消息含任意关键词时触发）。 */
export function OnKeyword(keywords: string[]) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'keyword'
    entry.trigger = { keywords: new Set(keywords) }
  }
}

/** 将方法注册为正则匹配处理器。 */
export function OnRegex(pattern: RegExp) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'regex'
    entry.trigger = { compiledPattern: pattern }
  }
}

/** 将方法注册为前缀匹配处理器。 */
export function OnStartsWith(prefix: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'startswith'
    entry.trigger = { prefix }
  }
}

/** 将方法注册为后缀匹配处理器。 */
export function OnEndsWith(suffix: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'endswith'
    entry.trigger = { suffix }
  }
}

/** 将方法注册为全量匹配处理器（消息完全等于指定文本时触发）。 */
export function OnFullMatch(text: string) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'fullmatch'
    entry.trigger = { text }
  }
}

/**
 * 将方法注册为事件类型处理器，按 key-value 匹配事件对象字段。
 * 例如 OnEvent({ postType: 'notice', noticeType: 'friend_add' })
 */
export function OnEvent(config: EventMatchConfig) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  return function (_target: Function, context: ClassMethodDecoratorContext) {
    const entry = getOrCreateMethodEntry(context)
    entry.mappingType = 'event'
    entry.trigger = { matchConfig: config }
  }
}
