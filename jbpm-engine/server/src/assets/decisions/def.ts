// DMN decision model asset — decision tables (SDK → .dmn; dmn-engine evaluates at runtime).
import { type AssetKindDef, slug } from '../types.ts';
export const def: AssetKindDef = {
  key: 'decisions', label: 'DMN decisions', nameField: 'name',
  seed: (name, fields) => {
    const rawInputs = typeof fields?.inputs === 'string' ? fields.inputs.split(',').map((s: string) => s.trim()).filter(Boolean) : (fields?.inputs as string[]) || ['amount'];
    const rawOutputs = typeof fields?.outputs === 'string' ? fields.outputs.split(',').map((s: string) => s.trim()).filter(Boolean) : (fields?.outputs as string[]) || ['approved'];
    const inputs = rawInputs.map((n: string) => ({ name: n, type: 'number' as const }));
    const outputs = rawOutputs.map((n: string) => ({ name: n, type: 'boolean' as const }));
    const hitPolicy = (fields?.hitPolicy as any) || 'UNIQUE';
    return {
      name,
      namespace: fields?.namespace || `https://kie.org/dmn/${slug(name)}`,
      decisions: [{
        name,
        hitPolicy,
        inputs,
        outputs,
        rules: [
          { when: { [inputs[0]?.name || 'amount']: { lte: 1000 } }, then: { [outputs[0]?.name || 'approved']: true } },
          { when: { [inputs[0]?.name || 'amount']: { gt: 1000 } }, then: { [outputs[0]?.name || 'approved']: false } },
        ],
      }],
    };
  },
};
