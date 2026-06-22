/** 生命周期装饰器 barrel 导出。 */

export { Inject } from './inject'
export { Provide } from './provide'
export { Startup, Shutdown } from './lifecycle'
export { Service, serviceEntryRegistry, type ServiceOptions } from './service'
export {
  SERVICE_NAME,
  SERVICE_INJECTS,
  SERVICE_PROVIDES,
  SERVICE_STARTUP,
  SERVICE_SHUTDOWN,
  type InjectEntry,
  type ProvideEntry,
} from './symbols'
