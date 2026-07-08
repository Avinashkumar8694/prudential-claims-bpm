// functions/enumeration.mjs — reusable runtime helpers for engine ENUMERATIONS (allowed field values).
// At runtime a Node engine uses them to populate dropdowns and validate input. Pure JS, no SDK dep.
// A value may carry a display label as "KEY=Label"; `value`/`label` split that.

const value = (v) => String(v).split('=')[0];
const label = (v) => { const [k, l] = String(v).split('='); return l ?? k; };

// find the enumeration entry for a type.field (or undefined)
const find = (enums, type, field) => (enums || []).find((e) => e.type === type && e.field === field);

// dropdown options for a field: the stored values (labels stripped). [] if none.
export function optionsFor(enums, type, field) {
  const e = find(enums, type, field);
  return e ? e.values.map(value) : [];
}

// dropdown options WITH labels: [{ value, label }]. [] if none.
export function labeledOptionsFor(enums, type, field) {
  const e = find(enums, type, field);
  return e ? e.values.map((v) => ({ value: value(v), label: label(v) })) : [];
}

// is `v` an allowed value for type.field? (true if no enumeration constrains it)
export function isAllowed(enums, type, field, v) {
  const e = find(enums, type, field);
  return !e || e.values.map(value).includes(String(v));
}
