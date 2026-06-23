/** 客户端连接状态。 */
export type ClientState = 'connected' | 'connecting' | 'disconnected' | 'error'

/** wireToPool 所需的连接池最小接口，避免循环依赖。 */
export interface PoolEmitter {
  emitFromClient(clientId: string, event: unknown, role: string): void
  notifyStateChange(clientId: string, from: ClientState, to: ClientState): void
}

/** 客户端适配器接口 —— 由使用方实现，桥接具体协议。 */
export interface ClientAdapter<TClient> {
  readonly id: string
  readonly client: TClient
  readonly state: ClientState
  connect(): Promise<void>
  disconnect(): Promise<void>
  healthCheck(): Promise<boolean>
  /** 可选：在 addClient 时由连接池自动调用，绑定客户端原生事件到连接池。 */
  wireToPool?(pool: PoolEmitter, role: string): void
}
