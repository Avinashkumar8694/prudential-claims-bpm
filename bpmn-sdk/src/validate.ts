import type { ProcessModel, ValidationResult } from './types.js';

/** Structural validation of a process model (same checks used to generate this project). */
export function validateModel(proc: ProcessModel): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeIds = new Set((proc.nodes || []).map((n) => n.id));

  (proc.flows || []).forEach((f) => {
    if (!nodeIds.has(f.sourceRef)) errors.push(`flow ${f.id}: sourceRef '${f.sourceRef}' is not a node`);
    if (!nodeIds.has(f.targetRef)) errors.push(`flow ${f.id}: targetRef '${f.targetRef}' is not a node`);
  });

  const actIn: Record<string, Set<string>> = {};
  const actOut: Record<string, Set<string>> = {};
  (proc.flows || []).forEach((f) => {
    (actOut[f.sourceRef] = actOut[f.sourceRef] || new Set()).add(f.id);
    (actIn[f.targetRef] = actIn[f.targetRef] || new Set()).add(f.id);
  });
  (proc.nodes || []).forEach((n) => {
    if (n.type === 'boundaryEvent' || n.type === 'raw') return;
    const din = new Set(n.incoming || []); const dout = new Set(n.outgoing || []);
    const ain = actIn[n.id] || new Set(); const aout = actOut[n.id] || new Set();
    if ([...din].sort().join() !== [...ain].sort().join()) warnings.push(`node ${n.id}: <incoming> [${[...din]}] != flows [${[...ain]}]`);
    if ([...dout].sort().join() !== [...aout].sort().join()) warnings.push(`node ${n.id}: <outgoing> [${[...dout]}] != flows [${[...aout]}]`);
  });

  const sig = new Set(((proc.declarations || { signals: [] }).signals || []).map((s) => s.name));
  const err = new Set(((proc.declarations || { errors: [] }).errors || []).map((e) => e.id));
  (proc.nodes || []).forEach((n) => {
    if (n.signalName && !sig.has(n.signalName)) warnings.push(`node ${n.id}: signal '${n.signalName}' not declared`);
    if (n.errorRef && !err.has(n.errorRef) && !n.errorRef.startsWith('org.jbpm')) warnings.push(`node ${n.id}: error '${n.errorRef}' not declared`);
    if (n.error && !err.has(n.error)) warnings.push(`event-subprocess ${n.id}: error '${n.error}' not declared`);
    if (n.type !== 'raw' && !n.position) warnings.push(`node ${n.id}: no diagram position (auto-placed)`);
  });

  return { ok: errors.length === 0, errors, warnings };
}
