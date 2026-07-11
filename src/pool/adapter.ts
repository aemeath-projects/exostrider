/** 客户端连接状态。 */
export type ClientState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'error'

/** wireToPool 所需的连接池最小接口，避免循环依赖。 */
export interface PoolEmitter {
  emitFromClient(clientId: string, event: unknown, role: string): void
  notifyStateChange(clientId: string, from: ClientState, to: ClientState): void
}

/**
 * 客户端适配器接口 —— 由使用方实现，桥接具体协议。
 *
 * 连接生命周期（何时重连、何时放弃）完全由适配器背后的客户端自行决定，
 * ClientPool 只做注册聚合与只读状态观测，因此本接口不包含 healthCheck/forceReconnect
 * 这类会让连接池反向操作连接生命周期的方法。
 */
export interface ClientAdapter<TClient> {
  readonly id: string
  readonly client: TClient
  readonly state: ClientState
  connect(): Promise<void>
  disconnect(): Promise<void>
  /** 可选：在 addClient 时由连接池自动调用，绑定客户端原生事件到连接池。 */
  wireToPool?(pool: PoolEmitter, role: string): void
}
