// src/index.ts
import http from "http";
import { WebSocketServer } from "ws";

// src/app.ts
import express from "express";

// src/store/file-store.ts
import fs from "fs";
import path from "path";
var FileRepo = class {
  constructor(dir) {
    this.dir = dir;
  }
  dir;
  cache = /* @__PURE__ */ new Map();
  loaded = false;
  ensureLoaded() {
    if (this.loaded) return;
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        const e = JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8"));
        this.cache.set(e.id, e);
      } catch {
      }
    }
    this.loaded = true;
  }
  file(id) {
    return path.join(this.dir, `${id}.json`);
  }
  async get(id) {
    this.ensureLoaded();
    return this.cache.get(id);
  }
  async list() {
    this.ensureLoaded();
    return [...this.cache.values()];
  }
  async query(pred) {
    this.ensureLoaded();
    return [...this.cache.values()].filter(pred);
  }
  async put(entity) {
    this.ensureLoaded();
    this.cache.set(entity.id, structuredClone(entity));
    const tmp = this.file(entity.id) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(entity, null, 2));
    fs.renameSync(tmp, this.file(entity.id));
    return entity;
  }
  async delete(id) {
    this.ensureLoaded();
    const existed = this.cache.delete(id);
    try {
      fs.unlinkSync(this.file(id));
    } catch {
    }
    return existed;
  }
};
var FileStore = class {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }
  dataDir;
  repos = /* @__PURE__ */ new Map();
  repo(collection) {
    let r = this.repos.get(collection);
    if (!r) {
      r = new FileRepo(path.join(this.dataDir, collection));
      this.repos.set(collection, r);
    }
    return r;
  }
};

// src/infra/config.ts
import path2 from "path";
var env = process.env;
var config = {
  port: Number(env.PORT || 4e3),
  dataDir: env.DATA_DIR || path2.resolve(process.cwd(), ".data"),
  store: env.STORE || "file",
  pgUrl: env.PG_URL,
  jwtSecret: env.JWT_SECRET || "dev-insecure-secret-change-me",
  integrationBaseUrl: env.INTEGRATION_BASE_URL || "http://localhost:3000",
  scriptTimeoutMs: Number(env.SCRIPT_TIMEOUT_MS || 2e3),
  wsPath: env.WS_PATH || "/ws",
  defaultTenant: env.DEFAULT_TENANT || "default"
};

// src/infra/ids.ts
var B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function encodeTime(ms, len) {
  let out = "";
  for (let i = len - 1; i >= 0; i--) {
    out = B32[ms % 32] + out;
    ms = Math.floor(ms / 32);
  }
  return out;
}
var seq = 0;
function newId(nowMs = Date.now()) {
  seq = (seq + 1) % 16777215;
  const time = encodeTime(nowMs, 10);
  let rand = "";
  const mix = seq * 2654435761 >>> 0;
  let r = mix + nowMs % 65536 >>> 0;
  for (let i = 0; i < 6; i++) {
    rand = B32[r % 32] + rand;
    r = Math.floor(r / 32) + (i + 1) * 131 * (seq + 1) >>> 0;
  }
  return time + rand;
}
var systemClock = () => (/* @__PURE__ */ new Date()).toISOString();

// src/domain.ts
var Collections = {
  workflows: "workflows",
  branches: "branches",
  versions: "versions",
  deployments: "deployments",
  instances: "instances",
  tasks: "tasks",
  timers: "timers",
  audit: "audit"
};

// src/context.ts
function makeContext(opts) {
  const clock = opts.clock || systemClock;
  const newId2 = opts.newId || (() => newId());
  const ctx = {
    store: opts.store,
    clock,
    newId: newId2,
    tenantId: opts.tenantId,
    audit: async (e) => {
      const ev = { id: newId2(), tenantId: opts.tenantId, at: clock(), ...e };
      await opts.store.repo(Collections.audit).put(ev);
    }
  };
  return ctx;
}

// src/http/routes.ts
import { Router } from "express";

// src/infra/logger.ts
var order = { debug: 10, info: 20, warn: 30, error: 40 };
var min = order[process.env.LOG_LEVEL || "info"];
function emit(level, msg, meta) {
  if (order[level] < min) return;
  const line = { t: (/* @__PURE__ */ new Date()).toISOString(), level, msg, ...meta || {} };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}
var logger = {
  debug: (m, meta) => emit("debug", m, meta),
  info: (m, meta) => emit("info", m, meta),
  warn: (m, meta) => emit("warn", m, meta),
  error: (m, meta) => emit("error", m, meta)
};

// src/infra/errors.ts
var STATUS = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  VERSION_FROZEN: 409,
  DEPLOY_BLOCKED: 409,
  INSTANCE_NOT_RESUMABLE: 409,
  SCRIPT_TIMEOUT: 500,
  INTERNAL: 500
};
var ApiError = class extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
  code;
  details;
  get status() {
    return STATUS[this.code];
  }
};
var notFound = (what) => new ApiError("NOT_FOUND", `${what} not found`);
var validation = (message, details) => new ApiError("VALIDATION_FAILED", message, details);
var conflict = (message, details) => new ApiError("CONFLICT", message, details);
var asyncHandler = (fn) => (req, res, next) => {
  fn(req, res, next).catch(next);
};
function errorMiddleware(err, _req, res, _next) {
  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error(err.message, { code: err.code });
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  logger.error("unhandled error", { err: err?.message, stack: err?.stack });
  return res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
}

// src/modules/workflows/service.ts
var slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
function emptyEngine(id, name, key) {
  return {
    id: key,
    name,
    processes: [{
      id: `${key}.process`,
      name,
      package: "com.acme",
      vars: [],
      nodes: [{ id: "start", type: "start", name: "Start" }],
      flows: []
    }]
  };
}
var WorkflowService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  wf() {
    return this.ctx.store.repo(Collections.workflows);
  }
  br() {
    return this.ctx.store.repo(Collections.branches);
  }
  ve() {
    return this.ctx.store.repo(Collections.versions);
  }
  async list() {
    return (await this.wf().query((w) => w.tenantId === this.ctx.tenantId && !w.archived)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async get(id) {
    const w = await this.wf().get(id);
    if (!w || w.tenantId !== this.ctx.tenantId) throw notFound("Workflow");
    return w;
  }
  async create(input, actor) {
    const name = (input.name || "").trim();
    if (!name) throw validation("name is required");
    const key = slug(input.key || name);
    const dupe = await this.wf().query((w) => w.tenantId === this.ctx.tenantId && w.key === key);
    if (dupe.length) throw validation(`key "${key}" already exists`);
    const now = this.ctx.clock();
    const wfId = this.ctx.newId();
    const branchId = this.ctx.newId();
    const versionId = this.ctx.newId();
    const workflow = {
      id: wfId,
      tenantId: this.ctx.tenantId,
      name,
      key,
      description: input.description,
      defaultBranchId: branchId,
      permissions: [],
      variables: [],
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor
    };
    const branch = {
      id: branchId,
      tenantId: this.ctx.tenantId,
      workflowId: wfId,
      name: "main",
      headVersionId: versionId,
      protected: true,
      createdAt: now,
      createdBy: actor
    };
    const version = {
      id: versionId,
      tenantId: this.ctx.tenantId,
      workflowId: wfId,
      branchId,
      number: 1,
      state: "draft",
      engine: emptyEngine(wfId, name, key),
      createdAt: now,
      createdBy: actor
    };
    await this.wf().put(workflow);
    await this.br().put(branch);
    await this.ve().put(version);
    await this.ctx.audit({ actor, kind: "workflow.created", workflowId: wfId, data: { name, key } });
    return workflow;
  }
  async update(id, patch, actor) {
    const w = await this.get(id);
    if (patch.name !== void 0) w.name = patch.name.trim() || w.name;
    if (patch.description !== void 0) w.description = patch.description;
    if (patch.permissions !== void 0) w.permissions = patch.permissions;
    if (patch.variables !== void 0) w.variables = patch.variables;
    w.updatedAt = this.ctx.clock();
    w.updatedBy = actor;
    await this.wf().put(w);
    await this.ctx.audit({ actor, kind: "workflow.updated", workflowId: id });
    return w;
  }
  async setPermissions(id, permissions, actor) {
    return this.update(id, { permissions }, actor);
  }
  async setVariables(id, variables, actor) {
    return this.update(id, { variables }, actor);
  }
  async archive(id, actor) {
    const w = await this.get(id);
    w.archived = true;
    w.updatedAt = this.ctx.clock();
    w.updatedBy = actor;
    await this.wf().put(w);
    await this.ctx.audit({ actor, kind: "workflow.archived", workflowId: id });
  }
};

// src/modules/branches/service.ts
var BranchService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  br() {
    return this.ctx.store.repo(Collections.branches);
  }
  ve() {
    return this.ctx.store.repo(Collections.versions);
  }
  async listByWorkflow(workflowId) {
    return (await this.br().query((b) => b.tenantId === this.ctx.tenantId && b.workflowId === workflowId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async get(id) {
    const b = await this.br().get(id);
    if (!b || b.tenantId !== this.ctx.tenantId) throw notFound("Branch");
    return b;
  }
  async create(workflowId, input, actor) {
    const name = (input.name || "").trim();
    if (!name) throw validation("branch name is required");
    const existing = await this.listByWorkflow(workflowId);
    if (existing.some((b) => b.name === name)) throw validation(`branch "${name}" already exists`);
    let from;
    if (input.fromVersionId) {
      from = await this.ve().get(input.fromVersionId);
      if (!from || from.tenantId !== this.ctx.tenantId) throw notFound("fromVersion");
    }
    const now = this.ctx.clock();
    const branchId = this.ctx.newId();
    const versionId = this.ctx.newId();
    const branch = {
      id: branchId,
      tenantId: this.ctx.tenantId,
      workflowId,
      name,
      forkedFromVersionId: from?.id,
      headVersionId: versionId,
      createdAt: now,
      createdBy: actor
    };
    const version = {
      id: versionId,
      tenantId: this.ctx.tenantId,
      workflowId,
      branchId,
      number: 1,
      state: "draft",
      engine: from ? structuredClone(from.engine) : { id: workflowId, name, processes: [] },
      parentVersionId: from?.id,
      createdAt: now,
      createdBy: actor
    };
    await this.br().put(branch);
    await this.ve().put(version);
    await this.ctx.audit({ actor, kind: "branch.created", workflowId, data: { branchId, name, from: from?.id } });
    return branch;
  }
};

// src/engine/nodes/start/handler.ts
var handler = () => ({});

// src/engine/nodes/end/handler.ts
var handler2 = async (c) => {
  if (c.node.result === "terminate") return { end: "terminate" };
  if (c.node.throw?.error) return { end: "error", outcome: "error-throw" };
  if (c.node.event?.compensation || c.node.result === "compensate") {
    return { vars: await c.compensate(c.node.event?.ref), end: "complete", outcome: "compensated" };
  }
  return { end: "complete" };
};

// src/engine/nodes/manual/handler.ts
var handler3 = () => ({});

// src/engine/sandbox.ts
import vm2 from "vm";

// src/engine/java-compat.ts
import vm from "vm";
var TYPE_WORD = "(?:String|Boolean|Integer|Long|Double|Float|Object|int|boolean|double|long|float|char|byte|short|JsonNode|ObjectNode|ArrayNode|ObjectMapper)";
var GENERIC = "(?:List|Map|Set|ArrayList|HashMap|HashSet)(?:<(?:[^<>]|<[^<>]*>)*>)?";
function transpileJava(src) {
  let s = src;
  s = s.replace(/\bcom\.fasterxml\.jackson\.databind\.node\./g, "");
  s = s.replace(/\bcom\.fasterxml\.jackson\.databind\./g, "");
  s = s.replace(/\bcom\.fasterxml\.jackson\.core\.type\./g, "");
  s = s.replace(/\bjava\.util\./g, "");
  s = s.replace(/\bjava\.lang\./g, "");
  s = s.replace(/new\s+TypeReference\s*<(?:[^<>]|<[^<>]*>)*>\s*\(\s*\)\s*\{\s*\}/g, "null");
  s = s.replace(/new\s+ArrayList(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*\)/g, "[]");
  s = s.replace(/new\s+HashMap(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*\)/g, "{}");
  s = s.replace(/new\s+HashSet(?:<(?:[^<>]|<[^<>]*>)*>)?\s*\(\s*\)/g, "[]");
  s = s.replace(new RegExp(`for\\s*\\(\\s*(?:${TYPE_WORD}|${GENERIC}|[A-Za-z_$][\\w$.<>]*)\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*`, "g"), "for (const $1 of ");
  s = s.replace(new RegExp(`\\b${TYPE_WORD}(?:<(?:[^<>]|<[^<>]*>)*>)?\\s+([A-Za-z_$][\\w$]*)\\s*=(?!=)`, "g"), "var $1 =");
  s = s.replace(new RegExp(`\\b${GENERIC}\\s+([A-Za-z_$][\\w$]*)\\s*=(?!=)`, "g"), "var $1 =");
  s = s.replace(new RegExp(`\\b${TYPE_WORD}\\s+([A-Za-z_$][\\w$]*)\\s*;`, "g"), "var $1;");
  s = s.replace(new RegExp(`\\(\\s*${TYPE_WORD}\\s*\\)(?=\\s*[A-Za-z_$(])`, "g"), "");
  s = s.replace(new RegExp(`\\(\\s*${GENERIC}\\s*\\)(?=\\s*[A-Za-z_$(])`, "g"), "");
  s = s.replace(/catch\s*\(\s*[A-Za-z_$][\w$.]*\s+([A-Za-z_$][\w$]*)\s*\)/g, "catch ($1)");
  const OPERAND = "[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*|\\([^()]*\\)|\\[[^\\[\\]]*\\])*";
  s = s.replace(new RegExp(`(${OPERAND})\\s+instanceof\\s+JsonNode\\b`, "g"), "__isJsonNode($1)");
  s = s.replace(new RegExp(`(${OPERAND})\\s+instanceof\\s+Boolean\\b`, "g"), "(typeof $1 === 'boolean')");
  s = s.replace(new RegExp(`(${OPERAND})\\s+instanceof\\s+String\\b`, "g"), "(typeof $1 === 'string')");
  s = s.replace(new RegExp(`(${OPERAND})\\s+instanceof\\s+(?:Integer|Long|Double|Float|Number)\\b`, "g"), "(typeof $1 === 'number')");
  s = s.replace(new RegExp(`(${OPERAND})\\s+instanceof\\s+(?:List|ArrayList)\\b`, "g"), "Array.isArray($1)");
  s = s.replace(new RegExp(`(${OPERAND})\\s+instanceof\\s+(?:Map|HashMap)\\b`, "g"), "($1 !== null && typeof $1 === 'object' && !Array.isArray($1))");
  s = s.replace(/Boolean\.TRUE\.equals\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, "(($1) === true)");
  s = s.replace(/Boolean\.FALSE\.equals\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, "(($1) === false)");
  s = s.replace(/\.getMessage\(\)/g, ".message");
  s = s.replace(/\.get\(/g, ".jget(");
  s = s.replace(/\.set\(/g, ".jset(");
  return s;
}
var JAVA_PRELUDE = `
(function () {
  // MISSING's own accessors are plain assignments (never go through ToPropertyDescriptor), so they
  // are unaffected by anything below, and naturally shadow the shared prototype methods so every
  // safe-navigation chain off a missing path stays safe.
  var MISSING = {};
  MISSING.isMissingNode = function () { return true; };
  MISSING.isNull = function () { return true; };
  MISSING.isArray = function () { return false; };
  MISSING.isObject = function () { return false; };
  MISSING.has = function () { return false; };
  MISSING.jget = function () { return null; };
  MISSING.path = function () { return MISSING; };
  MISSING.asText = function (d) { return d !== undefined ? d : null; };
  MISSING.asBoolean = function (d) { return d !== undefined ? d : false; };
  MISSING.asInt = function (d) { return d !== undefined ? d : 0; };
  MISSING.asLong = function (d) { return d !== undefined ? d : 0; };
  MISSING.asDouble = function (d) { return d !== undefined ? d : 0; };
  MISSING.size = function () { return 0; };
  MISSING.toString = function () { return 'null'; };
  globalThis.__MISSING = MISSING;
  globalThis.__isJsonNode = function (x) { return x !== null && typeof x === 'object'; };

  // Every accessor below is a plain, non-enumerable data property (value/writable), on purpose:
  // NEVER add one literally named 'get' or 'set' here (see the file header) \u2014 that crashes the vm
  // context's own global-property machinery, not just a JS-catchable error.
  Object.defineProperties(Object.prototype, {
    path: { value: function (k) { var v = this[k]; return v === undefined || v === null ? MISSING : v; }, enumerable: false, configurable: true, writable: true },
    jget: { value: function (k) { var v = this[k]; return v === undefined ? null : v; }, enumerable: false, configurable: true, writable: true },
    has: { value: function (k) { return this != null && k in Object(this); }, enumerable: false, configurable: true, writable: true },
    asText: { value: function (d) { return this === undefined || this === null ? (d !== undefined ? d : null) : String(this); }, enumerable: false, configurable: true, writable: true },
    asBoolean: { value: function (d) {
      // this may be an auto-boxed Boolean/String wrapper (calling a method on a primitive boxes it),
      // where strict === against the primitives true/false/'true'/'false' never matches \u2014 unwrap first.
      var v = (this !== null && typeof this === 'object' && typeof this.valueOf === 'function') ? this.valueOf() : this;
      if (v === true || v === 'true') return true;
      if (v === false || v === 'false' || v === null || v === undefined) return d !== undefined ? !!d : false;
      return !!v;
    }, enumerable: false, configurable: true, writable: true },
    asInt: { value: function (d) { var n = parseInt(this, 10); return isNaN(n) ? (d !== undefined ? d : 0) : n; }, enumerable: false, configurable: true, writable: true },
    asLong: { value: function (d) { return this.asInt(d); }, enumerable: false, configurable: true, writable: true },
    asDouble: { value: function (d) { var n = parseFloat(this); return isNaN(n) ? (d !== undefined ? d : 0) : n; }, enumerable: false, configurable: true, writable: true },
    isNull: { value: function () { return this === null || this === undefined; }, enumerable: false, configurable: true, writable: true },
    isMissingNode: { value: function () { return false; }, enumerable: false, configurable: true, writable: true },
    isArray: { value: function () { return Array.isArray(this); }, enumerable: false, configurable: true, writable: true },
    isObject: { value: function () {
      // exclude auto-boxed scalars (calling a method on a primitive boxes it, but a JSON boolean/
      // number/string leaf is not an "object" node in Jackson terms).
      return this !== null && typeof this === 'object' && !Array.isArray(this)
        && !(this instanceof Boolean) && !(this instanceof Number) && !(this instanceof String);
    }, enumerable: false, configurable: true, writable: true },
    size: { value: function () { return Array.isArray(this) ? this.length : (this == null ? 0 : Object.keys(this).length); }, enumerable: false, configurable: true, writable: true },
    fieldNames: { value: function () { return Object.keys(this)[Symbol.iterator](); }, enumerable: false, configurable: true, writable: true },
    elements: { value: function () { return (Array.isArray(this) ? this : [])[Symbol.iterator](); }, enumerable: false, configurable: true, writable: true },
    put: { value: function (k, v) { this[k] = v; return this; }, enumerable: false, configurable: true, writable: true },
    putPOJO: { value: function (k, v) { this[k] = v; return this; }, enumerable: false, configurable: true, writable: true },
    jset: { value: function (k, v) { this[k] = v; return this; }, enumerable: false, configurable: true, writable: true },
    remove: { value: function (k) { delete this[k]; return this; }, enumerable: false, configurable: true, writable: true },
    toString: { value: function () { try { return JSON.stringify(this); } catch (e) { return Object.prototype.toString.call(this); } }, enumerable: false, configurable: true, writable: true },
  });
  // array-only: 'add' has no sensible shared meaning on plain objects (unlike jget/size, which do).
  Object.defineProperties(Array.prototype, {
    add: { value: function (v) { this.push(v); return this; }, enumerable: false, configurable: true, writable: true },
  });

  globalThis.ObjectMapper = function ObjectMapper() {};
  ObjectMapper.prototype.createObjectNode = function () { return {}; };
  ObjectMapper.prototype.createArrayNode = function () { return []; };
  ObjectMapper.prototype.readTree = function (text) { return text === null || text === undefined || text === '' ? null : JSON.parse(String(text)); };
  ObjectMapper.prototype.convertValue = function (obj) { return obj; };
  ObjectMapper.prototype.readValue = function (text) { return text === null || text === undefined || text === '' ? null : JSON.parse(String(text)); };
  ObjectMapper.prototype.writeValueAsString = function (obj) { return JSON.stringify(obj); };

  globalThis.Integer = { valueOf: function (x) { return parseInt(x, 10); }, parseInt: function (x) { return parseInt(x, 10); } };
  globalThis.Long = { valueOf: function (x) { return parseInt(x, 10); }, parseLong: function (x) { return parseInt(x, 10); } };
  globalThis.Double = { valueOf: function (x) { return parseFloat(x); }, parseDouble: function (x) { return parseFloat(x); } };
  String.valueOf = function (x) { return x === null || x === undefined ? 'null' : String(x); };
  Boolean.valueOf = function (x) { return typeof x === 'string' ? x.trim().toLowerCase() === 'true' : Boolean(x); };
})();
`;
function installJavaSystemShims(sandbox, env2, log) {
  sandbox.System = {
    out: { println: (...a) => log(a.map((x) => String(x)).join(" ")) },
    getenv: (k) => env2[k],
    getProperty: (k) => env2[k],
    currentTimeMillis: () => Date.now()
  };
}
function runJavaInContext(code, context, timeoutMs) {
  vm.runInContext(JAVA_PRELUDE, context, { timeout: timeoutMs });
  vm.runInContext(transpileJava(code), context, { timeout: timeoutMs });
}

// src/engine/sandbox.ts
function runScript(code, vars, timeoutMs, opts = {}) {
  const instance = { getId: () => opts.instanceId ?? "" };
  let contextJson;
  const rehome = (v) => {
    if (v === null || typeof v !== "object" || !contextJson) return v;
    try {
      return contextJson.parse(contextJson.stringify(v));
    } catch {
      return v;
    }
  };
  const kcontext = {
    getVariable: (n) => rehome(vars[n]),
    setVariable: (n, v) => {
      vars[n] = v;
    },
    getProcessInstance: () => instance
  };
  const log = opts.log || (() => {
  });
  const sandbox = {
    kcontext,
    env: { ...opts.env || {} },
    console: { log: (...a) => log(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")) }
  };
  vm2.createContext(sandbox);
  if (opts.lang === "java") {
    installJavaSystemShims(sandbox, opts.env || {}, log);
    contextJson = vm2.runInContext("JSON", sandbox);
    runJavaInContext(code, sandbox, timeoutMs);
  } else {
    vm2.runInContext(code, sandbox, { timeout: timeoutMs });
  }
}
function evalCondition(expr, lang, vars, timeoutMs = 500) {
  if (!expr) return true;
  if (lang && lang !== "js" && lang !== "java") return false;
  const sandbox = { ...vars };
  vm2.createContext(sandbox);
  const isJava = lang === "java";
  try {
    if (isJava) {
      installJavaSystemShims(sandbox, {}, () => {
      });
      vm2.runInContext(JAVA_PRELUDE, sandbox, { timeout: timeoutMs });
      const ctxJson = vm2.runInContext("JSON", sandbox);
      for (const k of Object.keys(vars)) {
        const v = sandbox[k];
        if (v !== null && typeof v === "object") {
          try {
            sandbox[k] = ctxJson.parse(ctxJson.stringify(v));
          } catch {
          }
        }
      }
    }
    const src = isJava ? transpileJava(expr) : expr;
    const body = /return\b/.test(src) ? src : `return (${src});`;
    return !!vm2.runInContext(`(function(){ ${body} })()`, sandbox, { timeout: timeoutMs });
  } catch {
    return false;
  }
}

// src/engine/nodes/script/handler.ts
var handler4 = (c) => {
  const n = c.node;
  if (n.lang && n.lang !== "js" && n.lang !== "java") return { outcome: "skipped-nonjs" };
  const vars = { ...c.inst.variables };
  const logs = [];
  try {
    runScript(n.code || "", vars, config.scriptTimeoutMs, {
      env: c.dep.env,
      instanceId: c.inst.id,
      log: (line) => logs.push(line),
      lang: n.lang
    });
  } catch (e) {
    return { error: `script failed: ${e.message}`, errorCode: "SCRIPT_ERROR" };
  }
  return { vars, ...logs.length ? { outcome: logs.join("\n") } : {} };
};

// src/engine/nodes/http/handler.ts
function jsonPath(obj, path5) {
  if (obj == null) return void 0;
  const parts = path5.replace(/^\$\.?/, "").split(".").filter(Boolean);
  return parts.reduce((c, p) => c == null ? c : c[p], obj);
}
var handler5 = async (c) => {
  const n = c.node;
  const baseUrl = c.dep.env && c.dep.env["INTEGRATION_LAYER_URL"] || config.integrationBaseUrl;
  const url = /^https?:\/\//.test(n.url || "") ? n.url : `${baseUrl}${n.url || ""}`;
  const method = String(n.method || "POST").toUpperCase();
  const body = {};
  for (const [k, v] of Object.entries(n.body || {})) body[k] = typeof v === "string" && v.startsWith("$") ? c.inst.variables[v.slice(1)] : v;
  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json", ...n.headers || {} },
      ...method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }
    });
    if (!res.ok) return { error: `HTTP ${res.status} from ${url}`, errorCode: "SERVICE_ERROR" };
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : void 0;
    } catch {
      json = text;
    }
    const vars = {};
    for (const [varName, path5] of Object.entries(n.resultTo || {})) vars[varName] = jsonPath(json, String(path5));
    if (n.exitScript) {
      const scriptVars = { ...c.inst.variables, ...vars, resPayload: text };
      try {
        runScript(String(n.exitScript), scriptVars, config.scriptTimeoutMs, { env: c.dep.env, instanceId: c.inst.id, lang: n.lang });
        delete scriptVars.resPayload;
        Object.assign(vars, scriptVars);
      } catch (e) {
        return { error: `exitScript failed: ${e.message}`, errorCode: "SCRIPT_ERROR" };
      }
    }
    return { vars, outcome: `HTTP ${res.status}` };
  } catch (e) {
    return { error: `service call failed: ${e.message}`, errorCode: "SERVICE_ERROR" };
  }
};

// src/engine/decisioning.ts
function testMatch(value, test) {
  if (test == null) return true;
  if (typeof test === "object" && !Array.isArray(test)) {
    if (test.any === true) return true;
    if ("feel" in test) return true;
    if ("gt" in test) return Number(value) > Number(test.gt);
    if ("gte" in test) return Number(value) >= Number(test.gte);
    if ("lt" in test) return Number(value) < Number(test.lt);
    if ("lte" in test) return Number(value) <= Number(test.lte);
    if ("between" in test) return Number(value) >= Number(test.between[0]) && Number(value) <= Number(test.between[1]);
    if ("in" in test) return test.in.includes(value);
    if ("not" in test) return Array.isArray(test.not) ? !test.not.includes(value) : value !== test.not;
    return true;
  }
  if (Array.isArray(test)) return test.includes(value);
  if (test === "-") return true;
  return value === test;
}
function resolveOutput(r) {
  return r && typeof r === "object" && "feel" in r ? r.feel : r;
}
function evaluateDmn(engine, ref2, vars) {
  const model = (engine.decisions || []).find((m) => m.name === ref2.model || m.namespace === ref2.namespace);
  if (!model) throw new Error(`DMN model "${ref2.model}" not found`);
  const decision = model.decisions.find((d) => d.name === ref2.decision);
  if (!decision) throw new Error(`DMN decision "${ref2.decision}" not found`);
  const matches = decision.rules.filter((rule) => decision.inputs.every((inp) => testMatch(vars[inp.name], rule.when[inp.name])));
  const chosen = decision.hitPolicy === "COLLECT" ? matches : matches.slice(0, 1);
  const out = {};
  for (const inp of decision.outputs) {
    const vals = chosen.map((r) => resolveOutput(r.then[inp.name])).filter((v) => v !== void 0);
    if (vals.length) out[inp.name] = decision.hitPolicy === "COLLECT" ? vals : vals[0];
  }
  return out;
}
function whereMatch(fact, where) {
  if (!where) return true;
  return Object.entries(where).every(([field, spec]) => {
    const v = fact?.[field];
    if (spec && typeof spec === "object" && !Array.isArray(spec)) {
      if ("ref" in spec) return true;
      const [[op, val]] = Object.entries(spec);
      switch (op) {
        case "gt":
          return Number(v) > Number(val);
        case "gte":
          return Number(v) >= Number(val);
        case "lt":
          return Number(v) < Number(val);
        case "lte":
          return Number(v) <= Number(val);
        case "ne":
          return v !== val;
        case "in":
          return val.includes(v);
        case "notIn":
          return !val.includes(v);
        case "contains":
          return String(v).includes(String(val));
        default:
          return v === val;
      }
    }
    if (Array.isArray(spec)) return spec.includes(v);
    return v === spec;
  });
}
function evaluateRules(engine, group, vars) {
  const rulesets = (engine.rulesets || []).filter((r) => r.group === group);
  const changed = {};
  const factOf = (type) => vars[type] && typeof vars[type] === "object" ? vars[type] : vars;
  const rules = rulesets.flatMap((rs) => rs.rules).sort((a, b) => (b.priority || 0) - (a.priority || 0));
  for (const rule of rules) {
    const ok2 = (rule.when || []).every((w) => {
      const fact = factOf(w.fact);
      const present = whereMatch(fact, w.where);
      return w.exists === false || w.not ? !present : present;
    });
    if (!ok2) continue;
    for (const act of rule.then || []) {
      if ("set" in act) {
        const fact = factOf(act.set);
        Object.assign(fact, act.fields);
        if (fact === vars) Object.assign(changed, act.fields);
        else changed[act.set] = fact;
      } else if ("insert" in act) {
        vars[act.insert] = { ...act.fields || {} };
        changed[act.insert] = vars[act.insert];
      }
    }
  }
  return changed;
}
function evaluateDecisionTree(engine, name, vars) {
  const tree = (engine.decisionTrees || []).find((t) => t.name === name);
  if (!tree) throw new Error(`decision tree "${name}" not found`);
  const fact = tree.fact && vars[tree.fact] && typeof vars[tree.fact] === "object" ? vars[tree.fact] : vars;
  const out = {};
  let node = tree.root;
  let guard = 0;
  while (node && guard++ < 1e3) {
    if (node.output) Object.assign(out, node.output);
    const field = node.test?.field;
    if (!field || !Array.isArray(node.branches) || !node.branches.length) break;
    const hit = node.branches.find((b) => testMatch(fact?.[field], b.match));
    if (!hit) break;
    node = hit.then;
  }
  return out;
}
function evaluateScorecard(engine, name, vars) {
  const sc = (engine.scorecards || []).find((s) => s.name === name);
  if (!sc) throw new Error(`scorecard "${name}" not found`);
  const fact = sc.fact && vars[sc.fact] && typeof vars[sc.fact] === "object" ? vars[sc.fact] : vars;
  const target = sc.target || "score";
  let score = Number(sc.baseline) || 0;
  const reasons = [];
  for (const ch of sc.characteristics || []) {
    const attr = (ch.attributes || []).find((a) => testMatch(fact?.[ch.field], a.match));
    if (attr) {
      score += Number(attr.points) || 0;
      if (attr.reason) reasons.push(String(attr.reason));
    }
  }
  const out = { [target]: score };
  if (reasons.length) out[`${target}Reasons`] = reasons;
  return out;
}

// src/engine/nodes/rule/handler.ts
var handler6 = (c) => {
  const n = c.node;
  try {
    if (n.dmn) return { vars: evaluateDmn(c.dep.engine, n.dmn, c.inst.variables), outcome: "dmn" };
    if (n.decisionTree) return { vars: evaluateDecisionTree(c.dep.engine, n.decisionTree, c.inst.variables), outcome: `tree:${n.decisionTree}` };
    if (n.scorecard) return { vars: evaluateScorecard(c.dep.engine, n.scorecard, c.inst.variables), outcome: `scorecard:${n.scorecard}` };
    if (n.ruleflowGroup) return { vars: evaluateRules(c.dep.engine, n.ruleflowGroup, c.inst.variables), outcome: `rules:${n.ruleflowGroup}` };
    return {};
  } catch (e) {
    return { error: `rule evaluation failed: ${e.message}`, errorCode: "RULE_ERROR" };
  }
};

// src/engine/nodes/gateway/handler.ts
var handler7 = (c) => {
  const node = c.node;
  const outs = c.outgoing(node.id);
  const ins = c.incoming(node.id);
  const converging = ins.length > 1 && outs.length <= 1;
  if (converging && (node.mode === "parallel" || node.mode === "inclusive")) {
    const arrived = c.inst.history.filter((h) => h.nodeId === node.id).length;
    if (arrived < ins.length) return { consume: true, outcome: `join ${arrived}/${ins.length}` };
    c.joins[node.id] = /* @__PURE__ */ new Set();
    return { next: outs.map((f) => f.to), outcome: "join-complete" };
  }
  switch (node.mode) {
    case "parallel":
      return { next: outs.map((f) => f.to), outcome: "fork" };
    case "inclusive": {
      const taken = outs.filter((f) => f.id && f.id === node.default || evalCondition(f.when, f.lang, c.inst.variables));
      const chosen = taken.length ? taken : outs.filter((f) => f.id === node.default);
      return { next: chosen.map((f) => f.to), outcome: "inclusive" };
    }
    case "event":
      return { consume: true, outcome: "event-gateway-wait" };
    // downstream catches carry the wait
    case "complex":
    case "exclusive":
    default: {
      const match = outs.find((f) => f.when && evalCondition(f.when, f.lang, c.inst.variables));
      const def28 = outs.find((f) => f.id === node.default) || outs.find((f) => !f.when);
      const chosen = match || def28;
      return { next: chosen ? [chosen.to] : [], outcome: match ? "conditional" : "default" };
    }
  }
};

// src/engine/nodes/user-task/handler.ts
var handler8 = (c) => {
  const n = c.node;
  const task = {
    id: c.app.newId(),
    tenantId: c.app.tenantId,
    instanceId: c.inst.id,
    tokenId: c.inst.tokens.find((t) => t.nodeId === n.id).id,
    nodeId: n.id,
    name: n.name || n.form || "Task",
    formName: n.form,
    group: n.group || n.assignee,
    status: "created",
    inputs: {},
    createdAt: c.app.clock()
  };
  c.app.store.repo(Collections.tasks).put(task);
  c.emit({ kind: "task.created", instanceId: c.inst.id, taskId: task.id });
  return { wait: { kind: "task", ref: task.id } };
};

// src/engine/nodes/receive/handler.ts
var handler9 = (c) => ({ wait: { kind: "message", ref: c.node.message } });

// src/engine/duration.ts
function parseDuration(iso) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!m) return 0;
  const [, w, d, h, min2, s] = m.map((x) => x ? Number(x) : 0);
  return ((((w * 7 + d) * 24 + h) * 60 + min2) * 60 + s) * 1e3;
}
function computeDue(timer, nowIso) {
  const nowMs = Date.parse(nowIso);
  if (typeof timer === "string") return new Date(nowMs + parseDuration(timer)).toISOString();
  if (timer?.date) return new Date(timer.date).toISOString();
  if (timer?.duration) return new Date(nowMs + parseDuration(timer.duration)).toISOString();
  if (timer?.cycle) {
    const period = timer.cycle.split("/").slice(1).join("/") || timer.cycle;
    return new Date(nowMs + parseDuration(period)).toISOString();
  }
  return new Date(nowMs).toISOString();
}

