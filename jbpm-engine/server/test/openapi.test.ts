// The Swagger/OpenAPI doc must stay honest: every documented path+method exists in the Express router,
// and every registered route (except the docs endpoints themselves) is documented. Also sanity-check
// that all $ref targets resolve.
import { test } from 'node:test';
import assert from 'node:assert';
import { openapiSpec } from '../src/http/openapi.ts';
import { buildRoutes } from '../src/http/routes.ts';

// Express path (":id") ↔ OpenAPI path ("{id}")
const toExpress = (p: string) => p.replace(/\{([^}]+)\}/g, ':$1');

function routerRoutes(): Set<string> {
  const r: any = buildRoutes();
  const out = new Set<string>();
  for (const layer of r.stack) {
    const route = layer.route;
    if (!route) continue;
    for (const m of Object.keys(route.methods)) if (route.methods[m]) out.add(`${m.toUpperCase()} ${route.path}`);
  }
  return out;
}

test('spec is a valid OpenAPI 3 document with servers, tags and paths', () => {
  assert.match(openapiSpec.openapi, /^3\./);
  assert.ok(openapiSpec.info?.title && openapiSpec.info?.version);
  assert.deepStrictEqual(openapiSpec.servers, [{ url: '/api', description: 'This server' }]);
  assert.ok(Object.keys(openapiSpec.paths).length >= 40, 'documents the full surface');
});

test('every documented path+method is registered in the router', () => {
  const registered = routerRoutes();
  const missing: string[] = [];
  for (const [path, ops] of Object.entries<any>(openapiSpec.paths)) {
    for (const method of Object.keys(ops)) {
      const key = `${method.toUpperCase()} ${toExpress(path)}`;
      if (!registered.has(key)) missing.push(key);
    }
  }
  assert.deepStrictEqual(missing, [], `documented but not routed: ${missing.join(', ')}`);
});

test('every routed endpoint is documented (docs endpoints excluded)', () => {
  const documented = new Set<string>();
  for (const [path, ops] of Object.entries<any>(openapiSpec.paths))
    for (const method of Object.keys(ops)) documented.add(`${method.toUpperCase()} ${toExpress(path)}`);

  const undocumented = [...routerRoutes()].filter((k) => !documented.has(k) && !k.includes('/openapi.json') && !k.includes('/docs'));
  assert.deepStrictEqual(undocumented, [], `routed but undocumented: ${undocumented.join(', ')}`);
});

test('all $ref targets resolve to a component schema', () => {
  const names = new Set(Object.keys(openapiSpec.components.schemas));
  const refs: string[] = [];
  JSON.stringify(openapiSpec, (k, v) => { if (k === '$ref') refs.push(v); return v; });
  const broken = refs.filter((r) => !names.has(r.replace('#/components/schemas/', '')));
  assert.deepStrictEqual(broken, [], `unresolved refs: ${broken.join(', ')}`);
});
