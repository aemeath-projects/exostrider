/** 角色定义。priority 数值越小优先级越高。 */
export interface RoleDefinition<TRole extends string> {
  readonly name: TRole
  readonly priority: number
}