// src/engine/nodes/catch/handler.ts
var handler10 = (c) => {
  const ev = c.node.event || {};
  if (ev.timer) return { wait: { kind: "timer", ref: c.node.id, dueAt: computeDue(ev.timer, c.app.clock()) } };
  if (ev.message) return { wait: { kind: "message", ref: ev.message } };
  if (ev.signal) return { wait: { kind: "signal", ref: ev.signal } };
  return { wait: { kind: "condition", ref: c.node.id } };
};

// src/engine/nodes/throw/handler.ts
var handler11 = async (c) => {
  const ev = c.node.event || {};
  if (ev.compensation || ev.compensate) return { vars: await c.compensate(ev.ref), outcome: "compensated" };
  const name = ev.signal || ev.message || ev.escalation;
  if (name) await c.broadcast(name);
  return { outcome: name ? `threw:${name}` : "throw" };
};

// src/engine/nodes/send/handler.ts
var handler12 = async (c) => {
  if (c.node.message) await c.broadcast(c.node.message);
  return { outcome: c.node.message ? `sent:${c.node.message}` : "send" };
};

// src/engine/nodes/call/handler.ts
var handler13 = async (c) => {
  const n = c.node;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process);
  if (!resolved) return { outcome: "called-process-not-deployed" };
  const token = c.inst.tokens.find((t) => t.nodeId === n.id);
  const childVars = {};
  for (const [cv, spec] of Object.entries(n.inputs || {})) {
    childVars[cv] = typeof spec === "string" && spec.startsWith("$") ? c.inst.variables[spec.slice(1)] : spec;
  }
  const child = await c.startChild(resolved.dep, resolved.processId, childVars, token.id);
  if (child.status === "completed") {
    const vars = {};
    for (const [pv, cv] of Object.entries(n.outputs || {})) vars[pv] = child.variables[cv];
    return { vars, outcome: `called:${child.id}` };
  }
  return { wait: { kind: "child", ref: child.id }, outcome: `called:${child.id}` };
};

// src/engine/nodes/for-each/handler.ts
var handler14 = async (c) => {
  const n = c.node;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process);
  if (!resolved) return { outcome: "mi-process-not-deployed" };
  const items = Array.isArray(c.inst.variables[n.over]) ? c.inst.variables[n.over] : [];
  const parentToken = c.inst.tokens.find((t) => t.nodeId === n.id);
  const results = [];
  for (const item of items) {
    const childVars = {};
    for (const v of n.pass || []) childVars[v] = c.inst.variables[v];
    if (n.as) childVars[n.as] = item;
    const child = await c.startChild(resolved.dep, resolved.processId, childVars, parentToken.id);
    if (child.status === "completed" && n.itemResult) results.push(child.variables[n.itemResult]);
  }
  return { vars: n.collectInto ? { [n.collectInto]: results } : {}, outcome: `multiInstance:${items.length}` };
};

// src/engine/nodes/subprocess/handler.ts
var handler15 = async (c) => {
  const n = c.node;
  if (!Array.isArray(n.nodes) || n.nodes.length === 0) return {};
  const token = c.inst.tokens.find((t) => t.nodeId === n.id);
  const composite = `${c.proc.id}::${n.id}`;
  const child = await c.startChild(c.dep, composite, { ...c.inst.variables }, token.id);
  if (child.status === "completed") return { vars: { ...child.variables }, outcome: `sub:${child.id}` };
  if (child.status === "aborted" || child.status === "failed") return { error: "sub-process failed", errorCode: "SUBPROCESS_ERROR", outcome: `sub:${child.id}` };
  return { wait: { kind: "child", ref: child.id }, outcome: `sub:${child.id}` };
};

// src/engine/workitems/registry.ts
import vm3 from "vm";
async function callService(url, params) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const t = await res.text();
  try {
    return t ? JSON.parse(t) : {};
  } catch {
    return { raw: t };
  }
}
var WORKITEM_HANDLERS = {
  // record only (audit/logging)
  Log: async (p) => ({ logged: true, message: p["message"] ?? p }),
  // evaluate a JS expression with params in scope → { result }
  Compute: async (p) => {
    const expr = String(p["expression"] ?? p["expr"] ?? "");
    if (!expr) return { result: void 0 };
    const sandbox = { ...p };
    vm3.createContext(sandbox);
    return { result: vm3.runInContext(`(${expr})`, sandbox, { timeout: 1e3 }) };
  },
  // external side-effects — call the configured service, else simulate
  Email: async (p, env2) => env2["EMAIL_SERVICE_URL"] ? { ...await callService(env2["EMAIL_SERVICE_URL"], p), sent: true } : { sent: true, simulated: true, to: p["to"] },
  SMS: async (p, env2) => env2["SMS_SERVICE_URL"] ? { ...await callService(env2["SMS_SERVICE_URL"], p), sent: true } : { sent: true, simulated: true, to: p["to"] },
  DBQuery: async (p, env2) => env2["DB_SERVICE_URL"] ? await callService(env2["DB_SERVICE_URL"], p) : { rows: [], simulated: true }
};
var WORKITEM_NAMES = Object.keys(WORKITEM_HANDLERS);

