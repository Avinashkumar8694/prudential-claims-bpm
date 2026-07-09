import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'userTask',
  palette: [{ key: 'userTask', label: 'User Task', category: 'Tasks', icon: '👤', color: '#2563eb', engineType: 'userTask', defaults: { type: 'userTask', name: 'User Task', group: 'user' } }],
  ports: { in: true, out: true },
  schema: [GENERAL, { title: 'Assignment', fields: [
    { key: 'group', label: 'Group / role', widget: 'text', placeholder: 'examiners' },
    { key: 'assignee', label: 'Assignee (specific user)', widget: 'text' },
    { key: 'businessAdmin', label: 'Business administrator', widget: 'text' },
    { key: 'excludedOwners', label: 'Excluded owners', widget: 'stringlist' },
  ] }, { title: 'Form & behavior', fields: [
    { key: 'form', label: 'Form name', widget: 'text' },
    { key: 'priority', label: 'Priority', widget: 'number' },
    { key: 'dueDate', label: 'Due date / SLA', widget: 'text', placeholder: 'PT8H or 2026-01-01' },
    { key: 'skippable', label: 'Skippable', widget: 'bool' },
    { key: 'description', label: 'Task description', widget: 'textarea' },
  ] }, { title: 'Data', fields: [
    { key: 'inputs', label: 'Task inputs (taskVar ← $processVar)', widget: 'keyval' },
    { key: 'outputs', label: 'Task outputs (processVar ← taskVar)', widget: 'keyval' },
  ] }],
};
