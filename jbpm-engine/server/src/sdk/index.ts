// Thin wrapper over @neutrinos/bpmn-sdk — the engine's authoring & conversion source of truth.
// Everything the server touches goes through here so the dependency surface is explicit and mockable.
export {
  fromEngine, toEngine, fromEngineProject, toEngineProject, makeTypeResolver,
  validateModel, serializeProcess, parseBpmn, parseProject, writeProject, autowire,
} from '@neutrinos/bpmn-sdk';

export type {
  EngineProject, EngineProcess, EngineNode, EngineFlow, EngineVar, EngineType,
  ProcessModel, ValidationResult, Project,
} from '@neutrinos/bpmn-sdk';

import { fromEngine, validateModel } from '@neutrinos/bpmn-sdk';
import type { EngineProcess, ValidationResult } from '@neutrinos/bpmn-sdk';

/** Convert an engine process to a jBPM model and validate it. */
export function validateEngineProcess(proc: EngineProcess): ValidationResult {
  const model = fromEngine(proc);
  return validateModel(model);
}
