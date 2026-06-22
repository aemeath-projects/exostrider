/** dispatch 模块错误类定义。 */

/** 由 ctx.finish() 抛出，用于中止后续处理器执行（正常流程终止，非错误）。 */
export class FinishError extends Error {
  constructor(message?: string) {
    super(message ?? '')
    this.name = 'FinishError'
  }
}
