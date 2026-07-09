// Validation module facade. Runs the engine rule set (rules.ts) over an EngineProcess / EngineProject.
// Authoritative: publish/deploy call this and refuse on errors so an invalid process is never saved.
import type { EngineProcess, EngineProject } from '../../sdk/index.js';
import { validateProcess, type ValidationResult, type Problem } from './rules.js';
import { ApiError } from '../../infra/errors.js';

export { validateProcess };
export type { ValidationResult, Problem };

export class ValidationService {
  validate(process: EngineProcess): ValidationResult { return validateProcess(process); }

  validateProject(project: EngineProject): ValidationResult {
    const results = (project.processes || []).map((p) => validateProcess(p));
    return {
      ok: results.every((r) => r.ok),
      errors: results.flatMap((r) => r.errors),
      warnings: results.flatMap((r) => r.warnings),
      problems: results.flatMap((r) => r.problems),
    };
  }

  /** Throw VALIDATION_FAILED if the process has errors (used to gate publish/deploy). */
  assertValid(process: EngineProcess, action = 'save'): void {
    const res = this.validate(process);
    if (!res.ok) throw new ApiError('VALIDATION_FAILED', `Cannot ${action}: ${res.errors.length} validation error(s)`, res.errors);
  }
}
