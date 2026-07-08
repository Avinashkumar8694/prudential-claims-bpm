// Example 12 — declare data TYPES in the clean engine model, generate Java POJOs, and use the schema
// at runtime. You write name + fields (no Java, no package, no getters); fromEngineProject generates
// a .java per type and resolves names to FQNs. At runtime the type is just the object's shape:
// `instantiate` builds a default, `validate` checks a plain object against the declared field types.
import { fromEngineProject, writeProject } from '../../dist/index.mjs';
import { instantiate, validate } from '../functions/data-object.mjs';
import { isMain, outDir } from '../functions/io.mjs';
import { printWritten } from '../functions/report.mjs';

export const TYPES = [
  { name: 'Address', fields: [{ name: 'city', type: 'string' }, { name: 'zip', type: 'string' }] },
  { name: 'LineItem', fields: [{ name: 'sku', type: 'string' }, { name: 'qty', type: 'int' }] },
  { name: 'Claim', fields: [
    { name: 'id', type: 'string' },
    { name: 'amount', type: 'double' },
    { name: 'open', type: 'boolean' },
    { name: 'filedOn', type: 'date' },
    { name: 'address', type: 'Address' },              // nested declared type -> FQN
    { name: 'items', type: 'LineItem', list: true },   // typed collection -> List<FQN>
    { name: 'tags', type: 'string', list: true },      // List<String>
  ] },
];

export function buildTypesProject(dir) {
  const engine = {
    id: 'com.acme.claims',
    types: TYPES,
    processes: [{
      id: 'com.acme.claims.p', name: 'p', package: 'com.acme',
      vars: [{ name: 'claim', type: 'Claim' }],          // var typed by NAME -> structureRef FQN
      nodes: [{ id: 's', type: 'start' }, { id: 'e', type: 'end' }],
      flows: [{ from: 's', to: 'e' }],
    }],
  };
  const project = fromEngineProject(engine);
  const written = writeProject(project, dir);
  return { project, written };
}

const claimType = TYPES.find((t) => t.name === 'Claim');

if (isMain(import.meta.url)) {
  const dir = outDir(import.meta.url, 'data-objects');
  const { project, written } = buildTypesProject(dir);
  printWritten('data-object project', dir, written);
  console.log('\nGenerated Claim.java:\n');
  console.log(project.descriptor.files['src/main/java/com/acme/model/Claim.java']);

  // runtime: the type is a schema over plain JS objects
  console.log('instantiate(Claim) ->', JSON.stringify(instantiate(claimType)));
  const good = { id: 'C1', amount: 5000, open: true, filedOn: null, address: { city: 'NYC', zip: '10001' }, items: [], tags: ['vip'] };
  const bad = { id: 'C2', amount: 'lots', open: 'yes', items: {}, tags: 'nope' };
  console.log('validate(good) ->', JSON.stringify(validate(claimType, good)));
  console.log('validate(bad)  ->', JSON.stringify(validate(claimType, bad)));
}
