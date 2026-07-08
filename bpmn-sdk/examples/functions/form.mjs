// functions/form.mjs — reusable runtime helpers for an engine FORM. A form is UI metadata over a data
// object; at runtime your Node engine renders it and validates submissions. Pure JS, no SDK dependency.

// field type -> a friendly widget name (used when the form field doesn't specify `widget`)
const TYPE_WIDGET = { string: 'text', int: 'integer', integer: 'integer', long: 'integer', double: 'number', float: 'number', number: 'number', bool: 'checkbox', boolean: 'checkbox', date: 'date' };
const humanize = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

// build a UI render model: resolve each field's widget (explicit or derived from `type`) + label.
// `type` is the engine type schema ({ name, fields:[{ name, type }] }); pass it to derive widgets.
export function renderModel(form, type) {
  const ft = {}; for (const f of (type && type.fields) || []) ft[f.name] = f.type;
  return form.fields.map((f) => ({
    bind: f.bind,
    label: f.label || humanize(f.bind),
    widget: f.widget || TYPE_WIDGET[(ft[f.bind] || 'string').toLowerCase()] || 'text',
    required: !!f.required,
    readOnly: !!f.readOnly,
  }));
}

// validate a submitted data object against the form: required fields must be present (not empty).
export function validateSubmission(form, data) {
  const errors = [];
  for (const f of form.fields) {
    if (f.required && !f.readOnly) {
      const v = data ? data[f.bind] : undefined;
      if (v == null || v === '') errors.push({ bind: f.bind, error: 'required' });
    }
  }
  return errors;
}
