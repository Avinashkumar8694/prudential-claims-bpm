// Example 14 — author a user-task FORM in the engine model, convert to a jBPM .frm, and use it at
// runtime. You write which of a type's fields to show (bind + optional label); the widget is DERIVED
// from each field's type. fromEngineProject generates the Business Central form definition, and a
// userTask node bound to the form name wires it to the task. See docs/bpm-assets/form/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { renderModel, validateSubmission } from '../functions/form.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const CLAIM_TYPE = { name: 'Claim', fields: [
  { name: 'amount', type: 'double' }, { name: 'status', type: 'string' },
  { name: 'urgent', type: 'boolean' }, { name: 'notes', type: 'string' },
] };

export const FORM = {
  name: 'ClaimReview',
  type: 'Claim',
  fields: [
    { bind: 'amount', label: 'Claim amount', readOnly: true },   // double  -> DoubleBox
    { bind: 'status', label: 'Status', required: true },          // string  -> TextBox
    { bind: 'urgent' },                                           // boolean -> CheckBox
    { bind: 'notes', widget: 'textarea' },                        // override the derived widget
  ],
};

export function buildFormProject(dir) {
  const engine = {
    types: [CLAIM_TYPE],
    forms: [FORM],
    processes: [{
      id: 'review-claims', name: 'Review claims',
      nodes: [
        { id: 's', type: 'start' },
        { id: 'u', type: 'userTask', name: 'Review claim', group: 'ClaimsExaminer', form: 'ClaimReview' },
        { id: 'e', type: 'end' },
      ],
      flows: [{ from: 's', to: 'u' }, { from: 'u', to: 'e' }],
    }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'forms');
  const { project, written } = buildFormProject(dir);
  printWritten('form project', dir, written);
  console.log('\nGenerated ClaimReview.frm:\n');
  console.log(project.descriptor.files['src/main/resources/forms/ClaimReview.frm']);

  // runtime: build a UI render model + validate a submission
  console.log('renderModel ->', JSON.stringify(renderModel(FORM, CLAIM_TYPE), null, 0));
  console.log('validate {} ->', JSON.stringify(validateSubmission(FORM, {})));                  // status required
  console.log('validate {status:"OPEN"} ->', JSON.stringify(validateSubmission(FORM, { status: 'OPEN' })));
}
