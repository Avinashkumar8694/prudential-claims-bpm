// functions/data-object.mjs — reusable runtime helpers for engine TYPES (data-object schemas).
// A data object is a schema, not executable logic; at runtime your Node engine holds plain objects
// that match it. These helpers instantiate a default object and validate a plain object's field
// JS-types against the declared types. Pure JS, no SDK dependency.

const NUMERIC = new Set(['int', 'integer', 'long', 'double', 'float', 'number']);
const isList = (f) => f.list || f.type === 'list' || f.type === 'array';

// a default value for one field
function defaultFor(f) {
  if (isList(f)) return [];
  const t = f.type.toLowerCase();
  if (t === 'string') return '';
  if (NUMERIC.has(t)) return 0;
  if (t === 'bool' || t === 'boolean') return false;
  if (t === 'map' || t === 'object') return t === 'map' ? {} : null;
  return null;                                   // date / nested declared type
}

// build a default instance object from a type schema
export function instantiate(type) {
  const o = {};
  for (const f of type.fields || []) o[f.name] = defaultFor(f);
  return o;
}

// the JS typeof/shape a field value should have
function jsCheck(f, v) {
  if (v == null) return true;                    // null/undefined allowed (unset)
  if (isList(f)) return Array.isArray(v);
  const t = f.type.toLowerCase();
  if (t === 'string') return typeof v === 'string';
  if (NUMERIC.has(t)) return typeof v === 'number';
  if (t === 'bool' || t === 'boolean') return typeof v === 'boolean';
  if (t === 'date') return v instanceof Date || typeof v === 'string';
  return typeof v === 'object';                  // map / object / nested declared type (shallow)
}

// validate a plain object against a type schema; returns [] when valid, else a list of mismatches
export function validate(type, obj) {
  const errors = [];
  for (const f of type.fields || []) {
    if (!jsCheck(f, obj[f.name])) {
      errors.push({ field: f.name, expected: isList(f) ? `${f.type}[]` : f.type, got: Array.isArray(obj[f.name]) ? 'array' : typeof obj[f.name] });
    }
  }
  return errors;
}
