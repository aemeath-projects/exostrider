/** lifecycle 模块 barrel 导出。 */

export { LifecycleOrchestrator } from './orchestrator'
export { ServiceRegistry } from './service-registry'
export { applyInjects } from './apply-injects'
export {
  Inject,
  Provide,
  Startup,
  Shutdown,
  Service,
  serviceEntryRegistry,
  type ServiceOptions,
  type InjectEntry,
  type ProvideEntry,
  SERVICE_NAME,
  SERVICE_INJECTS,
  SERVICE_PROVIDES,
  SERVICE_STARTUP,
  SERVICE_SHUTDOWN,
} from './decorators/index'
export type { ServiceEntry } from './service-entry'
