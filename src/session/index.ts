/**
 * session 模块统一导出入口。
 */

export { TimeoutMode } from './enums.js'
export { makeTimeoutConfig, resolveTimeout } from './timeout.js'
export type { TimeoutConfig } from './timeout.js'
export { DEFAULT_CANCEL_COMMANDS, DEFAULT_CONFIRM_COMMANDS } from './commands.js'
export { InMemoryLockProvider, getCancelCommands, getConfirmCommands } from './lock.js'
export type { SessionConfig, LockProvider } from './lock.js'
export type { StateDefinition, StateTransitionResult, TransitionConfig } from './state.js'
export { SessionContext } from './context.js'
export { StateMachine, StateMachineError, InvalidTransitionError } from './state-machine.js'
export { InteractiveSession } from './base.js'
export { SESSION_META_KEY, STATE_META_KEY, INPUT_META_KEY, EXIT_META_KEY } from './base.js'
export type { SessionClassMeta, StateMethMeta, InputMethMeta, ExitMethMeta } from './base.js'
export { interactiveSession, state, onInput, onExit } from './decorators.js'
export type { InteractiveSessionOptions, StateDecoratorOptions } from './decorators.js'
export { SessionManager } from './manager.js'
export type { SessionManagerOptions } from './manager.js'
