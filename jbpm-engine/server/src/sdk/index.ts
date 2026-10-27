// Thin wrapper over @fabrixly/bpmn-sdk — the engine's authoring & conversion source of truth.
// Everything the server touches goes through here so the dependency surface is explicit and mockable.
export {
  fromEngine, toEngine, fromEngineProject, toEngineProject, makeTypeResolver,
  validateModel, serializeProcess, parseBpmn, parseProject, writeProject, autowire,
  dmnToDecisionModel,
} from '@fabrixly/bpmn-sdk';

export type {
  EngineProject, EngineProcess, EngineNode, EngineFlow, EngineVar, EngineType,
  ProcessModel, ValidationResult, Project,
  Asset, EngineForm, FormField, EngineRuleset, EngineRuleDef, DrlModel, DrlRule, EngineDecisionModel,
} from '@fabrixly/bpmn-sdk';

import { fromEngine, validateModel } from '@fabrixly/bpmn-sdk';
import type { EngineProcess, ValidationResult } from '@fabrixly/bpmn-sdk';

/** Convert an engine process to a jBPM model and validate it. */
export function validateEngineProcess(proc: EngineProcess): ValidationResult {
  const model = fromEngine(proc);
  return validateModel(model);
}
