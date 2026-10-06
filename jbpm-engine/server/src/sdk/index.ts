// Thin, stable indirection over @fabrixly/bpmn-sdk — the rest of this server imports its engine model
// types (EngineProcess/EngineNode/EngineFlow) and BPMN2 import/export functions (fromEngine/toEngine)
// from HERE, not from the SDK package directly, so a future SDK API change only needs adapting once.
export type {
  EngineProcess, EngineNode, EngineFlow, EngineType, EngineVar, EventDef,
  ProcessModel, Project, ProjectDescriptor, ValidationResult as SdkValidationResult,
  EngineDecision, EngineDecisionModel, DecisionField, DecisionRule, InputTest, OutputResult, HitPolicy, Aggregation,
} from '@fabrixly/bpmn-sdk';
export {
  fromEngine, toEngine, fromEngineProject, toEngineProject,
  parseBpmn, parseBpmnAll, serializeProcess, parseProject, writeProject,
  validateModel, autowire,
} from '@fabrixly/bpmn-sdk';

import type { EngineProcess } from '@fabrixly/bpmn-sdk';
import { fromEngine, validateModel } from '@fabrixly/bpmn-sdk';

/** Convert an engine process to its real jBPM/BPMN2 model shape and structurally validate it —
 *  reuses bpmn-sdk's OWN validateModel (the same checks that guard real BPMN2 export), so this
 *  engine's own validation/rules.ts is additive on top of it, never a re-implementation. */
export function validateEngineProcess(ep: EngineProcess) {
  const model = fromEngine(ep);
  return validateModel(model);
}
