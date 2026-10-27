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

export function makeJacksonNode(initial?: any): Record<string, unknown> {
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

export function makeJacksonArray(arr?: unknown[]): Record<string, unknown> {
  const data = arr || [];
  return {
    addObject: function () { const o = {}; data.push(o); return makeJacksonNode(o); },
    add: function (v: unknown) { data.push(v); return this; },
    toString: function () { return JSON.stringify(data); },
  };
}

export function makeArrayList(initial?: unknown[]): unknown[] {
  return initial ? initial.slice() : [];
}

const MapPrototype = {
  put(k: unknown, v: unknown) {
    const key = String(k);
    const old = (this as any)[key] !== undefined ? (this as any)[key] : null;
    (this as any)[key] = v;
    return old;
  },
  get(k: unknown) {
    const key = String(k);
    return (this as any)[key] !== undefined ? (this as any)[key] : null;
  },
  remove(k: unknown) {
    const key = String(k);
    const old = (this as any)[key] !== undefined ? (this as any)[key] : null;
    delete (this as any)[key];
    return old;
  },
  containsKey(k: unknown) {
    return Object.prototype.hasOwnProperty.call(this, String(k));
  },
  size() {
    return Object.keys(this).length;
  },
  isEmpty() {
    return Object.keys(this).length === 0;
  },
  clear() {
    for (const k of Object.keys(this)) delete (this as any)[k];
  },
  keySet() {
    return makeArrayList(Object.keys(this));
  },
  values() {
    return makeArrayList(Object.values(this));
  },
  toString() {
    return `{${Object.entries(this).map(([k, v]) => `${k}=${v}`).join(', ')}}`;
  },
};

export function makeHashMap(initial?: Record<string, unknown>): Record<string, unknown> {
  const self = Object.create(MapPrototype);
  if (initial && typeof initial === 'object') {
    Object.assign(self, initial);
  }
  return self;
}

export function makeHashSet(): Record<string, unknown> {
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

const JsonObjectPrototype = {
  put(k: string, v: unknown) {
    (this as any)[k] = v;
    return this;
  },
  get(k: string) {
    return (this as any)[k];
  },
  getString(k: string) {
    const v = (this as any)[k];
    return v == null ? null : String(v);
  },
  optString(k: string, fb = '') {
    const v = (this as any)[k];
    return v == null ? fb : String(v);
  },
  optBoolean(k: string, fb = false) {
    const v = (this as any)[k];
    if (v == null) return fb;
    if (typeof v === 'boolean') return v;
    const s = String(v).trim().toLowerCase();
    return s === 'true' || s === '1';
  },
  optInt(k: string, fb = 0) {
    const v = (this as any)[k];
    if (v == null) return fb;
    const n = parseInt(String(v), 10);
    return isNaN(n) ? fb : n;
  },
  has(k: string) {
    return Object.prototype.hasOwnProperty.call(this, k);
  },
  isNull(k: string) {
    return (this as any)[k] == null;
  },
  toString() {
    return JSON.stringify(this);
  },
};

export function makeJsonObject(initial?: any): Record<string, unknown> {
  let data: Record<string, unknown> = {};
  if (initial && typeof initial === 'string') {
    try {
      const parsed = JSON.parse(initial);
      if (parsed && typeof parsed === 'object') data = parsed;
    } catch {
      // safe fallback if not valid JSON
    }
  } else if (initial && typeof initial === 'object') {
    data = { ...initial };
  }
  const self = Object.create(JsonObjectPrototype);
  Object.assign(self, data);
  return self;
}

const COLLECTION_FACTORIES: Record<string, () => any> = {
  'java.util.ArrayList': () => makeArrayList(),
  'java.util.LinkedList': () => makeArrayList(),
  'java.util.HashMap': makeHashMap,
  'java.util.LinkedHashMap': makeHashMap,
  'java.util.HashSet': makeHashSet,
  'java.util.LinkedHashSet': makeHashSet,
};

function javaType(fqn: string): () => any {
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

/** Installs non-enumerable prototype shims on host or vm globalThis */
export function installRealmPrototypes(target: any): void {
  const def = (proto: any, prop: string, val: any) => {
    try {
      if (proto && !proto[prop]) {
        Object.defineProperty(proto, prop, { value: val, writable: true, configurable: true, enumerable: false });
      }
    } catch { /* ignore sealed or read-only prototypes */ }
  };

  // Object.prototype
  if (target.Object && target.Object.prototype) {
    def(target.Object.prototype, 'isEmpty', function (this: any) {
      if (this == null) return true;
      if (typeof this.length === 'number') return this.length === 0;
      if (typeof this.size === 'function') return this.size() === 0;
      if (typeof this.size === 'number') return this.size === 0;
      return Object.keys(this).length === 0;
    });
    def(target.Object.prototype, 'equals', function (this: any, o: any) {
      if (this === o) return true;
      if (o == null) return false;
      return this.valueOf() === (typeof o.valueOf === 'function' ? o.valueOf() : o);
    });
    def(target.Object.prototype, 'path', function (this: any, k: string) {
      const v = (this && typeof this === 'object') ? this[k] : undefined;
      return makeJacksonNode(v);
    });
    def(target.Object.prototype, 'has', function (this: any, k: string) {
      return this && typeof this === 'object' && Object.prototype.hasOwnProperty.call(this, k);
    });
    def(target.Object.prototype, 'hasNonNull', function (this: any, k: string) {
      return this && typeof this === 'object' && this[k] != null;
    });
    def(target.Object.prototype, 'asText', function (this: any, fb = '') {
      return this == null ? fb : String(this);
    });
    def(target.Object.prototype, 'asBoolean', function (this: any, fb = false) {
      if (this == null) return fb;
      if (typeof this === 'boolean') return this;
      const s = String(this).trim().toLowerCase();
      return s === 'true' || s === '1';
    });
    def(target.Object.prototype, 'asInt', function (this: any, fb = 0) {
      const n = parseInt(String(this), 10);
      return isNaN(n) ? fb : n;
    });
    def(target.Object.prototype, 'isNull', function (this: any) {
      return this == null;
    });
    def(target.Object.prototype, 'isMissingNode', function (this: any) {
      return this === undefined;
    });
    def(target.Object.prototype, 'size', function (this: any) {
      if (Array.isArray(this)) return this.length;
      return typeof this === 'object' && this !== null ? Object.keys(this).length : 0;
    });
  }

  // Array.prototype
  if (target.Array && target.Array.prototype) {
    def(target.Array.prototype, 'isEmpty', function (this: any[]) {
      return this.length === 0;
    });
    def(target.Array.prototype, 'size', function (this: any[]) {
      return this.length;
    });
    def(target.Array.prototype, 'get', function (this: any[], i: number) {
      return this[i];
    });
    def(target.Array.prototype, 'set', function (this: any[], i: number, v: any) {
      const old = this[i];
      this[i] = v;
      return old;
    });
    def(target.Array.prototype, 'add', function (this: any[], v: any) {
      this.push(v);
      return true;
    });
    def(target.Array.prototype, 'remove', function (this: any[], idxOrVal: any) {
      if (typeof idxOrVal === 'number' && idxOrVal >= 0 && idxOrVal < this.length) {
        return this.splice(idxOrVal, 1)[0];
      }
      const idx = this.indexOf(idxOrVal);
      if (idx !== -1) {
        return this.splice(idx, 1)[0];
      }
      return null;
    });
    def(target.Array.prototype, 'contains', function (this: any[], v: any) {
      return this.includes(v);
    });
    def(target.Array.prototype, 'clear', function (this: any[]) {
      this.length = 0;
    });
  }

  // String.prototype
  if (target.String && target.String.prototype) {
    def(target.String.prototype, 'isEmpty', function (this: string) {
      return this.length === 0;
    });
    def(target.String.prototype, 'equals', function (this: string, o: any) {
      return this.valueOf() === String(o);
    });
    def(target.String.prototype, 'equalsIgnoreCase', function (this: string, o: any) {
      return o != null && this.toLowerCase() === String(o).toLowerCase();
    });
    def(target.String.prototype, 'path', function (this: string, k: string) {
      try {
        const parsed = JSON.parse(this.valueOf());
        return makeJacksonNode(parsed && typeof parsed === 'object' ? parsed[k] : undefined);
      } catch {
        return makeJacksonNode(undefined);
      }
    });
    def(target.String.prototype, 'has', function (this: string, k: string) {
      try {
        const parsed = JSON.parse(this.valueOf());
        return parsed && typeof parsed === 'object' && Object.prototype.hasOwnProperty.call(parsed, k);
      } catch {
        return false;
      }
    });
    def(target.String.prototype, 'isNull', function (this: string) {
      return false;
    });
    def(target.String.prototype, 'asText', function (this: string) {
      return this.valueOf();
    });
    def(target.String.prototype, 'asBoolean', function (this: string, fb = false) {
      const s = this.trim().toLowerCase();
      return s === 'true' || s === '1';
    });
    def(target.String.prototype, 'asInt', function (this: string, fb = 0) {
      const n = parseInt(this, 10);
      return isNaN(n) ? fb : n;
    });
  }

  // Error.prototype
  if (target.Error && target.Error.prototype) {
    def(target.Error.prototype, 'getMessage', function (this: Error) {
      return this.message || String(this);
    });
    def(target.Error.prototype, 'getLocalizedMessage', function (this: Error) {
      return this.message || String(this);
    });
    def(target.Error.prototype, 'printStackTrace', function (this: Error) {
      console.error(this.stack);
    });
  }

  // String.valueOf
  if (target.String && !(target.String as any).valueOfFixed) {
    target.String.valueOf = function (o: any) { return o == null ? 'null' : String(o); };
    (target.String as any).valueOfFixed = true;
  }

  // Boolean.TRUE / Boolean.FALSE
  if (target.Boolean && typeof target.Boolean.TRUE === 'undefined') {
    target.Boolean.TRUE = { equals: function (o: any) { return Boolean(o) === true; }, valueOf: function () { return true; }, toString: function () { return 'true'; } };
    target.Boolean.FALSE = { equals: function (o: any) { return Boolean(o) === false; }, valueOf: function () { return false; }, toString: function () { return 'false'; } };
  }
}

// Pre-install on host node realm so variables passed across boundaries naturally have the methods
installRealmPrototypes(globalThis);

/** Installs realm-level prototypes (String.prototype.isEmpty, equals, Boolean.TRUE, etc.) */
export function initVmRealm(sandbox: Record<string, unknown>): void {
  installRealmPrototypes(sandbox);
  // Also run in-context to ensure VM-created prototype singletons are configured
  vm.runInContext(`
    (function() {
      var def = function(proto, prop, val) {
        try {
          if (proto && !proto[prop]) {
            Object.defineProperty(proto, prop, { value: val, writable: true, configurable: true, enumerable: false });
          }
        } catch(e) {}
      };
      if (typeof Object !== "undefined" && Object.prototype) {
        def(Object.prototype, "isEmpty", function() {
          if (this == null) return true;
          if (typeof this.length === "number") return this.length === 0;
          if (typeof this.size === "function") return this.size() === 0;
          if (typeof this.size === "number") return this.size === 0;
          return Object.keys(this).length === 0;
        });
        def(Object.prototype, "equals", function(o) {
          if (this === o) return true;
          if (o == null) return false;
          return this.valueOf() === (typeof o.valueOf === "function" ? o.valueOf() : o);
        });
        def(Object.prototype, "has", function(k) {
          return this && typeof this === "object" && Object.prototype.hasOwnProperty.call(this, k);
        });
        def(Object.prototype, "hasNonNull", function(k) {
          return this && typeof this === "object" && this[k] != null;
        });
        def(Object.prototype, "asText", function(fb) {
          return this == null ? (fb || "") : String(this);
        });
        def(Object.prototype, "asBoolean", function(fb) {
          if (this == null) return !!fb;
          if (typeof this === "boolean") return this;
          var s = String(this).trim().toLowerCase();
          return s === "true" || s === "1";
        });
        def(Object.prototype, "asInt", function(fb) {
          var n = parseInt(String(this), 10);
          return isNaN(n) ? (fb || 0) : n;
        });
        def(Object.prototype, "isNull", function() { return this == null; });
        def(Object.prototype, "isMissingNode", function() { return this === undefined; });
        def(Object.prototype, "size", function() {
          if (Array.isArray(this)) return this.length;
          return typeof this === "object" && this !== null ? Object.keys(this).length : 0;
        });
        def(Object.prototype, "path", function(k) {
          var v = (this && typeof this === "object") ? this[k] : undefined;
          return makeJacksonNode(v);
        });
      }
      if (typeof Array !== "undefined" && Array.prototype) {
        def(Array.prototype, "isEmpty", function() { return this.length === 0; });
        def(Array.prototype, "size", function() { return this.length; });
        def(Array.prototype, "get", function(i) { return this[i]; });
        def(Array.prototype, "set", function(i, v) { var old = this[i]; this[i] = v; return old; });
        def(Array.prototype, "add", function(v) { this.push(v); return true; });
        def(Array.prototype, "remove", function(idxOrVal) {
          if (typeof idxOrVal === "number" && idxOrVal >= 0 && idxOrVal < this.length) {
            return this.splice(idxOrVal, 1)[0];
          }
          var idx = this.indexOf(idxOrVal);
          if (idx !== -1) return this.splice(idx, 1)[0];
          return null;
        });
        def(Array.prototype, "contains", function(v) { return this.indexOf(v) !== -1; });
        def(Array.prototype, "clear", function() { this.length = 0; });
      }
      if (typeof String !== "undefined" && String.prototype) {
        def(String.prototype, "isEmpty", function() { return this.length === 0; });
        def(String.prototype, "equals", function(o) { return this.valueOf() === String(o); });
        def(String.prototype, "equalsIgnoreCase", function(o) {
          return o != null && this.toLowerCase() === String(o).toLowerCase();
        });
        def(String.prototype, "isNull", function() { return false; });
        def(String.prototype, "asText", function() { return this.valueOf(); });
        def(String.prototype, "asBoolean", function(fb) {
          var s = this.trim().toLowerCase();
          return s === "true" || s === "1";
        });
        def(String.prototype, "asInt", function(fb) {
          var n = parseInt(this, 10);
          return isNaN(n) ? (fb || 0) : n;
        });
        def(String.prototype, "path", function(k) {
          try {
            var parsed = JSON.parse(this.valueOf());
            return makeJacksonNode(parsed && typeof parsed === "object" ? parsed[k] : undefined);
          } catch(e) {
            return makeJacksonNode(undefined);
          }
        });
        def(String.prototype, "has", function(k) {
          try {
            var parsed = JSON.parse(this.valueOf());
            return parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, k);
          } catch(e) {
            return false;
          }
        });
      }
      if (typeof Error !== "undefined" && Error.prototype) {
        def(Error.prototype, "getMessage", function() { return this.message || String(this); });
        def(Error.prototype, "getLocalizedMessage", function() { return this.message || String(this); });
        def(Error.prototype, "printStackTrace", function() { console.error(this.stack); });
      }
      if (typeof String !== "undefined") {
        String.valueOf = function(o) { return o == null ? "null" : String(o); };
      }
      if (typeof Boolean !== "undefined" && typeof Boolean.TRUE === "undefined") {
        Boolean.TRUE = { equals: function(o) { return Boolean(o) === true; }, valueOf: function() { return true; }, toString: function() { return "true"; } };
        Boolean.FALSE = { equals: function(o) { return Boolean(o) === false; }, valueOf: function() { return false; }, toString: function() { return "false"; } };
      }
    })();
  `, sandbox);
}

/** Installs `Java.type(...)` and the `java.util.*` package-global constructors into a JS sandbox. */
export function installJsCompat(sandbox: Record<string, unknown>): void {
  sandbox.makeJacksonNode = makeJacksonNode;
  sandbox.Java = { type: javaType };
  sandbox.Integer = { valueOf: (x: any) => parseInt(x, 10), parseInt: (x: any) => parseInt(x, 10) };
  sandbox.Long = { valueOf: (x: any) => parseInt(x, 10), parseLong: (x: any) => parseInt(x, 10) };
  sandbox.Double = { valueOf: (x: any) => parseFloat(x), parseDouble: (x: any) => parseFloat(x) };
  sandbox.Float = { valueOf: (x: any) => parseFloat(x), parseFloat: (x: any) => parseFloat(x) };
  sandbox.java = {
    util: {
      ArrayList: function ArrayList(init?: any) { return makeArrayList(Array.isArray(init) ? init : []); },
      LinkedList: function LinkedList(init?: any) { return makeArrayList(Array.isArray(init) ? init : []); },
      HashMap: function HashMap(init?: any) { return makeHashMap(init); },
      LinkedHashMap: function LinkedHashMap(init?: any) { return makeHashMap(init); },
      HashSet: function HashSet() { return makeHashSet(); },
      LinkedHashSet: function LinkedHashSet() { return makeHashSet(); },
      Map: function Map(init?: any) { return makeHashMap(init); },
      List: function List(init?: any) { return makeArrayList(Array.isArray(init) ? init : []); },
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

  sandbox.org = {
    json: {
      JSONObject: function JSONObject(init?: any) { return makeJsonObject(init); },
      JSONArray: function JSONArray(init?: any) { return makeArrayList(Array.isArray(init) ? init : (typeof init === 'string' ? JSON.parse(init) : [])); },
    },
  };

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
