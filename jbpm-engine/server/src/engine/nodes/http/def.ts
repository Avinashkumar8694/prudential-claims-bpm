import { type NodeDef, GENERAL } from '../def-types.ts';
export const def: NodeDef = {
  engineType: 'http',
  palette: [{ key: 'http', label: 'Service Task (REST)', category: 'Tasks', icon: '🌐', color: '#0d9488', engineType: 'http', defaults: { type: 'http', method: 'POST', url: '/' } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: 'Request', fields: [
    { key: 'method', label: 'Method', widget: 'select', options: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] },
    { key: 'url', label: 'URL (appended to base)', widget: 'text', placeholder: '/v1/claims', required: true, help: 'Relative (e.g. /v1/claims) is appended to the deployment\'s integration base URL and is never SSRF-checked. An absolute URL (http://...) is used as-is but SSRF-gated — a private/link-local/loopback/cloud-metadata target fails the node with errorCode SSRF_BLOCKED unless allowlisted.' },
    { key: 'headers', label: 'Headers', widget: 'keyval', help: 'Sent as-is, verbatim — unlike Body, values here do NOT support "$var" substitution.' },
    { key: 'body', label: 'Body (value or $var)', widget: 'keyval', valueSource: 'ownRef', help: 'Right side: "$name" to send one of this process\'s own variables, or a literal value. Ignored entirely for GET/HEAD (the substituted values are still computed but never sent).' },
  ] }, { title: 'Response', fields: [
    { key: 'resultTo', label: 'Map response → variable (var ← JSONPath)', widget: 'keyval', keySource: 'own', help: 'Left = this process\'s variable to write (pick an existing one to overwrite it, or type a new name), e.g. verifierId ← $.verifierId. Only a dotted-path subset ($.a.b.c) is supported, not full JSONPath. If the response body isn\'t valid JSON, every mapped variable silently resolves to undefined — no error is raised.' },
    { key: 'lang', label: 'Exit script language', widget: 'select', options: ['js', 'java'], help: 'js runs natively; java runs in the JVM sidecar. Any other dialect (e.g. mvel) is not implemented — the exit script would be skipped.' },
    { key: 'exitScript', label: 'Exit script', widget: 'code', placeholder: 'kcontext.setVariable("x", resPayload.length());', help: 'Runs after resultTo is applied — the raw response text is available as resPayload. Runs before the node\'s own General → On-exit action, if one is also set.' },
  ] }],
  diagram: { icon: 'globe', color: '#0d9488', shape: 'rectangle' },
  typeLabel: 'Service task',
};
