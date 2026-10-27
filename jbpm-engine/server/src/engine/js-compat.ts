// JS-dialect compatibility shim for real jBPM's Nashorn/GraalVM Java-object semantics: an imported
// jBPM JS script may use `Java.type("java.util.ArrayList")` (GraalVM/Nashorn interop) or construct
// `new java.util.ArrayList()` directly (Nashorn's package-global convention), then call Java-shaped
// methods (.add/.get/.size/.put/.remove/...) on the result — see docs/bpm-nodes/_scripting-
// javascript.md §5. This engine runs `js` natively in V8, never a JVM, so this is a scoped,
// documented shim for the common `java.util` collection idioms that doc itself calls out — not a
// general Java interop bridge. A custom project-specific FQN (or any JDK type beyond the handful of
// collections below) isn't resolvable here, matching the "no custom classes" boundary already
// established for the real Java path (jbpm-engine/java-runtime).
import vm from 'node:vm';

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

/** Installs realm-level prototypes (String.prototype.isEmpty, equals, Boolean.TRUE, etc.) */
export function initVmRealm(sandbox: Record<string, unknown>): void {
  vm.runInContext(`
    if (!Object.prototype.isEmpty) {
      Object.prototype.isEmpty = function() {
        if (this == null) return true;
        if (typeof this.length === "number") return this.length === 0;
        if (typeof this.size === "function") return this.size() === 0;
        if (typeof this.size === "number") return this.size === 0;
        return Object.keys(this).length === 0;
      };
    }
    if (!Object.prototype.equals) {
      Object.prototype.equals = function(o) {
        if (this === o) return true;
        if (o == null) return false;
        return this.valueOf() === (typeof o.valueOf === "function" ? o.valueOf() : o);
      };
    }
    if (!String.prototype.isEmpty) {
      String.prototype.isEmpty = function() { return this.length === 0; };
    }
    if (!String.prototype.equals) {
      String.prototype.equals = function(o) { return this.valueOf() === String(o); };
    }
    if (!String.prototype.equalsIgnoreCase) {
      String.prototype.equalsIgnoreCase = function(o) { return o != null && this.toLowerCase() === String(o).toLowerCase(); };
    }
    if (!Error.prototype.getMessage) {
      Error.prototype.getMessage = function() { return this.message || String(this); };
    }
    if (!Error.prototype.getLocalizedMessage) {
      Error.prototype.getLocalizedMessage = function() { return this.message || String(this); };
    }
    if (!Error.prototype.printStackTrace) {
      Error.prototype.printStackTrace = function() { console.error(this.stack); };
    }
    String.valueOf = function(o) { return o == null ? "null" : String(o); };
    if (typeof Boolean.TRUE === "undefined") {
      Boolean.TRUE = { equals: function(o) { return Boolean(o) === true; }, valueOf: function() { return true; }, toString: function() { return "true"; } };
      Boolean.FALSE = { equals: function(o) { return Boolean(o) === false; }, valueOf: function() { return false; }, toString: function() { return "false"; } };
    }
  `, sandbox);
}