// src/engine/nodes/work-item/handler.ts
var handler16 = async (c) => {
  const n = c.node;
  const h = WORKITEM_HANDLERS[n.handler];
  if (!h) return { error: `unknown work-item handler "${n.handler}"`, errorCode: "SERVICE_ERROR" };
  const params = {};
  for (const [k, v] of Object.entries(n.params || {})) params[k] = typeof v === "string" && v.startsWith("$") ? c.inst.variables[v.slice(1)] : v;
  try {
    const result = await h(params, c.dep.env || {});
    const vars = {};
    for (const [varName, key] of Object.entries(n.resultTo || {})) vars[varName] = result[String(key)];
    return { vars, outcome: `workitem:${n.handler}` };
  } catch (e) {
    return { error: `work item "${n.handler}" failed: ${e.message}`, errorCode: "SERVICE_ERROR" };
  }
};

// src/engine/nodes/def-types.ts
var CATEGORIES = ["Events", "Tasks", "Gateways", "Sub-process", "Data"];
var GENERAL = { title: "General", fields: [
  { key: "name", label: "Name", widget: "text" },
  { key: "documentation", label: "Documentation", widget: "textarea", placeholder: "Notes for this node" }
] };

// src/engine/nodes/start/def.ts
var def = {
  engineType: "start",
  palette: [
    { key: "start", label: "Start", category: "Events", icon: "\u25B6", color: "#16a34a", engineType: "start", defaults: { type: "start", name: "Start" } },
    { key: "start-signal", label: "Start (Signal)", category: "Events", icon: "\u{1F4E1}", color: "#16a34a", engineType: "start", defaults: { type: "start", on: { signal: "Start" } } },
    { key: "start-timer", label: "Start (Timer)", category: "Events", icon: "\u23F0", color: "#16a34a", engineType: "start", defaults: { type: "start", on: { timer: "R/PT1H" } } }
  ],
  ports: { maxIn: 0, maxOut: 1 },
  // start: exactly one outgoing
  schema: [GENERAL, { title: "Trigger", fields: [
    { key: "on", label: "Start trigger", widget: "event", options: ["none", "signal", "message", "timer", "condition"], help: "How instances of this process are started" },
    { key: "on.timer", label: "Timer / cron", widget: "text", help: "ISO duration (PT1H), date, or recurring cycle (R/PT1H). The active deployment auto-starts instances on schedule." }
  ] }]
};

// src/engine/nodes/end/def.ts
var def2 = {
  engineType: "end",
  palette: [
    { key: "end", label: "End", category: "Events", icon: "\u23F9", color: "#dc2626", engineType: "end", defaults: { type: "end", name: "End" } },
    { key: "end-terminate", label: "End (Terminate)", category: "Events", icon: "\u26D4", color: "#dc2626", engineType: "end", defaults: { type: "end", result: "terminate" } }
  ],
  ports: { maxOut: 0 },
  // end: no outgoing; multiple paths may converge into an end (unlimited in)
  schema: [GENERAL, { title: "End behavior", fields: [
    { key: "result", label: "Result", widget: "select", options: ["(normal)", "terminate"], help: "terminate cancels all other tokens and ends the whole instance" },
    { key: "throw", label: "Throw event", widget: "event", options: ["none", "signal", "error", "escalation", "message"] }
  ] }]
};

// src/engine/nodes/manual/def.ts
var def3 = {
  engineType: "manual",
  palette: [{ key: "manual", label: "Manual Task", category: "Tasks", icon: "\u270B", color: "#64748b", engineType: "manual", defaults: { type: "manual", name: "Manual Task" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL]
};

// src/engine/nodes/script/def.ts
var def4 = {
  engineType: "script",
  palette: [{ key: "script", label: "Script Task", category: "Tasks", icon: "{ }", color: "#0891b2", engineType: "script", defaults: { type: "script", lang: "js", code: "" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Script (JavaScript)", fields: [
    { key: "code", label: "Script body", widget: "code", placeholder: 'kcontext.setVariable("x", 1);', help: "Runs as JavaScript against kcontext (getVariable/setVariable)." }
  ] }]
};

// src/engine/nodes/http/def.ts
var def5 = {
  engineType: "http",
  palette: [{ key: "http", label: "Service Task (REST)", category: "Tasks", icon: "\u{1F310}", color: "#0d9488", engineType: "http", defaults: { type: "http", method: "POST", url: "/" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Request", fields: [
    { key: "method", label: "Method", widget: "select", options: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"] },
    { key: "url", label: "URL (appended to base)", widget: "text", placeholder: "/v1/claims" },
    { key: "headers", label: "Headers", widget: "keyval" },
    { key: "body", label: "Body (value or $var)", widget: "keyval" }
  ] }, { title: "Response", fields: [
    { key: "resultTo", label: "Map response \u2192 variable (var \u2190 JSONPath)", widget: "keyval", help: "e.g. verifierId \u2190 $.verifierId" }
  ] }]
};

// src/engine/nodes/rule/def.ts
var def6 = {
  engineType: "rule",
  palette: [{ key: "rule", label: "Business Rule", category: "Tasks", icon: "\u{1F4D0}", color: "#ea580c", engineType: "rule", defaults: { type: "rule", ruleflowGroup: "group" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "DRL rules", fields: [
    { key: "ruleflowGroup", label: "Ruleflow group", widget: "text", placeholder: "classify" }
  ] }, { title: "DMN (alternative)", fields: [
    { key: "dmn.namespace", label: "DMN namespace", widget: "text" },
    { key: "dmn.model", label: "DMN model name", widget: "text" },
    { key: "dmn.decision", label: "Decision name", widget: "text" }
  ] }, { title: "Decision tree / scorecard (alternative)", fields: [
    { key: "decisionTree", label: "Decision tree name", widget: "text", help: "Evaluate a guided decision tree asset" },
    { key: "scorecard", label: "Scorecard name", widget: "text", help: "Evaluate a scorecard asset (writes its target score)" }
  ] }]
};

// src/engine/nodes/gateway/def.ts
var def7 = {
  engineType: "gateway",
  palette: [
    { key: "gw-exclusive", label: "Exclusive Gateway", category: "Gateways", icon: "\u2715", color: "#f59e0b", engineType: "gateway", defaults: { type: "gateway", mode: "exclusive" } },
    { key: "gw-parallel", label: "Parallel Gateway", category: "Gateways", icon: "\uFF0B", color: "#f59e0b", engineType: "gateway", defaults: { type: "gateway", mode: "parallel" } },
    { key: "gw-inclusive", label: "Inclusive Gateway", category: "Gateways", icon: "\u25CB", color: "#f59e0b", engineType: "gateway", defaults: { type: "gateway", mode: "inclusive" } },
    { key: "gw-event", label: "Event Gateway", category: "Gateways", icon: "\u25C7", color: "#f59e0b", engineType: "gateway", defaults: { type: "gateway", mode: "event" } }
  ],
  ports: {},
  // diverging → many out; converging → many in
  schema: [GENERAL, { title: "Gateway", fields: [
    { key: "mode", label: "Mode", widget: "select", options: ["exclusive", "parallel", "inclusive", "event", "complex"] },
    { key: "direction", label: "Direction", widget: "select", options: ["Diverging", "Converging"] },
    { key: "default", label: "Default flow id", widget: "text", help: "Taken when no condition matches (exclusive/inclusive)" }
  ] }]
};

// src/engine/nodes/user-task/def.ts
var def8 = {
  engineType: "userTask",
  palette: [{ key: "userTask", label: "User Task", category: "Tasks", icon: "\u{1F464}", color: "#2563eb", engineType: "userTask", defaults: { type: "userTask", name: "User Task", group: "user" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Assignment", fields: [
    { key: "group", label: "Group / role", widget: "text", placeholder: "examiners" },
    { key: "assignee", label: "Assignee (specific user)", widget: "text" },
    { key: "businessAdmin", label: "Business administrator", widget: "text" },
    { key: "excludedOwners", label: "Excluded owners", widget: "stringlist" }
  ] }, { title: "Form & behavior", fields: [
    { key: "form", label: "Form name", widget: "text" },
    { key: "priority", label: "Priority", widget: "number" },
    { key: "dueDate", label: "Due date / SLA", widget: "text", placeholder: "PT8H or 2026-01-01" },
    { key: "skippable", label: "Skippable", widget: "bool" },
    { key: "description", label: "Task description", widget: "textarea" }
  ] }, { title: "Data", fields: [
    { key: "inputs", label: "Task inputs (taskVar \u2190 $processVar)", widget: "keyval" },
    { key: "outputs", label: "Task outputs (processVar \u2190 taskVar)", widget: "keyval" }
  ] }]
};

// src/engine/nodes/receive/def.ts
var def9 = {
  engineType: "receive",
  palette: [{ key: "receive", label: "Receive Task", category: "Tasks", icon: "\u{1F4E5}", color: "#16a34a", engineType: "receive", defaults: { type: "receive", message: "Msg" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Message", fields: [
    { key: "message", label: "Message name", widget: "text" },
    { key: "implementation", label: "Implementation", widget: "select", options: ["##WebService", "Other"] }
  ] }]
};

// src/engine/nodes/catch/def.ts
var def10 = {
  engineType: "catch",
  palette: [
    { key: "catch-timer", label: "Timer", category: "Events", icon: "\u23F1", color: "#7c3aed", engineType: "catch", defaults: { type: "catch", event: { timer: { duration: "PT5M" } } } },
    { key: "catch-message", label: "Catch Message", category: "Events", icon: "\u2709", color: "#7c3aed", engineType: "catch", defaults: { type: "catch", event: { message: "Msg" } } }
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Event", fields: [
    { key: "event", label: "Catch", widget: "event", options: ["timer", "message", "signal", "condition"] }
  ] }]
};

// src/engine/nodes/throw/def.ts
var def11 = {
  engineType: "throw",
  palette: [
    { key: "throw-signal", label: "Throw Signal", category: "Events", icon: "\u{1F4E3}", color: "#7c3aed", engineType: "throw", defaults: { type: "throw", event: { signal: "Go" } } },
    { key: "throw-compensation", label: "Compensate", category: "Events", icon: "\u21A9", color: "#0d9488", engineType: "throw", defaults: { type: "throw", event: { compensation: true } } }
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Event", fields: [
    { key: "event", label: "Throw", widget: "event", options: ["signal", "message", "escalation", "compensation"] },
    { key: "event.ref", label: "Compensate activity (optional)", widget: "text", help: "Host node id to compensate; blank = compensate all completed activities" }
  ] }]
};

// src/engine/nodes/send/def.ts
var def12 = {
  engineType: "send",
  palette: [{ key: "send", label: "Send Task", category: "Tasks", icon: "\u{1F4E4}", color: "#16a34a", engineType: "send", defaults: { type: "send", message: "Msg" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Message", fields: [
    { key: "message", label: "Message name", widget: "text" },
    { key: "implementation", label: "Implementation", widget: "select", options: ["##WebService", "Other"] }
  ] }]
};

// src/engine/nodes/call/def.ts
var def13 = {
  engineType: "call",
  palette: [{ key: "call", label: "Call Activity", category: "Sub-process", icon: "\u21E5", color: "#4f46e5", engineType: "call", defaults: { type: "call", process: "" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Called process", fields: [
    { key: "process", label: "Process id / key", widget: "text", placeholder: "child-workflow.process" },
    { key: "inputs", label: "Inputs (childVar \u2190 $parentVar or value)", widget: "keyval" },
    { key: "outputs", label: "Outputs (parentVar \u2190 childVar)", widget: "keyval" },
    { key: "independent", label: "Independent (don\u2019t wait)", widget: "bool" }
  ] }]
};

// src/engine/nodes/for-each/def.ts
var def14 = {
  engineType: "forEach",
  palette: [{ key: "forEach", label: "Multi-Instance", category: "Sub-process", icon: "\u21F6", color: "#4f46e5", engineType: "forEach", defaults: { type: "forEach", process: "", over: "items" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Multi-instance", fields: [
    { key: "process", label: "Process id / key", widget: "text" },
    { key: "over", label: "Collection variable", widget: "text", placeholder: "applicablePolicies" },
    { key: "as", label: "Item variable", widget: "text", placeholder: "currentPolicy" },
    { key: "collectInto", label: "Collect results into", widget: "text" },
    { key: "itemResult", label: "Item result variable", widget: "text" },
    { key: "parallel", label: "Run in parallel", widget: "bool" },
    { key: "pass", label: "Pass-through variables", widget: "stringlist" }
  ] }]
};

// src/engine/nodes/subprocess/def.ts
var def15 = {
  engineType: "subprocess",
  palette: [{ key: "subprocess", label: "Sub-process", category: "Sub-process", icon: "\u25AD", color: "#4f46e5", engineType: "subprocess", defaults: { type: "subprocess", nodes: [], flows: [] } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Sub-process", fields: [
    { key: "transaction", label: "Transaction", widget: "bool" },
    { key: "on.error", label: "Event sub-process on error", widget: "text", help: "Error code that triggers this as an event sub-process" }
  ] }]
};

// src/engine/nodes/boundary/def.ts
var def16 = {
  engineType: "boundary",
  palette: [
    { key: "error-catch", label: "Error Catch", category: "Events", icon: "\u26A0", color: "#dc2626", engineType: "boundary", defaults: { type: "boundary", name: "Error catch", on: [], event: { error: "*" }, interrupting: true } },
    { key: "boundary-timer", label: "Timer Catch", category: "Events", icon: "\u23F0", color: "#7c3aed", engineType: "boundary", defaults: { type: "boundary", name: "Timer", on: [], event: { timer: { duration: "P1D" } }, interrupting: false } },
    { key: "boundary-compensation", label: "Compensation", category: "Events", icon: "\u21A9", color: "#0d9488", engineType: "boundary", defaults: { type: "boundary", name: "Compensation", on: [], event: { compensation: true }, interrupting: false } }
  ],
  ports: { maxIn: 0, maxOut: 1 },
  // boundary: no incoming; one recovery outgoing
  schema: [GENERAL, { title: "Error / boundary catch", fields: [
    { key: "on", label: "Catch from", widget: "nodes", help: "Pick node(s) to catch (boundary), or \u201CAll nodes\u201D for a process-wide handler. Connect this node\u2019s outgoing flow to the recovery path." },
    { key: "event", label: "Trigger", widget: "event", options: ["error", "timer", "message", "signal", "escalation", "condition"] },
    { key: "interrupting", label: "Interrupting (cancel the caught activity)", widget: "bool" }
  ] }]
};

// src/engine/nodes/work-item/def.ts
var def17 = {
  engineType: "workItem",
  palette: [
    { key: "email", label: "Email", category: "Tasks", icon: "\u2709", color: "#16a34a", engineType: "workItem", defaults: { type: "workItem", name: "Send email", handler: "Email", params: { to: "", subject: "", body: "" } } },
    { key: "sms", label: "SMS", category: "Tasks", icon: "\u{1F4AC}", color: "#16a34a", engineType: "workItem", defaults: { type: "workItem", name: "Send SMS", handler: "SMS", params: { to: "", text: "" } } },
    { key: "db", label: "DB Task", category: "Tasks", icon: "\u{1F5C4}", color: "#2563eb", engineType: "workItem", defaults: { type: "workItem", name: "DB query", handler: "DBQuery", params: { query: "" } } },
    { key: "compute", label: "Compute", category: "Tasks", icon: "\u2211", color: "#0891b2", engineType: "workItem", defaults: { type: "workItem", name: "Compute", handler: "Compute", params: { expression: "" }, resultTo: { result: "result" } } },
    { key: "log", label: "Log", category: "Tasks", icon: "\u{1F4DD}", color: "#64748b", engineType: "workItem", defaults: { type: "workItem", name: "Log", handler: "Log", params: { message: "" } } }
  ],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Work item", fields: [
    { key: "handler", label: "Handler", widget: "select", options: ["Email", "SMS", "DBQuery", "Compute", "Log"], help: "Email/SMS/DB call the configured service URL (deployment env), else simulate. Compute evaluates a JS expression." },
    { key: "params", label: "Parameters (value or $var)", widget: "keyval" },
    { key: "resultTo", label: "Map result \u2192 variable", widget: "keyval", help: "e.g. result \u2190 result, sent \u2190 sent, rows \u2190 rows" }
  ] }]
};

// src/engine/nodes/index.ts
var NODE_HANDLERS = {
  start: handler,
  end: handler2,
  manual: handler3,
  script: handler4,
  http: handler5,
  rule: handler6,
  gateway: handler7,
  userTask: handler8,
  receive: handler9,
  catch: handler10,
  throw: handler11,
  send: handler12,
  call: handler13,
  forEach: handler14,
  subprocess: handler15,
  workItem: handler16
  // 'boundary' has no active handler — it is spawned by the error router and follows its outgoing flow.
};
var NODE_DEFS = [
  def,
  def2,
  def10,
  def11,
  def16,
  // Events
  def8,
  def4,
  def5,
  def6,
  def12,
  def9,
  def3,
  def17,
  // Tasks (+ work items)
  def7,
  // Gateways
  def13,
  def14,
  def15
  // Sub-process
];
var NODE_DEF_BY_TYPE = Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d]));

