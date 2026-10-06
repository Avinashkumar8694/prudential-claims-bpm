import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'userTask',
  palette: [{ key: 'userTask', label: 'User Task', category: 'Tasks', icon: '👤', color: '#2563eb', engineType: 'userTask', defaults: { type: 'userTask', name: 'User Task', group: 'user' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Assignment', fields: [
    { key: 'group', label: 'Group / role', widget: 'text', placeholder: 'examiners', help: '"$name" to resolve from a process variable at runtime, or a literal value. Comma-separate multiple groups (e.g. "examiners,managers") — any member of any listed group can claim it.' },
    { key: 'assignee', label: 'Assignee (specific user)', widget: 'text', help: '"$name" to resolve from a process variable at runtime, or a literal value. A single specific user auto-reserves the task to them directly (no claim step). Comma-separate multiple specific people (e.g. "carol,dave") to name several candidates instead — any one of them can claim it, same union-with-Group rule as claiming.' },
    { key: 'businessAdmin', label: 'Business administrator', widget: 'text', help: 'This user can claim, start, stop, complete, or reassign the task at any time — bypasses group/assignee/excludedOwners checks entirely.' },
    { key: 'excludedOwners', label: 'Excluded owners', widget: 'stringlist', help: 'Each entry accepts "$name" (a process variable) or a literal value. Listed users are blocked from claiming/completing this task even if they belong to a listed Group — segregation of duties — though a businessAdmin is exempt.' },
  ] }, { title: 'Form & behavior', fields: [
    { key: 'form', label: 'Form name', widget: 'assetRef', assetKind: 'forms', help: 'Renders this asset\'s real form on the Task Detail page instead of a raw JSON field editor.' },
    { key: 'priority', label: 'Priority', widget: 'number', help: 'Higher number sorts first in every task inbox/queue view. Purely cosmetic — no effect on claim eligibility, SLA, or execution order.' },
    { key: 'dueDate', label: 'Due date / SLA', widget: 'text', placeholder: 'PT8H or 2026-01-01', help: 'ISO-8601 duration (e.g. "PT8H") relative to task creation, or an absolute date/time. Only drives the inbox\'s overdue flag/filter.' },
    { key: 'skippable', label: 'Skippable', widget: 'bool', help: 'When on, the task\'s Skip action becomes available and bypasses completion with no output data mapped.' },
    { key: 'description', label: 'Task description', widget: 'textarea', help: 'Shown to whoever works the task, on the Task Detail page — distinct from General → Documentation above (author-only, never shown to the assignee). Engine-only field: not part of @fabrixly/bpmn-sdk\'s EngineUserTask contract, so it is not preserved on export to real jBPM BPMN2 XML.' },
  ] }, { title: 'Data', fields: [
    { key: 'inputs', label: 'Task inputs (taskVar ← processVar)', widget: 'keyval', valueSource: 'ownRef', help: 'Left = the field name the form/UI sees on this task. Right = "$name" to copy one of this process\'s own variables in, or a literal value. Computed once, at creation — a later change to the source variable does not retroactively update it.' },
    { key: 'outputs', label: 'Task outputs (processVar ← taskVar)', widget: 'keyval', keySource: 'own', help: 'Left = the process variable to write. Right = the field name submitted on this task. Applied only when the task is completed — skip() resumes with no data at all.' },
  ] }],
  diagram: { icon: 'user', color: '#2563eb', shape: 'rectangle' },
  typeLabel: 'User task',
};
