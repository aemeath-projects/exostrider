/**
 * session 模块统一导出入口。
 */

export { TimeoutMode } from './enums'
export { makeTimeoutConfig, resolveTimeout } from './timeout'
export type { TimeoutConfig } from './timeout'
export { DEFAULT_CANCEL_COMMANDS, DEFAULT_CONFIRM_COMMANDS } from './commands'
export { InMemoryLockProvider, getCancelCommands, getConfirmCommands } from './lock'
export type { SessionConfig, LockProvider } from './lock'
export type { StateDefinition, StateTransitionResult, TransitionConfig } from './state'
export { SessionContext } from './context'
export { StateMachine, StateMachineError, InvalidTransitionError } from './state-machine'
export { InteractiveSession } from './base'
export { SESSION_META_KEY, STATE_META_KEY, INPUT_META_KEY, EXIT_META_KEY } from './base'
export type { SessionClassMeta, StateMethMeta, InputMethMeta, ExitMethMeta } from './base'
export { interactiveSession, state, onInput, onExit } from './decorators'
export type { InteractiveSessionOptions, StateDecoratorOptions } from './decorators'
export { SessionManager } from './manager'
export type { SessionManagerOptions } from './manager'