// src/modules/validation/rules.ts
var isStart = (n) => n.type === "start";
var isEnd = (n) => n.type === "end";
var isBoundary = (n) => n.type === "boundary";
var isEventSub = (n) => n.type === "subprocess" && !!n.on?.error;
var label = (n) => n.name || n.id || n.type;
function buildCtx(process2) {
  const nodes = process2.nodes || [];
  const flows = process2.flows || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = /* @__PURE__ */ new Map();
  const incoming = /* @__PURE__ */ new Map();
  for (const f of flows) {
    (outgoing.get(f.from) || outgoing.set(f.from, []).get(f.from)).push(f);
    (incoming.get(f.to) || incoming.set(f.to, []).get(f.to)).push(f);
  }
  const onList = (n) => {
    const on = n.on;
    return Array.isArray(on) ? on : on ? [on] : [];
  };
  const boundaryByHost = /* @__PURE__ */ new Map();
  for (const n of nodes) if (isBoundary(n)) {
    for (const host of onList(n)) (boundaryByHost.get(host) || boundaryByHost.set(host, []).get(host)).push(n);
  }
  const starts = nodes.filter(isStart);
  const ends = nodes.filter(isEnd);
  const reachable = /* @__PURE__ */ new Set();
  const globalCatches = nodes.filter((n) => isBoundary(n) && onList(n).includes("*"));
  const queue = [...starts.map((n) => n.id), ...nodes.filter(isEventSub).map((n) => n.id), ...globalCatches.map((n) => n.id)];
  while (queue.length) {
    const id = queue.shift();
    if (reachable.has(id) || !byId.has(id)) continue;
    reachable.add(id);
    for (const f of outgoing.get(id) || []) queue.push(f.to);
    for (const b of boundaryByHost.get(id) || []) queue.push(b.id);
  }
  return { process: process2, nodes, flows, byId, outgoing, incoming, starts, ends, reachable, boundaryByHost };
}
var P = (rule, severity, message, extra = {}) => ({ rule, severity, message, ...extra });
var deg = (ctx, id) => ({ in: (ctx.incoming.get(id) || []).length, out: (ctx.outgoing.get(id) || []).length });
var RULES = [
  { id: "start-exists", description: "Process must have at least one start node", run: (c) => c.starts.length ? [] : [P("start-exists", "error", "Process has no start node")] },
  { id: "end-exists", description: "Process must have at least one end node", run: (c) => c.ends.length ? [] : [P("end-exists", "error", "Process has no end node")] },
  { id: "single-start", description: "Prefer a single start node", run: (c) => c.starts.length > 1 ? [P("single-start", "warning", `Process has ${c.starts.length} start nodes`)] : [] },
  { id: "unique-ids", description: "Node ids must be unique", run: (c) => {
    const seen = /* @__PURE__ */ new Set(), dupes = /* @__PURE__ */ new Set();
    for (const n of c.nodes) {
      if (seen.has(n.id)) dupes.add(n.id);
      seen.add(n.id);
    }
    return [...dupes].map((id) => P("unique-ids", "error", `Duplicate node id "${id}"`, { nodeId: id }));
  } },
  { id: "flow-endpoints", description: "Every connection must link two existing nodes", run: (c) => {
    const out = [];
    for (const f of c.flows) {
      if (!c.byId.has(f.from)) out.push(P("flow-endpoints", "error", `Connection source "${f.from}" does not exist`, { flowId: f.id }));
      if (!c.byId.has(f.to)) out.push(P("flow-endpoints", "error", `Connection target "${f.to}" does not exist`, { flowId: f.id }));
      if (f.from === f.to) out.push(P("flow-endpoints", "warning", `Connection loops a node onto itself (${f.from})`, { flowId: f.id }));
    }
    return out;
  } },
  { id: "flow-direction", description: "Connections must respect each node type's declared ports (in/out)", run: (c) => {
    const out = [];
    for (const f of c.flows) {
      const from = c.byId.get(f.from);
      const to = c.byId.get(f.to);
      const fromDef = from && NODE_DEF_BY_TYPE[from.type];
      const toDef = to && NODE_DEF_BY_TYPE[to.type];
      if (fromDef && fromDef.ports.maxOut === 0) out.push(P("flow-direction", "error", `"${label(from)}" (${from.type}) has no outgoing connection point`, { flowId: f.id, nodeId: from.id }));
      if (toDef && toDef.ports.maxIn === 0) out.push(P("flow-direction", "error", `"${label(to)}" (${to.type}) has no incoming connection point`, { flowId: f.id, nodeId: to.id }));
    }
    return out;
  } },
  { id: "connection-cardinality", description: "Nodes must respect max in/out; only gateways branch/merge", run: (c) => {
    const out = [];
    for (const n of c.nodes) {
      const def28 = NODE_DEF_BY_TYPE[n.type];
      if (!def28) continue;
      const din = (c.incoming.get(n.id) || []).length, dout = (c.outgoing.get(n.id) || []).length;
      const { maxIn, maxOut } = def28.ports;
      if (maxOut != null && dout > maxOut) out.push(P("connection-cardinality", "error", `"${label(n)}" (${n.type}) allows at most ${maxOut} outgoing connection${maxOut === 1 ? "" : "s"} (has ${dout})`, { nodeId: n.id }));
      if (maxIn != null && din > maxIn) out.push(P("connection-cardinality", "error", `"${label(n)}" (${n.type}) allows at most ${maxIn} incoming connection${maxIn === 1 ? "" : "s"} (has ${din})`, { nodeId: n.id }));
      if (n.type === "gateway" && din > 1 && dout > 1) out.push(P("connection-cardinality", "error", `Gateway "${label(n)}" must be diverging (1\u2192many) or converging (many\u21921), not both`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "start-connections", description: "Start has one+ outgoing and no incoming", run: (c) => {
    const out = [];
    for (const n of c.starts) {
      const d = deg(c, n.id);
      if (d.out === 0) out.push(P("start-connections", "error", `Start "${label(n)}" has no outgoing connection`, { nodeId: n.id }));
      if (d.in > 0) out.push(P("start-connections", "error", `Start "${label(n)}" must not have incoming connections`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "end-connections", description: "End has one+ incoming and no outgoing", run: (c) => {
    const out = [];
    for (const n of c.ends) {
      const d = deg(c, n.id);
      if (d.in === 0) out.push(P("end-connections", "error", `End "${label(n)}" has no incoming connection`, { nodeId: n.id }));
      if (d.out > 0) out.push(P("end-connections", "error", `End "${label(n)}" must not have outgoing connections`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "node-connected", description: "Activities/gateways/events must be connected (no floating nodes)", run: (c) => {
    const out = [];
    for (const n of c.nodes) {
      if (isStart(n) || isEnd(n) || isEventSub(n)) continue;
      const d = deg(c, n.id);
      if (isBoundary(n)) {
        if (d.out === 0) out.push(P("node-connected", "error", `Boundary "${label(n)}" has no outgoing (handler) connection`, { nodeId: n.id }));
        continue;
      }
      if (d.in === 0 && d.out === 0) out.push(P("node-connected", "error", `Node "${label(n)}" is not connected`, { nodeId: n.id }));
      else if (d.in === 0) out.push(P("node-connected", "error", `Node "${label(n)}" has no incoming connection`, { nodeId: n.id }));
      else if (d.out === 0) out.push(P("node-connected", "error", `Node "${label(n)}" has no outgoing connection`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "reachable", description: "Every node must be reachable from a start", run: (c) => {
    const out = [];
    for (const n of c.nodes) {
      if (isStart(n) || isEventSub(n)) continue;
      const d = deg(c, n.id);
      if ((d.in > 0 || d.out > 0) && !c.reachable.has(n.id)) out.push(P("reachable", "error", `Node "${label(n)}" is not reachable from a start`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "ends-at-end", description: "Every path must terminate at an end event (no dead-ends / endless loops)", run: (c) => {
    if (!c.ends.length) return [];
    const reachesEnd = /* @__PURE__ */ new Set();
    const q2 = c.ends.map((n) => n.id);
    while (q2.length) {
      const id = q2.shift();
      if (reachesEnd.has(id) || !c.byId.has(id)) continue;
      reachesEnd.add(id);
      for (const f of c.incoming.get(id) || []) q2.push(f.from);
    }
    const out = [];
    for (const n of c.nodes) {
      if (isEnd(n) || isEventSub(n)) continue;
      if (c.reachable.has(n.id) && !reachesEnd.has(n.id)) out.push(P("ends-at-end", "error", `"${label(n)}" does not lead to an end event \u2014 every process path must finish at an End`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "boundary-host", description: "Error/boundary catch must attach to existing node(s) or all (*)", run: (c) => {
    const out = [];
    for (const n of c.nodes) if (isBoundary(n)) {
      const hosts = (() => {
        const on = n.on;
        return Array.isArray(on) ? on : on ? [on] : [];
      })();
      if (hosts.length === 0) {
        out.push(P("boundary-host", "error", `Catch "${label(n)}" is not attached to any node (pick nodes or "all")`, { nodeId: n.id }));
        continue;
      }
      for (const h of hosts) if (h !== "*" && !c.byId.has(h)) out.push(P("boundary-host", "error", `Catch "${label(n)}" attaches to missing node "${h}"`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "node-config", description: "Per-type required configuration", run: (c) => {
    const out = [];
    for (const n of c.nodes) {
      const a = n;
      switch (n.type) {
        case "script":
          if (!a.code || !String(a.code).trim()) out.push(P("node-config", "error", `Script "${label(n)}" has no code`, { nodeId: n.id }));
          break;
        case "http":
          if (!a.url) out.push(P("node-config", "error", `Service task "${label(n)}" has no URL`, { nodeId: n.id }));
          break;
        case "call":
          if (!a.process) out.push(P("node-config", "error", `Call activity "${label(n)}" has no called process`, { nodeId: n.id }));
          break;
        case "forEach":
          if (!a.process) out.push(P("node-config", "error", `Multi-instance "${label(n)}" has no process`, { nodeId: n.id }));
          if (!a.over) out.push(P("node-config", "error", `Multi-instance "${label(n)}" has no collection`, { nodeId: n.id }));
          break;
        case "rule":
          if (!a.ruleflowGroup && !a.dmn) out.push(P("node-config", "error", `Business rule "${label(n)}" references neither a ruleflow group nor a DMN decision`, { nodeId: n.id }));
          break;
        case "send":
          if (!a.message) out.push(P("node-config", "error", `Send task "${label(n)}" has no message`, { nodeId: n.id }));
          break;
        case "receive":
          if (!a.message) out.push(P("node-config", "error", `Receive task "${label(n)}" has no message`, { nodeId: n.id }));
          break;
        case "gateway":
          if (!a.mode) out.push(P("node-config", "error", `Gateway "${label(n)}" has no mode`, { nodeId: n.id }));
          break;
      }
    }
    return out;
  } },
  { id: "event-trigger", description: "Catch/throw/boundary events must define a trigger", run: (c) => {
    const out = [];
    const hasTrigger = (e) => e && (e.signal != null || e.message != null || e.error != null || e.escalation != null || e.condition != null || e.timer != null || e.compensation != null || e.compensate != null);
    for (const n of c.nodes) {
      const a = n;
      if ((n.type === "catch" || n.type === "throw" || n.type === "boundary") && !hasTrigger(a.event))
        out.push(P("event-trigger", "error", `${n.type} event "${label(n)}" has no trigger defined`, { nodeId: n.id }));
      const timer = a.event?.timer || n.type === "start" && a.on?.timer;
      if (timer && typeof timer === "object" && !timer.duration && !timer.cycle && !timer.date)
        out.push(P("event-trigger", "error", `Timer on "${label(n)}" has no duration/cycle/date`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "gateway-branching", description: "Diverging exclusive/inclusive gateways should resolve deterministically", run: (c) => {
    const out = [];
    for (const n of c.nodes) {
      const a = n;
      if (n.type !== "gateway" || a.mode !== "exclusive" && a.mode !== "inclusive") continue;
      const outs = c.outgoing.get(n.id) || [];
      if (outs.length <= 1) continue;
      const hasDefault = outs.some((f) => f.id && f.id === a.default);
      const uncond = outs.filter((f) => !f.when);
      if (!hasDefault && uncond.length === 0) out.push(P("gateway-branching", "warning", `Gateway "${label(n)}" has no default flow; instances may reach no branch`, { nodeId: n.id }));
      if (!hasDefault && uncond.length > 1) out.push(P("gateway-branching", "warning", `Gateway "${label(n)}" has multiple unconditional branches`, { nodeId: n.id }));
    }
    return out;
  } },
  { id: "usertask-assignment", description: "User task should have an actor or group", run: (c) => {
    const out = [];
    for (const n of c.nodes) if (n.type === "userTask" && !n.group && !n.assignee)
      out.push(P("usertask-assignment", "warning", `User task "${label(n)}" has no group or assignee`, { nodeId: n.id }));
    return out;
  } },
  { id: "condition-lang", description: "Flow conditions must be js to execute in the Node runtime", run: (c) => {
    const out = [];
    for (const f of c.flows) if (f.when && f.lang && f.lang !== "js")
      out.push(P("condition-lang", "warning", `Connection condition is "${f.lang}" and will not evaluate at runtime (use js)`, { flowId: f.id }));
    return out;
  } },
  { id: "node-name", description: "Nodes should be named", run: (c) => c.nodes.filter((n) => !n.name || !n.name.trim()).map((n) => P("node-name", "warning", `${n.type} "${n.id}" has no name`, { nodeId: n.id })) }
];
function validateProcess(process2) {
  const ctx = buildCtx(process2);
  const problems = RULES.flatMap((r) => r.run(ctx));
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");
  return { ok: errors.length === 0, errors, warnings, problems };
}

// src/modules/validation/service.ts
var ValidationService = class {
  validate(process2) {
    return validateProcess(process2);
  }
  validateProject(project) {
    const results = (project.processes || []).map((p) => validateProcess(p));
    return {
      ok: results.every((r) => r.ok),
      errors: results.flatMap((r) => r.errors),
      warnings: results.flatMap((r) => r.warnings),
      problems: results.flatMap((r) => r.problems)
    };
  }
  /** Throw VALIDATION_FAILED if the process has errors (used to gate publish/deploy). */
  assertValid(process2, action = "save") {
    const res = this.validate(process2);
    if (!res.ok) throw new ApiError("VALIDATION_FAILED", `Cannot ${action}: ${res.errors.length} validation error(s)`, res.errors);
  }
};

// src/modules/versions/service.ts
var VersionService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  ve() {
    return this.ctx.store.repo(Collections.versions);
  }
  br() {
    return this.ctx.store.repo(Collections.branches);
  }
  async mine(id) {
    const v = await this.ve().get(id);
    if (!v || v.tenantId !== this.ctx.tenantId) throw notFound("Version");
    return v;
  }
  async get(id) {
    return this.mine(id);
  }
  async listByBranch(branchId) {
    return (await this.ve().query((v) => v.tenantId === this.ctx.tenantId && v.branchId === branchId)).sort((a, b) => a.number - b.number);
  }
  /** Save engine JSON to the branch's head draft (creating a new draft if head is published). */
  async saveDraft(branchId, engine, actor, message) {
    const branch = await this.br().get(branchId);
    if (!branch || branch.tenantId !== this.ctx.tenantId) throw notFound("Branch");
    let head = branch.headVersionId ? await this.ve().get(branch.headVersionId) : void 0;
    if (head && head.state === "draft") {
      head.engine = engine;
      head.message = message ?? head.message;
      await this.ve().put(head);
      await this.ctx.audit({ actor, kind: "version.saved", workflowId: branch.workflowId, data: { versionId: head.id } });
      return head;
    }
    const all = await this.listByBranch(branchId);
    const nextNumber = (all.at(-1)?.number || 0) + 1;
    const version = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      workflowId: branch.workflowId,
      branchId,
      number: nextNumber,
      state: "draft",
      engine,
      parentVersionId: head?.id,
      message,
      createdAt: this.ctx.clock(),
      createdBy: actor
    };
    await this.ve().put(version);
    branch.headVersionId = version.id;
    await this.br().put(branch);
    await this.ctx.audit({ actor, kind: "version.created", workflowId: branch.workflowId, data: { versionId: version.id, number: nextNumber } });
    return version;
  }
  /** Freeze a draft and open a new draft head that continues from it. Blocks on validation errors. */
  async publish(id, actor, label2) {
    const v = await this.mine(id);
    if (v.state === "published") throw conflict("version already published");
    const proc = v.engine.processes?.[0];
    if (!proc) throw validation("version has no process");
    new ValidationService().assertValid(proc, "publish");
    v.state = "published";
    v.label = label2 ?? v.label;
    await this.ve().put(v);
    const newDraft = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      workflowId: v.workflowId,
      branchId: v.branchId,
      number: v.number + 1,
      state: "draft",
      engine: v.engine,
      parentVersionId: v.id,
      createdAt: this.ctx.clock(),
      createdBy: actor
    };
    await this.ve().put(newDraft);
    const branch = await this.br().get(v.branchId);
    if (branch) {
      branch.headVersionId = newDraft.id;
      await this.br().put(branch);
    }
    await this.ctx.audit({ actor, kind: "version.published", workflowId: v.workflowId, data: { versionId: v.id, label: label2 } });
    return { published: v, newDraft };
  }
  async validate(id) {
    const v = await this.mine(id);
    const proc = v.engine.processes?.[0];
    if (!proc) throw validation("version has no process");
    return new ValidationService().validate(proc);
  }
  async diff(aId, bId) {
    const a = await this.mine(aId);
    const b = await this.mine(bId);
    const pa = a.engine.processes?.[0];
    const pb = b.engine.processes?.[0];
    const byId = (arr = []) => new Map(arr.filter((x) => x.id).map((x) => [x.id, x]));
    const delta = (la = [], lb = []) => {
      const ma = byId(la);
      const mb = byId(lb);
      const added = [...mb.keys()].filter((k) => !ma.has(k));
      const removed = [...ma.keys()].filter((k) => !mb.has(k));
      const changed = [...ma.keys()].filter((k) => mb.has(k) && JSON.stringify(ma.get(k)) !== JSON.stringify(mb.get(k)));
      return { added, removed, changed };
    };
    const varsA = (pa?.vars || []).map((v) => ({ id: v.name, ...v }));
    const varsB = (pb?.vars || []).map((v) => ({ id: v.name, ...v }));
    return {
      nodes: delta(pa?.nodes, pb?.nodes),
      flows: delta(
        (pa?.flows || []).map((f, i) => ({ id: f.id || `${f.from}->${f.to}#${i}`, ...f })),
        (pb?.flows || []).map((f, i) => ({ id: f.id || `${f.from}->${f.to}#${i}`, ...f }))
      ),
      vars: delta(varsA, varsB)
    };
  }
};

// src/modules/deployments/service.ts
var DeploymentService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  dp() {
    return this.ctx.store.repo(Collections.deployments);
  }
  ve() {
    return this.ctx.store.repo(Collections.versions);
  }
  tm() {
    return this.ctx.store.repo(Collections.timers);
  }
  async get(id) {
    const d = await this.dp().get(id);
    if (!d || d.tenantId !== this.ctx.tenantId) throw notFound("Deployment");
    return d;
  }
  async listByWorkflow(workflowId) {
    return (await this.dp().query((d) => d.tenantId === this.ctx.tenantId && d.workflowId === workflowId)).sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
  }
  /** Snapshot a published version into an inactive deployment. */
  async deploy(versionId, input, actor) {
    const v = await this.ve().get(versionId);
    if (!v || v.tenantId !== this.ctx.tenantId) throw notFound("Version");
    if (v.state !== "published") throw conflict("only published versions can be deployed");
    const environment = (input.environment || "").trim();
    if (!environment) throw validation("environment is required");
    const dep = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      workflowId: v.workflowId,
      versionId: v.id,
      branchId: v.branchId,
      engine: structuredClone(v.engine),
      env: input.env || {},
      tags: [.../* @__PURE__ */ new Set([environment, ...input.tags || []])],
      status: "inactive",
      environment,
      versionNumber: v.number,
      versionLabel: v.label,
      deployedAt: this.ctx.clock(),
      deployedBy: actor
    };
    await this.dp().put(dep);
    await this.ctx.audit({ actor, kind: "deployment.created", workflowId: v.workflowId, deploymentId: dep.id, data: { versionId, environment, tags: dep.tags } });
    if (input.activate) return this.activate(dep.id, actor);
    return dep;
  }
  async setTags(id, change, actor) {
    const d = await this.get(id);
    const set = new Set(d.tags);
    for (const t of change.add || []) set.add(t);
    for (const t of change.remove || []) if (t !== d.environment) set.delete(t);
    d.tags = [...set];
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: "deployment.tagged", workflowId: d.workflowId, deploymentId: id, data: { tags: d.tags } });
    return d;
  }
  /** Activate this deployment in its environment; atomically deactivate the previous active one. */
  async activate(id, actor) {
    const d = await this.get(id);
    if (d.status === "archived") throw conflict("cannot activate an archived deployment");
    const siblings = await this.dp().query((x) => x.tenantId === this.ctx.tenantId && x.workflowId === d.workflowId && x.environment === d.environment && x.status === "active");
    for (const s of siblings) {
      if (s.id === d.id) continue;
      s.status = "inactive";
      s.undeployedAt = this.ctx.clock();
      await this.dp().put(s);
      await this.ctx.audit({ actor, kind: "deployment.deactivated", workflowId: d.workflowId, deploymentId: s.id });
    }
    d.status = "active";
    d.undeployedAt = void 0;
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: "deployment.activated", workflowId: d.workflowId, deploymentId: id, data: { environment: d.environment } });
    await this.syncStartTimers(d);
    return d;
  }
  /**
   * Reconcile start-timer / cron scheduled starts for (workflow, environment): cancel every scheduled
   * start job in that scope, then schedule a fresh job per timer-triggered start node of whichever
   * deployment is currently active. Called on activate/undeploy/archive so exactly the live
   * deployment's schedule runs. `changed` names the (workflow, environment) scope to reconcile.
   */
  async syncStartTimers(changed) {
    const scope = await this.dp().query((x) => x.tenantId === this.ctx.tenantId && x.workflowId === changed.workflowId && x.environment === changed.environment);
    const ids = new Set(scope.map((x) => x.id));
    const stale = await this.tm().query((t) => t.kind === "start" && t.status === "scheduled" && ids.has(t.deploymentId || ""));
    for (const t of stale) {
      t.status = "cancelled";
      await this.tm().put(t);
    }
    const active = scope.find((x) => x.status === "active");
    if (!active) return;
    const now = this.ctx.clock();
    for (const p of active.engine?.processes || []) {
      for (const n of p.nodes || []) {
        if (n.type !== "start") continue;
        const spec = n.on?.timer ?? n.timer;
        if (!spec) continue;
        const cycle = typeof spec === "object" ? spec.cycle : typeof spec === "string" && spec.startsWith("R") ? spec : void 0;
        const job = {
          id: this.ctx.newId(),
          tenantId: this.ctx.tenantId,
          instanceId: "",
          tokenId: "",
          nodeId: n.id,
          kind: "start",
          dueAt: computeDue(cycle ? { cycle } : spec, now),
          cycle,
          fired: 0,
          status: "scheduled",
          deploymentId: active.id,
          processId: p.id
        };
        await this.tm().put(job);
      }
    }
  }
  async rollback(environment, toDeploymentId, actor) {
    const target = await this.get(toDeploymentId);
    if (target.environment !== environment) throw validation("target deployment is in a different environment");
    return this.activate(toDeploymentId, actor);
  }
  async undeploy(id, actor) {
    const d = await this.get(id);
    d.status = "inactive";
    d.undeployedAt = this.ctx.clock();
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: "deployment.undeployed", workflowId: d.workflowId, deploymentId: id });
    await this.syncStartTimers(d);
    return d;
  }
  async archive(id, actor) {
    const d = await this.get(id);
    d.status = "archived";
    d.archivedAt = this.ctx.clock();
    await this.dp().put(d);
    await this.ctx.audit({ actor, kind: "deployment.archived", workflowId: d.workflowId, deploymentId: id });
    await this.syncStartTimers(d);
    return d;
  }
  /** Resolve the deployment that should serve a new instance for (workflow, environment). */
  async resolveActive(workflowId, environment) {
    const active = await this.dp().query((d) => d.tenantId === this.ctx.tenantId && d.workflowId === workflowId && d.environment === environment && d.status === "active");
    if (!active.length) throw conflict(`no active deployment for environment "${environment}"`);
    return active[0];
  }
};

// src/engine/execution-engine.ts
var ENGINE_ERRORS = ["SCRIPT_ERROR", "SERVICE_ERROR", "RULE_ERROR", "CALL_ERROR", "RUNTIME_ERROR"];
var ERROR_VAR = "errorInfo";
var ExecutionEngine = class {
  constructor(ctx, emit3 = () => {
  }, resolveCalled) {
    this.ctx = ctx;
    this.emit = emit3;
    this.resolveCalled = resolveCalled;
  }
  ctx;
  emit;
  resolveCalled;
  inst() {
    return this.ctx.store.repo(Collections.instances);
  }
  deps() {
    return this.ctx.store.repo(Collections.deployments);
  }
  // ---- process graph helpers ----
  /** The process (definition) an instance runs — selected by its processId, else the first. */
  pick(dep, processId) {
    const list = dep.engine.processes || [];
    if (processId && processId.includes("::")) {
      const [parentId, nodeId] = processId.split("::");
      const parent = list.find((x) => x.id === parentId) || list[0];
      const sub = parent?.nodes.find((n) => n.id === nodeId);
      if (!sub) throw new Error("embedded sub-process not found");
      return { id: processId, name: sub.name || "Sub-process", nodes: sub.nodes || [], flows: sub.flows || [] };
    }
    const p = processId && list.find((x) => x.id === processId) || list[0];
    if (!p) throw new Error("deployment has no process");
    return p;
  }
  proc(inst, dep) {
    return this.pick(dep, inst.processId);
  }
  nodeMap(p) {
    return new Map(p.nodes.map((n) => [n.id, n]));
  }
  outgoing(p, nodeId) {
    return p.flows.filter((f) => f.from === nodeId);
  }
  incoming(p, nodeId) {
    return p.flows.filter((f) => f.to === nodeId);
  }
  // ---- lifecycle ----
  async start(dep, variables, actor, opts = {}) {
    const p = this.pick(dep, opts.processId);
    const startNode = p.nodes.find((n) => n.type === "start") || p.nodes[0];
    if (!startNode) throw new Error("process has no start node");
    const now = this.ctx.clock();
    const seed = {};
    for (const v of p.vars || []) seed[v.name] = void 0;
    const inst = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      deploymentId: dep.id,
      workflowId: dep.workflowId,
      processId: p.id,
      correlationKey: opts.correlationKey,
      status: "running",
      variables: { ...seed, ...variables },
      tokens: [{ id: this.ctx.newId(), nodeId: startNode.id, state: "active", enteredAt: now }],
      history: [],
      startedAt: now,
      startedBy: actor
    };
    this.emit({ kind: "instance.started", instanceId: inst.id });
    await this.runToQuiescence(inst, dep);
    return inst;
  }
  /** Advance every active token until the instance waits, completes, aborts, or fails. */
  async runToQuiescence(inst, dep) {
    const p = this.proc(inst, dep);
    const nodes = this.nodeMap(p);
    const joins = {};
    let guard = 0;
    try {
      while (inst.status === "running") {
        const token = inst.tokens.find((t) => t.state === "active");
        if (!token) break;
        if (++guard > 1e5) throw new Error("step budget exceeded (possible loop)");
        const node = nodes.get(token.nodeId);
        if (!node) {
          this.removeToken(inst, token.id);
          continue;
        }
        const visit = { tokenId: token.id, nodeId: node.id, type: node.type, enteredAt: this.ctx.clock() };
        inst.history.push(visit);
        this.emit({ kind: "node.entered", instanceId: inst.id, nodeId: node.id, tokenId: token.id });
        let result;
        try {
          result = await this.handle(node, inst, p, joins, dep);
        } catch (e) {
          result = { error: e.message, errorCode: "RUNTIME_ERROR" };
        }
        if (result.vars) Object.assign(inst.variables, result.vars);
        visit.exitedAt = this.ctx.clock();
        visit.outcome = result.outcome || (result.wait ? "waiting" : result.end || (result.error ? "error" : "done"));
        this.emit({ kind: "node.exited", instanceId: inst.id, nodeId: node.id, tokenId: token.id });
        if (result.wait) {
          token.state = "waiting";
          token.waitFor = result.wait;
          if (result.wait.kind === "timer" && result.wait.dueAt) await this.scheduleTimer(inst, token.id, node.id, result.wait.dueAt);
          for (const b of p.nodes) {
            if (b.type === "boundary" && b.event?.timer && this.onList(b).includes(node.id)) {
              await this.scheduleTimer(inst, token.id, b.id, computeDue(b.event.timer, this.ctx.clock()));
            }
          }
          continue;
        }
        if (result.error) {
          this.removeToken(inst, token.id);
          const code = result.errorCode || "RUNTIME_ERROR";
          if (this.raiseError(inst, p, node.id, code, result.error)) continue;
          inst.status = "failed";
          inst.error = { nodeId: node.id, message: result.error, at: this.ctx.clock() };
          break;
        }
        if (result.end === "terminate") {
          inst.tokens = [];
          inst.status = "completed";
          break;
        }
        if (result.end === "error") {
          this.removeToken(inst, token.id);
          const code = node.throw?.error || "ERROR";
          if (this.raiseError(inst, p, node.id, code, `error end: ${code}`)) continue;
          inst.status = "failed";
          inst.error = { nodeId: node.id, message: `unhandled error end (${code})`, at: this.ctx.clock() };
          break;
        }
        for (const b of p.nodes) {
          if (b.type === "boundary" && b.event?.compensation && this.onList(b).includes(node.id)) {
            const target = this.outgoing(p, b.id)[0]?.to;
            if (target) (inst.compensations ||= []).push({ host: node.id, handler: target });
          }
        }
        this.removeToken(inst, token.id);
        if (result.end === "complete" || result.consume) {
        } else {
          const targets = result.next ?? this.defaultTargets(p, node, inst);
          for (const t of targets) inst.tokens.push({ id: this.ctx.newId(), nodeId: t, state: "active", enteredAt: this.ctx.clock() });
        }
      }
      if (inst.status === "running") {
        inst.status = inst.tokens.some((t) => t.state === "waiting") ? "waiting" : "completed";
      }
      if (inst.status === "completed" || inst.status === "aborted" || inst.status === "failed") inst.endedAt = this.ctx.clock();
    } catch (err) {
      inst.status = "failed";
      inst.error = { nodeId: "", message: err.message, stack: err.stack, at: this.ctx.clock() };
      inst.endedAt = this.ctx.clock();
    }
    await this.inst().put(inst);
    this.emit({ kind: inst.status === "failed" ? "instance.failed" : inst.status === "completed" ? "instance.completed" : "instance.updated", instanceId: inst.id });
    if (inst.status === "completed" || inst.status === "aborted" || inst.status === "failed") {
      await this.cancelTimersForInstance(inst.id);
      await this.abortDescendants(inst.id);
    }
    if (inst.parentInstanceId) {
      if (inst.status === "completed") await this.tryResumeParent(inst);
      else if (inst.status === "aborted" || inst.status === "failed") await this.tryFailParent(inst);
    }
    return inst;
  }
  /** Abort every still-active descendant instance (recursively), cancelling their timers. */
  async abortDescendants(parentId) {
    const children = await this.inst().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === parentId && (c.status === "running" || c.status === "waiting" || c.status === "suspended"));
    for (const child of children) {
      child.status = "aborted";
      child.tokens = [];
      child.endedAt = this.ctx.clock();
      await this.cancelTimersForInstance(child.id);
      await this.inst().put(child);
      this.emit({ kind: "instance.updated", instanceId: child.id });
      await this.abortDescendants(child.id);
    }
  }
  /** Public entry: abort an instance and its whole subtree; also unblock a waiting parent. */
  async abortInstance(inst) {
    if (inst.status === "completed" || inst.status === "aborted") return inst;
    inst.status = "aborted";
    inst.tokens = [];
    inst.endedAt = this.ctx.clock();
    await this.cancelTimersForInstance(inst.id);
    await this.inst().put(inst);
    this.emit({ kind: "instance.updated", instanceId: inst.id });
    await this.abortDescendants(inst.id);
    if (inst.parentInstanceId) await this.tryFailParent(inst);
    return inst;
  }
  /** A child instance aborted/failed → remove the parent's waiting token and raise an error there
   *  (routes to an error boundary if one is attached, otherwise the parent fails and cascades). */
  async tryFailParent(child) {
    const parent = await this.inst().get(child.parentInstanceId);
    if (!parent || parent.status === "completed" || parent.status === "aborted" || parent.status === "failed") return;
    const token = parent.tokens.find((t) => t.state === "waiting" && t.waitFor?.kind === "child" && t.waitFor?.ref === child.id);
    if (!token) return;
    const pdep = await this.deps().get(parent.deploymentId);
    if (!pdep) return;
    const p = this.pick(pdep, parent.processId);
    this.removeToken(parent, token.id);
    const code = child.status === "aborted" ? "SUBPROCESS_ABORTED" : "SUBPROCESS_ERROR";
    if (this.raiseError(parent, p, token.nodeId, code, `child instance ${child.status}: ${child.id}`)) {
      parent.status = "running";
      await this.runToQuiescence(parent, pdep);
    } else {
      parent.status = "failed";
      parent.error = { nodeId: token.nodeId, message: `child instance ${child.status}`, at: this.ctx.clock() };
      parent.endedAt = this.ctx.clock();
      await this.inst().put(parent);
      this.emit({ kind: "instance.failed", instanceId: parent.id });
      await this.abortDescendants(parent.id);
      if (parent.parentInstanceId) await this.tryFailParent(parent);
    }
  }
  /** A child instance completed → map its outputs into the parent and continue the parent flow. */
  async tryResumeParent(child) {
    const parent = await this.inst().get(child.parentInstanceId);
    if (!parent) return;
    const token = parent.tokens.find((t) => t.state === "waiting" && t.waitFor?.kind === "child" && t.waitFor?.ref === child.id);
    if (!token) return;
    const pdep = await this.deps().get(parent.deploymentId);
    if (!pdep) return;
    const callNode = this.pick(pdep, parent.processId).nodes.find((n) => n.id === token.nodeId);
    let vars = {};
    if (callNode?.type === "subprocess") vars = { ...child.variables };
    else for (const [pv, cv] of Object.entries(callNode?.outputs || {})) vars[pv] = child.variables[cv];
    await this.resumeToken(parent, pdep, token.id, vars);
  }
  /** Start a child process instance linked to a parent token (call activity). */
  async startChild(dep, processId, vars, actor, parentInstanceId, parentTokenId) {
    const p = this.pick(dep, processId);
    const startNode = p.nodes.find((n) => n.type === "start") || p.nodes[0];
    const now = this.ctx.clock();
    const child = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      deploymentId: dep.id,
      workflowId: dep.workflowId,
      processId: p.id,
      status: "running",
      variables: { ...vars },
      tokens: [{ id: this.ctx.newId(), nodeId: startNode.id, state: "active", enteredAt: now }],
      history: [],
      startedAt: now,
      startedBy: actor,
      parentInstanceId,
      parentTokenId
    };
    this.emit({ kind: "instance.started", instanceId: child.id });
    return this.runToQuiescence(child, dep);
  }
  /**
   * Run compensation handlers for successfully-completed activities in reverse (LIFO) order. `ref`
   * limits compensation to a single host activity; omitted → compensate everything recorded so far.
   * Handlers execute inline (they don't spawn into the main flow); each is recorded in history.
   */
  async compensate(inst, p, dep, ref2) {
    const all = inst.compensations || [];
    const toRun = [...all].reverse().filter((c) => !ref2 || c.host === ref2);
    const merged = {};
    const nodes = this.nodeMap(p);
    for (const entry of toRun) {
      const handler17 = nodes.get(entry.handler);
      if (!handler17) continue;
      const visit = { tokenId: "compensation", nodeId: handler17.id, type: handler17.type, enteredAt: this.ctx.clock() };
      inst.history.push(visit);
      this.emit({ kind: "node.entered", instanceId: inst.id, nodeId: handler17.id, tokenId: "compensation" });
      let res;
      try {
        res = await this.handle(handler17, inst, p, {}, dep);
      } catch (e) {
        res = { error: e.message };
      }
      if (res.vars) {
        Object.assign(inst.variables, res.vars);
        Object.assign(merged, res.vars);
      }
      visit.exitedAt = this.ctx.clock();
      visit.outcome = res.error ? `compensation-error: ${res.error}` : "compensated";
      this.emit({ kind: "node.exited", instanceId: inst.id, nodeId: handler17.id, tokenId: "compensation" });
    }
    inst.compensations = all.filter((c) => ref2 ? c.host !== ref2 : false);
    return merged;
  }
  /** Broadcast a signal/message to every waiting instance in the tenant (send/throw). */
  async broadcast(name) {
    const others = await this.inst().query((i) => i.tenantId === this.ctx.tenantId && (i.status === "waiting" || i.status === "running"));
    for (const other of others) {
      const hit = other.tokens.some((t) => t.state === "waiting" && (t.waitFor?.kind === "signal" || t.waitFor?.kind === "message") && t.waitFor?.ref === name);
      if (!hit) continue;
      const dep = await this.deps().get(other.deploymentId);
      if (dep) await this.signalInstance(other, dep, name);
    }
  }
  /** Deliver a signal/message to an instance: resume every token waiting on that name. */
  async signalInstance(inst, dep, name, payload) {
    const targets = inst.tokens.filter((t) => t.state === "waiting" && (t.waitFor?.kind === "signal" || t.waitFor?.kind === "message") && t.waitFor?.ref === name).map((t) => t.id);
    for (const tid of targets) {
      if (inst.tokens.find((t) => t.id === tid && t.state === "waiting")) {
        await this.resumeToken(inst, dep, tid, payload !== void 0 ? { [name]: payload } : void 0);
      }
    }
    return inst;
  }
  /** Re-trigger a node: drop a fresh active token onto it and run (retry a failed node or replay). */
  async retryNode(inst, dep, nodeId) {
    inst.error = void 0;
    inst.tokens.push({ id: this.ctx.newId(), nodeId, state: "active", enteredAt: this.ctx.clock() });
    inst.status = "running";
    return this.runToQuiescence(inst, dep);
  }
  removeToken(inst, tokenId) {
    inst.tokens = inst.tokens.filter((t) => t.id !== tokenId);
  }
  // ---- timers ----
  timerRepo() {
    return this.ctx.store.repo(Collections.timers);
  }
  async scheduleTimer(inst, tokenId, nodeId, dueAt) {
    await this.timerRepo().put({ id: this.ctx.newId(), tenantId: this.ctx.tenantId, instanceId: inst.id, tokenId, nodeId, kind: "duration", dueAt, fired: 0, status: "scheduled" });
  }
  /** Cancel a token's pending timers (host completed/resumed → its boundary/catch timers no longer apply). */
  async cancelTimersForToken(inst, tokenId) {
    const jobs = await this.timerRepo().query((t) => t.instanceId === inst.id && t.tokenId === tokenId && t.status === "scheduled");
    for (const j of jobs) {
      j.status = "cancelled";
      await this.timerRepo().put(j);
    }
  }
  /** Cancel every pending timer for an instance (instance reached a terminal state). */
  async cancelTimersForInstance(instanceId) {
    const jobs = await this.timerRepo().query((t) => t.instanceId === instanceId && t.status === "scheduled");
    for (const j of jobs) {
      j.status = "cancelled";
      await this.timerRepo().put(j);
    }
  }
  /** Fire a due timer job: boundary timer → activate the boundary; else resume the (catch) token. */
  async fireTimerJob(inst, dep, nodeId, tokenId) {
    const node = this.nodeMap(this.proc(inst, dep)).get(nodeId);
    if (node?.type === "boundary") return this.fireBoundary(inst, dep, node, tokenId);
    return this.resumeToken(inst, dep, tokenId);
  }
  /** A timer boundary fired: interrupting cancels the host token; then run the boundary's recovery flow. */
  async fireBoundary(inst, dep, boundary, hostTokenId) {
    const host = inst.tokens.find((t) => t.id === hostTokenId);
    if (!host) return inst;
    if (boundary.interrupting !== false) {
      this.removeToken(inst, hostTokenId);
      await this.cancelTimersForToken(inst, hostTokenId);
    }
    inst.tokens.push({ id: this.ctx.newId(), nodeId: boundary.id, state: "active", enteredAt: this.ctx.clock() });
    inst.status = "running";
    this.emit({ kind: "node.entered", instanceId: inst.id, nodeId: boundary.id, tokenId: inst.tokens.at(-1).id });
    return this.runToQuiescence(inst, dep);
  }
  // ---- error handling: route a raised error to a matching error-catch (boundary, or an event
  // sub-process with an error start — jBPM's other common "global error handler" idiom) ----
  //
  // jBPM/BPMN error declarations are named for human/XML readability (e.g. "REST_API_FAILURE" with
  // errorCode "org.jbpm.bpmn2.handler.WorkItemHandlerRuntimeException"); the Node runtime only ever
  // raises one of the fixed ENGINE_ERRORS codes, since that's determined entirely by which node TYPE
  // failed (an http node can only ever produce SERVICE_ERROR, a script node only SCRIPT_ERROR, etc).
  // A catch attached to one specific host can therefore only ever see one possible code anyway, so it
  // matches on ANY error from that host regardless of what name the author (or the mechanical jBPM
  // conversion) gave it — no author or converted process needs to know this runtime's internal
  // vocabulary. A GLOBAL catch (on: '*', or any event sub-process error-start, which is always
  // process-wide) still needs the code to disambiguate if there's more than one global handler; a
  // declared name that isn't itself one of ENGINE_ERRORS defaults to SERVICE_ERROR, since "catch
  // failures anywhere" overwhelmingly means "catch service/work-item failures" in real jBPM projects
  // (this project's own pru-sample-global-error/pru-api-error-handler are exactly that pattern). Use
  // an explicit ENGINE_ERRORS name, or '*'/'ANY'/empty, to mean something else or to catch everything.
  /** on: string | string[]; '*' = all nodes (process-global). Normalize to a list. (boundary only —
   *  an event sub-process error-catch has no host list; see isGlobalCatch.) */
  onList(n) {
    const on = n.on;
    return Array.isArray(on) ? on : typeof on === "string" ? [on] : [];
  }
  /** the declared error name/id, regardless of which catch construct carries it */
  catchErrorName(n) {
    if (n.type === "boundary") return n.event?.error;
    if (n.type === "subprocess") return n.on?.error;
    return void 0;
  }
  isErrorCatch(n) {
    if (n.type === "boundary") {
      const e = n.event;
      return !!e && Object.prototype.hasOwnProperty.call(e, "error");
    }
    if (n.type === "subprocess") return !!n.on && Object.prototype.hasOwnProperty.call(n.on, "error");
    return false;
  }
  isCatchAll(n) {
    const e = this.catchErrorName(n);
    return e === "" || e === "*" || e == null || String(e).toUpperCase() === "ANY";
  }
  /** an event sub-process error-catch is always process-wide; a boundary is global only via on: '*' */
  isGlobalCatch(n) {
    return n.type === "subprocess" || this.onList(n).includes("*");
  }
  /** A global, named catch matches a raised code if: the names match exactly (covers an explicit
   *  author error-throw end paired with an author-named catch — both sides pick the same custom
   *  name, e.g. "VALIDATION", and mean exactly that); OR the raised code came from an actual node
   *  execution failure (i.e. IS one of ENGINE_ERRORS — never true for an author's own error-throw
   *  end, which raises its literal custom name) and this catch's name is itself NOT a recognized
   *  ENGINE_ERRORS name, in which case it's treated as meaning SERVICE_ERROR (see block comment
   *  above) — a non-standard-named catch is never assumed to mean SCRIPT_ERROR/RULE_ERROR/etc. */
  globalNameMatches(n, code) {
    const declared = this.catchErrorName(n);
    if (declared === code) return true;
    const ERR = ENGINE_ERRORS;
    return ERR.includes(code) && declared !== void 0 && !ERR.includes(declared) && code === "SERVICE_ERROR";
  }
  /** Find the best error-catch for (failing node, code): host-specific (any code) → global+named → global+catch-all. */
  findErrorHandler(p, nodeId, code) {
    const catches = p.nodes.filter((n) => this.isErrorCatch(n));
    const onNode = (n) => !this.isGlobalCatch(n) && this.onList(n).includes(nodeId);
    const globalNamed = (n) => this.isGlobalCatch(n) && !this.isCatchAll(n) && this.globalNameMatches(n, code);
    const globalCatchAll = (n) => this.isGlobalCatch(n) && this.isCatchAll(n);
    return catches.find(onNode) || catches.find(globalNamed) || catches.find(globalCatchAll);
  }
  /** Route an error to a matching error-catch; returns true if handled (a handler token was spawned). */
  raiseError(inst, p, failingNodeId, code, message) {
    const handler17 = this.findErrorHandler(p, failingNodeId, code);
    if (!handler17) return false;
    inst.variables[ERROR_VAR] = { code, node: failingNodeId, message };
    if (this.isGlobalCatch(handler17)) inst.tokens = [];
    inst.tokens.push({ id: this.ctx.newId(), nodeId: handler17.id, state: "active", enteredAt: this.ctx.clock() });
    this.emit({ kind: "node.entered", instanceId: inst.id, nodeId: handler17.id, tokenId: inst.tokens.at(-1).id });
    return true;
  }
  defaultTargets(p, node, _inst) {
    return this.outgoing(p, node.id).map((f) => f.to);
  }
  // ---- node dispatch ----
  // Each node type's backend logic lives in src/engine/nodes/<type>/handler.ts (see NODE_HANDLERS).
  // The engine builds a HandlerCtx (node + instance state + capabilities) and runs the handler.
  async handle(node, inst, p, joins, dep) {
    const h = NODE_HANDLERS[node.type];
    if (!h) return {};
    const c = {
      node,
      inst,
      proc: p,
      dep,
      app: this.ctx,
      joins,
      outgoing: (id) => this.outgoing(p, id),
      incoming: (id) => this.incoming(p, id),
      emit: (e) => this.emit(e),
      startChild: (d, pid, vars, tok) => this.startChild(d, pid, vars, inst.startedBy, inst.id, tok),
      broadcast: (name) => this.broadcast(name),
      compensate: (ref2) => this.compensate(inst, p, dep, ref2),
      resolveCalled: this.resolveCalled
    };
    return h(c);
  }
  // ---- resume (wait states) ----
  /** Complete a wait node (task/timer/message/signal) and continue the instance. */
  async resumeToken(inst, dep, tokenId, vars) {
    if (inst.status === "suspended") throw new Error("instance is suspended");
    const token = inst.tokens.find((t) => t.id === tokenId);
    if (!token || token.state !== "waiting") throw new Error("token is not waiting");
    if (vars) Object.assign(inst.variables, vars);
    await this.cancelTimersForToken(inst, tokenId);
    const p = this.proc(inst, dep);
    const node = this.nodeMap(p).get(token.nodeId);
    this.removeToken(inst, tokenId);
    if (node) for (const t of this.defaultTargets(p, node, inst)) inst.tokens.push({ id: this.ctx.newId(), nodeId: t, state: "active", enteredAt: this.ctx.clock() });
    inst.status = "running";
    return this.runToQuiescence(inst, dep);
  }
  /** Diagram state for the live canvas highlight. */
  diagramState(inst) {
    const active = inst.tokens.map((t) => t.nodeId);
    const visited = [...new Set(inst.history.map((h) => h.nodeId))];
    return { activeNodeIds: active, visitedNodeIds: visited, status: inst.status };
  }
};

// src/modules/instances/service.ts
var InstanceService = class {
  constructor(ctx, emit3 = () => {
  }) {
    this.ctx = ctx;
    this.deployments = new DeploymentService(ctx);
    const resolveCalled = async (processId) => {
      const deps = await this.ctx.store.repo(Collections.deployments).query((d) => d.tenantId === this.ctx.tenantId && d.status === "active");
      for (const dep of deps) {
        const p = (dep.engine?.processes || []).find((x) => x.id === processId);
        if (p) return { dep, processId: p.id };
      }
      return void 0;
    };
    this.engine = new ExecutionEngine(ctx, emit3, resolveCalled);
  }
  ctx;
  engine;
  deployments;
  repo() {
    return this.ctx.store.repo(Collections.instances);
  }
  async start(input, actor) {
    let dep;
    if (input.deploymentId) dep = await this.deployments.get(input.deploymentId);
    else dep = await this.deployments.resolveActive(input.workflowId, input.environment || "prod");
    if (dep.status === "archived") throw conflict("cannot start on an archived deployment");
    return this.engine.start(dep, input.variables || {}, actor, { processId: input.processId, correlationKey: input.correlationKey });
  }
  async get(id) {
    const i = await this.repo().get(id);
    if (!i || i.tenantId !== this.ctx.tenantId) throw notFound("Instance");
    return i;
  }
  async list(filter) {
    return (await this.repo().query((i) => i.tenantId === this.ctx.tenantId && (!filter.workflowId || i.workflowId === filter.workflowId) && (!filter.status || i.status === filter.status) && (!filter.deploymentId || i.deploymentId === filter.deploymentId) && (!filter.correlationKey || i.correlationKey === filter.correlationKey))).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  async diagramState(id) {
    const i = await this.get(id);
    return this.engine.diagramState(i);
  }
  async history(id) {
    return (await this.get(id)).history;
  }
  /** Resume a waiting token (used by task completion / signals). */
  async resume(id, tokenId, vars) {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    return this.engine.resumeToken(inst, dep, tokenId, vars);
  }
  /** Fire a due timer job (catch timer → resume; boundary timer → activate the boundary). */
  async fireTimer(job) {
    const inst = await this.get(job.instanceId);
    const dep = await this.deployments.get(inst.deploymentId);
    return this.engine.fireTimerJob(inst, dep, job.nodeId, job.tokenId);
  }
  /** Fire a due start-timer/cron job → begin a new instance on the scheduled deployment+process. */
  async startScheduled(job) {
    const dep = await this.deployments.get(job.deploymentId);
    if (dep.status !== "active") throw conflict("scheduled deployment is no longer active");
    return this.engine.start(dep, {}, "timer", { processId: job.processId });
  }
  async abort(id, actor) {
    const i = await this.get(id);
    if (i.status === "completed" || i.status === "aborted") return i;
    const aborted = await this.engine.abortInstance(i);
    await this.ctx.audit({ actor, kind: "instance.aborted", workflowId: i.workflowId, instanceId: i.id });
    return aborted;
  }
  /** Deliver a signal/message to a running instance (resumes matching waiting tokens). */
  async signal(id, name, payload, actor) {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    await this.ctx.audit({ actor, kind: "instance.signaled", workflowId: inst.workflowId, instanceId: id, data: { name } });
    return this.engine.signalInstance(inst, dep, name, payload);
  }
  /** Re-trigger a node (retry a failed node, or replay a node) and continue the flow. */
  async retry(id, nodeId, actor) {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    await this.ctx.audit({ actor, kind: "instance.node.retriggered", workflowId: inst.workflowId, instanceId: id, nodeId });
    return this.engine.retryNode(inst, dep, nodeId);
  }
  /** Parent + child instances (call activities) for related-instance navigation. */
  async related(id) {
    const inst = await this.get(id);
    const parent = inst.parentInstanceId ? await this.repo().get(inst.parentInstanceId) || null : null;
    const children = await this.repo().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === id);
    return { instance: inst, parent, children };
  }
  /** Suspend pauses the WHOLE subtree: the instance and every active descendant (call activities /
   *  sub-processes). A paused tree does no work — tasks/signals/timers on it are refused until resume. */
  async suspend(id, actor) {
    const i = await this.get(id);
    await this.suspendTree(i);
    await this.ctx.audit({ actor, kind: "instance.suspended", workflowId: i.workflowId, instanceId: id });
    return this.get(id);
  }
  async suspendTree(i) {
    if (i.status === "running" || i.status === "waiting") {
      i.status = "suspended";
      await this.repo().put(i);
    }
    const kids = await this.repo().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === i.id && (c.status === "running" || c.status === "waiting"));
    for (const k of kids) await this.suspendTree(k);
  }
  /** Resume restores the whole paused subtree to running/waiting. */
  async resumeInstance(id, actor) {
    const i = await this.get(id);
    await this.resumeTree(i);
    await this.ctx.audit({ actor, kind: "instance.resumed", workflowId: i.workflowId, instanceId: id });
    return this.get(id);
  }
  async resumeTree(i) {
    if (i.status === "suspended") {
      i.status = i.tokens.some((t) => t.state === "active") ? "running" : "waiting";
      await this.repo().put(i);
    }
    const kids = await this.repo().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === i.id && c.status === "suspended");
    for (const k of kids) await this.resumeTree(k);
  }
  /** Read-only process graph + per-node execution counts (jBPM "instance badges") for the diagram. */
  async graph(id) {
    const inst = await this.get(id);
    const dep = await this.deployments.get(inst.deploymentId);
    const p = (dep.engine.processes || []).find((x) => x.id === inst.processId) || dep.engine.processes?.[0];
    const counts = {};
    for (const h of inst.history) counts[h.nodeId] = (counts[h.nodeId] || 0) + 1;
    return { nodes: p?.nodes || [], flows: p?.flows || [], diagram: this.engine.diagramState(inst), counts, status: inst.status };
  }
};

// src/modules/tasks/service.ts
var TaskService = class {
  constructor(ctx, emit3 = () => {
  }) {
    this.ctx = ctx;
    this.instances = new InstanceService(ctx, emit3);
  }
  ctx;
  instances;
  repo() {
    return this.ctx.store.repo(Collections.tasks);
  }
  async get(id) {
    const t = await this.repo().get(id);
    if (!t || t.tenantId !== this.ctx.tenantId) throw notFound("Task");
    return t;
  }
  async list(filter) {
    return (await this.repo().query((t) => t.tenantId === this.ctx.tenantId && (!filter.assignee || t.assignee === filter.assignee) && (!filter.group || t.group === filter.group) && (!filter.status || t.status === filter.status))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async claim(id, user) {
    const t = await this.get(id);
    if (t.status !== "created" && t.status !== "reserved") throw conflict("task not claimable");
    t.assignee = user;
    t.status = "reserved";
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.claimed", instanceId: t.instanceId, taskId: t.id });
    return t;
  }
  async release(id, user) {
    const t = await this.get(id);
    t.assignee = void 0;
    t.status = "created";
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.released", instanceId: t.instanceId, taskId: t.id });
    return t;
  }
  async complete(id, outputs, user) {
    const t = await this.get(id);
    if (t.status === "completed") throw conflict("task already completed");
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    if (inst && inst.status === "suspended") throw conflict("instance is suspended");
    if (inst && (inst.status === "aborted" || inst.status === "completed" || inst.status === "failed")) throw conflict(`instance is ${inst.status}`);
    t.status = "completed";
    t.outputs = outputs;
    t.completedAt = this.ctx.clock();
    t.completedBy = user;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.completed", instanceId: t.instanceId, taskId: t.id, nodeId: t.nodeId });
    await this.instances.resume(t.instanceId, t.tokenId, outputs);
    return t;
  }
};

// src/modules/processes/service.ts
var slug2 = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
var ProcessService = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.wf = new WorkflowService(ctx);
    this.ver = new VersionService(ctx);
  }
  ctx;
  wf;
  ver;
  async head(projectId) {
    const project = await this.wf.get(projectId);
    const versions = await this.ver.listByBranch(project.defaultBranchId);
    const head = versions.filter((v) => v.state === "draft").at(-1) || versions.at(-1);
    if (!head) throw notFound("draft version");
    return { branchId: project.defaultBranchId, key: project.key, engine: head.engine };
  }
  async saveEngine(branchId, engine, actor) {
    await this.ver.saveDraft(branchId, engine, actor);
  }
  async getEngine(projectId) {
    return (await this.head(projectId)).engine;
  }
  async list(projectId) {
    const { engine } = await this.head(projectId);
    return (engine.processes || []).map((p) => ({ id: p.id, name: p.name || p.id, nodes: (p.nodes || []).length, flows: (p.flows || []).length }));
  }
  async getProcess(projectId, processId) {
    const { engine } = await this.head(projectId);
    const p = (engine.processes || []).find((x) => x.id === processId);
    if (!p) throw notFound("Process");
    return p;
  }
  async add(projectId, name, actor) {
    const nm = (name || "").trim();
    if (!nm) throw validation("process name is required");
    const { branchId, key, engine } = await this.head(projectId);
    engine.processes ||= [];
    let id = `${key}.${slug2(nm)}`;
    if (engine.processes.some((p) => p.id === id)) id = `${id}-${engine.processes.length + 1}`;
    const proc = { id, name: nm, package: "com.acme", vars: [], nodes: [{ id: "start", type: "start", name: "Start" }], flows: [] };
    engine.processes.push(proc);
    await this.saveEngine(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: "process.added", workflowId: projectId, data: { processId: id } });
    return { id, name: nm, nodes: 1, flows: 0 };
  }
  async rename(projectId, processId, name, actor) {
    const { branchId, engine } = await this.head(projectId);
    const p = (engine.processes || []).find((x) => x.id === processId);
    if (!p) throw notFound("Process");
    p.name = (name || "").trim() || p.name;
    await this.saveEngine(branchId, engine, actor);
  }
  async remove(projectId, processId, actor) {
    const { branchId, engine } = await this.head(projectId);
    const before = (engine.processes || []).length;
    engine.processes = (engine.processes || []).filter((x) => x.id !== processId);
    if (engine.processes.length === before) throw notFound("Process");
    await this.saveEngine(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: "process.removed", workflowId: projectId, data: { processId } });
  }
  /** Replace a single process (from the builder) without touching the rest of the project. */
  async saveProcess(projectId, processId, process2, actor) {
    const { branchId, engine } = await this.head(projectId);
    const idx = (engine.processes || []).findIndex((x) => x.id === processId);
    if (idx < 0) throw notFound("Process");
    engine.processes[idx] = { ...process2, id: processId };
    await this.saveEngine(branchId, engine, actor);
  }
};

// src/modules/queries/service.ts
var durationMs = (from, to) => from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : void 0;
function stats(values) {
  if (!values.length) return { count: 0, avgMs: 0, minMs: 0, maxMs: 0 };
  const sum = values.reduce((a, b) => a + b, 0);
  return { count: values.length, avgMs: Math.round(sum / values.length), minMs: Math.min(...values), maxMs: Math.max(...values) };
}
var QueryService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  I() {
    return this.ctx.store.repo(Collections.instances);
  }
  T() {
    return this.ctx.store.repo(Collections.tasks);
  }
  D() {
    return this.ctx.store.repo(Collections.deployments);
  }
  J() {
    return this.ctx.store.repo(Collections.timers);
  }
  A() {
    return this.ctx.store.repo(Collections.audit);
  }
  mine(xs) {
    return xs.filter((x) => x.tenantId === this.ctx.tenantId);
  }
  allInstances() {
    return this.I().query((i) => i.tenantId === this.ctx.tenantId);
  }
  allTasks() {
    return this.T().query((t) => t.tenantId === this.ctx.tenantId);
  }
  // ---- process definitions (across active deployments) ----
  /** Every process definition currently deployed & active, with live instance stats (jBPM def catalog). */
  async processDefinitions() {
    const active = await this.D().query((d) => d.tenantId === this.ctx.tenantId && d.status === "active");
    const instances = await this.allInstances();
    const defs = [];
    for (const dep of active) {
      for (const p of dep.engine?.processes || []) {
        const insts = instances.filter((i) => i.processId === p.id && i.deploymentId === dep.id);
        defs.push({
          processId: p.id,
          name: p.name || p.id,
          package: p.package,
          deploymentId: dep.id,
          workflowId: dep.workflowId,
          environment: dep.environment,
          version: dep.versionLabel || (dep.versionNumber != null ? `v${dep.versionNumber}` : void 0),
          nodes: (p.nodes || []).length,
          instances: { total: insts.length, active: insts.filter((i) => i.status === "running" || i.status === "waiting").length }
        });
      }
    }
    return defs;
  }
  async resolveProcess(processId) {
    const active = await this.D().query((d) => d.tenantId === this.ctx.tenantId && d.status === "active");
    for (const dep of active) {
      const p = (dep.engine?.processes || []).find((x) => x.id === processId);
      if (p) return { dep, p };
    }
    return void 0;
  }
  /** Instances of a given process definition (across its active deployment). */
  async processInstances(processId, status) {
    const insts = await this.allInstances();
    return insts.filter((i) => i.processId === processId && (!status || i.status === status)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  /** Signals/messages a process references — what it listens for (start/catch/boundary) and throws. */
  async processSignals(processId) {
    const found = await this.resolveProcess(processId);
    if (!found) return { processId, listensFor: [], throws: [] };
    const listens = /* @__PURE__ */ new Set();
    const throws = /* @__PURE__ */ new Set();
    for (const n of found.p.nodes || []) {
      const a = n;
      const ev = a.event || {};
      const name = ev.signal || ev.message || a.on?.signal || a.on?.message;
      if (!name) continue;
      if (n.type === "throw" || n.type === "send" || n.type === "end" && a.throw) throws.add(name);
      else listens.add(name);
    }
    return { processId, listensFor: [...listens], throws: [...throws] };
  }
  // ---- users / task inboxes ----
  /** Derived user directory: initiators, task assignees/completers and audit actors, with work counts. */
  async users() {
    const [instances, tasks, audit] = [await this.allInstances(), await this.allTasks(), this.mine(await this.A().query(() => true))];
    const map = /* @__PURE__ */ new Map();
    const rec = (name) => {
      if (!name) return void 0;
      if (!map.has(name)) map.set(name, { user: name, groups: /* @__PURE__ */ new Set(), startedInstances: 0, openTasks: 0, completedTasks: 0 });
      return map.get(name);
    };
    for (const i of instances) {
      const e = rec(i.startedBy);
      if (e) e.startedInstances++;
    }
    for (const t of tasks) {
      const owner = rec(t.assignee);
      if (owner) {
        if (t.status === "completed") owner.completedTasks++;
        else owner.openTasks++;
        if (t.group) owner.groups.add(t.group);
      }
      if (t.status === "completed" && t.completedBy && t.completedBy !== t.assignee) {
        const c = rec(t.completedBy);
        if (c) c.completedTasks++;
      }
    }
    for (const a of audit) rec(a.actor);
    return [...map.values()].map((e) => ({ ...e, groups: [...e.groups] })).sort((a, b) => a.user.localeCompare(b.user));
  }
  /** Tasks owned by a user (their inbox). */
  async tasksForUser(user, status) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.assignee === user && (!status || t.status === status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Tasks a user has completed. */
  async tasksCompletedByUser(user) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.status === "completed" && t.completedBy === user).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  }
  /** Tasks for a group (the queue / potential-owner list). */
  async tasksForGroup(group, status) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.group === group && (!status || t.status === status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Tasks belonging to a process instance. */
  async instanceTasks(instanceId) {
    const tasks = await this.allTasks();
    return tasks.filter((t) => t.instanceId === instanceId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  // ---- analytics / TAT ----
  /** Task turn-around-time grouped by task name, plus a per-assignee completed breakdown. */
  async taskAnalytics() {
    const tasks = await this.allTasks();
    const byName = /* @__PURE__ */ new Map();
    const byAssignee = /* @__PURE__ */ new Map();
    for (const t of tasks) {
      const ms = durationMs(t.createdAt, t.completedAt);
      if (ms == null || t.status !== "completed") continue;
      (byName.get(t.name) || byName.set(t.name, []).get(t.name)).push(ms);
      const who = t.completedBy || t.assignee;
      if (who) (byAssignee.get(who) || byAssignee.set(who, []).get(who)).push(ms);
    }
    return {
      byTask: [...byName].map(([name, v]) => ({ name, ...stats(v) })),
      byAssignee: [...byAssignee].map(([user, v]) => ({ user, ...stats(v) })),
      openByStatus: this.countBy(tasks, (t) => t.status)
    };
  }
  /** Process-instance turn-around-time grouped by process definition, plus a status mix. */
  async processAnalytics() {
    const instances = await this.allInstances();
    const byProc = /* @__PURE__ */ new Map();
    for (const i of instances) {
      const ms = durationMs(i.startedAt, i.endedAt);
      if (ms == null) continue;
      const key = i.processId || i.workflowId;
      (byProc.get(key) || byProc.set(key, []).get(key)).push(ms);
    }
    return {
      byProcess: [...byProc].map(([processId, v]) => ({ processId, ...stats(v) })),
      byStatus: this.countBy(instances, (i) => i.status)
    };
  }
  /** Dashboard counts across instances, tasks, deployments and jobs. */
  async summary() {
    const [instances, tasks, deployments, jobs] = [
      await this.allInstances(),
      await this.allTasks(),
      await this.D().query((d) => d.tenantId === this.ctx.tenantId),
      await this.J().query((j) => j.tenantId === this.ctx.tenantId)
    ];
    return {
      instances: { total: instances.length, byStatus: this.countBy(instances, (i) => i.status) },
      tasks: { total: tasks.length, byStatus: this.countBy(tasks, (t) => t.status) },
      deployments: { total: deployments.length, active: deployments.filter((d) => d.status === "active").length },
      jobs: { scheduled: jobs.filter((j) => j.status === "scheduled").length, fired: jobs.filter((j) => j.status === "fired").length }
    };
  }
  /** Scheduled/fired timer jobs (jBPM "jobs" admin list). */
  async jobs(status) {
    return (await this.J().query((j) => j.tenantId === this.ctx.tenantId && (!status || j.status === status))).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  }
  countBy(xs, key) {
    const out = {};
    for (const x of xs) {
      const k = key(x);
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }
};

// src/assets/types.ts
var slug3 = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// src/assets/forms/def.ts
var def18 = {
  key: "forms",
  label: "Forms",
  nameField: "name",
  seed: (name) => ({ id: slug3(name), name, model: { className: "" }, fields: [] })
};

// src/assets/rulesets/def.ts
var def19 = {
  key: "rulesets",
  label: "DRL rules",
  nameField: "group",
  seed: (name) => ({ group: name, rules: [] })
};

// src/assets/decisions/def.ts
var def20 = {
  key: "decisions",
  label: "DMN decisions",
  nameField: "name",
  seed: (name) => ({ name, namespace: `https://kie.org/dmn/${slug3(name)}`, decisions: [{ name, hitPolicy: "UNIQUE", inputs: [], outputs: [], rules: [] }] })
};

// src/assets/guided-tables/def.ts
var def21 = {
  key: "guidedTables",
  label: "Decision tables",
  nameField: "name",
  seed: (name) => ({ name, fact: "", conditions: [], actions: [], rows: [] })
};

// src/assets/decision-trees/def.ts
var def22 = {
  key: "decisionTrees",
  label: "Decision trees",
  nameField: "name",
  seed: (name) => ({ name, fact: "", root: null })
};

// src/assets/scorecards/def.ts
var def23 = {
  key: "scorecards",
  label: "Scorecards",
  nameField: "name",
  seed: (name) => ({ name, fact: "", baseline: 0, target: "score", characteristics: [] })
};

// src/assets/enumerations/def.ts
var def24 = {
  key: "enumerations",
  label: "Enumerations",
  nameField: "name",
  seed: (name) => ({ name, entries: {} })
};

// src/assets/types-asset/def.ts
var def25 = {
  key: "types",
  label: "Data types",
  nameField: "name",
  seed: (name) => ({ name, fields: [] })
};

// src/assets/messages/def.ts
var def26 = {
  key: "messages",
  label: "Messages",
  nameField: "name",
  seed: (name) => ({ name })
};

// src/assets/tests/def.ts
var def27 = {
  key: "tests",
  label: "Test scenarios",
  nameField: "name",
  seed: (name) => ({ name, target: "", cases: [] })
};

// src/assets/index.ts
var ASSET_KINDS = [
  def18,
  def19,
  def20,
  def21,
  def22,
  def23,
  def24,
  def25,
  def26,
  def27
];
var ASSET_DEFS = Object.fromEntries(ASSET_KINDS.map((d) => [d.key, d]));

// src/modules/assets/service.ts
var AssetsService = class {
  constructor(ctx) {
    this.ctx = ctx;
    this.wf = new WorkflowService(ctx);
    this.ver = new VersionService(ctx);
  }
  ctx;
  wf;
  ver;
  async head(projectId) {
    const project = await this.wf.get(projectId);
    const versions = await this.ver.listByBranch(project.defaultBranchId);
    const head = versions.filter((v) => v.state === "draft").at(-1) || versions.at(-1);
    if (!head) throw notFound("draft version");
    return { branchId: project.defaultBranchId, engine: head.engine };
  }
  async list(projectId) {
    const { engine } = await this.head(projectId);
    const assets = {};
    for (const k of ASSET_KINDS) {
      const arr = engine[k.key] || [];
      assets[k.key] = arr.map((a) => ({ name: a[k.nameField] || a.name || a.group || a.id || "(unnamed)" }));
    }
    return { kinds: ASSET_KINDS.map((k) => ({ key: k.key, label: k.label })), assets };
  }
  async add(projectId, kind, name, actor) {
    const nm = (name || "").trim();
    if (!nm) throw validation("asset name is required");
    const def28 = ASSET_DEFS[kind];
    if (!def28) throw validation(`unknown asset kind "${kind}"`);
    const { branchId, engine } = await this.head(projectId);
    const coll = engine[kind] ||= [];
    if (coll.some((a) => (a[def28.nameField] || a.name) === nm)) throw validation(`asset "${nm}" already exists`);
    coll.push(def28.seed(nm));
    await this.ver.saveDraft(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: "asset.added", workflowId: projectId, data: { kind, name: nm } });
    return { kind, name: nm };
  }
};

// src/modules/export/service.ts
import fs2 from "fs";
import os from "os";
import path3 from "path";

// src/sdk/index.ts
import {
  fromEngine,
  toEngine,
  fromEngineProject,
  toEngineProject,
  makeTypeResolver,
  validateModel,
  serializeProcess,
  parseBpmn,
  parseProject,
  writeProject,
  autowire
} from "@neutrinos/bpmn-sdk";
import { fromEngine as fromEngine2, validateModel as validateModel2 } from "@neutrinos/bpmn-sdk";

// src/modules/export/service.ts
var BINARY = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".zip", ".jar", ".xls", ".xlsx"]);
function exportKjar(engine) {
  const dir = fs2.mkdtempSync(path3.join(os.tmpdir(), "kjar-"));
  try {
    const project = fromEngineProject(engine);
    project.root = dir;
    project.descriptor ||= {};
    project.descriptor.gav ||= { groupId: "com.acme", artifactId: String(engine.id || "process").replace(/[^A-Za-z0-9_-]/g, "-"), version: "1.0.0-SNAPSHOT", name: engine.name };
    writeProject(project, dir);
    const files = {};
    const walk = (d, rel = "") => {
      for (const e of fs2.readdirSync(d, { withFileTypes: true })) {
        const p = path3.join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p, r);
        else files[r] = BINARY.has(path3.extname(e.name).toLowerCase()) ? fs2.readFileSync(p).toString("base64") : fs2.readFileSync(p, "utf8");
      }
    };
    walk(dir);
    return { files };
  } finally {
    fs2.rmSync(dir, { recursive: true, force: true });
  }
}

// src/modules/import/service.ts
import fs3 from "fs";
import os2 from "os";
import path4 from "path";
function kjarToEngine(files) {
  if (!files || !Object.keys(files).length) throw validation("no files to import");
  const dir = fs3.mkdtempSync(path4.join(os2.tmpdir(), "kjar-in-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const p = path4.join(dir, rel);
      fs3.mkdirSync(path4.dirname(p), { recursive: true });
      fs3.writeFileSync(p, content);
    }
    return toEngineProject(parseProject(dir));
  } finally {
    fs3.rmSync(dir, { recursive: true, force: true });
  }
}
var ImportService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  /** Import a kjar file map as a new project (workflow) + initial draft. */
  async importKjar(files, name, actor) {
    const engine = kjarToEngine(files);
    const wf = await new WorkflowService(this.ctx).create({ name: name || engine.name || engine.id || "Imported project" }, actor);
    await new VersionService(this.ctx).saveDraft(wf.defaultBranchId, engine, actor);
    await this.ctx.audit({ actor, kind: "project.imported", workflowId: wf.id, data: { processes: engine.processes?.length || 0 } });
    return { workflowId: wf.id, processes: engine.processes?.length || 0 };
  }
};

// src/http/openapi.ts
var ref = (name) => ({ $ref: `#/components/schemas/${name}` });
var listOf = (name) => ({ type: "object", properties: { items: { type: "array", items: ref(name) } } });
var ok = (schema) => ({ "200": { description: "OK", content: { "application/json": { schema } } } });
var created = (schema) => ({ "201": { description: "Created", content: { "application/json": { schema } } } });
var idParam = (name = "id", desc = "Resource id") => ({ name, in: "path", required: true, schema: { type: "string" }, description: desc });
var q = (name, desc) => ({ name, in: "query", required: false, schema: { type: "string" }, description: desc });
var jsonBody = (schema, required = true) => ({ required, content: { "application/json": { schema } } });
var schemas = {
  Error: { type: "object", properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" }, details: {} } } } },
  Problem: { type: "object", properties: { rule: { type: "string" }, severity: { type: "string", enum: ["error", "warning"] }, message: { type: "string" }, nodeId: { type: "string" } } },
  ValidationResult: { type: "object", properties: { ok: { type: "boolean" }, errors: { type: "array", items: ref("Problem") }, warnings: { type: "array", items: ref("Problem") } } },
  Workflow: { type: "object", properties: { id: { type: "string" }, key: { type: "string" }, name: { type: "string" }, description: { type: "string" }, defaultBranchId: { type: "string" }, variables: { type: "array", items: {} }, createdAt: { type: "string", format: "date-time" } } },
  Branch: { type: "object", properties: { id: { type: "string" }, workflowId: { type: "string" }, name: { type: "string" }, headVersionId: { type: "string" } } },
  Version: { type: "object", properties: { id: { type: "string" }, branchId: { type: "string" }, workflowId: { type: "string" }, number: { type: "integer" }, label: { type: "string" }, state: { type: "string", enum: ["draft", "published"] }, engine: { type: "object" } } },
  Deployment: { type: "object", properties: { id: { type: "string" }, workflowId: { type: "string" }, versionId: { type: "string" }, environment: { type: "string" }, status: { type: "string", enum: ["active", "inactive", "archived"] }, tags: { type: "array", items: { type: "string" } }, versionNumber: { type: "integer" }, versionLabel: { type: "string" }, env: { type: "object", additionalProperties: { type: "string" } }, deployedAt: { type: "string", format: "date-time" } } },
  NodeVisit: { type: "object", properties: { tokenId: { type: "string" }, nodeId: { type: "string" }, type: { type: "string" }, enteredAt: { type: "string" }, exitedAt: { type: "string" }, outcome: { type: "string" } } },
  Token: { type: "object", properties: { id: { type: "string" }, nodeId: { type: "string" }, state: { type: "string", enum: ["active", "waiting"] }, waitFor: { type: "object" } } },
  Instance: { type: "object", properties: { id: { type: "string" }, workflowId: { type: "string" }, deploymentId: { type: "string" }, processId: { type: "string" }, correlationKey: { type: "string" }, status: { type: "string", enum: ["running", "waiting", "completed", "aborted", "failed", "suspended"] }, variables: { type: "object" }, tokens: { type: "array", items: ref("Token") }, history: { type: "array", items: ref("NodeVisit") }, parentInstanceId: { type: "string" }, startedAt: { type: "string" }, startedBy: { type: "string" }, endedAt: { type: "string" } } },
  InstanceGraph: { type: "object", properties: { nodes: { type: "array", items: {} }, flows: { type: "array", items: {} }, diagram: { type: "object", properties: { activeNodeIds: { type: "array", items: { type: "string" } }, visitedNodeIds: { type: "array", items: { type: "string" } }, status: { type: "string" } } }, counts: { type: "object", additionalProperties: { type: "integer" }, description: "per-node execution count (jBPM instance badges)" }, status: { type: "string" } } },
  Task: { type: "object", properties: { id: { type: "string" }, instanceId: { type: "string" }, nodeId: { type: "string" }, name: { type: "string" }, group: { type: "string" }, assignee: { type: "string" }, status: { type: "string", enum: ["created", "reserved", "inprogress", "completed", "skipped", "error"] }, inputs: { type: "object" }, outputs: { type: "object" }, createdAt: { type: "string" }, dueAt: { type: "string" }, completedAt: { type: "string" }, completedBy: { type: "string" } } },
  TimerJob: { type: "object", properties: { id: { type: "string" }, instanceId: { type: "string" }, nodeId: { type: "string" }, kind: { type: "string", enum: ["duration", "cycle", "date", "start"] }, dueAt: { type: "string" }, cycle: { type: "string" }, status: { type: "string", enum: ["scheduled", "fired", "cancelled"] }, deploymentId: { type: "string" }, processId: { type: "string" } } },
  UserRow: { type: "object", properties: { user: { type: "string" }, groups: { type: "array", items: { type: "string" } }, startedInstances: { type: "integer" }, openTasks: { type: "integer" }, completedTasks: { type: "integer" } } },
  ProcessDef: { type: "object", properties: { processId: { type: "string" }, name: { type: "string" }, package: { type: "string" }, deploymentId: { type: "string" }, environment: { type: "string" }, version: { type: "string" }, nodes: { type: "integer" }, instances: { type: "object", properties: { total: { type: "integer" }, active: { type: "integer" } } } } },
  DurStats: { type: "object", properties: { count: { type: "integer" }, avgMs: { type: "integer" }, minMs: { type: "integer" }, maxMs: { type: "integer" } } },
  Summary: { type: "object", properties: { instances: { type: "object" }, tasks: { type: "object" }, deployments: { type: "object" }, jobs: { type: "object" } } }
};
var paths = {
  "/catalog/nodes": { get: { tags: ["Catalog"], summary: "Node palette, property schemas and connection ports", responses: ok({ type: "object" }) } },
  "/catalog/nodes/{engineType}": { get: { tags: ["Catalog"], summary: "One node type definition", parameters: [idParam("engineType", "Engine node type")], responses: { ...ok({ type: "object" }), "404": { description: "Not found", content: { "application/json": { schema: ref("Error") } } } } } },
  "/validate": { post: { tags: ["Authoring"], summary: "Validate an in-progress process (no save)", requestBody: jsonBody({ type: "object" }), responses: ok(ref("ValidationResult")) } },
  "/import/jbpm": { post: { tags: ["Import/Export"], summary: "Import a jBPM kjar (file map) as a new project", requestBody: jsonBody({ type: "object", properties: { files: { type: "object", additionalProperties: { type: "string" } }, name: { type: "string" } } }), responses: created({ type: "object", properties: { workflowId: { type: "string" }, processes: { type: "integer" } } }) } },
  "/workflows": {
    get: { tags: ["Projects"], summary: "List projects", responses: ok(listOf("Workflow")) },
    post: { tags: ["Projects"], summary: "Create a project", requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, description: { type: "string" } } }), responses: created(ref("Workflow")) }
  },
  "/workflows/{id}": {
    get: { tags: ["Projects"], summary: "Get a project", parameters: [idParam()], responses: ok(ref("Workflow")) },
    patch: { tags: ["Projects"], summary: "Update a project", parameters: [idParam()], requestBody: jsonBody({ type: "object" }), responses: ok(ref("Workflow")) },
    delete: { tags: ["Projects"], summary: "Archive a project", parameters: [idParam()], responses: { "204": { description: "Archived" } } }
  },
  "/workflows/{id}/permissions": { put: { tags: ["Projects"], summary: "Set project permissions", parameters: [idParam()], requestBody: jsonBody({ type: "array", items: {} }), responses: ok(ref("Workflow")) } },
  "/workflows/{id}/variables": { put: { tags: ["Projects"], summary: "Set project variables", parameters: [idParam()], requestBody: jsonBody({ type: "array", items: {} }), responses: ok(ref("Workflow")) } },
  "/workflows/{id}/processes": {
    get: { tags: ["Processes"], summary: "List processes in a project", parameters: [idParam()], responses: ok(listOf("ProcessDef")) },
    post: { tags: ["Processes"], summary: "Add a process", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { name: { type: "string" } } }), responses: created({ type: "object" }) }
  },
  "/workflows/{id}/processes/{pid}": {
    get: { tags: ["Processes"], summary: "Get a process definition", parameters: [idParam(), idParam("pid", "Process id")], responses: ok({ type: "object" }) },
    put: { tags: ["Processes"], summary: "Save a process definition", parameters: [idParam(), idParam("pid", "Process id")], requestBody: jsonBody({ type: "object" }), responses: ok({ type: "object" }) },
    patch: { tags: ["Processes"], summary: "Rename a process", parameters: [idParam(), idParam("pid", "Process id")], requestBody: jsonBody({ type: "object" }), responses: ok({ type: "object" }) },
    delete: { tags: ["Processes"], summary: "Remove a process", parameters: [idParam(), idParam("pid", "Process id")], responses: { "204": { description: "Removed" } } }
  },
  "/workflows/{id}/engine": { get: { tags: ["Projects"], summary: "Assembled engine model (all processes + assets) for a project", parameters: [idParam()], responses: ok({ type: "object" }) } },
  "/workflows/{id}/assets": {
    get: { tags: ["Assets"], summary: "List project assets by kind", parameters: [idParam()], responses: ok({ type: "object" }) },
    post: { tags: ["Assets"], summary: "Add an asset", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { kind: { type: "string" }, name: { type: "string" } } }), responses: created({ type: "object" }) }
  },
  "/workflows/{id}/branches": {
    get: { tags: ["Versioning"], summary: "List branches", parameters: [idParam()], responses: ok(listOf("Branch")) },
    post: { tags: ["Versioning"], summary: "Create a branch", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, fromVersionId: { type: "string" } } }), responses: created(ref("Branch")) }
  },
  "/branches/{id}": { get: { tags: ["Versioning"], summary: "Get a branch", parameters: [idParam()], responses: ok(ref("Branch")) } },
  "/branches/{id}/versions": {
    get: { tags: ["Versioning"], summary: "List versions on a branch", parameters: [idParam()], responses: ok(listOf("Version")) },
    post: { tags: ["Versioning"], summary: "Save a draft version", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { engine: { type: "object" }, message: { type: "string" } } }), responses: created(ref("Version")) }
  },
  "/versions/{id}": { get: { tags: ["Versioning"], summary: "Get a version", parameters: [idParam()], responses: ok(ref("Version")) } },
  "/versions/{id}/publish": { post: { tags: ["Versioning"], summary: "Publish a draft (immutable) version", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { label: { type: "string" } } }, false), responses: ok({ type: "object" }) } },
  "/versions/{id}/validate": { post: { tags: ["Versioning"], summary: "Validate a version", parameters: [idParam()], responses: ok(ref("ValidationResult")) } },
  "/versions/{a}/diff/{b}": { get: { tags: ["Versioning"], summary: "Diff two versions", parameters: [idParam("a", "Version A"), idParam("b", "Version B")], responses: ok({ type: "object" }) } },
  "/versions/{id}/deploy": { post: { tags: ["Deployments"], summary: "Deploy a published version", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { environment: { type: "string" }, tags: { type: "array", items: { type: "string" } }, env: { type: "object" }, activate: { type: "boolean" } } }), responses: created(ref("Deployment")) } },
  "/versions/{id}/export": { get: { tags: ["Import/Export"], summary: "Export a version as a jBPM kjar (file map)", parameters: [idParam()], responses: ok({ type: "object", properties: { files: { type: "object", additionalProperties: { type: "string" } } } }) } },
  "/workflows/{id}/deployments": { get: { tags: ["Deployments"], summary: "List deployments for a project", parameters: [idParam()], responses: ok(listOf("Deployment")) } },
  "/deployments/{id}": { get: { tags: ["Deployments"], summary: "Get a deployment", parameters: [idParam()], responses: ok(ref("Deployment")) } },
  "/deployments/{id}/tags": { post: { tags: ["Deployments"], summary: "Add/remove deployment tags", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { add: { type: "array", items: { type: "string" } }, remove: { type: "array", items: { type: "string" } } } }), responses: ok(ref("Deployment")) } },
  "/deployments/{id}/activate": { post: { tags: ["Deployments"], summary: "Activate (swaps the active one in the environment)", parameters: [idParam()], responses: ok(ref("Deployment")) } },
  "/deployments/{id}/rollback": { post: { tags: ["Deployments"], summary: "Roll back to this deployment", parameters: [idParam()], responses: ok(ref("Deployment")) } },
  "/deployments/{id}/undeploy": { post: { tags: ["Deployments"], summary: "Undeploy (deactivate)", parameters: [idParam()], responses: ok(ref("Deployment")) } },
  "/deployments/{id}/archive": { post: { tags: ["Deployments"], summary: "Archive a deployment", parameters: [idParam()], responses: ok(ref("Deployment")) } },
  "/deployments/{id}/export": { get: { tags: ["Import/Export"], summary: "Export a deployment as a jBPM kjar", parameters: [idParam()], responses: ok({ type: "object" }) } },
  "/deployments/{id}/definitions": { get: { tags: ["Processes"], summary: "Process definitions in a deployment", parameters: [idParam()], responses: ok(listOf("ProcessDef")) } },
  "/instances": {
    get: { tags: ["Instances"], summary: "List process instances", parameters: [q("workflowId", "Filter by project"), q("status", "Filter by status"), q("deploymentId", "Filter by deployment"), q("correlationKey", "Filter by correlation key")], responses: ok(listOf("Instance")) },
    post: { tags: ["Instances"], summary: "Start a process instance", requestBody: jsonBody({ type: "object", properties: { workflowId: { type: "string" }, processId: { type: "string" }, environment: { type: "string" }, deploymentId: { type: "string" }, variables: { type: "object" }, correlationKey: { type: "string" } } }), responses: created(ref("Instance")) }
  },
  "/instances/{id}": { get: { tags: ["Instances"], summary: "Get an instance", parameters: [idParam()], responses: ok(ref("Instance")) } },
  "/instances/{id}/history": { get: { tags: ["Instances"], summary: "Node-visit history", parameters: [idParam()], responses: ok({ type: "array", items: ref("NodeVisit") }) } },
  "/instances/{id}/graph": { get: { tags: ["Instances"], summary: "Diagram + per-node execution counts (instance badges)", parameters: [idParam()], responses: ok(ref("InstanceGraph")) } },
  "/instances/{id}/diagram-state": { get: { tags: ["Instances"], summary: "Active/visited node ids", parameters: [idParam()], responses: ok({ type: "object" }) } },
  "/instances/{id}/related": { get: { tags: ["Instances"], summary: "Parent + child (sub-process) instances", parameters: [idParam()], responses: ok({ type: "object" }) } },
  "/instances/{id}/signal": { post: { tags: ["Instances"], summary: "Send a signal/message to the instance", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, payload: {} } }), responses: ok(ref("Instance")) } },
  "/instances/{id}/retry": { post: { tags: ["Instances"], summary: "Re-trigger a node (retry / replay)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { nodeId: { type: "string" } } }), responses: ok(ref("Instance")) } },
  "/instances/{id}/suspend": { post: { tags: ["Instances"], summary: "Suspend (cascades to the whole subtree)", parameters: [idParam()], responses: ok(ref("Instance")) } },
  "/instances/{id}/resume": { post: { tags: ["Instances"], summary: "Resume the subtree", parameters: [idParam()], responses: ok(ref("Instance")) } },
  "/instances/{id}/abort": { post: { tags: ["Instances"], summary: "Abort (cascades to active children)", parameters: [idParam()], responses: ok(ref("Instance")) } },
  "/tasks": { get: { tags: ["Human Tasks"], summary: "List tasks", parameters: [q("assignee", "Owned by user"), q("group", "Group queue"), q("status", "Task status")], responses: ok(listOf("Task")) } },
  "/tasks/{id}": { get: { tags: ["Human Tasks"], summary: "Get a task", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/claim": { post: { tags: ["Human Tasks"], summary: "Claim a task", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/release": { post: { tags: ["Human Tasks"], summary: "Release a task", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/complete": { post: { tags: ["Human Tasks"], summary: "Complete a task (resumes the instance)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { outputs: { type: "object" } } }), responses: ok(ref("Task")) } },
  "/query/process-definitions": { get: { tags: ["Query & Analytics"], summary: "All active process definitions with live stats", responses: ok(listOf("ProcessDef")) } },
  "/query/process-definitions/{processId}/instances": { get: { tags: ["Query & Analytics"], summary: "Instances of a process definition", parameters: [idParam("processId", "Process id"), q("status", "Filter by status")], responses: ok(listOf("Instance")) } },
  "/query/process-definitions/{processId}/signals": { get: { tags: ["Query & Analytics"], summary: "Signals a process listens-for / throws", parameters: [idParam("processId", "Process id")], responses: ok({ type: "object", properties: { processId: { type: "string" }, listensFor: { type: "array", items: { type: "string" } }, throws: { type: "array", items: { type: "string" } } } }) } },
  "/query/users": { get: { tags: ["Query & Analytics"], summary: "Derived user directory with work counts", responses: ok(listOf("UserRow")) } },
  "/query/users/{user}/tasks": { get: { tags: ["Query & Analytics"], summary: "Tasks owned by a user (inbox)", parameters: [idParam("user", "User"), q("status", "Task status")], responses: ok(listOf("Task")) } },
  "/query/users/{user}/tasks/completed": { get: { tags: ["Query & Analytics"], summary: "Tasks completed by a user", parameters: [idParam("user", "User")], responses: ok(listOf("Task")) } },
  "/query/groups/{group}/tasks": { get: { tags: ["Query & Analytics"], summary: "Tasks for a group (queue)", parameters: [idParam("group", "Group"), q("status", "Task status")], responses: ok(listOf("Task")) } },
  "/query/instances/{id}/tasks": { get: { tags: ["Query & Analytics"], summary: "Tasks of a process instance", parameters: [idParam()], responses: ok(listOf("Task")) } },
  "/query/analytics/tasks": { get: { tags: ["Query & Analytics"], summary: "Task turn-around-time (by task, by assignee)", responses: ok({ type: "object" }) } },
  "/query/analytics/processes": { get: { tags: ["Query & Analytics"], summary: "Process turn-around-time + status mix", responses: ok({ type: "object" }) } },
  "/query/analytics/summary": { get: { tags: ["Query & Analytics"], summary: "Dashboard summary counts", responses: ok(ref("Summary")) } },
  "/query/jobs": { get: { tags: ["Query & Analytics"], summary: "Timer jobs", parameters: [q("status", "scheduled|fired|cancelled")], responses: ok(listOf("TimerJob")) } }
};
var openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "jBPM-style BPM Engine API",
    version: "0.1.0",
    description: "Node-native BPM engine REST API \u2014 authoring, versioning, deployment lifecycle, runtime process instances, human tasks, and KIE-Server-style query & analytics. Set the `X-User` header to act as a user."
  },
  servers: [{ url: "/api", description: "This server" }],
  tags: [
    { name: "Catalog" },
    { name: "Authoring" },
    { name: "Projects" },
    { name: "Processes" },
    { name: "Assets" },
    { name: "Versioning" },
    { name: "Deployments" },
    { name: "Instances" },
    { name: "Human Tasks" },
    { name: "Query & Analytics" },
    { name: "Import/Export" }
  ],
  components: {
    schemas,
    parameters: { XUser: { name: "X-User", in: "header", required: false, schema: { type: "string" }, description: "Acting user" } }
  },
  paths
};
var swaggerHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>BPM Engine API \u2014 Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  <style> body { margin: 0; } .topbar { display: none; } </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({ url: 'openapi.json', dom_id: '#swagger-ui', deepLinking: true, docExpansion: 'none', filter: true });
  </script>
