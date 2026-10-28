// Validation module facade. Runs the engine rule set (rules.ts) over an EngineProcess / EngineProject.
// Authoritative: publish/deploy call this and refuse on errors so an invalid process is never saved.
import type { EngineProcess, EngineProject } from '../../sdk/index.ts';
import { validateProcess, type ValidationResult, type Problem } from './rules.ts';
import { ApiError } from '../../infra/errors.ts';

export { validateProcess };
export type { ValidationResult, Problem };

export class ValidationService {
  validate(process: EngineProcess): Promise<ValidationResult> { return validateProcess(process); }

  async validateProject(project: EngineProject): Promise<ValidationResult> {
    const results = await Promise.all((project.processes || []).map((p) => validateProcess(p)));
    return {
      ok: results.every((r) => r.ok),
      errors: results.flatMap((r) => r.errors),
      warnings: results.flatMap((r) => r.warnings),
      problems: results.flatMap((r) => r.problems),
    };
  }

  /** Throw VALIDATION_FAILED if the process has errors (used to gate publish/deploy). */
  async assertValid(process: EngineProcess, action = 'save'): Promise<void> {
    const res = await this.validate(process);
    if (!res.ok) throw new ApiError('VALIDATION_FAILED', `Cannot ${action}: ${res.errors.length} validation error(s)`, res.errors);
  }
}
