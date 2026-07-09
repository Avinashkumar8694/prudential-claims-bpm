// functions/properties.mjs — reusable runtime helpers for engine MESSAGES (i18n bundles).
// `messages` is the EngineProject.messages map: { <locale>: { key: value } }, where "default" is the
// base/fallback bundle. Resolution prefers the requested locale, then falls back to "default".
// Pairs with a form's renderModel to localize labels. Pure JS, no SDK dependency.

// resolve one label for a locale (locale bundle wins, else "default"). undefined if absent in both.
export function resolve(messages, key, locale) {
  const loc = messages[locale];
  if (loc && key in loc) return loc[key];
  const def = messages.default;
  return def ? def[key] : undefined;
}

// all keys under a prefix, resolved for the locale -> { key: value }.
export function labelsFor(messages, prefix, locale) {
  const keys = new Set([
    ...Object.keys(messages.default || {}),
    ...Object.keys(messages[locale] || {}),
  ].filter((k) => k.startsWith(prefix)));
  const out = {};
  for (const k of keys) out[k] = resolve(messages, k, locale);
  return out;
}