</body>
</html>`;

// src/infra/ws-hub.ts
var WsHub = class {
  subs = /* @__PURE__ */ new Set();
  add(ws) {
    const sub = { ws, topics: /* @__PURE__ */ new Set() };
    this.subs.add(sub);
    ws.on("close", () => this.subs.delete(sub));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg.op === "sub" && Array.isArray(msg.topics)) for (const t of msg.topics) sub.topics.add(t);
        if (msg.op === "unsub" && Array.isArray(msg.topics)) for (const t of msg.topics) sub.topics.delete(t);
      } catch {
      }
    });
    return sub;
  }
  publish(topic, kind, data) {
    const payload = JSON.stringify({ topic, kind, at: (/* @__PURE__ */ new Date()).toISOString(), data });
    for (const s of this.subs) if (s.topics.has(topic)) {
      try {
        s.ws.send(payload);
      } catch {
      }
    }
  }
  /** Forward an engine event onto instance/workflow topics for the live UI. */
  engineEmit = (e) => {
    const iid = e.instanceId;
    if (iid) this.publish(`instance:${iid}`, e.kind, { ...e });
  };
};
var hub = new WsHub();

// src/http/routes.ts
var ctxOf = (req) => req.ctx;
var actorOf = (req) => req.actor;
var emit2 = hub.engineEmit;
function buildRoutes() {
  const r = Router();
  r.get("/openapi.json", (_req, res) => res.json(openapiSpec));
  r.get("/docs", (_req, res) => res.type("html").send(swaggerHtml));
  r.get("/catalog/nodes", (_req, res) => res.json({
    categories: CATEGORIES,
    nodes: NODE_DEFS.flatMap((d) => d.palette),
    // palette tiles
    schemas: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.schema])),
    // engineType → property form
    ports: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.ports]))
    // engineType → { in, out }
  }));
  r.get("/catalog/nodes/:engineType", (req, res) => {
    const def28 = NODE_DEF_BY_TYPE[req.params.engineType];
    if (!def28) return res.status(404).json({ error: { code: "NOT_FOUND", message: "node type not found" } });
    res.json(def28);
  });
  r.post("/validate", (req, res) => res.json(new ValidationService().validate(req.body?.engine?.processes?.[0] || req.body?.process || req.body)));
  r.post("/import/jbpm", asyncHandler(async (req, res) => res.status(201).json(await new ImportService(ctxOf(req)).importKjar(req.body?.files, req.body?.name, actorOf(req)))));
  r.get("/workflows", asyncHandler(async (req, res) => res.json({ items: await new WorkflowService(ctxOf(req)).list() })));
  r.post("/workflows", asyncHandler(async (req, res) => res.status(201).json(await new WorkflowService(ctxOf(req)).create(req.body, actorOf(req)))));
  r.get("/workflows/:id", asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).get(req.params.id))));
  r.patch("/workflows/:id", asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).update(req.params.id, req.body, actorOf(req)))));
  r.delete("/workflows/:id", asyncHandler(async (req, res) => {
    await new WorkflowService(ctxOf(req)).archive(req.params.id, actorOf(req));
    res.status(204).end();
  }));
  r.put("/workflows/:id/permissions", asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).setPermissions(req.params.id, req.body, actorOf(req)))));
  r.put("/workflows/:id/variables", asyncHandler(async (req, res) => res.json(await new WorkflowService(ctxOf(req)).setVariables(req.params.id, req.body, actorOf(req)))));
  r.get("/workflows/:id/processes", asyncHandler(async (req, res) => res.json({ items: await new ProcessService(ctxOf(req)).list(req.params.id) })));
  r.post("/workflows/:id/processes", asyncHandler(async (req, res) => res.status(201).json(await new ProcessService(ctxOf(req)).add(req.params.id, req.body?.name, actorOf(req)))));
  r.get("/workflows/:id/processes/:pid", asyncHandler(async (req, res) => res.json(await new ProcessService(ctxOf(req)).getProcess(req.params.id, req.params.pid))));
  r.put("/workflows/:id/processes/:pid", asyncHandler(async (req, res) => {
    await new ProcessService(ctxOf(req)).saveProcess(req.params.id, req.params.pid, req.body?.process || req.body, actorOf(req));
    res.json({ ok: true });
  }));
  r.patch("/workflows/:id/processes/:pid", asyncHandler(async (req, res) => {
    await new ProcessService(ctxOf(req)).rename(req.params.id, req.params.pid, req.body?.name, actorOf(req));
    res.json({ ok: true });
  }));
  r.delete("/workflows/:id/processes/:pid", asyncHandler(async (req, res) => {
    await new ProcessService(ctxOf(req)).remove(req.params.id, req.params.pid, actorOf(req));
    res.status(204).end();
  }));
  r.get("/workflows/:id/engine", asyncHandler(async (req, res) => res.json(await new ProcessService(ctxOf(req)).getEngine(req.params.id))));
  r.get("/workflows/:id/assets", asyncHandler(async (req, res) => res.json(await new AssetsService(ctxOf(req)).list(req.params.id))));
  r.post("/workflows/:id/assets", asyncHandler(async (req, res) => res.status(201).json(await new AssetsService(ctxOf(req)).add(req.params.id, req.body?.kind, req.body?.name, actorOf(req)))));
  r.get("/workflows/:id/branches", asyncHandler(async (req, res) => res.json({ items: await new BranchService(ctxOf(req)).listByWorkflow(req.params.id) })));
  r.post("/workflows/:id/branches", asyncHandler(async (req, res) => res.status(201).json(await new BranchService(ctxOf(req)).create(req.params.id, req.body, actorOf(req)))));
  r.get("/branches/:id", asyncHandler(async (req, res) => res.json(await new BranchService(ctxOf(req)).get(req.params.id))));
  r.get("/branches/:id/versions", asyncHandler(async (req, res) => res.json({ items: await new VersionService(ctxOf(req)).listByBranch(req.params.id) })));
  r.post("/branches/:id/versions", asyncHandler(async (req, res) => res.status(201).json(await new VersionService(ctxOf(req)).saveDraft(req.params.id, req.body.engine, actorOf(req), req.body.message))));
  r.get("/versions/:id", asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).get(req.params.id))));
  r.post("/versions/:id/publish", asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).publish(req.params.id, actorOf(req), req.body?.label))));
  r.post("/versions/:id/validate", asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).validate(req.params.id))));
  r.get("/versions/:a/diff/:b", asyncHandler(async (req, res) => res.json(await new VersionService(ctxOf(req)).diff(req.params.a, req.params.b))));
  r.post("/versions/:id/deploy", asyncHandler(async (req, res) => res.status(201).json(await new DeploymentService(ctxOf(req)).deploy(req.params.id, req.body, actorOf(req)))));
  r.get("/versions/:id/export", asyncHandler(async (req, res) => {
    const v = await new VersionService(ctxOf(req)).get(req.params.id);
    res.json(exportKjar(v.engine));
  }));
  r.get("/workflows/:id/deployments", asyncHandler(async (req, res) => res.json({ items: await new DeploymentService(ctxOf(req)).listByWorkflow(req.params.id) })));
  r.get("/deployments/:id", asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).get(req.params.id))));
  r.post("/deployments/:id/tags", asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).setTags(req.params.id, req.body, actorOf(req)))));
  r.post("/deployments/:id/activate", asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).activate(req.params.id, actorOf(req)))));
  r.post("/deployments/:id/rollback", asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).rollback(req.body.environment, req.body.toDeploymentId, actorOf(req)))));
  r.post("/deployments/:id/undeploy", asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).undeploy(req.params.id, actorOf(req)))));
  r.post("/deployments/:id/archive", asyncHandler(async (req, res) => res.json(await new DeploymentService(ctxOf(req)).archive(req.params.id, actorOf(req)))));
  r.get("/deployments/:id/export", asyncHandler(async (req, res) => {
    const d = await new DeploymentService(ctxOf(req)).get(req.params.id);
    res.json(exportKjar(d.engine));
  }));
  r.get("/deployments/:id/definitions", asyncHandler(async (req, res) => {
    const d = await new DeploymentService(ctxOf(req)).get(req.params.id);
    res.json({ items: (d.engine.processes || []).map((p) => ({ id: p.id, name: p.name || p.id, nodes: (p.nodes || []).length, startable: (p.nodes || []).some((n) => n.type === "start") })) });
  }));
  r.post("/instances", asyncHandler(async (req, res) => res.status(201).json(await new InstanceService(ctxOf(req), emit2).start(req.body, actorOf(req)))));
  r.get("/instances", asyncHandler(async (req, res) => res.json({ items: await new InstanceService(ctxOf(req)).list(req.query) })));
  r.get("/instances/:id", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).get(req.params.id))));
  r.get("/instances/:id/history", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).history(req.params.id))));
  r.get("/instances/:id/diagram-state", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).diagramState(req.params.id))));
  r.get("/instances/:id/graph", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).graph(req.params.id))));
  r.get("/instances/:id/related", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).related(req.params.id))));
  r.post("/instances/:id/signal", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req), emit2).signal(req.params.id, req.body?.name, req.body?.payload, actorOf(req)))));
  r.post("/instances/:id/retry", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req), emit2).retry(req.params.id, req.body?.nodeId, actorOf(req)))));
  r.post("/instances/:id/suspend", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).suspend(req.params.id, actorOf(req)))));
  r.post("/instances/:id/resume", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).resumeInstance(req.params.id, actorOf(req)))));
  r.post("/instances/:id/abort", asyncHandler(async (req, res) => res.json(await new InstanceService(ctxOf(req)).abort(req.params.id, actorOf(req)))));
  r.get("/tasks", asyncHandler(async (req, res) => res.json({ items: await new TaskService(ctxOf(req)).list(req.query) })));
  r.get("/tasks/:id", asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).get(req.params.id))));
  r.post("/tasks/:id/claim", asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).claim(req.params.id, actorOf(req)))));
  r.post("/tasks/:id/release", asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req)).release(req.params.id, actorOf(req)))));
  r.post("/tasks/:id/complete", asyncHandler(async (req, res) => res.json(await new TaskService(ctxOf(req), emit2).complete(req.params.id, req.body?.outputs || {}, actorOf(req)))));
  const q2 = (req) => new QueryService(ctxOf(req));
  const s = (req) => req.query.status;
  r.get("/query/process-definitions", asyncHandler(async (req, res) => res.json({ items: await q2(req).processDefinitions() })));
  r.get("/query/process-definitions/:processId/instances", asyncHandler(async (req, res) => res.json({ items: await q2(req).processInstances(req.params.processId, s(req)) })));
  r.get("/query/process-definitions/:processId/signals", asyncHandler(async (req, res) => res.json(await q2(req).processSignals(req.params.processId))));
  r.get("/query/users", asyncHandler(async (req, res) => res.json({ items: await q2(req).users() })));
  r.get("/query/users/:user/tasks", asyncHandler(async (req, res) => res.json({ items: await q2(req).tasksForUser(req.params.user, s(req)) })));
  r.get("/query/users/:user/tasks/completed", asyncHandler(async (req, res) => res.json({ items: await q2(req).tasksCompletedByUser(req.params.user) })));
  r.get("/query/groups/:group/tasks", asyncHandler(async (req, res) => res.json({ items: await q2(req).tasksForGroup(req.params.group, s(req)) })));
  r.get("/query/instances/:id/tasks", asyncHandler(async (req, res) => res.json({ items: await q2(req).instanceTasks(req.params.id) })));
  r.get("/query/analytics/tasks", asyncHandler(async (req, res) => res.json(await q2(req).taskAnalytics())));
  r.get("/query/analytics/processes", asyncHandler(async (req, res) => res.json(await q2(req).processAnalytics())));
  r.get("/query/analytics/summary", asyncHandler(async (req, res) => res.json(await q2(req).summary())));
  r.get("/query/jobs", asyncHandler(async (req, res) => res.json({ items: await q2(req).jobs(s(req)) })));
  return r;
}

// src/app.ts
function createApp(store2) {
  const app2 = express();
  const theStore = store2 || new FileStore(config.dataDir);
  app2.use(express.json({ limit: "4mb" }));
  app2.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", process.env.APP_ORIGIN || "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-User");
    res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  app2.use((req, _res, next) => {
    req.ctx = makeContext({ store: theStore, tenantId: config.defaultTenant });
    req.actor = (req.header("x-user") || "system").toString();
    next();
  });
  app2.get("/api/health", (_req, res) => res.json({ ok: true, service: "jbpm-engine-server", version: "0.1.0" }));
  app2.use("/api", buildRoutes());
  app2.use(errorMiddleware);
  return { app: app2, store: theStore };
}

// src/modules/timers/service.ts
var TimerService = class {
  constructor(ctx, emit3 = () => {
  }) {
    this.ctx = ctx;
    this.instances = new InstanceService(ctx, emit3);
  }
  ctx;
  instances;
  repo() {
    return this.ctx.store.repo(Collections.timers);
  }
  /** Fire every scheduled timer due at or before `nowIso`; returns the number fired. */
  async tick(nowIso) {
    const due = await this.repo().query((t) => t.status === "scheduled" && t.dueAt <= nowIso);
    let fired = 0;
    for (const job of due) {
      if (job.kind !== "start") {
        const inst = await this.instances.get(job.instanceId).catch(() => null);
        if (inst && inst.status === "suspended") continue;
      }
      job.status = "fired";
      job.fired += 1;
      await this.repo().put(job);
      fired++;
      try {
        if (job.kind === "start") {
          await this.instances.startScheduled(job);
          if (job.cycle) await this.reschedule(job, nowIso);
        } else {
          await this.instances.fireTimer(job);
        }
      } catch {
      }
    }
    return fired;
  }
  async reschedule(job, nowIso) {
    const next = {
      ...job,
      id: this.ctx.newId(),
      status: "scheduled",
      fired: 0,
      dueAt: computeDue({ cycle: job.cycle }, nowIso)
    };
    await this.repo().put(next);
  }
};

// src/index.ts
var { app, store } = createApp();
var server = http.createServer(app);
var wss = new WebSocketServer({ server, path: config.wsPath });
wss.on("connection", (ws) => hub.add(ws));
var timerCtx = makeContext({ store, tenantId: config.defaultTenant });
var timers = new TimerService(timerCtx, hub.engineEmit);
setInterval(() => {
  timers.tick((/* @__PURE__ */ new Date()).toISOString()).catch((e) => logger.error("timer tick failed", { err: e.message }));
}, 5e3);
server.listen(config.port, () => {
  logger.info("jbpm-engine server up", { port: config.port, ws: config.wsPath, store: config.store, dataDir: config.dataDir });
});
