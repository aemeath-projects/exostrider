/** 客户端连接状态。 */
export type ClientState = 'connected' | 'connecting' | 'disconnected' | 'error'

/** 客户端适配器接口 —— 由使用方实现，桥接具体协议。 */
export interface ClientAdapter<TClient> {
  readonly id: string
  readonly client: TClient
  readonly state: ClientState
  connect(): Promise<void>
  disconnect(): Promise<void>
  healthCheck(): Promise<boolean>
}