/** Installs `Java.type(...)` and the `java.util.*` package-global constructors into a JS sandbox. */
export function installJsCompat(sandbox: Record<string, unknown>): void {
  sandbox.Java = { type: javaType };
  sandbox.Integer = { valueOf: (x: any) => parseInt(x, 10), parseInt: (x: any) => parseInt(x, 10) };
  sandbox.Long = { valueOf: (x: any) => parseInt(x, 10), parseLong: (x: any) => parseInt(x, 10) };
  sandbox.Double = { valueOf: (x: any) => parseFloat(x), parseDouble: (x: any) => parseFloat(x) };
  sandbox.Float = { valueOf: (x: any) => parseFloat(x), parseFloat: (x: any) => parseFloat(x) };
  sandbox.java = {
    util: {
      ArrayList: function ArrayList() { return makeArrayList(); },
      LinkedList: function LinkedList() { return makeArrayList(); },
      HashMap: function HashMap() { return makeHashMap(); },
      LinkedHashMap: function LinkedHashMap() { return makeHashMap(); },
      HashSet: function HashSet() { return makeHashSet(); },
      LinkedHashSet: function LinkedHashSet() { return makeHashSet(); },
      Map: function Map() { return makeHashMap(); },
      List: function List() { return makeArrayList(); },
      Set: function Set() { return makeHashSet(); },
    },
  };
  sandbox.KieFunctions = {
    equalsTo: (a: unknown, b: unknown) => {
      if (a === b) return true;
      if (a == null || b == null) return false;
      return String(a) === String(b);
    },
    isTrue: (a: unknown) => {
      if (typeof a === 'boolean') return a;
      if (typeof a === 'string') return a.trim().toLowerCase() === 'true' || a.trim() === '1';
      return Boolean(a);
    },
    isFalse: (a: unknown) => {
      if (typeof a === 'boolean') return !a;
      if (typeof a === 'string') return a.trim().toLowerCase() === 'false' || a.trim() === '0';
      return !a;
    },
    isNull: (a: unknown) => a == null,
    notNull: (a: unknown) => a != null,
    isEmpty: (a: unknown) => a == null || String(a).trim() === '',
  };

  function makeJsonObject(initial?: any): Record<string, unknown> {
    const data: Record<string, unknown> = (initial && typeof initial === 'string') ? JSON.parse(initial) : (initial && typeof initial === 'object') ? { ...initial } : {};
    const self: Record<string, unknown> = {};
    self.put = (k: string, v: unknown) => { data[k] = v; return self; };
    self.get = (k: string) => data[k];
    self.getString = (k: string) => data[k] == null ? null : String(data[k]);
    self.optString = (k: string, fb = '') => data[k] == null ? fb : String(data[k]);
    self.optBoolean = (k: string, fb = false) => {
      const v = data[k];
      if (v == null) return fb;
      if (typeof v === 'boolean') return v;
      const s = String(v).trim().toLowerCase();
      return s === 'true' || s === '1';
    };
    self.optInt = (k: string, fb = 0) => {
      const v = data[k];
      if (v == null) return fb;
      const n = parseInt(String(v), 10);
      return isNaN(n) ? fb : n;
    };
    self.has = (k: string) => Object.prototype.hasOwnProperty.call(data, k);
    self.isNull = (k: string) => data[k] == null;
    self.toString = () => JSON.stringify(data);
    return self;
  }

  sandbox.org = {
    json: {
      JSONObject: function JSONObject(init?: any) { return makeJsonObject(init); },
      JSONArray: function JSONArray(init?: any) { return makeArrayList(Array.isArray(init) ? init : (typeof init === 'string' ? JSON.parse(init) : [])); },
    },
  };

  function makeJacksonNode(initial?: any): Record<string, unknown> {
    const data = initial;
    const self: Record<string, unknown> = {
      put: function (k: string, v: unknown) { if (data && typeof data === 'object') (data as any)[k] = v; return self; },
      putPOJO: function (k: string, v: unknown) { if (data && typeof data === 'object') (data as any)[k] = v; return self; },
      putNull: function (k: string) { if (data && typeof data === 'object') (data as any)[k] = null; return self; },
      putArray: function (k: string) { const a: unknown[] = []; if (data && typeof data === 'object') (data as any)[k] = a; return makeJacksonArray(a); },
      set: function (k: string, v: unknown) { if (data && typeof data === 'object') (data as any)[k] = v; return self; },
      get: function (k: string) { return (data && typeof data === 'object') ? (data as any)[k] : undefined; },
      path: function (k: string) { return makeJacksonNode((data && typeof data === 'object') ? (data as any)[k] : undefined); },
      has: function (k: string) { return (data && typeof data === 'object') ? Object.prototype.hasOwnProperty.call(data, k) : false; },
      hasNonNull: function (k: string) { return (data && typeof data === 'object') ? (data as any)[k] != null : false; },
      isArray: function () { return Array.isArray(data); },
      asBoolean: function (fb = false) {
        if (data == null) return fb;
        if (typeof data === 'boolean') return data;
        const s = String(data).trim().toLowerCase();
        return s === 'true' || s === '1';
      },
      asInt: function (fb = 0) { const n = parseInt(String(data), 10); return isNaN(n) ? fb : n; },
      asText: function (fb = '') { return data == null ? fb : String(data); },
      isNull: function () { return data == null; },
      isMissingNode: function () { return data === undefined; },
      size: function () { return Array.isArray(data) ? data.length : (typeof data === 'object' && data !== null ? Object.keys(data).length : 0); },
      toString: function () { return typeof data === 'string' ? data : JSON.stringify(data); },
    };
    return self;
  }

  function makeJacksonArray(arr?: unknown[]): Record<string, unknown> {
    const data = arr || [];
    return {
      addObject: function () { const o = {}; data.push(o); return makeJacksonNode(o); },
      add: function (v: unknown) { data.push(v); return this; },
      toString: function () { return JSON.stringify(data); },
    };
  }

  sandbox.com = {
    fasterxml: {
      jackson: {
        databind: {
          ObjectMapper: function ObjectMapper() {
            return {
              createObjectNode: () => makeJacksonNode({}),
              createArrayNode: () => makeJacksonArray([]),
              readTree: (str: unknown) => {
                try { return makeJacksonNode(typeof str === 'string' ? JSON.parse(str) : str); }
                catch { return makeJacksonNode({}); }
              },
              writeValueAsString: (obj: unknown) => JSON.stringify(obj),
            };
          },
          node: {
            ObjectNode: function ObjectNode() { return makeJacksonNode({}); },
            ArrayNode: function ArrayNode() { return makeJacksonArray([]); },
          },
        },
      },
    },
  };

  sandbox.System = {
    out: {
      println: (...args: unknown[]) => ((sandbox.console as any)?.log || console.log)(...args),
      print: (...args: unknown[]) => ((sandbox.console as any)?.log || console.log)(...args),
    },
    getenv: (k: string) => ((sandbox.env as Record<string, string>)?.[k] || process.env[k] || ''),
    getProperty: (k: string) => ((sandbox.env as Record<string, string>)?.[k] || process.env[k] || ''),
    currentTimeMillis: () => Date.now(),
  };
}
