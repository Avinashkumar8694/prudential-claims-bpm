import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'userTask',
  palette: [{ key: 'userTask', label: 'User Task', category: 'Tasks', icon: '👤', color: '#2563eb', engineType: 'userTask', defaults: { type: 'userTask', name: 'User Task', group: 'user' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Assignment', fields: [
    { key: 'group', label: 'Group / role', widget: 'text', placeholder: 'examiners' },
    { key: 'assignee', label: 'Assignee (specific user)', widget: 'text' },
    { key: 'businessAdmin', label: 'Business administrator', widget: 'text' },
    { key: 'excludedOwners', label: 'Excluded owners', widget: 'stringlist' },
  ] }, { title: 'Form & behavior', fields: [
    { key: 'form', label: 'Form name', widget: 'assetRef', assetKind: 'forms' },
    { key: 'priority', label: 'Priority', widget: 'number' },
    { key: 'dueDate', label: 'Due date / SLA', widget: 'text', placeholder: 'PT8H or 2026-01-01' },
    { key: 'skippable', label: 'Skippable', widget: 'bool' },
    { key: 'description', label: 'Task description', widget: 'textarea' },
  ] }, { title: 'Data', fields: [
    { key: 'inputs', label: 'Task inputs (taskVar ← processVar)', widget: 'keyval', valueSource: 'ownRef', help: 'Left = the field name the form/UI sees on this task. Right = "$name" to copy one of this process\'s own variables in, or a literal value.' },
    { key: 'outputs', label: 'Task outputs (processVar ← taskVar)', widget: 'keyval', keySource: 'own', help: 'Left = the process variable to write (pick an existing one to overwrite it, or type a new name). Right = the field name submitted on this task.' },
  ] }],
  diagram: { icon: 'user', color: '#2563eb', shape: 'rectangle' },
  typeLabel: 'User task',
};
