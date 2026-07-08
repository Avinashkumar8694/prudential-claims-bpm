// Example 15 — declare ENUMERATIONS (allowed values per field) in the engine model, generate the
// .enumeration file, and use them at runtime. This is the source of dropdown options: pair it with a
// form field bound to the same type.field to get a picklist. See docs/bpm-assets/enumeration/.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { optionsFor, labeledOptionsFor, isAllowed } from '../functions/enumeration.mjs';
import { renderModel } from '../functions/form.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const ENUMS = [
  { type: 'Claim', field: 'status', values: ['NEW', 'OPEN', 'APPROVED', 'REJECTED'] },
  { type: 'Claim', field: 'type', values: ['DEATH=Death claim', 'TI=Total & permanent disability'] },
];

const CLAIM_TYPE = { name: 'Claim', fields: [{ name: 'amount', type: 'double' }, { name: 'status', type: 'string' }, { name: 'type', type: 'string' }] };
const FORM = { name: 'ClaimReview', type: 'Claim', fields: [{ bind: 'amount', readOnly: true }, { bind: 'status', widget: 'dropdown', required: true }, { bind: 'type', widget: 'dropdown' }] };

export function buildEnumProject(dir) {
  const engine = {
    types: [CLAIM_TYPE], enumerations: ENUMS, forms: [FORM],
    processes: [{ id: 'review-claims', name: 'Review claims',
      nodes: [{ id: 's', type: 'start' }, { id: 'u', type: 'userTask', name: 'Review', form: 'ClaimReview' }, { id: 'e', type: 'end' }],
      flows: [{ from: 's', to: 'u' }, { from: 'u', to: 'e' }] }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'enumerations');
  const { project, written } = buildEnumProject(dir);
  printWritten('enumeration project', dir, written);
  console.log('\nGenerated enumerations.enumeration:\n' + project.descriptor.files['src/main/resources/enumerations.enumeration']);

  // runtime: populate a dropdown + validate a value
  console.log('optionsFor(Claim.status)        ->', JSON.stringify(optionsFor(ENUMS, 'Claim', 'status')));
  console.log('labeledOptionsFor(Claim.type)   ->', JSON.stringify(labeledOptionsFor(ENUMS, 'Claim', 'type')));
  console.log('isAllowed(status, "APPROVED")   ->', isAllowed(ENUMS, 'Claim', 'status', 'APPROVED'));
  console.log('isAllowed(status, "BOGUS")      ->', isAllowed(ENUMS, 'Claim', 'status', 'BOGUS'));

  // pairing: a form dropdown's options come from the enumeration
  const statusField = renderModel(FORM, CLAIM_TYPE).find((f) => f.bind === 'status');
  console.log('\nform field', JSON.stringify(statusField), '-> options', JSON.stringify(optionsFor(ENUMS, 'Claim', 'status')));
}
