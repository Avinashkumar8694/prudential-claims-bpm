// JS-dialect compatibility shim for real jBPM's Nashorn/GraalVM Java-object semantics: an imported
// jBPM JS script may use `Java.type("java.util.ArrayList")` (GraalVM/Nashorn interop) or construct
// `new java.util.ArrayList()` directly (Nashorn's package-global convention), then call Java-shaped
// methods (.add/.get/.size/.put/.remove/...) on the result — see docs/bpm-nodes/_scripting-
// javascript.md §5. This engine runs `js` natively in V8, never a JVM, so this is a scoped,
// documented shim for the common `java.util` collection idioms that doc itself calls out — not a
// general Java interop bridge. A custom project-specific FQN (or any JDK type beyond the handful of
// collections below) isn't resolvable here, matching the "no custom classes" boundary already
// established for the real Java path (jbpm-engine/java-runtime).
//
// Every method below is installed as an OWN property of the created instance, never on a shared
// prototype: java-compat.ts's own history found that adding `get`/`set` as OWN properties of
// Object.prototype crashes a vm context's internal global-property machinery (not a catchable JS
// error). That risk is specific to the SHARED prototype every object in the realm inherits from —
// an ordinary object having its own method named `get`/`set`/`put` (exactly like real JS `Map`
// already does) carries no such risk.

function makeArrayList(initial?: unknown[]): Record<string, unknown> {
  const data: unknown[] = initial ? initial.slice() : [];
  const self: Record<string, unknown> = {};
  self.add = (v: unknown) => { data.push(v); return true; };
  self.get = (i: number) => data[i];
  self.set = (i: number, v: unknown) => { const old = data[i]; data[i] = v; return old; };
  self.size = () => data.length;
  self.remove = (i: number) => data.splice(i, 1)[0];
  self.isEmpty = () => data.length === 0;
  self.contains = (v: unknown) => data.includes(v);
  self.clear = () => { data.length = 0; };
  self.toString = () => `[${data.join(', ')}]`;
  return self;
}

function makeHashMap(): Record<string, unknown> {
  const data = new Map<unknown, unknown>();
  const self: Record<string, unknown> = {};
  self.put = (k: unknown, v: unknown) => { const old = data.has(k) ? data.get(k) : null; data.set(k, v); return old; };
  self.get = (k: unknown) => (data.has(k) ? data.get(k) : null);
  self.remove = (k: unknown) => { const old = data.has(k) ? data.get(k) : null; data.delete(k); return old; };
  self.containsKey = (k: unknown) => data.has(k);
  self.size = () => data.size;
  self.isEmpty = () => data.size === 0;
  self.clear = () => data.clear();
  self.keySet = () => makeArrayList([...data.keys()]);
  self.values = () => makeArrayList([...data.values()]);
  self.toString = () => `{${[...data.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}}`;
  return self;
}

function makeHashSet(): Record<string, unknown> {
  const data = new Set<unknown>();
  const self: Record<string, unknown> = {};
  self.add = (v: unknown) => { const had = data.has(v); data.add(v); return !had; };
  self.contains = (v: unknown) => data.has(v);
  self.remove = (v: unknown) => { const had = data.has(v); data.delete(v); return had; };
  self.size = () => data.size;
  self.isEmpty = () => data.size === 0;
  self.clear = () => data.clear();
  self.toString = () => `[${[...data].join(', ')}]`;
  return self;
}

const COLLECTION_FACTORIES: Record<string, () => Record<string, unknown>> = {
  'java.util.ArrayList': () => makeArrayList(),
  'java.util.LinkedList': () => makeArrayList(),
  'java.util.HashMap': makeHashMap,
  'java.util.LinkedHashMap': makeHashMap,
  'java.util.HashSet': makeHashSet,
  'java.util.LinkedHashSet': makeHashSet,
};

/** `Java.type("java.util.ArrayList")` — GraalVM/Nashorn's explicit type-handle interop. Returns a
 *  function so `new Java.type(...)()` works: a constructor function that `return`s a plain object
 *  is honored by `new` in place of the freshly-allocated `this` (standard JS semantics) — but ONLY
 *  for an ordinary `function`, never an arrow function: arrow functions have no `[[Construct]]` slot
 *  at all, so `new (() => {})()` throws "is not a constructor" — a real bug caught by this file's
 *  own test (engine-js-compat.test.ts) assigning the result to a variable and `new`-ing it, exactly
 *  how `_scripting-javascript.md` §5 documents real scripts using `Java.type`. */
function javaType(fqn: string): () => Record<string, unknown> {
  const factory = COLLECTION_FACTORIES[fqn];
  if (!factory) {
    throw new Error(
      `Java.type("${fqn}") is not supported in this engine's JS sandbox — only the common ` +
      `java.util collection types (ArrayList, LinkedList, HashMap, LinkedHashMap, HashSet, ` +
      `LinkedHashSet) are shimmed; custom/application classes and anything else on the JDK ` +
      `aren't resolvable here (this engine runs JS natively in V8, never a JVM).`
    );
  }
  return function () { return factory(); };
}

/** Installs `Java.type(...)` and the `java.util.*` package-global constructors (Nashorn's other,
 *  more common convention: `new java.util.ArrayList()` directly, no `Java.type` call) into a JS
 *  sandbox. Mutates `sandbox` in place, mirroring this codebase's existing install-shim pattern. */
export function installJsCompat(sandbox: Record<string, unknown>): void {
  sandbox.Java = { type: javaType };
  sandbox.java = {
    util: {
      ArrayList: function ArrayList() { return makeArrayList(); },
      LinkedList: function LinkedList() { return makeArrayList(); },
      HashMap: function HashMap() { return makeHashMap(); },
      LinkedHashMap: function LinkedHashMap() { return makeHashMap(); },
      HashSet: function HashSet() { return makeHashSet(); },
      LinkedHashSet: function LinkedHashSet() { return makeHashSet(); },
    },
  };
}
