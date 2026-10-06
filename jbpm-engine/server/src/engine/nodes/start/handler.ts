// Start event — begins a path. Triggered starts (signal/message/timer) are handled at instance start
// (signal/message: execution-engine.ts's startTriggeredProcesses; timer: deployments/service.ts
// schedules a TimerJob the moment a deployment activates).
import type { NodeHandler } from '../types.ts';
export const handler: NodeHandler = () => ({});
