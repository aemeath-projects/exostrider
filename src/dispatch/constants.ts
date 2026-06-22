/**
 * dispatch 模块常量定义。
 *
 * Permission/MessageScope 枚举对象供业务代码按名称引用权限等级/作用域。
 */

/** 权限等级枚举。 */
export const Permission = {
  ANYONE: 0,
  GROUP_MEMBER: 10,
  GROUP_ADMIN: 20,
  GROUP_OWNER: 30,
  ADMIN: 100,
} as const

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 允许消费者传入自定义权限级别
export type PermissionLevel = (typeof Permission)[keyof typeof Permission] | number

/** 消息作用域 —— 限制 handler 仅在特定消息类型中触发。 */
export const MessageScope = {
  ALL: 'all',
  GROUP: 'group',
  PRIVATE: 'private',
} as const

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 允许消费者传入自定义作用域字符串
export type MessageScopeValue = (typeof MessageScope)[keyof typeof MessageScope] | string
