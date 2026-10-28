// A field-builder-authored tree that maps 1:1 onto a real (nested) JSON Schema object — object/array
// types recurse via `children`/`items`, so the builder can express anything a hand-written JSON
// Schema for a case's `data` would need: nested objects, arrays of string/number/boolean, or arrays
// of nested objects. See schema-field-editor.component.ts for the recursive UI and
// workflow-management.component.ts's fieldsToSchema()/schemaToFields() for the JSON Schema conversion.
export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';
export type ArrayItemType = 'string' | 'number' | 'boolean' | 'object';

export interface SchemaField {
  key: string;
  type: FieldType;
  required: boolean;
  /** only meaningful when type === 'array' */
  arrayItemType?: ArrayItemType;
  /** only meaningful when type === 'object', or type === 'array' with arrayItemType === 'object' —
   *  the nested object's own fields (recursive). */
  children?: SchemaField[];
}

/** field -> real JSON Schema, recursively. */
export function fieldToJsonSchema(f: SchemaField): Record<string, unknown> {
  if (f.type === 'object') return childrenToObjectSchema(f.children || []);
  if (f.type === 'array') {
    const itemType = f.arrayItemType || 'string';
    return { type: 'array', items: itemType === 'object' ? childrenToObjectSchema(f.children || []) : { type: itemType } };
  }
  return { type: f.type };
}

export function childrenToObjectSchema(fields: SchemaField[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const f of fields) {
    if (!f.key.trim()) continue;
    properties[f.key.trim()] = fieldToJsonSchema(f);
    if (f.required) required.push(f.key.trim());
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) };
}

/** real JSON Schema -> field tree, recursively (the inverse of the above — used when opening Edit on
 *  an existing definition, so a previously hand-authored or builder-authored schema round-trips). */
export function jsonSchemaToField(key: string, schema: any, required: boolean): SchemaField {
  const type: FieldType = (schema?.type as FieldType) || 'string';
  if (type === 'object') return { key, type, required, children: objectSchemaToChildren(schema) };
  if (type === 'array') {
    const itemSchema = schema?.items || {};
    const itemType: ArrayItemType = (itemSchema.type as ArrayItemType) || 'string';
    return { key, type, required, arrayItemType: itemType, ...(itemType === 'object' ? { children: objectSchemaToChildren(itemSchema) } : {}) };
  }
  return { key, type, required };
}

export function objectSchemaToChildren(schema: any): SchemaField[] {
  const requiredList: string[] = schema?.required || [];
  const properties = schema?.properties || {};
  return Object.entries(properties).map(([k, v]) => jsonSchemaToField(k, v, requiredList.includes(k)));
}
