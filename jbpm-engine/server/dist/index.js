var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--)
    if (decorator = decorators[i])
      result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};

// src/index.ts
import http from "http";
import { WebSocketServer } from "ws";

// src/app.ts
import express from "express";

// src/store/file-store.ts
import fs from "fs";
import path from "path";
function cloneSafe(val) {
  try {
    return structuredClone(val);
  } catch {
    return JSON.parse(JSON.stringify(val));
  }
}
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
    this.cache.set(entity.id, cloneSafe(entity));
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

// src/store/pg-store.ts
import "reflect-metadata";
import { DataSource, Entity as TypeOrmEntity, PrimaryColumn, Column, Index } from "typeorm";
var KvRow = class {
  collection;
  id;
  tenantId;
  data;
  updatedAt;
};
__decorateClass([
  PrimaryColumn({ type: "varchar", length: 64 })
], KvRow.prototype, "collection", 2);
__decorateClass([
  PrimaryColumn({ type: "varchar", length: 128 })
], KvRow.prototype, "id", 2);
__decorateClass([
  Column({ type: "varchar", length: 128, nullable: true })
], KvRow.prototype, "tenantId", 2);
__decorateClass([
  Column({ type: "jsonb" })
], KvRow.prototype, "data", 2);
__decorateClass([
  Column({ type: "timestamptz", default: () => "now()" })
], KvRow.prototype, "updatedAt", 2);
KvRow = __decorateClass([
  TypeOrmEntity({ name: "kv_store" }),
  Index(["collection", "tenantId"])
], KvRow);
var PgRepo = class {
  constructor(collection, getDs) {
    this.collection = collection;
    this.getDs = getDs;
  }
  collection;
  getDs;
  async orm() {
    return (await this.getDs()).getRepository(KvRow);
  }
  async get(id) {
    const row = await (await this.orm()).findOneBy({ collection: this.collection, id });
    return row ? row.data : void 0;
  }
  async list() {
    const rows = await (await this.orm()).findBy({ collection: this.collection });
    return rows.map((r) => r.data);
  }
  async query(pred) {
    return (await this.list()).filter(pred);
  }
  async put(entity) {
    await (await this.orm()).upsert(
      { collection: this.collection, id: entity.id, tenantId: entity.tenantId ?? null, data: entity, updatedAt: /* @__PURE__ */ new Date() },
      ["collection", "id"]
    );
    return entity;
  }
  async delete(id) {
    const res = await (await this.orm()).delete({ collection: this.collection, id });
    return !!res.affected;
  }
};
var PgStore = class {
  constructor(url) {
    this.url = url;
  }
  url;
  ds;
  dsPromise;
  repos = /* @__PURE__ */ new Map();
  /** Lazily connects on first actual use (same idiom as FileRepo's own ensureLoaded()) — constructing
   *  a PgStore never itself requires an event loop tick or a reachable database. */
  ensureDataSource() {
    if (this.ds) return Promise.resolve(this.ds);
    if (!this.dsPromise) {
      this.dsPromise = new DataSource({
        type: "postgres",
        url: this.url,
        entities: [KvRow],
        // One trivial, schema-less table — safe to auto-create/reconcile; a real multi-table relational
        // rollout would want real migrations, but there's nothing here for synchronize to drift on.
        synchronize: true,
        logging: false
      }).initialize().then((ds) => this.ds = ds);
    }
    return this.dsPromise;
  }
  repo(collection) {
    let r = this.repos.get(collection);
    if (!r) {
      r = new PgRepo(collection, () => this.ensureDataSource());
      this.repos.set(collection, r);
    }
    return r;
  }
  async close() {
    if (this.ds) await this.ds.destroy();
  }
};

// src/infra/config.ts
import path2 from "path";
import { fileURLToPath } from "url";
var defaultJavaSidecarClasspath = path2.resolve(path2.dirname(fileURLToPath(import.meta.url)), "../../../java-runtime/out");
var env = process.env;
var config = {
  appName: env.APP_NAME || "Orkestr",
  domain: env.DOMAIN || "orkestr.io",
  port: Number(env.PORT || 4e3),
  dataDir: env.DATA_DIR || path2.resolve(process.cwd(), ".data"),
  store: env.STORE || "file",
  // matches docker-compose.yml's default postgres service — `STORE=pg` works with zero extra config
  // once that container is up (see jbpm-engine/docker-compose.yml, `npm run docker:up`).
  pgUrl: env.PG_URL || "postgresql://jbpm:jbpm@localhost:5433/jbpm",
  jwtSecret: env.JWT_SECRET || "dev-insecure-secret-change-me",
  adminInitialPassword: env.ADMIN_INITIAL_PASSWORD || "admin-change-me",
  integrationBaseUrl: env.INTEGRATION_BASE_URL || `https://api.${env.DOMAIN || "orkestr.io"}`,
  scriptTimeoutMs: Number(env.SCRIPT_TIMEOUT_MS || 2e3),
  wsPath: env.WS_PATH || "/ws",
  defaultTenant: env.DEFAULT_TENANT || "default",
  javaSidecarClasspath: env.JAVA_SIDECAR_CLASSPATH || defaultJavaSidecarClasspath,
  javaSidecarStartupTimeoutMs: Number(env.JAVA_SIDECAR_STARTUP_TIMEOUT_MS || 1e4),
  javaSidecarTimeoutMs: Number(env.JAVA_SIDECAR_TIMEOUT_MS || 1e4),
  outboundAllowlist: (env.OUTBOUND_ALLOWLIST || "").split(",").map((h) => h.trim()).filter(Boolean)
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
  folders: "folders",
  branches: "branches",
  versions: "versions",
  deployments: "deployments",
  instances: "instances",
  tasks: "tasks",
  timers: "timers",
  audit: "audit",
  users: "users",
  groups: "groups",
  roles: "roles",
  tenants: "tenants",
  tenantMembers: "tenantMembers",
  plans: "plans",
  errors: "errors",
  comments: "comments",
  notifications: "notifications",
  settings: "settings"
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
import { Router as Router2 } from "express";

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
  INTERNAL: 500,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  JBPM_EXPORT_DENIED: 422
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
var forbidden = (message, details) => new ApiError("FORBIDDEN", message, details);
var authRequired = (message = "authentication required") => new ApiError("AUTH_REQUIRED", message);
var quotaExceeded = (message, details) => new ApiError("QUOTA_EXCEEDED", message, details);
var rateLimited = (message = "too many requests") => new ApiError("RATE_LIMITED", message);
var jbpmExportDenied = (message, details) => new ApiError("JBPM_EXPORT_DENIED", message, details);
var asyncHandler = (fn) => (req2, res, next) => {
  fn(req2, res, next).catch(next);
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
  fo() {
    return this.ctx.store.repo(Collections.folders);
  }
  async assertFolderValid(folderId) {
    if (!folderId) return;
    const f = await this.fo().get(folderId);
    if (!f || f.tenantId !== this.ctx.tenantId) throw notFound("Folder");
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
    const dupe = await this.wf().query((w) => w.tenantId === this.ctx.tenantId && w.key === key && !w.archived);
    if (dupe.length) throw validation(`key "${key}" already exists`);
    await this.assertFolderValid(input.folderId);
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
      folderId: input.folderId || null,
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
    if (patch.folderId !== void 0) {
      await this.assertFolderValid(patch.folderId);
      w.folderId = patch.folderId;
    }
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

// src/modules/folders/service.ts
var FolderService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  fo() {
    return this.ctx.store.repo(Collections.folders);
  }
  wf() {
    return this.ctx.store.repo(Collections.workflows);
  }
  async list() {
    return (await this.fo().query((f) => f.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async get(id) {
    const f = await this.fo().get(id);
    if (!f || f.tenantId !== this.ctx.tenantId) throw notFound("Folder");
    return f;
  }
  async assertParentValid(parentId, selfId) {
    if (!parentId) return;
    if (parentId === selfId) throw validation("a folder cannot be its own parent");
    const parent = await this.fo().get(parentId);
    if (!parent || parent.tenantId !== this.ctx.tenantId) throw notFound("parent Folder");
    if (selfId) {
      let cur = parent;
      const seen = /* @__PURE__ */ new Set();
      while (cur?.parentId) {
        if (cur.parentId === selfId) throw validation("cannot move a folder into its own descendant");
        if (seen.has(cur.parentId)) break;
        seen.add(cur.parentId);
        cur = await this.fo().get(cur.parentId);
      }
    }
  }
  async create(input, actor) {
    const name = (input.name || "").trim();
    if (!name) throw validation("name is required");
    await this.assertParentValid(input.parentId);
    const now = this.ctx.clock();
    const folder = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      name,
      parentId: input.parentId || null,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor
    };
    await this.fo().put(folder);
    return folder;
  }
  async update(id, patch, actor) {
    const f = await this.get(id);
    if (patch.name !== void 0) {
      const name = patch.name.trim();
      if (!name) throw validation("name is required");
      f.name = name;
    }
    if (patch.parentId !== void 0) {
      await this.assertParentValid(patch.parentId, id);
      f.parentId = patch.parentId;
    }
    f.updatedAt = this.ctx.clock();
    f.updatedBy = actor;
    await this.fo().put(f);
    return f;
  }
  async delete(id) {
    await this.get(id);
    const children = await this.fo().query((f) => f.tenantId === this.ctx.tenantId && f.parentId === id);
    if (children.length) throw conflict("folder is not empty \u2014 move or delete its subfolders first");
    const contents = await this.wf().query((w) => w.tenantId === this.ctx.tenantId && w.folderId === id && !w.archived);
    if (contents.length) throw conflict("folder is not empty \u2014 move its projects out first");
    await this.fo().delete(id);
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
  if (c.node.throw && "error" in c.node.throw) return { end: "error", outcome: "error-throw" };
  if (c.node.event?.compensation || c.node.result === "compensate") {
    return { vars: await c.compensate(c.node.event?.ref), end: "complete", outcome: "compensated" };
  }
  const name = c.node.throw?.signal || c.node.throw?.message || c.node.throw?.escalation;
  if (name) {
    const ck = c.node.throw?.correlationKey;
    const correlationValue = typeof ck === "string" && ck.startsWith("$") ? c.inst.variables[ck.slice(1)] : void 0;
    await c.broadcast(name, correlationValue);
    return { end: "complete", outcome: `threw:${name}` };
  }
  return { end: "complete" };
};

// src/engine/nodes/manual/handler.ts
var handler3 = () => ({});

// src/engine/sandbox.ts
import vm2 from "vm";

// src/engine/java-sidecar.ts
import fs2 from "fs";
import path3 from "path";
import { spawn } from "child_process";
function findJavaBinary() {
  if (process.env.JAVA_HOME && fs2.existsSync(path3.join(process.env.JAVA_HOME, "bin/java"))) {
    return path3.join(process.env.JAVA_HOME, "bin/java");
  }
  for (const candidate of [
    "/opt/homebrew/opt/openjdk@17/bin/java",
    "/opt/homebrew/opt/openjdk@21/bin/java",
    "/opt/homebrew/opt/openjdk/bin/java",
    "/usr/local/opt/openjdk@17/bin/java",
    "/usr/local/opt/openjdk/bin/java"
  ]) {
    if (fs2.existsSync(candidate)) return candidate;
  }
  return "java";
}
var JavaSidecarUnavailableError = class extends Error {
  constructor(detail) {
    super(`Java sidecar unavailable \u2014 Java script/condition/exitScript code cannot run without it (this engine never falls back to transpiling Java to JavaScript). ${detail}`);
    this.name = "JavaSidecarUnavailableError";
  }
};
var child;
var port;
var starting;
function start() {
  if (starting) return starting;
  starting = new Promise((resolve, reject) => {
    const proc = spawn(findJavaBinary(), ["-cp", config.javaSidecarClasspath, "bpmscript.Server", "0"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    child = proc;
    let stderrBuf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new JavaSidecarUnavailableError(`Timed out waiting for it to start (>${config.javaSidecarStartupTimeoutMs}ms). stderr: ${stderrBuf.trim() || "(empty)"}`));
    }, config.javaSidecarStartupTimeoutMs);
    proc.stdout?.on("data", (chunk) => {
      const m = /BPMSCRIPT_LISTENING (\d+)/.exec(chunk.toString("utf8"));
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        port = Number(m[1]);
        resolve(port);
      }
    });
    proc.stderr?.on("data", (chunk) => {
      stderrBuf += chunk.toString("utf8");
    });
    proc.on("exit", (code) => {
      const wasRunning = child === proc;
      child = void 0;
      port = void 0;
      starting = void 0;
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new JavaSidecarUnavailableError(
          `The sidecar process exited during startup (code ${code}). This usually means no JDK is on PATH (a JRE alone can't compile scripts \u2014 javax.tools.ToolProvider.getSystemJavaCompiler() needs a JDK), or the classpath "${config.javaSidecarClasspath}" doesn't have compiled bpmscript classes yet. stderr: ${stderrBuf.trim() || "(empty)"}`
        ));
      } else if (wasRunning) {
      }
    });
    proc.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new JavaSidecarUnavailableError(`Failed to spawn the "java" executable: ${err.message}. Is a JDK installed and on PATH?`));
    });
  });
  return starting;
}
async function ensureStarted() {
  if (port !== void 0 && child) return port;
  return start();
}
async function callSidecar(body) {
  const p = await ensureStarted();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.javaSidecarTimeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${p}/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return await res.json();
  } catch (e) {
    if (child) {
      child.kill();
      child = void 0;
      port = void 0;
      starting = void 0;
    }
    throw new JavaSidecarUnavailableError(`Request to the sidecar failed: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
}
function requestFields(req2) {
  return {
    instanceId: req2.instanceId == null ? "" : String(req2.instanceId),
    nodeInstanceId: req2.nodeInstanceId,
    nodeId: req2.nodeId,
    nodeName: req2.nodeName,
    processId: req2.processId,
    processName: req2.processName,
    correlationKey: req2.correlationKey,
    parentInstanceId: req2.parentInstanceId,
    state: req2.state,
    activeNodeInstances: req2.activeNodeInstances || []
  };
}
async function executeJava(req2) {
  const json = await callSidecar({
    code: req2.code,
    vars: req2.vars,
    env: req2.env || {},
    varTypes: req2.varTypes || {},
    ...requestFields(req2)
  });
  if (!json.ok) throw new Error(json.error || "java execution failed");
  return { vars: json.vars || {}, logs: json.logs || "", pendingActions: json.pendingActions || [] };
}
async function executeJavaCondition(req2) {
  const json = await callSidecar({
    mode: "condition",
    code: req2.code,
    vars: req2.vars,
    env: req2.env || {},
    varTypes: req2.varTypes || {},
    ...requestFields(req2)
  });
  if (!json.ok) throw new Error(json.error || "java condition evaluation failed");
  return !!json.result;
}
async function validateJava(code, asCondition, varTypes) {
  const json = await callSidecar({ mode: "validate", code, asCondition, vars: {}, env: {}, varTypes: varTypes || {} });
  return json.ok ? { ok: true } : { ok: false, error: json.error || "java validation failed" };
}

// src/engine/js-compat.ts
import vm from "vm";
function makeJacksonNode(initial) {
  const data = initial;
  const self = {
    put: function(k, v) {
      if (data && typeof data === "object") data[k] = v;
      return self;
    },
    putPOJO: function(k, v) {
      if (data && typeof data === "object") data[k] = v;
      return self;
    },
    putNull: function(k) {
      if (data && typeof data === "object") data[k] = null;
      return self;
    },
    putArray: function(k) {
      const a = [];
      if (data && typeof data === "object") data[k] = a;
      return makeJacksonArray(a);
    },
    set: function(k, v) {
      if (data && typeof data === "object") data[k] = v;
      return self;
    },
    get: function(k) {
      return data && typeof data === "object" ? data[k] : void 0;
    },
    path: function(k) {
      return makeJacksonNode(data && typeof data === "object" ? data[k] : void 0);
    },
    has: function(k) {
      return data && typeof data === "object" ? Object.prototype.hasOwnProperty.call(data, k) : false;
    },
    hasNonNull: function(k) {
      return data && typeof data === "object" ? data[k] != null : false;
    },
    isArray: function() {
      return Array.isArray(data);
    },
    asBoolean: function(fb = false) {
      if (data == null) return fb;
      if (typeof data === "boolean") return data;
      const s = String(data).trim().toLowerCase();
      return s === "true" || s === "1";
    },
    asInt: function(fb = 0) {
      const n = parseInt(String(data), 10);
      return isNaN(n) ? fb : n;
    },
    asText: function(fb = "") {
      return data == null ? fb : String(data);
    },
    isNull: function() {
      return data == null;
    },
    isMissingNode: function() {
      return data === void 0;
    },
    size: function() {
      return Array.isArray(data) ? data.length : typeof data === "object" && data !== null ? Object.keys(data).length : 0;
    },
    toString: function() {
      return typeof data === "string" ? data : JSON.stringify(data);
    }
  };
  return self;
}
function makeJacksonArray(arr) {
  const data = arr || [];
  return {
    addObject: function() {
      const o = {};
      data.push(o);
      return makeJacksonNode(o);
    },
    add: function(v) {
      data.push(v);
      return this;
    },
    toString: function() {
      return JSON.stringify(data);
    }
  };
}
function makeArrayList(initial) {
  return initial ? initial.slice() : [];
}
var MapPrototype = {
  put(k, v) {
    const key = String(k);
    const old = this[key] !== void 0 ? this[key] : null;
    this[key] = v;
    return old;
  },
  get(k) {
    const key = String(k);
    return this[key] !== void 0 ? this[key] : null;
  },
  remove(k) {
    const key = String(k);
    const old = this[key] !== void 0 ? this[key] : null;
    delete this[key];
    return old;
  },
  containsKey(k) {
    return Object.prototype.hasOwnProperty.call(this, String(k));
  },
  size() {
    return Object.keys(this).length;
  },
  isEmpty() {
    return Object.keys(this).length === 0;
  },
  clear() {
    for (const k of Object.keys(this)) delete this[k];
  },
  keySet() {
    return makeArrayList(Object.keys(this));
  },
  values() {
    return makeArrayList(Object.values(this));
  },
  toString() {
    return `{${Object.entries(this).map(([k, v]) => `${k}=${v}`).join(", ")}}`;
  }
};
function makeHashMap(initial) {
  const self = Object.create(MapPrototype);
  if (initial && typeof initial === "object") {
    Object.assign(self, initial);
  }
  return self;
}
function makeHashSet() {
  const data = /* @__PURE__ */ new Set();
  const self = {};
  self.add = (v) => {
    const had = data.has(v);
    data.add(v);
    return !had;
  };
  self.contains = (v) => data.has(v);
  self.remove = (v) => {
    const had = data.has(v);
    data.delete(v);
    return had;
  };
  self.size = () => data.size;
  self.isEmpty = () => data.size === 0;
  self.clear = () => data.clear();
  self.toString = () => `[${[...data].join(", ")}]`;
  return self;
}
var JsonObjectPrototype = {
  put(k, v) {
    this[k] = v;
    return this;
  },
  get(k) {
    return this[k];
  },
  getString(k) {
    const v = this[k];
    return v == null ? null : String(v);
  },
  optString(k, fb = "") {
    const v = this[k];
    return v == null ? fb : String(v);
  },
  optBoolean(k, fb = false) {
    const v = this[k];
    if (v == null) return fb;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    return s === "true" || s === "1";
  },
  optInt(k, fb = 0) {
    const v = this[k];
    if (v == null) return fb;
    const n = parseInt(String(v), 10);
    return isNaN(n) ? fb : n;
  },
  has(k) {
    return Object.prototype.hasOwnProperty.call(this, k);
  },
  isNull(k) {
    return this[k] == null;
  },
  toString() {
    return JSON.stringify(this);
  }
};
function makeJsonObject(initial) {
  let data = {};
  if (initial && typeof initial === "string") {
    try {
      const parsed = JSON.parse(initial);
      if (parsed && typeof parsed === "object") data = parsed;
    } catch {
    }
  } else if (initial && typeof initial === "object") {
    data = { ...initial };
  }
  const self = Object.create(JsonObjectPrototype);
  Object.assign(self, data);
  return self;
}
var COLLECTION_FACTORIES = {
  "java.util.ArrayList": () => makeArrayList(),
  "java.util.LinkedList": () => makeArrayList(),
  "java.util.HashMap": makeHashMap,
  "java.util.LinkedHashMap": makeHashMap,
  "java.util.HashSet": makeHashSet,
  "java.util.LinkedHashSet": makeHashSet
};
function javaType(fqn) {
  const factory = COLLECTION_FACTORIES[fqn];
  if (!factory) {
    throw new Error(
      `Java.type("${fqn}") is not supported in this engine's JS sandbox \u2014 only the common java.util collection types (ArrayList, LinkedList, HashMap, LinkedHashMap, HashSet, LinkedHashSet) are shimmed; custom/application classes and anything else on the JDK aren't resolvable here (this engine runs JS natively in V8, never a JVM).`
    );
  }
  return function() {
    return factory();
  };
}
function installRealmPrototypes(target) {
  const def28 = (proto, prop, val) => {
    try {
      if (proto && !proto[prop]) {
        Object.defineProperty(proto, prop, { value: val, writable: true, configurable: true, enumerable: false });
      }
    } catch {
    }
  };
  if (target.Object && target.Object.prototype) {
    def28(target.Object.prototype, "isEmpty", function() {
      if (this == null) return true;
      if (typeof this.length === "number") return this.length === 0;
      if (typeof this.size === "function") return this.size() === 0;
      if (typeof this.size === "number") return this.size === 0;
      return Object.keys(this).length === 0;
    });
    def28(target.Object.prototype, "equals", function(o) {
      if (this === o) return true;
      if (o == null) return false;
      return this.valueOf() === (typeof o.valueOf === "function" ? o.valueOf() : o);
    });
    def28(target.Object.prototype, "path", function(k) {
      const v = this && typeof this === "object" ? this[k] : void 0;
      return makeJacksonNode(v);
    });
    def28(target.Object.prototype, "has", function(k) {
      return this && typeof this === "object" && Object.prototype.hasOwnProperty.call(this, k);
    });
    def28(target.Object.prototype, "hasNonNull", function(k) {
      return this && typeof this === "object" && this[k] != null;
    });
    def28(target.Object.prototype, "asText", function(fb = "") {
      return this == null ? fb : String(this);
    });
    def28(target.Object.prototype, "asBoolean", function(fb = false) {
      if (this == null) return fb;
      if (typeof this === "boolean") return this;
      const s = String(this).trim().toLowerCase();
      return s === "true" || s === "1";
    });
    def28(target.Object.prototype, "asInt", function(fb = 0) {
      const n = parseInt(String(this), 10);
      return isNaN(n) ? fb : n;
    });
    def28(target.Object.prototype, "isNull", function() {
      return this == null;
    });
    def28(target.Object.prototype, "isMissingNode", function() {
      return this === void 0;
    });
    def28(target.Object.prototype, "size", function() {
      if (Array.isArray(this)) return this.length;
      return typeof this === "object" && this !== null ? Object.keys(this).length : 0;
    });
  }
  if (target.Array && target.Array.prototype) {
    def28(target.Array.prototype, "isEmpty", function() {
      return this.length === 0;
    });
    def28(target.Array.prototype, "size", function() {
      return this.length;
    });
    def28(target.Array.prototype, "get", function(i) {
      return this[i];
    });
    def28(target.Array.prototype, "set", function(i, v) {
      const old = this[i];
      this[i] = v;
      return old;
    });
    def28(target.Array.prototype, "add", function(v) {
      this.push(v);
      return true;
    });
    def28(target.Array.prototype, "remove", function(idxOrVal) {
      if (typeof idxOrVal === "number" && idxOrVal >= 0 && idxOrVal < this.length) {
        return this.splice(idxOrVal, 1)[0];
      }
      const idx = this.indexOf(idxOrVal);
      if (idx !== -1) {
        return this.splice(idx, 1)[0];
      }
      return null;
    });
    def28(target.Array.prototype, "contains", function(v) {
      return this.includes(v);
    });
    def28(target.Array.prototype, "clear", function() {
      this.length = 0;
    });
  }
  if (target.String && target.String.prototype) {
    def28(target.String.prototype, "isEmpty", function() {
      return this.length === 0;
    });
    def28(target.String.prototype, "equals", function(o) {
      return this.valueOf() === String(o);
    });
    def28(target.String.prototype, "equalsIgnoreCase", function(o) {
      return o != null && this.toLowerCase() === String(o).toLowerCase();
    });
    def28(target.String.prototype, "path", function(k) {
      try {
        const parsed = JSON.parse(this.valueOf());
        return makeJacksonNode(parsed && typeof parsed === "object" ? parsed[k] : void 0);
      } catch {
        return makeJacksonNode(void 0);
      }
    });
    def28(target.String.prototype, "has", function(k) {
      try {
        const parsed = JSON.parse(this.valueOf());
        return parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, k);
      } catch {
        return false;
      }
    });
    def28(target.String.prototype, "isNull", function() {
      return false;
    });
    def28(target.String.prototype, "asText", function() {
      return this.valueOf();
    });
    def28(target.String.prototype, "asBoolean", function(fb = false) {
      const s = this.trim().toLowerCase();
      return s === "true" || s === "1";
    });
    def28(target.String.prototype, "asInt", function(fb = 0) {
      const n = parseInt(this, 10);
      return isNaN(n) ? fb : n;
    });
  }
  if (target.Error && target.Error.prototype) {
    def28(target.Error.prototype, "getMessage", function() {
      return this.message || String(this);
    });
    def28(target.Error.prototype, "getLocalizedMessage", function() {
      return this.message || String(this);
    });
    def28(target.Error.prototype, "printStackTrace", function() {
      console.error(this.stack);
    });
  }
  if (target.String && !target.String.valueOfFixed) {
    target.String.valueOf = function(o) {
      return o == null ? "null" : String(o);
    };
    target.String.valueOfFixed = true;
  }
  if (target.Boolean && typeof target.Boolean.TRUE === "undefined") {
    target.Boolean.TRUE = { equals: function(o) {
      return Boolean(o) === true;
    }, valueOf: function() {
      return true;
    }, toString: function() {
      return "true";
    } };
    target.Boolean.FALSE = { equals: function(o) {
      return Boolean(o) === false;
    }, valueOf: function() {
      return false;
    }, toString: function() {
      return "false";
    } };
  }
}
installRealmPrototypes(globalThis);
function initVmRealm(sandbox) {
  installRealmPrototypes(sandbox);
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
function installJsCompat(sandbox) {
  sandbox.makeJacksonNode = makeJacksonNode;
  sandbox.Java = { type: javaType };
  sandbox.Integer = { valueOf: (x) => parseInt(x, 10), parseInt: (x) => parseInt(x, 10) };
  sandbox.Long = { valueOf: (x) => parseInt(x, 10), parseLong: (x) => parseInt(x, 10) };
  sandbox.Double = { valueOf: (x) => parseFloat(x), parseDouble: (x) => parseFloat(x) };
  sandbox.Float = { valueOf: (x) => parseFloat(x), parseFloat: (x) => parseFloat(x) };
  sandbox.java = {
    util: {
      ArrayList: function ArrayList(init) {
        return makeArrayList(Array.isArray(init) ? init : []);
      },
      LinkedList: function LinkedList(init) {
        return makeArrayList(Array.isArray(init) ? init : []);
      },
      HashMap: function HashMap(init) {
        return makeHashMap(init);
      },
      LinkedHashMap: function LinkedHashMap(init) {
        return makeHashMap(init);
      },
      HashSet: function HashSet() {
        return makeHashSet();
      },
      LinkedHashSet: function LinkedHashSet() {
        return makeHashSet();
      },
      Map: function Map2(init) {
        return makeHashMap(init);
      },
      List: function List(init) {
        return makeArrayList(Array.isArray(init) ? init : []);
      },
      Set: function Set2() {
        return makeHashSet();
      }
    }
  };
  sandbox.KieFunctions = {
    equalsTo: (a, b) => {
      if (a === b) return true;
      if (a == null || b == null) return false;
      return String(a) === String(b);
    },
    isTrue: (a) => {
      if (typeof a === "boolean") return a;
      if (typeof a === "string") return a.trim().toLowerCase() === "true" || a.trim() === "1";
      return Boolean(a);
    },
    isFalse: (a) => {
      if (typeof a === "boolean") return !a;
      if (typeof a === "string") return a.trim().toLowerCase() === "false" || a.trim() === "0";
      return !a;
    },
    isNull: (a) => a == null,
    notNull: (a) => a != null,
    isEmpty: (a) => a == null || String(a).trim() === ""
  };
  sandbox.org = {
    json: {
      JSONObject: function JSONObject(init) {
        return makeJsonObject(init);
      },
      JSONArray: function JSONArray(init) {
        return makeArrayList(Array.isArray(init) ? init : typeof init === "string" ? JSON.parse(init) : []);
      }
    }
  };
  sandbox.com = {
    fasterxml: {
      jackson: {
        databind: {
          ObjectMapper: function ObjectMapper() {
            return {
              createObjectNode: () => makeJacksonNode({}),
              createArrayNode: () => makeJacksonArray([]),
              readTree: (str) => {
                try {
                  return makeJacksonNode(typeof str === "string" ? JSON.parse(str) : str);
                } catch {
                  return makeJacksonNode({});
                }
              },
              writeValueAsString: (obj) => JSON.stringify(obj)
            };
          },
          node: {
            ObjectNode: function ObjectNode() {
              return makeJacksonNode({});
            },
            ArrayNode: function ArrayNode() {
              return makeJacksonArray([]);
            }
          }
        }
      }
    }
  };
  sandbox.System = {
    out: {
      println: (...args) => (sandbox.console?.log || console.log)(...args),
      print: (...args) => (sandbox.console?.log || console.log)(...args)
    },
    getenv: (k) => sandbox.env?.[k] || process.env[k] || "",
    getProperty: (k) => sandbox.env?.[k] || process.env[k] || "",
    currentTimeMillis: () => Date.now()
  };
}

// src/infra/quotas.ts
var runningScripts = /* @__PURE__ */ new Map();
function acquireScriptSlot(tenantId, max) {
  const current = runningScripts.get(tenantId) || 0;
  if (max && current >= max) {
    throw quotaExceeded(`per-tenant concurrent script quota exceeded (max ${max})`, { quota: "maxConcurrentScripts", max, current });
  }
  runningScripts.set(tenantId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runningScripts.set(tenantId, Math.max(0, (runningScripts.get(tenantId) || 1) - 1));
  };
}

// src/engine/sandbox.ts
var PROCESS_INSTANCE_STATE = { PENDING: 0, ACTIVE: 1, COMPLETED: 2, ABORTED: 3, SUSPENDED: 4 };
function stateFor(status) {
  switch (status) {
    case "completed":
      return PROCESS_INSTANCE_STATE.COMPLETED;
    case "aborted":
    case "failed":
      return PROCESS_INSTANCE_STATE.ABORTED;
    case "suspended":
      return PROCESS_INSTANCE_STATE.SUSPENDED;
    default:
      return PROCESS_INSTANCE_STATE.ACTIVE;
  }
}
function buildKcontext(vars, info, actions) {
  const selfId = info.instanceId == null ? "" : String(info.instanceId);
  const instance = {
    getId: () => selfId,
    getProcessId: () => info.processId,
    getProcessName: () => info.processName,
    getCorrelationKey: () => info.correlationKey,
    getParentProcessInstanceId: () => info.parentInstanceId,
    getState: () => stateFor(info.state),
    getVariables: () => vars,
    getNodeInstances: () => (info.activeNodeInstances || []).map((n) => ({
      getId: () => n.id,
      getNodeId: () => n.nodeId,
      getNodeName: () => n.nodeName ?? ""
    })),
    // self-scoped signal — real jBPM's ProcessInstance implements EventListener, so this is
    // delivered to THIS instance only (see kieRuntime.signalEvent below for the session-wide form).
    signalEvent: (type, event) => {
      actions.push({ kind: "signal", type, payload: event, targetInstanceId: selfId });
    }
  };
  const nodeInstance = { getId: () => info.nodeInstanceId ?? "", getNodeId: () => info.nodeId ?? "", getNodeName: () => info.nodeName ?? "" };
  const envMap = { ...info.env || {} };
  const environment = {
    ...envMap,
    get: (k) => envMap[k] ?? process.env[k] ?? null,
    set: (k, v) => {
      envMap[k] = v;
      if (info.env) info.env[k] = String(v);
    }
  };
  const kieRuntime = {
    getEnvironment: () => environment,
    // one function handles both the session-wide broadcast (2 args) and targeted delivery (3 args) —
    // JS has no method overloading, unlike the Java-dialect twin's two signalEvent overloads.
    signalEvent: (type, event, processInstanceId) => {
      actions.push({ kind: "signal", type, payload: event, targetInstanceId: processInstanceId });
    },
    abortProcessInstance: (processInstanceId) => {
      actions.push({ kind: "abort", targetInstanceId: processInstanceId });
    }
  };
  return {
    getVariable: (n) => vars[n],
    setVariable: (n, v) => {
      vars[n] = v;
    },
    getProcessInstance: () => instance,
    getNodeInstance: () => nodeInstance,
    getKieRuntime: () => kieRuntime
  };
}
function buildInstanceGlobal(vars, info, actions) {
  const selfId = info.instanceId == null ? "" : String(info.instanceId);
  return {
    id: selfId,
    processId: info.processId,
    processName: info.processName,
    correlationKey: info.correlationKey,
    parentId: info.parentInstanceId,
    // this engine's own status string, NOT jBPM's STATE_* int (that's still available via
    // kcontext.getProcessInstance().getState() for anyone who needs the real jBPM constant).
    state: info.state ?? "running",
    variables: vars,
    activeNodes: (info.activeNodeInstances || []).map((n) => ({ id: n.id, nodeId: n.nodeId, name: n.nodeName ?? "" })),
    signal: (type, payload) => {
      actions.push({ kind: "signal", type, payload, targetInstanceId: selfId });
    },
    signalOther: (targetInstanceId, type, payload) => {
      actions.push({ kind: "signal", type, payload, targetInstanceId });
    },
    broadcast: (type, payload) => {
      actions.push({ kind: "signal", type, payload });
    },
    abort: () => {
      actions.push({ kind: "abort", targetInstanceId: selfId });
    },
    abortOther: (targetInstanceId) => {
      actions.push({ kind: "abort", targetInstanceId });
    }
  };
}
function buildNodeGlobal(info) {
  return { id: info.nodeInstanceId ?? "", nodeId: info.nodeId ?? "", name: info.nodeName ?? "" };
}
async function resolveActions(actions, cb) {
  for (const a of actions) {
    if (a.kind === "signal" && a.type) {
      if (a.targetInstanceId) await cb.signal(a.targetInstanceId, a.type, a.payload);
      else await cb.broadcast(a.type);
    } else if (a.kind === "abort" && a.targetInstanceId) {
      await cb.abort(a.targetInstanceId);
    }
  }
}
async function runScript(code, vars, timeoutMs, opts = {}) {
  const release = opts.tenantId ? acquireScriptSlot(opts.tenantId, opts.maxConcurrentScripts) : void 0;
  try {
    await runScriptBody(code, vars, timeoutMs, opts);
  } finally {
    release?.();
  }
}
async function runScriptBody(code, vars, timeoutMs, opts) {
  if (opts.lang === "java") {
    const result = await executeJava({
      code,
      vars,
      env: opts.env,
      instanceId: opts.instanceId,
      varTypes: opts.varTypes,
      nodeInstanceId: opts.nodeInstanceId,
      nodeId: opts.nodeId,
      nodeName: opts.nodeName,
      processId: opts.processId,
      processName: opts.processName,
      correlationKey: opts.correlationKey,
      parentInstanceId: opts.parentInstanceId,
      state: opts.state,
      activeNodeInstances: opts.activeNodeInstances
    });
    Object.assign(vars, result.vars);
    if (result.logs) {
      const log2 = opts.log || (() => {
      });
      for (const line of result.logs.split("\n")) if (line) log2(line);
    }
    if (opts.onAction) await resolveActions(result.pendingActions, opts.onAction);
    return;
  }
  const actions = [];
  const kcontext = buildKcontext(vars, opts, actions);
  const log = opts.log || (() => {
  });
  const safeVars = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!RESERVED_SANDBOX_KEYS.has(k)) {
      safeVars[k] = v;
    }
  }
  const sandbox = {
    ...safeVars,
    kcontext,
    vars,
    instance: buildInstanceGlobal(vars, opts, actions),
    node: buildNodeGlobal(opts),
    env: { ...opts.env || {} },
    console: { log: (...a) => log(a.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" ")) }
  };
  installJsCompat(sandbox);
  vm2.createContext(sandbox);
  initVmRealm(sandbox);
  const before = {};
  for (const k of Object.keys(sandbox)) if (!RESERVED_SANDBOX_KEYS.has(k)) before[k] = sandbox[k];
  vm2.runInContext(`(function(){
${code}
})()`, sandbox, { timeout: timeoutMs });
  for (const k of Object.keys(sandbox)) {
    if (RESERVED_SANDBOX_KEYS.has(k)) continue;
    if (typeof sandbox[k] === "function") continue;
    if (!(k in before) || !Object.is(sandbox[k], before[k])) vars[k] = sandbox[k];
  }
  if (opts.onAction) await resolveActions(actions, opts.onAction);
}
var RESERVED_SANDBOX_KEYS = /* @__PURE__ */ new Set([
  "kcontext",
  "vars",
  "instance",
  "node",
  "env",
  "console",
  "Java",
  "java",
  "System",
  "KieFunctions",
  "org",
  "com",
  "makeJacksonNode",
  "Boolean",
  "String",
  "Number",
  "Object",
  "Array",
  "Integer",
  "Long",
  "Double",
  "Float",
  "Error",
  "Date",
  "Math",
  "JSON",
  "RegExp",
  "Map",
  "Set",
  "Promise",
  "Function",
  "Symbol",
  "Reflect",
  "Proxy",
  "isNaN",
  "isFinite",
  "parseInt",
  "parseFloat",
  "encodeURI",
  "encodeURIComponent",
  "decodeURI",
  "decodeURIComponent",
  "eval"
]);
async function evalCondition(expr, lang, vars, timeoutMs = 500, varTypes, ctx = {}) {
  if (!expr) return true;
  if (lang && lang !== "js" && lang !== "java") return false;
  if (lang === "java") {
    try {
      const result = await executeJavaCondition({
        code: expr,
        vars,
        varTypes,
        env: ctx.env,
        instanceId: ctx.instanceId,
        nodeInstanceId: ctx.nodeInstanceId,
        nodeId: ctx.nodeId,
        nodeName: ctx.nodeName,
        processId: ctx.processId,
        processName: ctx.processName,
        correlationKey: ctx.correlationKey,
        parentInstanceId: ctx.parentInstanceId,
        state: ctx.state,
        activeNodeInstances: ctx.activeNodeInstances
      });
      return result;
    } catch {
      return false;
    }
  }
  const actions = [];
  const kcontext = buildKcontext(vars, ctx, actions);
  const safeVars = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!RESERVED_SANDBOX_KEYS.has(k)) {
      safeVars[k] = v;
    }
  }
  const sandbox = {
    ...safeVars,
    kcontext,
    vars,
    instance: buildInstanceGlobal(vars, ctx, actions),
    node: buildNodeGlobal(ctx),
    env: { ...ctx.env || {} }
  };
  installJsCompat(sandbox);
  vm2.createContext(sandbox);
  initVmRealm(sandbox);
  try {
    const body = /return\b/.test(expr) ? expr : `return (${expr});`;
    const result = !!vm2.runInContext(`(function(){ ${body} })()`, sandbox, { timeout: timeoutMs });
    if (ctx.onAction) await resolveActions(actions, ctx.onAction);
    return result;
  } catch {
    return false;
  }
}

// src/engine/nodes/kcontext-info.ts
function varTypesOf(c) {
  const varTypes = {};
  for (const v of c.proc.vars || []) if (v.name) varTypes[v.name] = v.type;
  return varTypes;
}
function nodeNameIndex(nodes, out) {
  for (const n of nodes || []) {
    if (n.id) out.set(n.id, n.name);
    const nested = n.nodes;
    if (Array.isArray(nested)) nodeNameIndex(nested, out);
  }
}
function activeNodeInstancesOf(c) {
  const names = /* @__PURE__ */ new Map();
  nodeNameIndex(c.proc.nodes, names);
  return c.inst.tokens.filter((t) => t.state === "active").map((t) => ({ id: t.id, nodeId: t.nodeId, nodeName: names.get(t.nodeId) }));
}
function kcontextInfoOf(c) {
  return {
    env: c.dep.env,
    instanceId: c.inst.id,
    nodeInstanceId: c.tokenId,
    nodeId: c.node.id,
    nodeName: c.node.name,
    processId: c.proc.id,
    processName: c.proc.name,
    correlationKey: c.inst.correlationKey,
    parentInstanceId: c.inst.parentInstanceId,
    state: c.inst.status,
    activeNodeInstances: activeNodeInstancesOf(c)
  };
}
function onActionOf(c) {
  return { broadcast: c.broadcast, signal: c.signal, abort: c.abort };
}

// src/modules/settings/service.ts
var DEFAULT_SETTINGS = {
  defaultPageSize: 20,
  instanceRetentionDays: 90,
  auditRetentionDays: 365,
  allowRunningVariableEdits: true,
  executorIntervalSeconds: 5,
  defaultJobRetries: 3,
  slaWarnThresholdPct: 80,
  sessionTimeoutHours: 8,
  emailEnabled: false,
  // 0 = unlimited — see SystemSettings' own doc comment (domain.ts).
  maxActiveInstances: 0,
  maxActiveTimers: 0,
  maxConcurrentScripts: 0
};
var PAGE_SIZES = [10, 20, 50, 100];
var SettingsService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  repo() {
    return this.ctx.store.repo(Collections.settings);
  }
  async get() {
    const existing = await this.repo().get("system");
    if (existing && existing.tenantId === this.ctx.tenantId) return existing;
    return { id: "system", tenantId: this.ctx.tenantId, ...DEFAULT_SETTINGS };
  }
  async update(patch, actor) {
    if (patch.defaultPageSize !== void 0 && !PAGE_SIZES.includes(patch.defaultPageSize)) {
      throw validation(`defaultPageSize must be one of ${PAGE_SIZES.join(", ")}`);
    }
    for (const k of ["instanceRetentionDays", "auditRetentionDays", "executorIntervalSeconds", "defaultJobRetries", "sessionTimeoutHours"]) {
      const v = patch[k];
      if (v !== void 0 && (typeof v !== "number" || v <= 0)) throw validation(`${k} must be a positive number`);
    }
    if (patch.slaWarnThresholdPct !== void 0 && (patch.slaWarnThresholdPct < 1 || patch.slaWarnThresholdPct > 100)) {
      throw validation("slaWarnThresholdPct must be between 1 and 100");
    }
    for (const k of ["maxActiveInstances", "maxActiveTimers", "maxConcurrentScripts"]) {
      const v = patch[k];
      if (v !== void 0 && (typeof v !== "number" || v < 0 || !Number.isInteger(v))) {
        throw validation(`${k} must be a non-negative integer (0 = unlimited)`);
      }
    }
    const current = await this.get();
    const next = {
      ...current,
      ...patch,
      id: "system",
      tenantId: this.ctx.tenantId,
      updatedAt: this.ctx.clock(),
      updatedBy: actor
    };
    await this.repo().put(next);
    await this.ctx.audit({ actor, kind: "settings.updated", data: { changed: Object.keys(patch) } });
    return next;
  }
};

// src/engine/nodes/script/handler.ts
var handler4 = async (c) => {
  const n = c.node;
  if (n.lang && n.lang !== "js" && n.lang !== "java") return { outcome: "skipped-nonjs" };
  const vars = { ...c.inst.variables };
  const logs = [];
  const { maxConcurrentScripts } = await new SettingsService(c.app).get();
  try {
    await runScript(n.code || "", vars, config.scriptTimeoutMs, {
      ...kcontextInfoOf(c),
      log: (line) => logs.push(line),
      lang: n.lang,
      varTypes: varTypesOf(c),
      onAction: onActionOf(c),
      tenantId: c.app.tenantId,
      maxConcurrentScripts
    });
  } catch (e) {
    const code = e.code === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED" : "SCRIPT_ERROR";
    return { error: `script failed: ${e.message}`, errorCode: code };
  }
  return { vars, ...logs.length ? { outcome: logs.join("\n") } : {} };
};

// src/infra/outbound-guard.ts
import dns from "dns/promises";
import net from "net";
var PRIVATE_V4 = [/^169\.254\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^127\./, /^0\./];
function isBlockedIp(ip) {
  const kind = net.isIP(ip);
  if (kind === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (kind === 6) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fe80:") || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("::ffff:127.") || l.startsWith("::ffff:169.254.") || l.startsWith("::ffff:10.") || l.startsWith("::ffff:192.168.");
  }
  return false;
}
function isAllowlisted(hostname) {
  return config.outboundAllowlist.some((h) => h === hostname || hostname.endsWith(`.${h}`));
}
async function assertOutboundAllowed(absoluteUrl) {
  const { hostname } = new URL(absoluteUrl);
  if (isAllowlisted(hostname)) return;
  const literalIp = net.isIP(hostname) !== 0;
  const ips = literalIp ? [hostname] : (await dns.lookup(hostname, { all: true }).catch(() => [])).map((r) => r.address);
  if (ips.some(isBlockedIp)) {
    throw new Error(`outbound call to "${hostname}" blocked: private/link-local/loopback address (SSRF protection) \u2014 add it to OUTBOUND_ALLOWLIST if this is intentional`);
  }
}

// src/engine/nodes/http/handler.ts
function jsonPath(obj, path6) {
  if (obj == null) return void 0;
  const parts = path6.replace(/^\$\.?/, "").split(".").filter(Boolean);
  return parts.reduce((c, p) => c == null ? c : c[p], obj);
}
var handler5 = async (c) => {
  const n = c.node;
  const baseUrl = c.dep.env && c.dep.env["INTEGRATION_LAYER_URL"] || config.integrationBaseUrl;
  const isAbsolute = /^https?:\/\//.test(n.url || "");
  const url = isAbsolute ? n.url : `${baseUrl}${n.url || ""}`;
  const method = String(n.method || "POST").toUpperCase();
  const body = {};
  for (const [k, v] of Object.entries(n.body || {})) body[k] = typeof v === "string" && v.startsWith("$") ? c.inst.variables[v.slice(1)] : v;
  if (isAbsolute) {
    try {
      await assertOutboundAllowed(url);
    } catch (e) {
      return { error: e.message, errorCode: "SSRF_BLOCKED" };
    }
  }
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
    for (const [varName, path6] of Object.entries(n.resultTo || {})) vars[varName] = jsonPath(json, String(path6));
    if (n.exitScript) {
      const scriptVars = { ...c.inst.variables, ...vars, resPayload: text };
      const varTypes = { resPayload: "String", ...varTypesOf(c) };
      try {
        const { maxConcurrentScripts } = await new SettingsService(c.app).get();
        await runScript(String(n.exitScript), scriptVars, config.scriptTimeoutMs, {
          ...kcontextInfoOf(c),
          lang: n.lang,
          varTypes,
          onAction: onActionOf(c),
          tenantId: c.app.tenantId,
          maxConcurrentScripts
        });
        delete scriptVars.resPayload;
        Object.assign(vars, scriptVars);
      } catch (e) {
        const code = e.code === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED" : "SCRIPT_ERROR";
        return { error: `exitScript failed: ${e.message}`, errorCode: code };
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
  const decision = ref2.decision ? model.decisions.find((d) => d.name === ref2.decision) : model.decisions[0];
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
function evaluateGuidedTable(engine, name, vars) {
  const table = (engine.guidedTables || []).find((t) => t.name === name);
  if (!table) throw new Error(`guided decision table "${name}" not found`);
  const fact = table.fact && vars[table.fact] && typeof vars[table.fact] === "object" ? vars[table.fact] : vars;
  const input = { ...fact };
  const out = { ...fact };
  const changed = {};
  const fired = [];
  const OPS = {
    eq: (a, b) => a === b || String(a) === String(b),
    ne: (a, b) => a !== b && String(a) !== String(b),
    gt: (a, b) => Number(a) > Number(b),
    gte: (a, b) => Number(a) >= Number(b),
    lt: (a, b) => Number(a) < Number(b),
    lte: (a, b) => Number(a) <= Number(b)
  };
  const conditions = table.conditions || [];
  const actions = table.actions || [];
  const rows = table.rows || [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const matches = conditions.every((c) => {
      const v = (row.when || {})[c.field];
      if (v == null || v === "") return true;
      const op = c.op || "eq";
      const fn = OPS[op] || OPS.eq;
      return fn(input[c.field], v);
    });
    if (!matches) continue;
    fired.push(i + 1);
    for (const a of actions) {
      const v = (row.then || {})[a.field];
      if (v !== void 0) {
        out[a.field] = v;
        changed[a.field] = v;
      }
    }
    if (table.hitPolicy === "FIRST" || table.hitPolicy === "FIRST_HIT") break;
  }
  if (table.fact && table.fact !== name && vars[table.fact] && typeof vars[table.fact] === "object") {
    Object.assign(vars[table.fact], out);
    changed[table.fact] = vars[table.fact];
  } else {
    Object.assign(vars, changed);
  }
  return { ...changed, _firedRows: fired };
}
function evaluateTestScenario(engine, suiteName) {
  const suite = (engine.tests || []).find((s) => s.name === suiteName);
  if (!suite) throw new Error(`test suite "${suiteName}" not found`);
  const target = suite.target;
  const cases = suite.cases || [];
  const evaluateTarget = (given) => {
    if ((engine.decisions || []).some((d) => d.name === target)) {
      return evaluateDmn(engine, { model: target, decision: "" }, { ...given });
    }
    if ((engine.rulesets || []).some((r) => r.group === target)) {
      return evaluateRules(engine, target, { ...given });
    }
    if ((engine.guidedTables || []).some((g) => g.name === target)) {
      return evaluateGuidedTable(engine, target, { ...given });
    }
    if ((engine.decisionTrees || []).some((t) => t.name === target)) {
      return evaluateDecisionTree(engine, target, { ...given });
    }
    if ((engine.scorecards || []).some((s) => s.name === target)) {
      return evaluateScorecard(engine, target, { ...given });
    }
    throw new Error(`Target "${target}" not found among project decisions, rulesets, tables, trees, or scorecards`);
  };
  const results = cases.map((c, i) => {
    const given = c.given || {};
    const expected = c.expect || {};
    let actual = {};
    const failures = [];
    try {
      actual = evaluateTarget({ ...given });
      for (const [k, expVal] of Object.entries(expected)) {
        const actVal = actual[k];
        if (actVal !== expVal && String(actVal) !== String(expVal)) {
          failures.push({ field: k, expected: expVal, actual: actVal });
        }
      }
    } catch (err) {
      failures.push({ field: "_execution", expected: "successful evaluation", actual: err.message });
    }
    return {
      name: c.name || `Case ${i + 1}`,
      pass: failures.length === 0,
      actual,
      expected,
      failures
    };
  });
  const passed = results.filter((r) => r.pass).length;
  return {
    name: suite.name,
    target,
    cases: results,
    total: results.length,
    passed,
    failed: results.length - passed
  };
}

// src/engine/nodes/rule/handler.ts
var handler6 = (c) => {
  const n = c.node;
  try {
    if (n.dmn) return { vars: evaluateDmn(c.dep.engine, n.dmn, c.inst.variables), outcome: "dmn" };
    if (n.guidedTable) return { vars: evaluateGuidedTable(c.dep.engine, n.guidedTable, c.inst.variables), outcome: `table:${n.guidedTable}` };
    if (n.decisionTree) return { vars: evaluateDecisionTree(c.dep.engine, n.decisionTree, c.inst.variables), outcome: `tree:${n.decisionTree}` };
    if (n.scorecard) return { vars: evaluateScorecard(c.dep.engine, n.scorecard, c.inst.variables), outcome: `scorecard:${n.scorecard}` };
    if (n.ruleflowGroup) return { vars: evaluateRules(c.dep.engine, n.ruleflowGroup, c.inst.variables), outcome: `rules:${n.ruleflowGroup}` };
    return {};
  } catch (e) {
    return { error: `rule evaluation failed: ${e.message}`, errorCode: "RULE_ERROR" };
  }
};

// src/engine/nodes/gateway/handler.ts
async function filterAsync(items, pred) {
  const out = [];
  for (const item of items) if (await pred(item)) out.push(item);
  return out;
}
async function findAsync(items, pred) {
  for (const item of items) if (await pred(item)) return item;
  return void 0;
}
var handler7 = async (c) => {
  const node = c.node;
  const outs = c.outgoing(node.id);
  const ins = c.incoming(node.id);
  const converging = ins.length > 1 && outs.length <= 1;
  const varTypes = varTypesOf(c);
  const condCtx = { ...kcontextInfoOf(c), onAction: onActionOf(c) };
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
      const matched = await filterAsync(outs, async (f) => !!f.when && evalCondition(f.when, f.lang, c.inst.variables, void 0, varTypes, condCtx));
      const chosen = matched.length ? matched : outs.filter((f) => f.id === node.default || !f.when);
      return { next: chosen.map((f) => f.to), outcome: matched.length ? "inclusive" : "default" };
    }
    // Event-based gateway: fork a token onto EVERY downstream catch (message/signal/timer/condition) —
    // real BPMN semantics is a race, not a fan-out: whichever catch fires first wins, and
    // execution-engine.ts's resumeToken (via cancelEventGatewaySiblings) cancels the rest at that point.
    case "event":
      return { next: outs.map((f) => f.to), outcome: "event-gateway-fork" };
    case "complex":
    case "exclusive":
    default: {
      const match = await findAsync(outs, async (f) => !!f.when && evalCondition(f.when, f.lang, c.inst.variables, void 0, varTypes, condCtx));
      const def28 = outs.find((f) => f.id === node.default) || outs.find((f) => !f.when);
      const chosen = match || def28;
      return { next: chosen ? [chosen.to] : [], outcome: match ? "conditional" : "default" };
    }
  }
};

// src/engine/duration.ts
function parseDuration(iso) {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!m) return 0;
  const [, w, d, h, min2, s] = m.map((x) => x ? Number(x) : 0);
  return ((((w * 7 + d) * 24 + h) * 60 + min2) * 60 + s) * 1e3;
}
function parseCycleRepeatCount(cycle) {
  const m = /^R(\d*)\//.exec(cycle.trim());
  if (!m) return null;
  return m[1] ? Number(m[1]) : null;
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

// src/engine/nodes/user-task/handler.ts
function mapTaskInputs(n, vars) {
  const out = {};
  for (const [tv, spec] of Object.entries(n.inputs || {})) out[tv] = typeof spec === "string" && spec.startsWith("$") ? vars[spec.slice(1)] : spec;
  return out;
}
var handler8 = (c) => {
  const n = c.node;
  const now = c.app.clock();
  const task = {
    id: c.app.newId(),
    tenantId: c.app.tenantId,
    instanceId: c.inst.id,
    tokenId: c.inst.tokens.find((t) => t.nodeId === n.id).id,
    nodeId: n.id,
    name: n.name || n.form || "Task",
    formName: n.form,
    group: n.group || n.assignee,
    businessAdmin: n.businessAdmin,
    excludedOwners: n.excludedOwners,
    priority: n.priority,
    status: "created",
    inputs: mapTaskInputs(n, c.inst.variables),
    createdAt: now,
    ...n.dueDate ? { dueAt: computeDue(n.dueDate, now) } : {}
  };
  c.app.store.repo(Collections.tasks).put(task);
  c.emit({ kind: "task.created", instanceId: c.inst.id, taskId: task.id });
  return { wait: { kind: "task", ref: task.id } };
};

// src/engine/nodes/receive/handler.ts
var handler9 = (c) => ({ wait: { kind: "message", ref: c.node.message } });

// src/engine/nodes/catch/handler.ts
var handler10 = (c) => {
  const ev = c.node.event || {};
  if (ev.timer) return { wait: { kind: "timer", ref: c.node.id, dueAt: computeDue(ev.timer, c.app.clock()) } };
  if (ev.message) return { wait: { kind: "message", ref: ev.message } };
  if (ev.signal || ev.escalation) return { wait: { kind: "signal", ref: ev.signal || ev.escalation } };
  return { wait: { kind: "condition", ref: c.node.id } };
};

// src/engine/nodes/throw/handler.ts
var handler11 = async (c) => {
  const ev = c.node.event || {};
  if (ev.compensation || ev.compensate) return { vars: await c.compensate(ev.ref), outcome: "compensated" };
  const name = ev.signal || ev.message || ev.escalation;
  const correlationValue = typeof ev.correlationKey === "string" && ev.correlationKey.startsWith("$") ? c.inst.variables[ev.correlationKey.slice(1)] : void 0;
  if (name) await c.broadcast(name, correlationValue);
  return { outcome: name ? `threw:${name}` : "throw" };
};

// src/engine/nodes/send/handler.ts
var handler12 = async (c) => {
  const n = c.node;
  const correlationValue = typeof n.correlationKey === "string" && n.correlationKey.startsWith("$") ? c.inst.variables[n.correlationKey.slice(1)] : void 0;
  if (n.message) await c.broadcast(n.message, correlationValue);
  return { outcome: n.message ? `sent:${n.message}` : "send" };
};

// src/engine/nodes/call/handler.ts
function mapChildOutputs(n, child2) {
  const vars = {};
  for (const [pv, cv] of Object.entries(n.outputs || {})) vars[pv] = child2.variables[cv];
  return vars;
}
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
  const independent = n.independent === true;
  const child2 = await c.startChild(resolved.dep, resolved.processId, childVars, token.id, independent);
  if (independent) return { vars: child2.status === "completed" ? mapChildOutputs(n, child2) : {}, outcome: `called:${child2.id}` };
  if (child2.status === "completed") return { vars: mapChildOutputs(n, child2), outcome: `called:${child2.id}` };
  if (child2.status === "aborted" || child2.status === "failed") return { error: `called process ${child2.status}`, errorCode: "CALL_ERROR", outcome: `called:${child2.id}` };
  return { wait: { kind: "child", ref: child2.id }, outcome: `called:${child2.id}` };
};

// src/engine/nodes/for-each/handler.ts
function buildMultiInstanceResult(children, total, n) {
  const failed = children.find((child2) => child2.status === "failed" || child2.status === "aborted");
  if (failed) return { error: `multi-instance item did not complete (${failed.status}): ${failed.id}`, errorCode: "MULTIINSTANCE_ERROR", outcome: `multiInstance:${total}` };
  if (children.length < total || children.some((child2) => child2.status !== "completed")) return { wait: { kind: "multiInstance" }, outcome: `multiInstance:${children.length}/${total}` };
  const results = n.itemResult ? children.map((child2) => child2.variables[n.itemResult]) : [];
  return { vars: n.collectInto ? { [n.collectInto]: results } : {}, outcome: `multiInstance:${total}` };
}
var handler14 = async (c) => {
  const n = c.node;
  if (!c.resolveCalled || !n.process) return {};
  const resolved = await c.resolveCalled(n.process);
  if (!resolved) return { outcome: "mi-process-not-deployed" };
  const items = Array.isArray(c.inst.variables[n.over]) ? c.inst.variables[n.over] : [];
  if (!items.length) return { vars: n.collectInto ? { [n.collectInto]: [] } : {}, outcome: "multiInstance:0" };
  const parentToken = c.inst.tokens.find((t) => t.nodeId === n.id);
  const runOne = (item) => {
    const childVars = {};
    for (const v of n.pass || []) childVars[v] = c.inst.variables[v];
    if (n.as) childVars[n.as] = item;
    return c.startChild(resolved.dep, resolved.processId, childVars, parentToken.id);
  };
  if (n.parallel) return buildMultiInstanceResult(await Promise.all(items.map(runOne)), items.length, n);
  const started = [];
  for (const item of items) {
    started.push(await runOne(item));
    if (started.at(-1).status !== "completed") break;
  }
  return buildMultiInstanceResult(started, items.length, n);
};

// src/engine/nodes/subprocess/handler.ts
function mapChildOutputs2(_n, child2) {
  return { ...child2.variables };
}
var handler15 = async (c) => {
  const n = c.node;
  if (!Array.isArray(n.nodes) || n.nodes.length === 0) return {};
  const token = c.inst.tokens.find((t) => t.nodeId === n.id);
  const composite = `${c.proc.id}::${n.id}`;
  const child2 = await c.startChild(c.dep, composite, { ...c.inst.variables }, token.id);
  if (child2.status === "completed") return { vars: mapChildOutputs2(n, child2), outcome: `sub:${child2.id}` };
  if (child2.status === "aborted" || child2.status === "failed") return { error: "sub-process failed", errorCode: "SUBPROCESS_ERROR", outcome: `sub:${child2.id}` };
  return { wait: { kind: "child", ref: child2.id }, outcome: `sub:${child2.id}` };
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
  DBQuery: async (p, env2) => env2["DB_SERVICE_URL"] ? await callService(env2["DB_SERVICE_URL"], p) : { rows: [], simulated: true },
  // standard jBPM REST work item handler
  Rest: async (p, env2) => {
    let rawUrl = String(p["Url"] || p["url"] || "");
    if (!rawUrl) throw new Error('Rest workitem requires "Url" parameter');
    let url = rawUrl.replace(/\$\{([^}]+)\}/g, (_, key) => String(env2[key] ?? p[key] ?? ""));
    const baseUrl = env2["BASE_URL"] || "";
    if (!/^https?:\/\//i.test(url) && baseUrl) {
      const base = baseUrl.replace(/\/+$/, "");
      url = url.startsWith("/") ? `${base}${url}` : `${base}/${url}`;
    }
    const method = String(p["Method"] || p["method"] || "POST").toUpperCase();
    const contentType = String(p["ContentType"] || p["contentType"] || "application/json");
    let headers = { "content-type": contentType };
    const rawHeaders = p["Headers"] || p["headers"];
    if (typeof rawHeaders === "string" && rawHeaders.trim()) {
      try {
        const parsed = JSON.parse(rawHeaders);
        if (typeof parsed === "object" && parsed !== null) headers = { ...headers, ...parsed };
      } catch {
        for (const line of rawHeaders.split(/[\n;]/)) {
          const idx = line.indexOf(":") !== -1 ? line.indexOf(":") : line.indexOf("=");
          if (idx !== -1) {
            const k = line.substring(0, idx).trim();
            const v = line.substring(idx + 1).trim();
            if (k) headers[k] = v;
          }
        }
      }
    } else if (typeof rawHeaders === "object" && rawHeaders !== null) {
      headers = { ...headers, ...rawHeaders };
    }
    let body = void 0;
    if (method !== "GET" && method !== "HEAD") {
      const content = p["ContentData"] ?? p["Content"] ?? p["body"];
      if (typeof content === "string") {
        body = content;
      } else if (content !== void 0 && content !== null) {
        body = JSON.stringify(content);
      }
    }
    const connectTimeout = Number(p["ConnectTimeout"] || p["ReadTimeout"] || 1e4);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), connectTimeout);
    try {
      const res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });
      clearTimeout(timer);
      const text = await res.text();
      let resultData = text;
      const resultClass = String(p["ResultClass"] || "").trim();
      if (resultClass) {
        try {
          resultData = text ? JSON.parse(text) : {};
        } catch {
          resultData = text;
        }
      }
      if (!res.ok) {
        const handleResponseErrors = String(p["HandleResponseErrors"]).toLowerCase() === "true";
        if (handleResponseErrors) {
          throw new Error(`HTTP ${res.status} from ${url}: ${text}`);
        }
      }
      return {
        Result: resultData,
        Status: res.status,
        result: resultData,
        status: res.status
      };
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }
};
WORKITEM_HANDLERS.REST = WORKITEM_HANDLERS.Rest;
var WORKITEM_NAMES = Object.keys(WORKITEM_HANDLERS);

// src/engine/nodes/work-item/handler.ts
var handler16 = async (c) => {
  const n = c.node;
  const h = WORKITEM_HANDLERS[n.handler];
  if (!h) return { error: `unknown work-item handler "${n.handler}"`, errorCode: "SERVICE_ERROR" };
  const params = {};
  const env2 = c.dep.env || {};
  const instVars = c.inst.variables || {};
  for (const [k, v] of Object.entries(n.params || {})) {
    if (typeof v === "string") {
      if (v.startsWith("$")) {
        params[k] = instVars[v.slice(1)] ?? env2[v.slice(1)];
      } else if (v.includes("${")) {
        params[k] = v.replace(/\$\{([^}]+)\}/g, (_, name) => String(instVars[name] ?? env2[name] ?? process.env[name] ?? ""));
      } else {
        params[k] = v;
      }
    } else {
      params[k] = v;
    }
  }
  try {
    const result = await h(params, env2);
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
  ] }],
  diagram: { icon: "play", color: "#16a34a", shape: "circle" },
  typeLabel: "Start event"
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
    { key: "throw", label: "Throw event", widget: "event", options: ["none", "signal", "error", "escalation", "message"] },
    { key: "throw.correlationKey", label: "Correlate to", widget: "varRef", varSource: "ownRef", placeholder: "$claimId", help: "Deliver only to the waiting instance whose own correlationKey matches this variable\u2019s value; blank = deliver to every instance waiting on this name" }
  ] }],
  diagram: { icon: "error", color: "#dc2626", shape: "circle" },
  typeLabel: "End event"
};

// src/engine/nodes/manual/def.ts
var def3 = {
  engineType: "manual",
  palette: [{ key: "manual", label: "Manual Task", category: "Tasks", icon: "\u270B", color: "#64748b", engineType: "manual", defaults: { type: "manual", name: "Manual Task" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL],
  diagram: { icon: "tasks", color: "#64748b", shape: "rectangle" },
  typeLabel: "Manual task"
};

// src/engine/nodes/script/def.ts
var def4 = {
  engineType: "script",
  palette: [{ key: "script", label: "Script Task", category: "Tasks", icon: "{ }", color: "#0891b2", engineType: "script", defaults: { type: "script", lang: "js", code: "" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Script (JavaScript)", fields: [
    { key: "code", label: "Script body", widget: "code", placeholder: 'kcontext.setVariable("x", 1);', help: "Runs as JavaScript against kcontext (getVariable/setVariable)." }
  ] }],
  diagram: { icon: "code", color: "#0891b2", shape: "rectangle" },
  typeLabel: "Script task"
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
    { key: "body", label: "Body (value or $var)", widget: "keyval", valueSource: "ownRef", help: `Right side: "$name" to send one of this process's own variables, or a literal value.` }
  ] }, { title: "Response", fields: [
    { key: "resultTo", label: "Map response \u2192 variable (var \u2190 JSONPath)", widget: "keyval", keySource: "own", help: "Left = this process's variable to write (pick an existing one to overwrite it, or type a new name), e.g. verifierId \u2190 $.verifierId." }
  ] }],
  diagram: { icon: "globe", color: "#0d9488", shape: "rectangle" },
  typeLabel: "Service task"
};

// src/engine/nodes/rule/def.ts
var def6 = {
  engineType: "rule",
  palette: [{ key: "rule", label: "Business Rule", category: "Tasks", icon: "\u{1F4D0}", color: "#ea580c", engineType: "rule", defaults: { type: "rule", ruleflowGroup: "group" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "DRL rules", fields: [
    { key: "ruleflowGroup", label: "Ruleflow group", widget: "assetRef", assetKind: "rulesets", placeholder: "classify" }
  ] }, { title: "DMN (alternative)", fields: [
    { key: "dmn.namespace", label: "DMN namespace", widget: "text" },
    { key: "dmn.model", label: "DMN model name", widget: "assetRef", assetKind: "decisions" },
    { key: "dmn.decision", label: "Decision name", widget: "text" }
  ] }, { title: "Guided Decision Table (alternative)", fields: [
    { key: "guidedTable", label: "Guided table name", widget: "assetRef", assetKind: "guidedTables", help: "Evaluate a guided decision table asset" }
  ] }, { title: "Decision tree / scorecard (alternative)", fields: [
    { key: "decisionTree", label: "Decision tree name", widget: "assetRef", assetKind: "decisionTrees", help: "Evaluate a guided decision tree asset" },
    { key: "scorecard", label: "Scorecard name", widget: "assetRef", assetKind: "scorecards", help: "Evaluate a scorecard asset (writes its target score)" }
  ] }],
  diagram: { icon: "branch", color: "#ea580c", shape: "rectangle" },
  typeLabel: "Business rule"
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
  ] }],
  diagram: { icon: "branch", color: "#f59e0b", shape: "diamond" },
  typeLabel: "Gateway"
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
    { key: "form", label: "Form name", widget: "assetRef", assetKind: "forms" },
    { key: "priority", label: "Priority", widget: "number" },
    { key: "dueDate", label: "Due date / SLA", widget: "text", placeholder: "PT8H or 2026-01-01" },
    { key: "skippable", label: "Skippable", widget: "bool" },
    { key: "description", label: "Task description", widget: "textarea" }
  ] }, { title: "Data", fields: [
    { key: "inputs", label: "Task inputs (taskVar \u2190 processVar)", widget: "keyval", valueSource: "ownRef", help: `Left = the field name the form/UI sees on this task. Right = "$name" to copy one of this process's own variables in, or a literal value.` },
    { key: "outputs", label: "Task outputs (processVar \u2190 taskVar)", widget: "keyval", keySource: "own", help: "Left = the process variable to write (pick an existing one to overwrite it, or type a new name). Right = the field name submitted on this task." }
  ] }],
  diagram: { icon: "user", color: "#2563eb", shape: "rectangle" },
  typeLabel: "User task"
};

// src/engine/nodes/receive/def.ts
var def9 = {
  engineType: "receive",
  palette: [{ key: "receive", label: "Receive Task", category: "Tasks", icon: "\u{1F4E5}", color: "#16a34a", engineType: "receive", defaults: { type: "receive", message: "Msg" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Message", fields: [
    { key: "message", label: "Message name", widget: "assetRef", assetKind: "messages" },
    { key: "implementation", label: "Implementation", widget: "select", options: ["##WebService", "Other"] }
  ] }],
  diagram: { icon: "download", color: "#16a34a", shape: "rectangle" },
  typeLabel: "Receive task"
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
  ] }],
  diagram: { icon: "clock", color: "#7c3aed", shape: "circle" },
  typeLabel: "Catch event"
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
    { key: "event.ref", label: "Compensate activity (optional)", widget: "text", help: "Host node id to compensate; blank = compensate all completed activities" },
    { key: "event.correlationKey", label: "Correlate to", widget: "varRef", varSource: "ownRef", placeholder: "$claimId", help: "Deliver only to the waiting instance whose own correlationKey matches this variable\u2019s value; blank = deliver to every instance waiting on this name" }
  ] }],
  diagram: { icon: "mail", color: "#7c3aed", shape: "circle" },
  typeLabel: "Throw event"
};

// src/engine/nodes/send/def.ts
var def12 = {
  engineType: "send",
  palette: [{ key: "send", label: "Send Task", category: "Tasks", icon: "\u{1F4E4}", color: "#16a34a", engineType: "send", defaults: { type: "send", message: "Msg" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Message", fields: [
    { key: "message", label: "Message name", widget: "assetRef", assetKind: "messages" },
    { key: "implementation", label: "Implementation", widget: "select", options: ["##WebService", "Other"] },
    { key: "correlationKey", label: "Correlate to", widget: "varRef", varSource: "ownRef", placeholder: "$claimId", help: "Deliver only to the waiting instance whose own correlationKey matches this variable\u2019s value; blank = deliver to every instance waiting on this name" }
  ] }],
  diagram: { icon: "upload", color: "#16a34a", shape: "rectangle" },
  typeLabel: "Send task"
};

// src/engine/nodes/call/def.ts
var def13 = {
  engineType: "call",
  palette: [{ key: "call", label: "Call Activity", category: "Sub-process", icon: "\u21E5", color: "#4f46e5", engineType: "call", defaults: { type: "call", process: "" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Called process", fields: [
    { key: "process", label: "Process", widget: "processRef", placeholder: "child-workflow.process", help: "Any process behind a currently active deployment \u2014 in this project or another. Not deployed yet? Deploy it first, or type the id/key now and deploy before running." },
    { key: "inputs", label: "Inputs (childVar \u2190 parentVar)", widget: "keyval", keySource: "called", valueSource: "ownRef", help: `Left = a variable declared on the called process. Right = "$name" to copy one of this process's own variables in, or a literal value.` },
    { key: "outputs", label: "Outputs (parentVar \u2190 childVar)", widget: "keyval", keySource: "own", valueSource: "called", help: "Left = the variable to write on THIS process (pick an existing one to overwrite it, or type a new name). Right = the variable to read from the called process once it completes." },
    { key: "independent", label: "Independent (don\u2019t wait)", widget: "bool", help: "Fire-and-forget: the parent continues immediately and the child keeps running standalone even after the parent completes or aborts" }
  ] }],
  diagram: { icon: "arrowRight", color: "#4f46e5", shape: "rectangle" },
  typeLabel: "Call activity"
};

// src/engine/nodes/for-each/def.ts
var def14 = {
  engineType: "forEach",
  palette: [{ key: "forEach", label: "Multi-Instance", category: "Sub-process", icon: "\u21F6", color: "#4f46e5", engineType: "forEach", defaults: { type: "forEach", process: "", over: "items" } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Multi-instance", fields: [
    { key: "process", label: "Process", widget: "processRef", help: "Run once per item, on any process behind a currently active deployment." },
    { key: "over", label: "Collection variable", widget: "varRef", varSource: "own", placeholder: "applicablePolicies", help: "One of this process's own variables, holding the array to iterate." },
    { key: "as", label: "Item variable", widget: "text", placeholder: "currentPolicy", help: "New variable name on the CHILD process, set to the current item on each run." },
    { key: "collectInto", label: "Collect results into", widget: "varRef", varSource: "own", help: "This process's variable to collect every child's item result into, as an array. Pick an existing one to overwrite, or type a new name." },
    { key: "itemResult", label: "Item result variable", widget: "varRef", varSource: "called", help: 'Which variable on the CHILD process holds its one result \u2014 read back into "Collect results into" above.' },
    { key: "parallel", label: "Run in parallel", widget: "bool" },
    { key: "pass", label: "Pass-through variables", widget: "stringlist", varSource: "own", help: "This process's own variables to copy into every child run unchanged." }
  ] }],
  diagram: { icon: "projects", color: "#4f46e5", shape: "rectangle" },
  typeLabel: "Multi-instance"
};

// src/engine/nodes/subprocess/def.ts
var def15 = {
  engineType: "subprocess",
  palette: [{ key: "subprocess", label: "Sub-process", category: "Sub-process", icon: "\u25AD", color: "#4f46e5", engineType: "subprocess", defaults: { type: "subprocess", nodes: [], flows: [] } }],
  ports: { maxIn: 1, maxOut: 1 },
  schema: [GENERAL, { title: "Sub-process", fields: [
    { key: "transaction", label: "Transaction", widget: "bool" },
    { key: "on.error", label: "Event sub-process on error", widget: "text", help: "Error code that triggers this as an event sub-process" }
  ] }],
  diagram: { icon: "projects", color: "#4f46e5", shape: "rectangle" },
  typeLabel: "Sub-process"
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
  ] }],
  diagram: { icon: "warning", color: "#7c3aed", shape: "circle" },
  typeLabel: "Boundary event"
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
    { key: "params", label: "Parameters (value or $var)", widget: "keyval", valueSource: "ownRef", help: `Right side: "$name" to pass one of this process's own variables, or a literal value.` },
    { key: "resultTo", label: "Map result \u2192 variable", widget: "keyval", keySource: "own", help: "Left = this process's variable to write (pick an existing one to overwrite it, or type a new name), e.g. result \u2190 result, sent \u2190 sent, rows \u2190 rows." }
  ] }],
  diagram: { icon: "admin", color: "#0891b2", shape: "rectangle" },
  typeLabel: "Work item"
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
var CHILD_OUTPUT_MAPPERS = {
  call: mapChildOutputs,
  subprocess: mapChildOutputs2
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

// src/engine/java-compat.ts
function blankStringsAndComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j++;
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else if (c === "/" && c2 === "*") {
      let j = i + 2;
      while (j < n - 1 && !(src[j] === "*" && src[j + 1] === "/")) j++;
      j = Math.min(j + 2, n);
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else if (c === '"' || c === "'") {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        j++;
      }
      j = Math.min(j + 1, n);
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
var DENYLIST = [
  // Reflection that can load/instantiate arbitrary classpath classes or bypass access control. Plain
  // `.getClass()` (e.g. `e.getClass().getName()` in a catch block) is left alone — it's harmless.
  { pattern: /\bClass\.forName\b/, message: "Class.forName is not supported \u2014 arbitrary class loading is blocked for safety" },
  { pattern: /\.setAccessible\s*\(/, message: ".setAccessible(...) is not supported \u2014 bypassing access control is blocked for safety" },
  { pattern: /\bjava\.lang\.reflect\./, message: "java.lang.reflect.* is not supported \u2014 reflection is blocked for safety" },
  // Threading/concurrency: the sidecar is a single persistent process shared by every script
  // execution; a script spawning its own threads (or blocking one) would break the isolation between
  // unrelated, concurrently-queued script runs.
  { pattern: /\bnew\s+Thread\s*\(/, message: "creating a Thread is not supported \u2014 scripts run synchronously in a shared process" },
  { pattern: /\bThread\.(sleep|currentThread)\b/, message: "Thread.sleep/currentThread are not supported \u2014 scripts run synchronously in a shared process" },
  { pattern: /\bsynchronized\b|\bvolatile\b/, message: "synchronized/volatile are not supported \u2014 scripts run synchronously in a shared process" },
  { pattern: /\bExecutors\.|\bExecutorService\b|\bCompletableFuture\b/, message: "thread pools / async execution are not supported \u2014 scripts run synchronously in a shared process" },
  // Filesystem access — a script task has no business reading/writing the host filesystem.
  { pattern: /\bjava\.io\.|\bjava\.nio\.|\bFileInputStream\b|\bFileOutputStream\b|\bFiles\.|\bPaths\.get\b/, message: "file/IO APIs are not supported \u2014 a script task has no filesystem access" },
  // Process control — a script must never spawn OS processes or kill the shared sidecar (which would
  // abort every in-flight script execution across every running process instance, not just its own).
  { pattern: /\bRuntime\.getRuntime\s*\(\s*\)|\bProcessBuilder\b/, message: "spawning OS processes is not supported" },
  { pattern: /\bSystem\.exit\s*\(|\.halt\s*\(/, message: "System.exit/.halt are not supported \u2014 that would kill the shared script runtime for every in-flight process" },
  // Raw network access — use an HTTP/REST task node (audited, retried, timed-out by the engine),
  // not ad-hoc sockets/connections from inside a script.
  { pattern: /\bjava\.net\.|\bHttpURLConnection\b/, message: "raw network access is not supported from a script \u2014 use an HTTP/REST task node instead" }
];
function validateJavaSupport(code) {
  const errors = [];
  const scan = blankStringsAndComments(code);
  for (const { pattern, message } of DENYLIST) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    const m = re.exec(scan);
    if (m) errors.push(typeof message === "function" ? message(m) : message);
  }
  return { errors, warnings: [] };
}

// src/modules/validation/rules.ts
var isStart = (n) => n.type === "start";
var isEnd = (n) => n.type === "end";
var isBoundary = (n) => n.type === "boundary";
var isEventSub = (n) => n.type === "subprocess" && !!n.on && Object.prototype.hasOwnProperty.call(n.on, "error");
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
  const onList2 = (n) => {
    const on = n.on;
    return Array.isArray(on) ? on : on ? [on] : [];
  };
  const boundaryByHost = /* @__PURE__ */ new Map();
  for (const n of nodes) if (isBoundary(n)) {
    for (const host of onList2(n)) (boundaryByHost.get(host) || boundaryByHost.set(host, []).get(host)).push(n);
  }
  const starts = nodes.filter(isStart);
  const ends = nodes.filter(isEnd);
  const reachable = /* @__PURE__ */ new Set();
  const globalCatches = nodes.filter((n) => isBoundary(n) && onList2(n).includes("*"));
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
      if (n.type === "gateway" && n.mode !== "exclusive" && din > 1 && dout > 1) out.push(P("connection-cardinality", "error", `Gateway "${label(n)}" must be diverging (1\u2192many) or converging (many\u21921), not both`, { nodeId: n.id }));
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
  // A node type absent from NODE_DEF_BY_TYPE (chiefly 'raw' — the SDK's escape hatch for a BPMN
  // construct it doesn't structurally understand, e.g. an ad-hoc sub-process or an unrecognized service
  // task implementation) is invisible to every other structural rule here: connection-cardinality and
  // flow-direction both guard on `NODE_DEF_BY_TYPE[n.type]` and silently skip it, and it renders on the
  // canvas with no real configuration surface. Without this rule, importing a real jBPM project with one
  // of these constructs reports "no problems" while actually having silently dropped part of the
  // process's logic — caught by testing real jbpm-playground/businessautomation-cop examples, where an
  // ad-hoc sub-process's entire nested task list disappears into one opaque raw blob with zero warning.
  { id: "unsupported-construct", description: "Every node type must be understood by this engine (not the raw/opaque fallback)", run: (c) => {
    const out = [];
    for (const n of c.nodes) {
      if (!NODE_DEF_BY_TYPE[n.type]) {
        out.push(P("unsupported-construct", "warning", `"${label(n)}" (${n.type}) is a construct this engine doesn't structurally support \u2014 imported as opaque data; it will not execute as intended and needs manual reconstruction`, { nodeId: n.id }));
      }
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
          if (!a.ruleflowGroup && !a.dmn && !a.decisionTree && !a.scorecard && !a.guidedTable) out.push(P("node-config", "error", `Business rule "${label(n)}" references no ruleflow group, DMN decision, guided table, decision tree, or scorecard`, { nodeId: n.id }));
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
        // A throw kind (error/signal/message/escalation) is "selected" the moment its key exists on
        // throw/event — the properties panel writes e.g. `{ signal: '' }` the instant you pick Signal
        // from the dropdown, before you've typed a name. Both end/handler.ts and throw/handler.ts
        // check the NAME truthily (`throw?.signal`, `ev.signal`, etc.), so a blank one is silently a
        // no-op at runtime (an "error end" that just completes normally, a "throw signal" that throws
        // nothing) — the process still runs, just not as configured, with no error anywhere. Catching
        // it here at publish time, the same way the DRL/DMN check above already does, is far safer
        // than a live instance silently completing when the author expects it to fail or broadcast.
        case "end":
        case "throw": {
          const o = (n.type === "end" ? a.throw : a.event) || {};
          const label2 = n.type === "end" ? "End" : "Throw";
          for (const k of ["error", "signal", "message", "escalation"]) {
            if (k in o && !String(o[k] ?? "").trim()) out.push(P("node-config", "error", `${label2} "${label(n)}" is set to throw ${k === "error" ? "an error" : k} but has no ${k === "error" ? "code" : "name"}`, { nodeId: n.id }));
          }
          break;
        }
        // A blank message/signal on a catch falls through catch/handler.ts's if-chain to a
        // condition-wait instead — silently waiting on the wrong thing, forever, rather than the
        // message/signal the author actually picked.
        case "catch": {
          const o = a.event || {};
          for (const k of ["message", "signal"]) {
            if (k in o && !String(o[k] ?? "").trim()) out.push(P("node-config", "error", `Catch "${label(n)}" is set to wait on a ${k} but has no name`, { nodeId: n.id }));
          }
          break;
        }
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
  { id: "condition-lang", description: "Flow conditions must be js or java to execute in the Node runtime", run: (c) => {
    const out = [];
    for (const f of c.flows) if (f.when && f.lang && f.lang !== "js" && f.lang !== "java")
      out.push(P("condition-lang", "warning", `Connection condition is "${f.lang}" and will not evaluate at runtime (use js or java)`, { flowId: f.id }));
    return out;
  } },
  // In BPMN 2.0 and jBPM, Events (start, end, catch, throw, boundary) and Gateways are graphic shapes
  // that are standardly unnamed; only activities, tasks, and sub-processes require meaningful names for clarity.
  { id: "node-name", description: "Nodes should be named", run: (c) => c.nodes.filter((n) => n.type !== "start" && n.type !== "end" && n.type !== "gateway" && n.type !== "catch" && n.type !== "throw" && n.type !== "boundary" && (!n.name || !n.name.trim())).map((n) => P("node-name", "warning", `${n.type} "${n.id}" has no name`, { nodeId: n.id })) },
  // Recurses into subprocess/event-subprocess children itself (unlike the other rules above, which
  // only see the top-level process.nodes/flows) so a Java script buried inside an embedded or event
  // subprocess is checked too, not silently skipped. Two layers, cheapest first: (1) the sync
  // denylist (java-compat.ts) — fast, no network, catches operationally-unsafe constructs; (2) for
  // anything that passes, a real dry compile against the JVM sidecar (java-sidecar.ts) — ground
  // truth for whether the exact script text actually compiles, using the identical wrapper shape
  // execution uses, so this can never drift out of sync with what running the script actually does.
  {
    id: "java-support",
    description: 'lang:"java" scripts and conditions must actually compile and stay inside the supported subset (see docs/bpm-nodes/_scripting-java.md)',
    run: async (c) => {
      const out = [];
      const pending = [];
      const varTypes = {};
      for (const v of c.process.vars || []) if (v.name) varTypes[v.name] = v.type;
      const httpVarTypes = { resPayload: "String", ...varTypes };
      const check = (code, asCondition, types, describe) => {
        const denylist = validateJavaSupport(code);
        for (const msg of denylist.errors) out.push(describe(msg));
        if (denylist.errors.length) return;
        pending.push(validateJava(code, asCondition, types).then((res) => {
          if (!res.ok) out.push(describe(res.error));
        }));
      };
      const walk = (nodes, flows) => {
        for (const n of nodes) {
          const a = n;
          if (n.type === "script" && a.lang === "java" && a.code) {
            check(String(a.code), false, varTypes, (msg) => P("java-support", "error", `Script "${label(n)}": ${msg}`, { nodeId: n.id }));
          }
          if (n.type === "http" && a.lang === "java" && a.exitScript) {
            check(String(a.exitScript), false, httpVarTypes, (msg) => P("java-support", "error", `Exit script "${label(n)}": ${msg}`, { nodeId: n.id }));
          }
          if (n.type !== "http") {
            if (a.onEntry && a.onEntryLang === "java") check(String(a.onEntry), false, varTypes, (msg) => P("java-support", "error", `onEntry "${label(n)}": ${msg}`, { nodeId: n.id }));
            if (a.onExit && a.onExitLang === "java") check(String(a.onExit), false, varTypes, (msg) => P("java-support", "error", `onExit "${label(n)}": ${msg}`, { nodeId: n.id }));
          }
          if (Array.isArray(a.nodes)) walk(a.nodes, a.flows || []);
        }
        for (const f of flows) {
          if (f.when && f.lang === "java") {
            check(f.when, true, varTypes, (msg) => P("java-support", "error", `Connection condition "${f.id}": ${msg}`, { flowId: f.id }));
          }
        }
      };
      walk(c.process.nodes || [], c.process.flows || []);
      await Promise.all(pending);
      return out;
    }
  }
];
async function validateProcess(process2) {
  const ctx = buildCtx(process2);
  const perRule = await Promise.all(RULES.map((r) => r.run(ctx)));
  const problems = perRule.flat();
  const errors = problems.filter((p) => p.severity === "error");
  const warnings = problems.filter((p) => p.severity === "warning");
  return { ok: errors.length === 0, errors, warnings, problems };
}

// src/modules/validation/service.ts
var ValidationService = class {
  validate(process2) {
    return validateProcess(process2);
  }
  async validateProject(project) {
    const results = await Promise.all((project.processes || []).map((p) => validateProcess(p)));
    return {
      ok: results.every((r) => r.ok),
      errors: results.flatMap((r) => r.errors),
      warnings: results.flatMap((r) => r.warnings),
      problems: results.flatMap((r) => r.problems)
    };
  }
  /** Throw VALIDATION_FAILED if the process has errors (used to gate publish/deploy). */
  async assertValid(process2, action = "save") {
    const res = await this.validate(process2);
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
    await new ValidationService().assertValid(proc, "publish");
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
    return await new ValidationService().validate(proc);
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

// src/modules/notifications/service.ts
var NotificationService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  repo() {
    return this.ctx.store.repo(Collections.notifications);
  }
  async notify(n) {
    const rec = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, read: false, at: this.ctx.clock(), ...n };
    await this.repo().put(rec);
    return rec;
  }
  async listFor(userId, q2 = {}) {
    const all = (await this.repo().query((n) => n.tenantId === this.ctx.tenantId && n.userId === userId)).sort((a, b) => a.at < b.at ? 1 : -1);
    const unread = all.filter((n) => !n.read).length;
    const items = (q2.unread ? all.filter((n) => !n.read) : all).slice(0, q2.limit ?? 50);
    return { items, unread };
  }
  async markRead(id, userId) {
    const n = await this.repo().get(id);
    if (!n || n.tenantId !== this.ctx.tenantId || n.userId !== userId) throw notFound("Notification");
    if (!n.read) {
      n.read = true;
      await this.repo().put(n);
    }
    return n;
  }
  async markAllRead(userId) {
    const unread = await this.repo().query((n) => n.tenantId === this.ctx.tenantId && n.userId === userId && !n.read);
    for (const n of unread) {
      n.read = true;
      await this.repo().put(n);
    }
    return { marked: unread.length };
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
  /** Cross-project listing (mirrors InstanceService.list) — powers the top-level Deployments page,
   *  which browses across every project rather than requiring one to be picked first. */
  async list(filter) {
    return (await this.dp().query((d) => d.tenantId === this.ctx.tenantId && (!filter.workflowId || d.workflowId === filter.workflowId) && (!filter.environment || d.environment === filter.environment) && (!filter.status || d.status === filter.status))).sort((a, b) => b.deployedAt.localeCompare(a.deployedAt));
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
    if (actor && actor !== "system") {
      await new NotificationService(this.ctx).notify({
        userId: actor,
        kind: "deployment-succeeded",
        title: `Deployment is live on ${d.environment}`,
        body: d.versionLabel ? `version ${d.versionNumber} (${d.versionLabel})` : `version ${d.versionNumber ?? ""}`.trim(),
        link: `/deployments`,
        deploymentId: d.id
      });
    }
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

// src/engine/nodes/boundary/handler.ts
var ENGINE_ERRORS = [
  "SCRIPT_ERROR",
  "SERVICE_ERROR",
  "RULE_ERROR",
  "RUNTIME_ERROR",
  "CALL_ERROR",
  "CALL_ABORTED",
  "SUBPROCESS_ERROR",
  "SUBPROCESS_ABORTED",
  "MULTIINSTANCE_ERROR"
];
function onList(n) {
  const on = n.on;
  return Array.isArray(on) ? on : typeof on === "string" ? [on] : [];
}
function catchErrorName(n) {
  if (n.type === "boundary") return n.event?.error;
  if (n.type === "subprocess") return n.on?.error;
  return void 0;
}
function isErrorCatch(n) {
  if (n.type === "boundary") {
    const e = n.event;
    return !!e && Object.prototype.hasOwnProperty.call(e, "error");
  }
  if (n.type === "subprocess") return !!n.on && Object.prototype.hasOwnProperty.call(n.on, "error");
  return false;
}
function isCatchAll(n) {
  const e = catchErrorName(n);
  return e === "" || e === "*" || e == null || String(e).toUpperCase() === "ANY";
}
function isGlobalCatch(n) {
  return n.type === "subprocess" || onList(n).includes("*");
}
function globalNameMatches(n, code) {
  const declared = catchErrorName(n);
  if (declared === code) return true;
  const ERR = ENGINE_ERRORS;
  return ERR.includes(code) && declared !== void 0 && !ERR.includes(declared) && code === "SERVICE_ERROR";
}
function findErrorHandler(nodes, failingNodeId, code) {
  const catches = nodes.filter((n) => isErrorCatch(n));
  const onNode = (n) => !isGlobalCatch(n) && onList(n).includes(failingNodeId);
  const globalNamed = (n) => isGlobalCatch(n) && !isCatchAll(n) && globalNameMatches(n, code);
  const globalCatchAll = (n) => isGlobalCatch(n) && isCatchAll(n);
  return catches.find(onNode) || catches.find(globalNamed) || catches.find(globalCatchAll);
}
function boundaryTimerHosts(nodes, hostNodeId) {
  return nodes.filter((b) => b.type === "boundary" && b.event?.timer && onList(b).includes(hostNodeId));
}
function messageBoundaryHosts(nodes, hostNodeId) {
  return nodes.filter((b) => b.type === "boundary" && onList(b).includes(hostNodeId)).flatMap((b) => {
    const ev = b.event || {};
    const name = ev.message || ev.signal || ev.escalation;
    if (!name) return [];
    return [{ node: b, kind: ev.message ? "message" : "signal", name }];
  });
}
function compensationBoundaries(nodes, hostNodeId) {
  return nodes.filter((b) => b.type === "boundary" && b.event?.compensation && onList(b).includes(hostNodeId));
}

// src/engine/execution-engine.ts
var ERROR_VAR = "errorInfo";
var ExecutionEngine = class {
  constructor(ctx, emit4 = () => {
  }, resolveCalled) {
    this.ctx = ctx;
    this.emit = emit4;
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
    await this.ctx.audit({ actor, kind: "instance.started", workflowId: dep.workflowId, deploymentId: dep.id, instanceId: inst.id, data: { processId: inst.processId } });
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
          result = await this.handle(node, inst, p, joins, dep, token.id);
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
          try {
            if (result.wait.kind === "timer" && result.wait.dueAt) await this.scheduleTimer(inst, token.id, node.id, result.wait.dueAt);
            for (const b of boundaryTimerHosts(p.nodes, node.id)) {
              const spec = b.event.timer;
              const cycle = typeof spec === "object" ? spec.cycle : void 0;
              await this.scheduleTimer(inst, token.id, b.id, computeDue(spec, this.ctx.clock()), cycle);
            }
          } catch (e) {
            this.removeToken(inst, token.id);
            const code = e.code === "QUOTA_EXCEEDED" ? "QUOTA_EXCEEDED" : "RUNTIME_ERROR";
            if (this.raiseError(inst, p, node.id, code, e.message)) continue;
            inst.status = "failed";
            inst.error = { nodeId: node.id, message: e.message, at: this.ctx.clock() };
            break;
          }
          for (const b of messageBoundaryHosts(p.nodes, node.id)) {
            inst.tokens.push({ id: this.ctx.newId(), nodeId: b.node.id, state: "waiting", waitFor: { kind: b.kind, ref: b.name }, enteredAt: this.ctx.clock() });
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
        for (const b of compensationBoundaries(p.nodes, node.id)) {
          const target = this.outgoing(p, b.id)[0]?.to;
          if (target) (inst.compensations ||= []).push({ host: node.id, handler: target });
        }
        this.removeHostToken(inst, p, token.id, node.id);
        if (result.end === "complete" || result.consume || inst.status !== "running") {
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
      await this.exitOpenTasks(inst.id);
      await this.abortDescendants(inst.id);
    }
    if (inst.parentInstanceId) {
      if (inst.status === "completed") await this.tryResumeParent(inst);
      else if (inst.status === "aborted" || inst.status === "failed") await this.tryFailParent(inst);
    }
    return inst;
  }
  /** Abort every still-active descendant instance (recursively), cancelling their timers. An
   *  `independent` child (see `Instance.independent`) is skipped — its lifecycle isn't tied to its
   *  parent's, so it keeps running standalone instead of being cascade-torn-down. */
  async abortDescendants(parentId) {
    const children = await this.inst().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === parentId && (c.status === "running" || c.status === "waiting" || c.status === "suspended"));
    for (const child2 of children) {
      if (child2.independent) continue;
      child2.status = "aborted";
      child2.tokens = [];
      child2.endedAt = this.ctx.clock();
      await this.cancelTimersForInstance(child2.id);
      await this.exitOpenTasks(child2.id);
      await this.inst().put(child2);
      this.emit({ kind: "instance.updated", instanceId: child2.id });
      await this.abortDescendants(child2.id);
    }
  }
  /** No instance in a terminal state should leave an actionable task behind — see the callers'
   *  comments for the specific ways a task's host activity can otherwise be cancelled without the
   *  separate Task record ever finding out. 'exited' (jBPM's own term) covers every such case; a
   *  task already completed/skipped/errored (its OWN terminal states) is untouched. */
  async exitOpenTasks(instanceId) {
    const open = await this.ctx.store.repo(Collections.tasks).query((t) => t.tenantId === this.ctx.tenantId && t.instanceId === instanceId && (t.status === "created" || t.status === "reserved" || t.status === "inprogress"));
    for (const t of open) {
      t.status = "exited";
      await this.ctx.store.repo(Collections.tasks).put(t);
    }
  }
  /** Same, scoped to one token — an interrupting boundary cancels only ITS host token, which may be
   *  one of several still-active branches on a parallel gateway; the instance itself stays running,
   *  so exitOpenTasks(instanceId) above (only called once the whole instance settles) would never
   *  reach this task otherwise. */
  async exitOpenTaskForToken(tokenId) {
    const open = await this.ctx.store.repo(Collections.tasks).query((t) => t.tenantId === this.ctx.tenantId && t.tokenId === tokenId && (t.status === "created" || t.status === "reserved" || t.status === "inprogress"));
    for (const t of open) {
      t.status = "exited";
      await this.ctx.store.repo(Collections.tasks).put(t);
    }
  }
  /** Public entry: abort an instance and its whole subtree; also unblock a waiting parent. */
  async abortInstance(inst) {
    if (inst.status === "completed" || inst.status === "aborted") return inst;
    inst.status = "aborted";
    inst.tokens = [];
    inst.endedAt = this.ctx.clock();
    await this.cancelTimersForInstance(inst.id);
    await this.exitOpenTasks(inst.id);
    await this.inst().put(inst);
    this.emit({ kind: "instance.updated", instanceId: inst.id });
    await this.abortDescendants(inst.id);
    if (inst.parentInstanceId) await this.tryFailParent(inst);
    return inst;
  }
  /** A child instance aborted/failed → remove the parent's waiting token and raise an error there
   *  (routes to an error boundary if one is attached, otherwise the parent fails and cascades). */
  async tryFailParent(child2) {
    const parent = await this.inst().get(child2.parentInstanceId);
    if (!parent || parent.status === "completed" || parent.status === "aborted" || parent.status === "failed") return;
    const token = parent.tokens.find((t) => t.state === "waiting" && (t.waitFor?.kind === "child" && t.waitFor?.ref === child2.id || t.waitFor?.kind === "multiInstance" && t.id === child2.parentTokenId));
    if (!token) return;
    const pdep = await this.deps().get(parent.deploymentId);
    if (!pdep) return;
    const p = this.pick(pdep, parent.processId);
    if (token.waitFor?.kind === "multiInstance") {
      await this.settleMultiInstance(parent, pdep, p, token);
      return;
    }
    this.removeToken(parent, token.id);
    const callNode = p.nodes.find((n) => n.id === token.nodeId);
    const prefix = callNode?.type === "call" ? "CALL" : "SUBPROCESS";
    const code = `${prefix}_${child2.status === "aborted" ? "ABORTED" : "ERROR"}`;
    await this.failParentWith(parent, p, pdep, token.nodeId, code, `child instance ${child2.status}: ${child2.id}`);
  }
  /** A child instance completed → map its outputs into the parent and continue the parent flow. */
  async tryResumeParent(child2) {
    const parent = await this.inst().get(child2.parentInstanceId);
    if (!parent) return;
    const token = parent.tokens.find((t) => t.state === "waiting" && (t.waitFor?.kind === "child" && t.waitFor?.ref === child2.id || t.waitFor?.kind === "multiInstance" && t.id === child2.parentTokenId));
    if (!token) return;
    const pdep = await this.deps().get(parent.deploymentId);
    if (!pdep) return;
    const p = this.pick(pdep, parent.processId);
    if (token.waitFor?.kind === "multiInstance") {
      await this.settleMultiInstance(parent, pdep, p, token);
      return;
    }
    const callNode = p.nodes.find((n) => n.id === token.nodeId);
    const mapper = callNode ? CHILD_OUTPUT_MAPPERS[callNode.type] : void 0;
    const vars = mapper ? mapper(callNode, child2) : {};
    await this.resumeToken(parent, pdep, token.id, vars);
  }
  /** Shared terminal-outcome logic for a child settling into a parent's waiting call/subprocess/
   *  multi-instance token: route to an error boundary if one is attached, otherwise fail the parent
   *  and cascade upward — the same either way regardless of which node type raised it. */
  async failParentWith(parent, p, pdep, nodeId, code, message) {
    if (this.raiseError(parent, p, nodeId, code, message)) {
      parent.status = "running";
      await this.runToQuiescence(parent, pdep);
    } else {
      parent.status = "failed";
      parent.error = { nodeId, message, at: this.ctx.clock() };
      parent.endedAt = this.ctx.clock();
      await this.exitOpenTasks(parent.id);
      await this.inst().put(parent);
      this.emit({ kind: "instance.failed", instanceId: parent.id });
      await this.abortDescendants(parent.id);
      if (parent.parentInstanceId) await this.tryFailParent(parent);
    }
  }
  /** One of a multi-instance (forEach) node's children just settled (completed/failed/aborted) —
   *  re-derive the node's full state from ALL its children (found by parentTokenId, not stored on the
   *  token itself — see WaitSpec's 'multiInstance' doc comment) and either: start the next item
   *  (sequential, more items left, nothing failed yet), stay parked (parallel, some still running),
   *  fail the node (any child aborted/failed — real MI default semantics), or resume with the
   *  collected itemResult array (every child completed). */
  async settleMultiInstance(parent, pdep, p, token) {
    const n = p.nodes.find((node) => node.id === token.nodeId);
    if (!n) {
      this.removeToken(parent, token.id);
      return;
    }
    const items = Array.isArray(parent.variables[n.over]) ? parent.variables[n.over] : [];
    let siblings = (await this.inst().query((i) => i.tenantId === this.ctx.tenantId && i.parentInstanceId === parent.id && i.parentTokenId === token.id)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const alreadyFailed = siblings.some((s) => s.status === "failed" || s.status === "aborted");
    if (!n.parallel && !alreadyFailed && siblings.length < items.length && siblings.every((s) => s.status === "completed")) {
      const item = items[siblings.length];
      const childVars = {};
      for (const v of n.pass || []) childVars[v] = parent.variables[v];
      if (n.as) childVars[n.as] = item;
      const resolved = this.resolveCalled ? await this.resolveCalled(n.process) : void 0;
      if (resolved) {
        await this.startChild(resolved.dep, resolved.processId, childVars, parent.startedBy, parent.id, token.id);
        siblings = (await this.inst().query((i) => i.tenantId === this.ctx.tenantId && i.parentInstanceId === parent.id && i.parentTokenId === token.id)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      }
    }
    const result = buildMultiInstanceResult(siblings, items.length, n);
    if (result.wait) return;
    if (result.error) {
      this.removeToken(parent, token.id);
      await this.failParentWith(parent, p, pdep, token.nodeId, result.errorCode || "MULTIINSTANCE_ERROR", result.error);
      return;
    }
    await this.resumeToken(parent, pdep, token.id, result.vars);
  }
  /** Start a child process instance linked to a parent token (call activity). `independent` decouples
   *  the child's lifecycle from the parent's — see the `Instance.independent` doc comment. */
  async startChild(dep, processId, vars, actor, parentInstanceId, parentTokenId, independent) {
    const p = this.pick(dep, processId);
    const startNode = p.nodes.find((n) => n.type === "start") || p.nodes[0];
    const now = this.ctx.clock();
    const seed = {};
    for (const v of p.vars || []) seed[v.name] = void 0;
    const child2 = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      deploymentId: dep.id,
      workflowId: dep.workflowId,
      processId: p.id,
      status: "running",
      variables: { ...seed, ...vars },
      tokens: [{ id: this.ctx.newId(), nodeId: startNode.id, state: "active", enteredAt: now }],
      history: [],
      startedAt: now,
      startedBy: actor,
      parentInstanceId,
      parentTokenId,
      ...independent ? { independent: true } : {}
    };
    this.emit({ kind: "instance.started", instanceId: child2.id });
    return this.runToQuiescence(child2, dep);
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
        res = await this.handle(handler17, inst, p, {}, dep, "compensation");
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
  /** Broadcast a signal/message to every waiting instance in the tenant (send/throw/end-throw), and
   *  also start a fresh instance of any deployed process whose start event listens for this exact
   *  name — the process-level counterpart to a mid-flow catch/boundary (real jBPM's signal-start /
   *  message-start event). `correlationValue`, when the thrower declares one (see `EventDef.
   *  correlationKey` — a $var reference resolved on the throwing side), narrows delivery to only the
   *  instance(s) whose OWN `correlationKey` (set at `start()`) matches — otherwise EVERY instance
   *  waiting on that name resumes, which is wrong the moment more than one instance of the same
   *  process is waiting on the same message type at once (e.g. N claims all waiting on
   *  "PaymentReceived" — without this, one payment webhook would incorrectly resume all N). Signal/
   *  message-START events are never correlation-scoped: a brand-new instance has no correlationKey
   *  yet to match against. */
  async broadcast(name, correlationValue) {
    const others = await this.inst().query((i) => i.tenantId === this.ctx.tenantId && (i.status === "waiting" || i.status === "running"));
    for (const other of others) {
      if (correlationValue !== void 0 && other.correlationKey !== correlationValue) continue;
      const hit = other.tokens.some((t) => t.state === "waiting" && (t.waitFor?.kind === "signal" || t.waitFor?.kind === "message") && t.waitFor?.ref === name);
      if (!hit) continue;
      const dep = await this.deps().get(other.deploymentId);
      if (dep) await this.signalInstance(other, dep, name);
    }
    if (correlationValue === void 0) await this.startTriggeredProcesses(name);
  }
  /** Signal/message-start events: begin a new instance of every active deployment's process whose
   *  start node's `on.signal`/`on.message` matches `name`. */
  async startTriggeredProcesses(name) {
    const active = await this.deps().query((d) => d.tenantId === this.ctx.tenantId && d.status === "active");
    for (const dep of active) {
      for (const p of dep.engine?.processes || []) {
        const startNode = p.nodes.find((n) => n.type === "start");
        const on = startNode?.on;
        const kind = on?.signal === name ? "signal" : on?.message === name ? "message" : void 0;
        if (kind) await this.start(dep, {}, kind, { processId: p.id });
      }
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
  /** Deliver a signal to ONE specific instance by id — matches real jBPM's targeted
   *  kcontext.getKieRuntime().signalEvent(type, event, processInstanceId), as opposed to broadcast()'s
   *  session-wide delivery. A no-op (not an error) if the id doesn't resolve within this tenant —
   *  matches how a script/condition kcontext call has no result to fail loudly against.
   *
   *  Self-targeted (the calling instance signaling itself) is special-cased to mutate `callerInst`
   *  directly rather than re-fetching by id: the store's `.get()` returns whatever was last `.put()`,
   *  a SEPARATE object from the one `runToQuiescence`'s loop is actively stepping through in memory.
   *  Mutating a fresh fetch would get silently overwritten when the loop persists its own reference
   *  at the end of its own processing — confirmed by a real test failure before this fix existed. */
  async signalTargeted(callerInst, callerDep, targetInstanceId, name, payload) {
    if (targetInstanceId === callerInst.id) {
      await this.signalInstance(callerInst, callerDep, name, payload);
      return;
    }
    const target = await this.inst().get(targetInstanceId);
    if (!target || target.tenantId !== this.ctx.tenantId) return;
    const dep = await this.deps().get(target.deploymentId);
    if (dep) await this.signalInstance(target, dep, name, payload);
  }
  /** Abort ONE specific instance by id — matches real jBPM's kcontext.getKieRuntime().
   *  abortProcessInstance(id). Reuses the same public abortInstance() the REST abort endpoint already
   *  uses (aborts the whole subtree, cancels timers), so a script-triggered abort behaves identically
   *  to an operator-triggered one. A no-op if the id doesn't resolve within this tenant. Self-targeted
   *  case: see signalTargeted's comment — same reasoning, same fix. */
  async abortTargeted(callerInst, targetInstanceId) {
    if (targetInstanceId === callerInst.id) {
      await this.abortInstance(callerInst);
      return;
    }
    const target = await this.inst().get(targetInstanceId);
    if (target && target.tenantId === this.ctx.tenantId) await this.abortInstance(target);
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
  /** Remove a host token AND any sibling message/signal/escalation boundary tokens still waiting on
   *  it (see messageBoundaryHosts) — those are real entries in inst.tokens (unlike a timer boundary's
   *  wait, which lives in a separate TimerJob record already cleaned up via cancelTimersForToken), so
   *  leaving one behind after its host is gone for ANY reason — normal completion, a DIFFERENT
   *  boundary interrupting it, direct resumption — would permanently block the instance from ever
   *  settling out of 'waiting' (see runToQuiescence's settle check). */
  removeHostToken(inst, p, hostTokenId, hostNodeId) {
    this.removeToken(inst, hostTokenId);
    const boundaryIds = new Set(messageBoundaryHosts(p.nodes, hostNodeId).map((b) => b.node.id));
    if (boundaryIds.size) inst.tokens = inst.tokens.filter((t) => !(t.state === "waiting" && boundaryIds.has(t.nodeId)));
  }
  // ---- timers ----
  timerRepo() {
    return this.ctx.store.repo(Collections.timers);
  }
  /** `cycle` (boundary timers only — see call site) lets TimerService reschedule this job for its next
   *  occurrence after firing, instead of the one-shot behavior every other timer kind wants. */
  async scheduleTimer(inst, tokenId, nodeId, dueAt, cycle) {
    const { maxActiveTimers } = await new SettingsService(this.ctx).get();
    if (maxActiveTimers) {
      const active = await this.timerRepo().query((t) => t.tenantId === this.ctx.tenantId && t.status === "scheduled");
      if (active.length >= maxActiveTimers) {
        throw quotaExceeded(`per-tenant active-timer quota exceeded (max ${maxActiveTimers})`, { quota: "maxActiveTimers", max: maxActiveTimers, current: active.length });
      }
    }
    await this.timerRepo().put({ id: this.ctx.newId(), tenantId: this.ctx.tenantId, instanceId: inst.id, tokenId, nodeId, kind: "duration", dueAt, cycle, fired: 0, status: "scheduled" });
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
  /** Event-Based Gateway race: `resolvedNodeId` just resolved its wait (timer/message/signal fired) —
   *  if it's reached directly (single incoming flow) from a `mode:'event'` gateway, every OTHER branch
   *  forked from that same gateway loses the race — cancel their still-waiting tokens (and any timer
   *  jobs backing them) so they never also fire. Structural match by node id, like boundaryTimerHosts;
   *  doesn't disambiguate concurrent activations of the same event gateway (e.g. inside a loop), same
   *  simplification the join-count logic elsewhere in this engine already accepts. */
  async cancelEventGatewaySiblings(inst, p, resolvedNodeId) {
    const incoming = this.incoming(p, resolvedNodeId);
    if (incoming.length !== 1) return;
    const gateway = this.nodeMap(p).get(incoming[0].from);
    if (!gateway || gateway.type !== "gateway" || gateway.mode !== "event") return;
    const siblingTargets = new Set(this.outgoing(p, gateway.id).map((f) => f.to));
    siblingTargets.delete(resolvedNodeId);
    for (const s of inst.tokens.filter((t) => t.state === "waiting" && siblingTargets.has(t.nodeId))) {
      await this.cancelTimersForToken(inst, s.id);
      this.removeToken(inst, s.id);
    }
  }
  /** Fire a due timer job: boundary timer → activate the boundary; else resume the (catch) token.
   *  Public — called externally from modules/instances/service.ts's timer-poll path. */
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
      this.removeHostToken(inst, this.proc(inst, dep), hostTokenId, host.nodeId);
      await this.cancelTimersForToken(inst, hostTokenId);
      await this.exitOpenTaskForToken(hostTokenId);
    }
    inst.tokens.push({ id: this.ctx.newId(), nodeId: boundary.id, state: "active", enteredAt: this.ctx.clock() });
    inst.status = "running";
    this.emit({ kind: "node.entered", instanceId: inst.id, nodeId: boundary.id, tokenId: inst.tokens.at(-1).id });
    return this.runToQuiescence(inst, dep);
  }
  /** A message/signal/escalation boundary's own waiting token resolved (see messageBoundaryHosts) —
   *  same "interrupting cancels the host, then run the recovery flow" as fireBoundary, just resolved
   *  via broadcast()/resumeToken() instead of a fired TimerJob, so the host has to be found by its
   *  current waiting token rather than passed in directly (that's still the SAME host token id
   *  fireBoundary takes; this just discovers it a different way). */
  async fireMessageBoundary(inst, dep, boundary, boundaryTokenId) {
    this.removeToken(inst, boundaryTokenId);
    const p = this.proc(inst, dep);
    const hostIds = onList(boundary);
    const host = inst.tokens.find((t) => t.state === "waiting" && hostIds.includes(t.nodeId));
    if (host && boundary.interrupting !== false) {
      this.removeHostToken(inst, p, host.id, host.nodeId);
      await this.cancelTimersForToken(inst, host.id);
      await this.exitOpenTaskForToken(host.id);
    }
    for (const t of this.defaultTargets(p, boundary, inst)) inst.tokens.push({ id: this.ctx.newId(), nodeId: t, state: "active", enteredAt: this.ctx.clock() });
    inst.status = "running";
    return this.runToQuiescence(inst, dep);
  }
  // ---- error handling: route a raised error to a matching error-catch (boundary, or an event
  // sub-process with an error start — jBPM's other common "global error handler" idiom) ----
  // WHICH node matches (isErrorCatch/catchErrorName/isGlobalCatch/isCatchAll/globalNameMatches/
  // findErrorHandler) is nodes/boundary/handler.ts's decision — see its own doc comment for the full
  // "why" (jBPM error-code naming vs. this runtime's fixed ENGINE_ERRORS vocabulary). Only the
  // orchestration that ACTS on a match (mutating instance/token state) stays here.
  /** Route an error to a matching error-catch; returns true if handled (a handler token was spawned). */
  raiseError(inst, p, failingNodeId, code, message) {
    const handler17 = findErrorHandler(p.nodes, failingNodeId, code);
    if (!handler17) return false;
    inst.variables[ERROR_VAR] = { code, node: failingNodeId, message };
    if (isGlobalCatch(handler17)) inst.tokens = [];
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
  buildCtx(node, inst, p, joins, dep, tokenId) {
    return {
      node,
      inst,
      proc: p,
      dep,
      app: this.ctx,
      joins,
      tokenId,
      outgoing: (id) => this.outgoing(p, id),
      incoming: (id) => this.incoming(p, id),
      emit: (e) => this.emit(e),
      startChild: (d, pid, vars, tok, independent) => this.startChild(d, pid, vars, inst.startedBy, inst.id, tok, independent),
      broadcast: (name, correlationValue) => this.broadcast(name, correlationValue),
      signal: (targetInstanceId, name, payload) => this.signalTargeted(inst, dep, targetInstanceId, name, payload),
      abort: (targetInstanceId) => this.abortTargeted(inst, targetInstanceId),
      compensate: (ref2) => this.compensate(inst, p, dep, ref2),
      resolveCalled: this.resolveCalled
    };
  }
  /** Real jBPM's generic onEntry-script/onExit-script action hooks (see bpmn-sdk's `WithLifecycle`) —
   *  any activity node type may carry `onEntry`/`onExit` (+ `onEntryLang`/`onExitLang`), executed with
   *  the exact same kcontext/vars/instance/node/meta-locals surface a script node gets (varTypesOf/
   *  kcontextInfoOf/onActionOf — see kcontext-info.ts). Mutates `inst.variables` directly (no merge
   *  step needed — same object reference `runScript` writes through). Returns an error message on
   *  failure, undefined on success; never throws (caller decides how to route the failure). */
  async runLifecycle(node, kind, c) {
    const text = node[kind];
    if (!text) return void 0;
    const lang = node[`${kind}Lang`];
    try {
      await runScript(text, c.inst.variables, config.scriptTimeoutMs, {
        ...kcontextInfoOf(c),
        lang,
        varTypes: varTypesOf(c),
        onAction: onActionOf(c)
      });
      return void 0;
    } catch (e) {
      return `${kind} failed: ${e.message}`;
    }
  }
  async handle(node, inst, p, joins, dep, tokenId) {
    const h = NODE_HANDLERS[node.type];
    if (!h) return {};
    const c = this.buildCtx(node, inst, p, joins, dep, tokenId);
    const entryErr = await this.runLifecycle(node, "onEntry", c);
    if (entryErr) return { error: entryErr, errorCode: "SCRIPT_ERROR" };
    const result = await h(c);
    if (!result.wait && !result.error) {
      const exitErr = await this.runLifecycle(node, "onExit", c);
      if (exitErr) return { ...result, error: exitErr, errorCode: "SCRIPT_ERROR" };
    }
    return result;
  }
  // ---- resume (wait states) ----
  /** Complete a wait node (task/timer/message/signal) and continue the instance. */
  async resumeToken(inst, dep, tokenId, vars) {
    if (inst.status === "suspended") throw conflict("instance is suspended");
    const token = inst.tokens.find((t) => t.id === tokenId);
    if (!token || token.state !== "waiting") throw conflict("token is not waiting");
    if (vars) Object.assign(inst.variables, vars);
    await this.cancelTimersForToken(inst, tokenId);
    const p = this.proc(inst, dep);
    const node = this.nodeMap(p).get(token.nodeId);
    if (node?.type === "boundary") return this.fireMessageBoundary(inst, dep, node, tokenId);
    if (node) this.removeHostToken(inst, p, tokenId, node.id);
    else this.removeToken(inst, tokenId);
    if (node) await this.cancelEventGatewaySiblings(inst, p, node.id);
    if (node && node.onExit) {
      const c = this.buildCtx(node, inst, p, {}, dep, tokenId);
      const exitErr = await this.runLifecycle(node, "onExit", c);
      if (exitErr) {
        if (!this.raiseError(inst, p, node.id, "SCRIPT_ERROR", exitErr)) {
          inst.status = "failed";
          inst.error = { nodeId: node.id, message: exitErr, at: this.ctx.clock() };
          return this.runToQuiescence(inst, dep);
        }
        inst.status = "running";
        return this.runToQuiescence(inst, dep);
      }
    }
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

// src/modules/errors/service.ts
var ErrorService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  repo() {
    return this.ctx.store.repo(Collections.errors);
  }
  /**
   * Record a failure. Identical (instanceId, nodeId, message) triples increment `occurrences` on the
   * existing row instead of appending a new one — a node retried 40 times should be one line in the
   * operator's queue, not forty.
   */
  async record(e) {
    const existing = (await this.repo().query(
      (x) => x.instanceId === e.instanceId && x.nodeId === e.nodeId && x.message === e.message && !x.acknowledged
    ))[0];
    if (existing) {
      existing.occurrences += 1;
      existing.at = this.ctx.clock();
      await this.repo().put(existing);
      return existing;
    }
    const rec = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      at: this.ctx.clock(),
      occurrences: 1,
      acknowledged: false,
      ...e
    };
    await this.repo().put(rec);
    await this.ctx.audit({
      actor: "system",
      kind: "error.recorded",
      instanceId: e.instanceId,
      nodeId: e.nodeId,
      data: { type: e.type, message: e.message }
    });
    return rec;
  }
  async list(q2 = {}) {
    const all = await this.repo().query((e) => {
      if (q2.type?.length && !q2.type.includes(e.type)) return false;
      if (q2.instanceId && e.instanceId !== q2.instanceId) return false;
      if (q2.taskId && e.taskId !== q2.taskId) return false;
      if (q2.jobId && e.jobId !== q2.jobId) return false;
      if (q2.workflowId && e.workflowId !== q2.workflowId) return false;
      if (q2.processId && e.processId !== q2.processId) return false;
      if (q2.nodeId && e.nodeId !== q2.nodeId) return false;
      if (q2.acknowledged !== void 0 && e.acknowledged !== q2.acknowledged) return false;
      if (q2.from && e.at < q2.from) return false;
      if (q2.to && e.at > q2.to) return false;
      return true;
    });
    all.sort((a, b) => a.at < b.at ? 1 : -1);
    const offset = q2.offset ?? 0;
    const limit = q2.limit ?? 20;
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
  async get(id) {
    const e = await this.repo().get(id);
    if (!e) throw notFound("ExecutionError");
    return e;
  }
  /** Take ownership. Idempotent — re-acknowledging keeps the original actor/timestamp. */
  async acknowledge(id, actor) {
    const e = await this.get(id);
    if (e.acknowledged) return e;
    e.acknowledged = true;
    e.acknowledgedBy = actor;
    e.acknowledgedAt = this.ctx.clock();
    await this.repo().put(e);
    await this.ctx.audit({ actor, kind: "error.acknowledged", instanceId: e.instanceId, data: { errorId: id } });
    return e;
  }
  async acknowledgeMany(ids, actor) {
    const out = [];
    for (const id of ids) {
      try {
        await this.acknowledge(id, actor);
        out.push({ id, ok: true });
      } catch (err) {
        out.push({ id, ok: false, reason: err.message });
      }
    }
    return out;
  }
  /** Counts for the nav badge and the Home KPI tile. */
  async summary() {
    const all = await this.repo().query(() => true);
    const dayAgo = new Date(Date.parse(this.ctx.clock()) - 864e5).toISOString();
    return {
      total: all.length,
      unacknowledged: all.filter((e) => !e.acknowledged).length,
      last24h: all.filter((e) => e.at >= dayAgo).length
    };
  }
};

// src/modules/instances/service.ts
function makeResolveCalled(ctx) {
  return async (processId) => {
    const deps = await ctx.store.repo(Collections.deployments).query((d) => d.tenantId === ctx.tenantId && d.status === "active");
    for (const dep of deps) {
      const p = (dep.engine?.processes || []).find((x) => x.id === processId);
      if (p) return { dep, processId: p.id };
    }
    return void 0;
  };
}
var InstanceService = class {
  constructor(ctx, emit4 = () => {
  }) {
    this.ctx = ctx;
    this.deployments = new DeploymentService(ctx);
    this.engine = new ExecutionEngine(ctx, emit4, makeResolveCalled(ctx));
  }
  ctx;
  engine;
  deployments;
  repo() {
    return this.ctx.store.repo(Collections.instances);
  }
  /** SystemSettings.maxActiveInstances (0/undefined = unlimited) caps how many TOP-LEVEL (root)
   *  instances this tenant may have running/waiting at once — child/subprocess instances aren't
   *  independently gated since they aren't independently "started" via this API either; they're a
   *  direct consequence of a parent that already passed this same check. */
  async assertInstanceQuota() {
    const { maxActiveInstances } = await new SettingsService(this.ctx).get();
    if (!maxActiveInstances) return;
    const active = await this.repo().query((i) => i.tenantId === this.ctx.tenantId && !i.parentInstanceId && (i.status === "running" || i.status === "waiting"));
    if (active.length >= maxActiveInstances) {
      throw quotaExceeded(`per-tenant active-instance quota exceeded (max ${maxActiveInstances})`, { quota: "maxActiveInstances", max: maxActiveInstances, current: active.length });
    }
  }
  /** Every engine entry point funnels through here on the way out: a run that ended in `failed`
   *  lands one row in the Execution Errors queue (deduped by ErrorService.record) and a bell
   *  notification for whoever started the instance. */
  async recordIfFailed(inst) {
    if (inst.status !== "failed" || !inst.error) return inst;
    const dep = await this.ctx.store.repo(Collections.deployments).get(inst.deploymentId);
    const proc = (dep?.engine.processes || []).find((p) => p.id === inst.processId) || dep?.engine.processes?.[0];
    const node = proc?.nodes?.find((n) => n.id === inst.error.nodeId);
    const rec = await new ErrorService(this.ctx).record({
      type: "process",
      instanceId: inst.id,
      workflowId: inst.workflowId,
      deploymentId: inst.deploymentId,
      processId: inst.processId,
      nodeId: inst.error.nodeId || void 0,
      nodeName: node?.name,
      nodeType: node?.type,
      message: inst.error.message,
      stack: inst.error.stack
    });
    if (rec.occurrences === 1 && inst.startedBy && inst.startedBy !== "system" && inst.startedBy !== "timer") {
      await new NotificationService(this.ctx).notify({
        userId: inst.startedBy,
        kind: "instance-failed",
        title: `Instance ${inst.id} failed`,
        body: inst.error.message,
        link: `/instances/${inst.id}`,
        instanceId: inst.id
      });
    }
    return inst;
  }
  async start(input, actor) {
    let dep;
    if (input.deploymentId) dep = await this.deployments.get(input.deploymentId);
    else dep = await this.deployments.resolveActive(input.workflowId, input.environment || "prod");
    if (dep.status === "archived") throw conflict("cannot start on an archived deployment");
    await this.assertInstanceQuota();
    return this.recordIfFailed(await this.engine.start(dep, input.variables || {}, actor, { processId: input.processId, correlationKey: input.correlationKey }));
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
    return this.recordIfFailed(await this.engine.resumeToken(inst, dep, tokenId, vars));
  }
  /** Fire a due timer job (catch timer → resume; boundary timer → activate the boundary). */
  async fireTimer(job) {
    const inst = await this.get(job.instanceId);
    const dep = await this.deployments.get(inst.deploymentId);
    return this.recordIfFailed(await this.engine.fireTimerJob(inst, dep, job.nodeId, job.tokenId));
  }
  /** Fire a due start-timer/cron job → begin a new instance on the scheduled deployment+process. */
  async startScheduled(job) {
    const dep = await this.deployments.get(job.deploymentId);
    if (dep.status !== "active") throw conflict("scheduled deployment is no longer active");
    await this.assertInstanceQuota();
    return this.recordIfFailed(await this.engine.start(dep, {}, "timer", { processId: job.processId }));
  }
  async abort(id, actor) {
    const i = await this.get(id);
    if (i.status === "completed" || i.status === "aborted") return i;
    const aborted = await this.engine.abortInstance(i);
    await this.ctx.audit({ actor, kind: "instance.aborted", workflowId: i.workflowId, instanceId: i.id });
    return aborted;
  }
  /** Deliver a signal/message to a running instance (resumes matching waiting tokens). Blocked on a
   *  terminal instance — there's nothing left to resume, and silently no-op'ing behind a success toast
   *  would just mislead the caller into thinking the signal did something. Also blocked on `suspended`
   *  ("a paused tree does no work — tasks/signals/timers on it are refused until resume", per suspend()'s
   *  own doc comment below) and `failed` (an unhandled error already removed the waiting token, so
   *  there's nothing left for a signal to resume either — retryFailedNode is the real recovery path). */
  async signal(id, name, payload, actor) {
    const inst = await this.get(id);
    if (inst.status === "completed" || inst.status === "aborted") throw conflict(`instance is ${inst.status}; cannot signal a terminal instance`);
    if (inst.status === "suspended") throw conflict("instance is suspended; resume it before signaling");
    if (inst.status === "failed") throw conflict("instance is failed; retry the failed node instead of signaling");
    const dep = await this.deployments.get(inst.deploymentId);
    await this.ctx.audit({ actor, kind: "instance.signaled", workflowId: inst.workflowId, instanceId: id, data: { name } });
    return this.recordIfFailed(await this.engine.signalInstance(inst, dep, name, payload));
  }
  /** Re-trigger a node (retry a failed node, or replay a node) and continue the flow. Blocked on a
   *  terminal instance — same "completed/aborted is read-only" rule as updateVariables() above; unlike
   *  that check, this one is load-bearing: the engine's retryNode() has no defensive check of its own
   *  and will happily push a fresh active token onto a completed instance, flip it back to 'running',
   *  and resume execution — silently resurrecting a finished process instead of erroring. Also blocked
   *  on `suspended` — same resurrection risk (retryNode forces status back to 'running', bypassing the
   *  whole point of a pause) — the instance must be resumed first. */
  async retry(id, nodeId, actor) {
    const inst = await this.get(id);
    if (inst.status === "completed" || inst.status === "aborted") throw conflict(`instance is ${inst.status}; cannot retry a terminal instance`);
    if (inst.status === "suspended") throw conflict("instance is suspended; resume it before retrying a node");
    const dep = await this.deployments.get(inst.deploymentId);
    await this.ctx.audit({ actor, kind: "instance.node.retriggered", workflowId: inst.workflowId, instanceId: id, nodeId });
    return this.recordIfFailed(await this.engine.retryNode(inst, dep, nodeId));
  }
  /** Parent + child instances (call activities) for related-instance navigation. */
  async related(id) {
    const inst = await this.get(id);
    const parent = inst.parentInstanceId ? await this.repo().get(inst.parentInstanceId) || null : null;
    const children = await this.repo().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === id);
    return { instance: inst, parent, children };
  }
  /** Every descendant of `rootId` at ANY depth (call activities, embedded/event sub-processes,
   *  multi-instance children, recursively) — the root itself plus every instance reachable by
   *  following `parentInstanceId` down. Read-only; includes terminal instances by default so
   *  callers get the full historical case tree. */
  async descendants(rootId, opts = {}) {
    const includeTerminal = opts.includeTerminal ?? true;
    const root = await this.get(rootId);
    const out = [root];
    const walk = async (parentId) => {
      const children = await this.repo().query((c) => c.tenantId === this.ctx.tenantId && c.parentInstanceId === parentId && (includeTerminal || c.status === "running" || c.status === "waiting" || c.status === "suspended"));
      for (const child2 of children) {
        out.push(child2);
        await walk(child2.id);
      }
    };
    await walk(rootId);
    return out;
  }
  /** Suspend pauses the WHOLE subtree: the instance and every active descendant (call activities /
   *  sub-processes). A paused tree does no work — tasks/signals/timers on it are refused until resume.
   *  Only a running/waiting instance can be suspended — there's nothing to pause on a terminal instance,
   *  and a 'failed' instance has no active/waiting token either (the failure already removed it), so
   *  "suspending" it would silently do nothing; reject up front instead of a no-op with no feedback. */
  async suspend(id, actor) {
    const i = await this.get(id);
    if (i.status !== "running" && i.status !== "waiting") throw conflict(`instance is ${i.status}; only a running or waiting instance can be suspended`);
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
  /** Resume restores the whole paused subtree to running/waiting. Only a suspended instance can be
   *  resumed — mirrors suspend()'s own guard above. */
  async resumeInstance(id, actor) {
    const i = await this.get(id);
    if (i.status !== "suspended") throw conflict(`instance is ${i.status}; only a suspended instance can be resumed`);
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
  /** Inline edit from the Variables tab. Each write lands in the audit trail with before/after
   *  values, which is exactly what variableHistory() reads back — no separate history table. */
  async updateVariables(id, patch, actor) {
    const i = await this.get(id);
    if (i.status === "completed" || i.status === "aborted") throw conflict(`instance is ${i.status}; variables are read-only`);
    if (i.status === "suspended") throw conflict("instance is suspended; variables are read-only until resumed");
    if ((i.status === "running" || i.status === "waiting") && !(await new SettingsService(this.ctx).get()).allowRunningVariableEdits) {
      throw conflict("editing variables on a running/waiting instance is disabled by system settings; suspend it first");
    }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw validation("expected an object of variable name \u2192 value");
    const changes = Object.entries(patch).filter(([k, v]) => JSON.stringify(i.variables[k]) !== JSON.stringify(v)).map(([k, v]) => ({ name: k, from: i.variables[k], to: v }));
    if (!changes.length) return i;
    for (const c of changes) i.variables[c.name] = c.to;
    await this.repo().put(i);
    await this.ctx.audit({ actor, kind: "instance.variables.updated", workflowId: i.workflowId, instanceId: id, data: { changes } });
    return i;
  }
  /** Per-variable change history for the Variables tab, newest first (optionally one variable). */
  async variableHistory(id, name) {
    await this.get(id);
    const events = await this.ctx.store.repo(Collections.audit).query((e) => e.tenantId === this.ctx.tenantId && e.instanceId === id && e.kind === "instance.variables.updated");
    const out = [];
    for (const e of events) {
      for (const c of e.data?.changes || []) {
        if (!name || c.name === name) out.push({ ...c, at: e.at, actor: e.actor });
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
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
  constructor(ctx, emit4 = () => {
  }) {
    this.ctx = ctx;
    this.instances = new InstanceService(ctx, emit4);
  }
  ctx;
  instances;
  repo() {
    return this.ctx.store.repo(Collections.tasks);
  }
  async lookupUser(username) {
    return (await this.ctx.store.repo(Collections.users).query((u) => u.tenantId === this.ctx.tenantId && u.username === username))[0];
  }
  /** Segregation of duties + group membership: excludedOwners can never act on this task; businessAdmin
   *  always can. If the task has a `group` and the caller resolves to a REAL registered User (via
   *  lookupUser), they must be a member of that group — or already be the assignee — to act on it.
   *  This check only activates for real IAM-provisioned accounts: a caller whose username isn't a
   *  registered User (any pre-IAM actor string, e.g. everywhere in this engine's own test suite) is
   *  unaffected, so adding real IAM enforcement here doesn't retroactively break every caller that
   *  predates user provisioning. */
  async assertOwnable(t, user) {
    if (t.businessAdmin === user) return;
    if (t.excludedOwners?.includes(user)) throw forbidden(`${user} is excluded from this task`);
    if (!t.group || t.assignee === user) return;
    const actingUser = await this.lookupUser(user);
    if (actingUser && !actingUser.groups.includes(t.group)) throw forbidden(`${user} is not a member of group "${t.group}"`);
  }
  /** Every task action ultimately depends on its instance still being able to accept a resume — even
   *  ones with no direct engine effect (claim, save, delegate, remind, priority edits) are pointless or
   *  actively misleading once the instance is gone (why claim/work/get reminded about a task whose
   *  process aborted, completed via another path, or already failed?). Was previously only checked
   *  inside complete()/skip(); every other action here let a task on a dead instance stay fully
   *  actionable right up until the wall at complete()/skip() — see the audit that flagged this. Missing
   *  instance (already pruned) is left unblocked, matching complete()/skip()'s existing behavior below. */
  async assertInstanceActionable(t) {
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    if (!inst) return;
    if (inst.status === "suspended") throw conflict("instance is suspended");
    if (inst.status === "aborted" || inst.status === "completed" || inst.status === "failed") throw conflict(`instance is ${inst.status}`);
  }
  async get(id) {
    const t = await this.repo().get(id);
    if (!t || t.tenantId !== this.ctx.tenantId) throw notFound("Task");
    return t;
  }
  async list(filter) {
    const now = this.ctx.clock();
    return (await this.repo().query((t) => t.tenantId === this.ctx.tenantId && (!filter.assignee || t.assignee === filter.assignee) && (!filter.group || t.group === filter.group) && (!filter.status || t.status === filter.status) && (!filter.overdue || !!t.dueAt && t.dueAt < now && t.status !== "completed" && t.status !== "skipped"))).sort((a, b) => (b.priority ?? -Infinity) - (a.priority ?? -Infinity) || b.createdAt.localeCompare(a.createdAt));
  }
  async claim(id, user) {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    await this.assertInstanceActionable(t);
    if (t.status !== "created" && t.status !== "reserved") throw conflict("task not claimable");
    t.assignee = user;
    t.status = "reserved";
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.claimed", instanceId: t.instanceId, taskId: t.id });
    return t;
  }
  async release(id, user) {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    t.assignee = void 0;
    t.status = "created";
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.released", instanceId: t.instanceId, taskId: t.id });
    return t;
  }
  /** userTask.outputs declares processVar ← taskVar (see engine/nodes/user-task/def.ts's schema) —
   *  translate the completer's raw submission through it before it reaches instance.variables. Keys
   *  not covered by the mapping still pass through as-is, so a node with no (or a partial) `outputs`
   *  mapping keeps today's direct-passthrough behavior; only declared mappings get renamed. */
  mapTaskOutputs(node, outputs) {
    const mapping = node?.outputs;
    if (!mapping || typeof mapping !== "object" || !Object.keys(mapping).length) return outputs;
    const mapped = { ...outputs };
    for (const [processVar, taskVar] of Object.entries(mapping)) {
      if (typeof taskVar === "string" && taskVar in outputs) mapped[processVar] = outputs[taskVar];
    }
    return mapped;
  }
  async complete(id, outputs, user) {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    if (t.status === "completed") throw conflict("task already completed");
    await this.assertInstanceActionable(t);
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    let mappedOutputs = outputs;
    if (inst) {
      const dep = await this.ctx.store.repo(Collections.deployments).get(inst.deploymentId);
      const proc = (dep?.engine.processes || []).find((p) => p.id === inst.processId) || dep?.engine.processes?.[0];
      const node = proc?.nodes.find((n) => n.id === t.nodeId);
      mappedOutputs = this.mapTaskOutputs(node, outputs);
    }
    t.status = "completed";
    t.outputs = outputs;
    t.completedAt = this.ctx.clock();
    t.completedBy = user;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.completed", instanceId: t.instanceId, taskId: t.id, nodeId: t.nodeId });
    await this.instances.resume(t.instanceId, t.tokenId, mappedOutputs);
    return t;
  }
  /** Skip a task without completing it — real jBPM's TaskService.skip(): the instance continues past
   *  it with no output data mapped, only allowed when the node itself is declared `skippable: true`
   *  (this engine enforces that at the API layer; the node's own runtime handler has nothing to do
   *  with skip — it's purely a task-lifecycle shortcut around the normal complete() path). */
  async skip(id, user) {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    if (t.status === "completed" || t.status === "skipped") throw conflict(`task already ${t.status}`);
    await this.assertInstanceActionable(t);
    const inst = await this.instances.get(t.instanceId).catch(() => null);
    if (inst) {
      const dep = await this.ctx.store.repo(Collections.deployments).get(inst.deploymentId);
      const proc = (dep?.engine.processes || []).find((p) => p.id === inst.processId) || dep?.engine.processes?.[0];
      const node = proc?.nodes.find((n) => n.id === t.nodeId);
      if (node && node.skippable !== true) throw conflict("task is not skippable");
    }
    t.status = "skipped";
    t.completedAt = this.ctx.clock();
    t.completedBy = user;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.skipped", instanceId: t.instanceId, taskId: t.id, nodeId: t.nodeId });
    await this.instances.resume(t.instanceId, t.tokenId, {});
    return t;
  }
  /** jBPM Start: reserved → inprogress (the owner begins working; Work tab shows Save/Complete). */
  async start(id, user) {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    await this.assertInstanceActionable(t);
    if (t.status === "created") {
      t.assignee = user;
    } else if (t.status !== "reserved") throw conflict(`task is ${t.status}, not startable`);
    else if (t.assignee !== user && t.businessAdmin !== user) throw forbidden("only the task owner can start it");
    t.status = "inprogress";
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.started", instanceId: t.instanceId, taskId: t.id });
    return t;
  }
  /** jBPM Stop: inprogress → reserved (pause work without giving the task up). */
  async stop(id, user) {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    if (t.status !== "inprogress") throw conflict(`task is ${t.status}, not in progress`);
    if (t.assignee !== user && t.businessAdmin !== user) throw forbidden("only the task owner can stop it");
    t.status = "reserved";
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.stopped", instanceId: t.instanceId, taskId: t.id });
    return t;
  }
  /** Save partial output data without completing (the Work tab's Save button). */
  async saveOutputs(id, outputs, user) {
    const t = await this.get(id);
    await this.assertOwnable(t, user);
    await this.assertInstanceActionable(t);
    if (t.status === "completed" || t.status === "skipped") throw conflict(`task already ${t.status}`);
    t.outputs = outputs;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.saved", instanceId: t.instanceId, taskId: t.id });
    return t;
  }
  /** jBPM Delegate: hand the task to a specific user (goes to their inbox as reserved). */
  async delegate(id, to, user) {
    const t = await this.get(id);
    if (!to?.trim()) throw validation("target user is required");
    await this.assertInstanceActionable(t);
    if (t.status === "completed" || t.status === "skipped") throw conflict(`task already ${t.status}`);
    if (t.excludedOwners?.includes(to)) throw conflict(`${to} is excluded from this task`);
    const from = t.assignee;
    t.assignee = to;
    t.status = "reserved";
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.delegated", instanceId: t.instanceId, taskId: t.id, data: { from, to } });
    await new NotificationService(this.ctx).notify({
      userId: to,
      kind: "task-assigned",
      title: `Task "${t.name}" was delegated to you`,
      body: `by ${user}`,
      link: `/tasks/${t.id}`,
      taskId: t.id,
      instanceId: t.instanceId
    });
    return t;
  }
  /** jBPM Forward: push the task back to Ready in another user's or group's queue — the target must
   *  claim it (unlike delegate, which reserves it for them directly). */
  async forward(id, to, user) {
    const t = await this.get(id);
    if (!to?.user?.trim() && !to?.group?.trim()) throw validation("a target user or group is required");
    await this.assertInstanceActionable(t);
    if (t.status === "completed" || t.status === "skipped") throw conflict(`task already ${t.status}`);
    const from = t.assignee;
    t.assignee = void 0;
    t.status = "created";
    if (to.group?.trim()) t.group = to.group.trim();
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.forwarded", instanceId: t.instanceId, taskId: t.id, data: { from, to } });
    if (to.user?.trim()) {
      await new NotificationService(this.ctx).notify({
        userId: to.user.trim(),
        kind: "task-assigned",
        title: `Task "${t.name}" was forwarded to you`,
        body: `by ${user} \u2014 claim it to start`,
        link: `/tasks/${t.id}`,
        taskId: t.id,
        instanceId: t.instanceId
      });
    }
    return t;
  }
  /** Admin-tab edits: priority / due date. No behavioral effect beyond sort order and overdue flags. */
  async update(id, patch, user) {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    if (t.status === "completed" || t.status === "skipped") throw conflict(`task already ${t.status}`);
    const changed = {};
    if (patch.priority !== void 0) {
      changed.priority = { from: t.priority, to: patch.priority };
      t.priority = patch.priority;
    }
    if (patch.dueAt !== void 0) {
      changed.dueAt = { from: t.dueAt, to: patch.dueAt };
      t.dueAt = patch.dueAt === null ? void 0 : patch.dueAt;
    }
    if (!Object.keys(changed).length) return t;
    await this.repo().put(t);
    await this.ctx.audit({ actor: user, kind: "task.updated", instanceId: t.instanceId, taskId: t.id, data: changed });
    return t;
  }
  /** Admin-tab reminder: ping the current owner (or the group queue's members' bell is out of scope —
   *  a group-queue reminder without an owner notifies no one and is a validation error). */
  async remind(id, user) {
    const t = await this.get(id);
    await this.assertInstanceActionable(t);
    if (t.status === "completed" || t.status === "skipped") throw conflict(`task already ${t.status}`);
    if (!t.assignee) throw validation("task has no owner to remind \u2014 forward or delegate it instead");
    await new NotificationService(this.ctx).notify({
      userId: t.assignee,
      kind: "task-reminder",
      title: `Reminder: "${t.name}" is waiting on you`,
      body: t.dueAt ? `due ${t.dueAt}` : void 0,
      link: `/tasks/${t.id}`,
      taskId: t.id,
      instanceId: t.instanceId
    });
    await this.ctx.audit({ actor: user, kind: "task.reminded", instanceId: t.instanceId, taskId: t.id, data: { to: t.assignee } });
    return { notified: t.assignee };
  }
  // --- comments (separate entities so they page and audit cleanly — see domain.ts TaskComment) ---
  comments() {
    return this.ctx.store.repo(Collections.comments);
  }
  async listComments(taskId) {
    await this.get(taskId);
    return (await this.comments().query((c) => c.tenantId === this.ctx.tenantId && c.taskId === taskId)).sort((a, b) => a.at.localeCompare(b.at));
  }
  async addComment(taskId, body, author) {
    const t = await this.get(taskId);
    if (!body?.trim()) throw validation("comment body is required");
    const c = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, taskId, author, body: body.trim(), at: this.ctx.clock() };
    await this.comments().put(c);
    await this.ctx.audit({ actor: author, kind: "task.commented", instanceId: t.instanceId, taskId });
    return c;
  }
  async deleteComment(taskId, commentId, actor) {
    const t = await this.get(taskId);
    const c = await this.comments().get(commentId);
    if (!c || c.tenantId !== this.ctx.tenantId || c.taskId !== taskId) throw notFound("Comment");
    if (c.author !== actor && t.businessAdmin !== actor) throw forbidden("only the comment author can delete it");
    await this.comments().delete(commentId);
    await this.ctx.audit({ actor, kind: "task.comment.deleted", instanceId: t.instanceId, taskId });
  }
  /** The Logs tab: every audit event recorded against this task, oldest first. */
  async events(taskId) {
    await this.get(taskId);
    return (await this.ctx.store.repo(Collections.audit).query((e) => e.tenantId === this.ctx.tenantId && e.taskId === taskId)).sort((a, b) => a.at.localeCompare(b.at));
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
  isAll() {
    return this.ctx.tenantId === "all" || this.ctx.tenantId === "*";
  }
  mine(xs) {
    return this.isAll() ? xs : xs.filter((x) => x.tenantId === this.ctx.tenantId);
  }
  allInstances() {
    return this.isAll() ? this.I().query(() => true) : this.I().query((i) => i.tenantId === this.ctx.tenantId);
  }
  allTasks() {
    return this.isAll() ? this.T().query(() => true) : this.T().query((t) => t.tenantId === this.ctx.tenantId);
  }
  // ---- process definitions (across active deployments) ----
  /** Every process definition currently deployed & active, with live instance stats (jBPM def catalog). */
  async processDefinitions() {
    const active = await this.D().query((d) => (this.isAll() || d.tenantId === this.ctx.tenantId) && d.status === "active");
    const instances = await this.allInstances();
    const defs2 = [];
    for (const dep of active) {
      for (const p of dep.engine?.processes || []) {
        const insts2 = instances.filter((i) => i.processId === p.id && i.deploymentId === dep.id);
        defs2.push({
          processId: p.id,
          name: p.name || p.id,
          package: p.package,
          deploymentId: dep.id,
          workflowId: dep.workflowId,
          environment: dep.environment,
          version: dep.versionLabel || (dep.versionNumber != null ? `v${dep.versionNumber}` : void 0),
          nodes: (p.nodes || []).length,
          instances: { total: insts2.length, active: insts2.filter((i) => i.status === "running" || i.status === "waiting").length }
        });
      }
    }
    return defs2;
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
    const insts2 = await this.allInstances();
    return insts2.filter((i) => i.processId === processId && (!status || i.status === status)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
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
    const isAll = this.isAll();
    const [instances, tasks, deployments, jobs] = [
      await this.allInstances(),
      await this.allTasks(),
      await this.D().query((d) => isAll || d.tenantId === this.ctx.tenantId),
      await this.J().query((j) => isAll || j.tenantId === this.ctx.tenantId)
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
    return (await this.J().query((j) => (this.isAll() || j.tenantId === this.ctx.tenantId) && (!status || j.status === status))).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
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
  seed: (name, fields) => ({
    id: slug3(name),
    name,
    type: fields?.type || name,
    model: { className: fields?.["model.className"] || fields?.className || `com.acme.model.${name}` },
    fields: [
      { bind: "amount", label: "Claim Amount", widget: "number", required: true, placeholder: "Enter amount" },
      { bind: "description", label: "Description", widget: "textarea", required: false, placeholder: "Claim details" }
    ]
  })
};

// src/assets/rulesets/def.ts
var def19 = {
  key: "rulesets",
  label: "DRL rules",
  nameField: "group",
  seed: (name, fields) => ({
    group: name,
    package: fields?.package || "com.acme.rules",
    rules: [
      {
        name: fields?.ruleName || "Standard Approval",
        priority: 10,
        when: [{ fact: fields?.fact || "Claim", where: { amount: { lte: 1e3 } } }],
        then: [{ set: fields?.fact || "Claim", fields: { approved: true, discount: 0.05 } }]
      }
    ]
  })
};

// src/assets/decisions/def.ts
var def20 = {
  key: "decisions",
  label: "DMN decisions",
  nameField: "name",
  seed: (name, fields) => {
    const rawInputs = typeof fields?.inputs === "string" ? fields.inputs.split(",").map((s) => s.trim()).filter(Boolean) : fields?.inputs || ["amount"];
    const rawOutputs = typeof fields?.outputs === "string" ? fields.outputs.split(",").map((s) => s.trim()).filter(Boolean) : fields?.outputs || ["approved"];
    const inputs = rawInputs.map((n) => ({ name: n, type: "number" }));
    const outputs = rawOutputs.map((n) => ({ name: n, type: "boolean" }));
    const hitPolicy = fields?.hitPolicy || "UNIQUE";
    return {
      name,
      namespace: fields?.namespace || `https://kie.org/dmn/${slug3(name)}`,
      decisions: [{
        name,
        hitPolicy,
        inputs,
        outputs,
        rules: [
          { when: { [inputs[0]?.name || "amount"]: { lte: 1e3 } }, then: { [outputs[0]?.name || "approved"]: true } },
          { when: { [inputs[0]?.name || "amount"]: { gt: 1e3 } }, then: { [outputs[0]?.name || "approved"]: false } }
        ]
      }]
    };
  }
};

// src/assets/guided-tables/def.ts
var def21 = {
  key: "guidedTables",
  label: "Decision tables",
  nameField: "name",
  seed: (name, fields) => {
    const fact = fields?.fact || "Claim";
    return {
      name,
      fact,
      package: fields?.package || "com.acme.rules",
      conditions: [
        { field: "amount", op: "lte", type: "number" },
        { field: "region", op: "eq", type: "string" }
      ],
      actions: [
        { field: "approved", type: "boolean" },
        { field: "discount", type: "number" }
      ],
      rows: [
        { when: { amount: 1e3 }, then: { approved: true, discount: 0.1 } },
        { when: { amount: 1e4, region: "US" }, then: { approved: false, discount: 0 } }
      ]
    };
  }
};

// src/assets/decision-trees/def.ts
var def22 = {
  key: "decisionTrees",
  label: "Decision trees",
  nameField: "name",
  seed: (name, fields) => ({
    name,
    package: fields?.package || "com.acme.rules",
    fact: fields?.fact || "Claim",
    root: {
      test: { field: fields?.field || "amount" },
      branches: [
        { match: { lte: 1e3 }, then: { output: { approved: true, discount: 0.1 } } },
        { match: { gt: 1e3 }, then: { output: { approved: false, discount: 0 } } }
      ]
    }
  })
};

// src/assets/scorecards/def.ts
var def23 = {
  key: "scorecards",
  label: "Scorecards",
  nameField: "name",
  seed: (name, fields) => ({
    name,
    package: fields?.package || "com.acme.rules",
    fact: fields?.fact || "Claim",
    baseline: Number(fields?.baseline ?? 100),
    target: fields?.target || "score",
    characteristics: [
      {
        field: "creditScore",
        attributes: [
          { match: { gte: 750 }, points: 50, reason: "Excellent credit" },
          { match: { gte: 650 }, points: 20, reason: "Good credit" },
          { match: { lt: 650 }, points: -30, reason: "Subprime credit" }
        ]
      },
      {
        field: "claimAmount",
        attributes: [
          { match: { lte: 1e3 }, points: 20, reason: "Low amount" },
          { match: { gt: 1e4 }, points: -40, reason: "High amount alert" }
        ]
      }
    ]
  })
};

// src/assets/enumerations/def.ts
var def24 = {
  key: "enumerations",
  label: "Enumerations",
  nameField: "name",
  seed: (name, fields) => {
    const fact = fields?.fact || fields?.type || "Claim";
    const field = fields?.field || "status";
    const vals = Array.isArray(fields?.values) ? fields.values : typeof fields?.values === "string" ? fields.values.split(",").map((s) => s.trim()).filter(Boolean) : ["NEW", "PENDING", "APPROVED", "REJECTED"];
    return {
      name,
      type: fact,
      field,
      values: vals,
      entries: { [`${fact}.${field}`]: vals }
    };
  }
};

// src/assets/types-asset/def.ts
var def25 = {
  key: "types",
  label: "Data types",
  nameField: "name",
  seed: (name, fields) => ({
    name,
    package: fields?.package || "com.acme.model",
    fields: [
      { name: "id", type: "string", list: false },
      { name: "amount", type: "double", list: false },
      { name: "status", type: "string", list: false }
    ]
  })
};

// src/assets/messages/def.ts
var def26 = {
  key: "messages",
  label: "Messages",
  nameField: "name",
  seed: (name, fields) => ({
    name,
    dataType: fields?.dataType || "Object",
    correlationKey: fields?.correlationKey || "correlationId",
    description: fields?.description || `Message contract for ${name}`
  })
};

// src/assets/tests/def.ts
var def27 = {
  key: "tests",
  label: "Test scenarios",
  nameField: "name",
  seed: (name, fields) => ({
    name,
    target: fields?.target || "Eligibility",
    description: fields?.description || `Verification test suite for ${fields?.target || "Eligibility"}`,
    cases: [
      {
        name: "Small claim auto-approval",
        given: { amount: 500, creditScore: 800 },
        expect: { approved: true }
      },
      {
        name: "High claim rejection",
        given: { amount: 15e3, creditScore: 600 },
        expect: { approved: false }
      }
    ]
  })
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
  def(kind) {
    const def28 = ASSET_DEFS[kind];
    if (!def28) throw validation(`unknown asset kind "${kind}"`);
    return def28;
  }
  /**
   * Every place a process can point at an asset by name, keyed by asset kind. This is the single
   * source of truth for both the "used by" counts on the list and the "referenced by" panel on an
   * asset's detail — matches the engine node fields each kind's node handler actually reads (see
   * engine/nodes/{user-task,rule,send,receive,catch,throw}/handler.ts).
   */
  findRefs(engine, kind, name) {
    const refs = [];
    const visit = (proc, nodes) => {
      for (const n of nodes) {
        const push = (via) => refs.push({ kind, process: proc.name || proc.id, processId: proc.id, nodeId: n.id, nodeName: n.name || n.id, via });
        if (kind === "forms" && n.type === "userTask" && n.form === name) push("form");
        if (kind === "rulesets" && n.type === "rule" && n.ruleflowGroup === name) push("ruleflowGroup");
        if (kind === "decisions" && n.type === "rule" && n.dmn?.model === name) push("dmn.model");
        if (kind === "guidedTables" && n.type === "rule" && n.guidedTable === name) push("guidedTable");
        if (kind === "decisionTrees" && n.type === "rule" && n.decisionTree === name) push("decisionTree");
        if (kind === "scorecards" && n.type === "rule" && n.scorecard === name) push("scorecard");
        if (kind === "messages") {
          if (n.type === "send" && n.message === name) push("message");
          if (n.type === "receive" && n.message === name) push("message");
          if (n.type === "catch" && n.event?.message === name) push("event.message");
          if (n.type === "throw" && n.event?.message === name) push("event.message");
        }
        if (n.type === "subprocess" && Array.isArray(n.nodes)) visit(proc, n.nodes);
      }
    };
    for (const proc of engine.processes || []) {
      visit(proc, proc.nodes || []);
      if (kind === "types" && (proc.vars || []).some((v) => v.type === name)) {
        refs.push({ kind, process: proc.name || proc.id, processId: proc.id, via: "process variable" });
      }
    }
    if (kind === "types") {
      for (const f of engine.forms || []) {
        if (f.model?.className === name || f.model?.className?.endsWith("." + name)) {
          refs.push({ kind, process: `Form: ${f.name}`, via: "form model" });
        }
      }
    }
    if (kind !== "tests") {
      for (const t of engine.tests || []) {
        if (t.target === name) {
          refs.push({ kind, process: `Test Suite: ${t.name}`, via: "test target" });
        }
      }
    }
    return refs;
  }
  async list(projectId) {
    const { engine } = await this.head(projectId);
    const assets = {};
    for (const k of ASSET_KINDS) {
      const arr = engine[k.key] || [];
      assets[k.key] = arr.map((a) => {
        const name = a[k.nameField] || a.name || a.group || a.id || "(unnamed)";
        const refs = this.findRefs(engine, k.key, name);
        return { name, usedBy: refs.length, refs };
      });
    }
    return { kinds: ASSET_KINDS.map((k) => ({ key: k.key, label: k.label, nameField: k.nameField })), assets };
  }
  findRaw(engine, kind, name) {
    const def28 = this.def(kind);
    const arr = engine[kind] || [];
    return arr.find((a) => (a[def28.nameField] || a.name) === name);
  }
  async get(projectId, kind, name) {
    const { engine } = await this.head(projectId);
    const asset = this.findRaw(engine, kind, name);
    if (!asset) throw notFound(`asset "${name}"`);
    return { kind, asset, usedBy: this.findRefs(engine, kind, name) };
  }
  // `fields` carries kind-specific data beyond the name (e.g. a form's model.className, a scorecard's
  // fact/baseline/target). Only keys already present in def.seed()'s own shape are copied over — that
  // seed shape is each kind's only schema today (see src/assets/types.ts), so this both scopes the
  // payload to what the kind actually supports and blocks injecting arbitrary/prototype keys.
  async add(projectId, kind, name, actor, fields) {
    const nm = (name || "").trim();
    if (!nm) throw validation("asset name is required");
    const def28 = this.def(kind);
    const { branchId, engine } = await this.head(projectId);
    const coll = engine[kind] ||= [];
    if (coll.some((a) => (a[def28.nameField] || a.name) === nm)) throw validation(`asset "${nm}" already exists`);
    const seeded = def28.seed(nm, fields);
    if (fields && typeof fields === "object") {
      for (const k of Object.keys(seeded)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
        if (k === def28.nameField || !(k in fields)) continue;
        const v = fields[k];
        if (v === void 0 || v === "") continue;
        seeded[k] = typeof seeded[k] === "number" ? Number(v) : v;
      }
    }
    coll.push(seeded);
    await this.ver.saveDraft(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: "asset.added", workflowId: projectId, data: { kind, name: nm } });
    return { kind, name: nm };
  }
  /** Rename and/or merge other top-level field edits (e.g. a data object's field list) into an
   *  existing asset. Renaming re-points every process reference so nothing silently breaks. */
  async update(projectId, kind, name, patch, actor) {
    const def28 = this.def(kind);
    const { branchId, engine } = await this.head(projectId);
    const asset = this.findRaw(engine, kind, name);
    if (!asset) throw notFound(`asset "${name}"`);
    const nextName = typeof patch[def28.nameField] === "string" ? patch[def28.nameField].trim() : void 0;
    if (nextName && nextName !== name) {
      const coll = engine[kind] || [];
      if (coll.some((a) => (a[def28.nameField] || a.name) === nextName)) throw validation(`asset "${nextName}" already exists`);
      this.retarget(engine, kind, name, nextName);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      asset[k] = v;
    }
    await this.ver.saveDraft(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: "asset.updated", workflowId: projectId, data: { kind, name, patch: Object.keys(patch) } });
    return { kind, name: nextName || name };
  }
  /** Re-point every process reference to a renamed asset (see update()). Mirrors findRefs' field list. */
  retarget(engine, kind, oldName, newName) {
    const visit = (nodes) => {
      for (const n of nodes) {
        const any = n;
        if (kind === "forms" && any.type === "userTask" && any.form === oldName) any.form = newName;
        if (kind === "rulesets" && any.type === "rule" && any.ruleflowGroup === oldName) any.ruleflowGroup = newName;
        if (kind === "decisions" && any.type === "rule" && any.dmn?.model === oldName) any.dmn.model = newName;
        if (kind === "decisionTrees" && any.type === "rule" && any.decisionTree === oldName) any.decisionTree = newName;
        if (kind === "scorecards" && any.type === "rule" && any.scorecard === oldName) any.scorecard = newName;
        if (kind === "messages") {
          if ((any.type === "send" || any.type === "receive") && any.message === oldName) any.message = newName;
          if ((any.type === "catch" || any.type === "throw") && any.event?.message === oldName) any.event.message = newName;
        }
        if (any.type === "subprocess" && Array.isArray(any.nodes)) visit(any.nodes);
      }
    };
    for (const proc of engine.processes || []) {
      visit(proc.nodes || []);
      if (kind === "types") {
        for (const v of proc.vars || []) if (v.type === oldName) v.type = newName;
      }
    }
  }
  /** Blocked while any process still references the asset — matches jBPM's own rule that "used by" is
   *  what makes deletion safe (ux_design/mockups/assets-overview.html). */
  async remove(projectId, kind, name, actor) {
    const def28 = this.def(kind);
    const { branchId, engine } = await this.head(projectId);
    const coll = engine[kind] || [];
    const idx = coll.findIndex((a) => (a[def28.nameField] || a.name) === name);
    if (idx < 0) throw notFound(`asset "${name}"`);
    const refs = this.findRefs(engine, kind, name);
    if (refs.length) throw conflict(`"${name}" is referenced by ${refs.length} process node(s) \u2014 remove those references first`, refs);
    coll.splice(idx, 1);
    await this.ver.saveDraft(branchId, engine, actor);
    await this.ctx.audit({ actor, kind: "asset.removed", workflowId: projectId, data: { kind, name } });
  }
  /** Run/test an asset based on its purpose (e.g. evaluate DMN/DRL/table/tree/scorecard, validate form/type, or run test suite). */
  async testAsset(projectId, kind, name, inputPayload) {
    const { engine } = await this.head(projectId);
    const asset = this.findRaw(engine, kind, name);
    if (!asset) throw notFound(`asset "${name}"`);
    switch (kind) {
      case "decisions": {
        const decisionName = inputPayload.decision || "";
        const vars = inputPayload.inputs || inputPayload.vars || inputPayload;
        const result = evaluateDmn(engine, { model: name, decision: decisionName }, vars);
        return { success: true, kind, name, outputs: result };
      }
      case "rulesets": {
        const vars = inputPayload.vars || inputPayload;
        const result = evaluateRules(engine, name, vars);
        return { success: true, kind, name, outputs: result };
      }
      case "guidedTables": {
        const vars = inputPayload.vars || inputPayload;
        const result = evaluateGuidedTable(engine, name, vars);
        return { success: true, kind, name, outputs: result };
      }
      case "decisionTrees": {
        const vars = inputPayload.vars || inputPayload;
        const result = evaluateDecisionTree(engine, name, vars);
        return { success: true, kind, name, outputs: result };
      }
      case "scorecards": {
        const vars = inputPayload.vars || inputPayload;
        const result = evaluateScorecard(engine, name, vars);
        return { success: true, kind, name, outputs: result };
      }
      case "tests": {
        const result = evaluateTestScenario(engine, name);
        return { success: true, kind, ...result };
      }
      case "forms": {
        const submission = inputPayload.submission || inputPayload;
        const fields = asset.fields || [];
        const errors = [];
        for (const f of fields) {
          const val = submission[f.bind];
          if (f.required && (val === void 0 || val === null || val === "")) {
            errors.push(`Field "${f.label || f.bind}" is required`);
          }
          if (val !== void 0 && val !== null && val !== "") {
            if ((f.widget === "integer" || f.widget === "number" || f.widget === "decimal") && isNaN(Number(val))) {
              errors.push(`Field "${f.label || f.bind}" must be a number`);
            }
          }
        }
        return { success: errors.length === 0, valid: errors.length === 0, errors, submission };
      }
      case "types": {
        const obj = inputPayload.object || inputPayload;
        const typeFields = asset.fields || [];
        const errors = [];
        for (const f of typeFields) {
          const val = obj[f.name];
          if (f.list && val !== void 0 && !Array.isArray(val)) {
            errors.push(`Property "${f.name}" must be a list/array`);
          }
        }
        return { success: errors.length === 0, valid: errors.length === 0, errors, sample: obj };
      }
      case "enumerations": {
        const testVal = inputPayload.value || "";
        const allowedVals = asset.values || asset.entries && asset.entries[Object.keys(asset.entries)[0]] || [];
        const allowed = allowedVals.includes(testVal);
        return { success: true, allowed, value: testVal, allowedValues: allowedVals };
      }
      case "messages": {
        return {
          success: true,
          name,
          dataType: asset.dataType || "Object",
          correlationKey: asset.correlationKey || "correlationId",
          description: asset.description,
          activeReferences: this.findRefs(engine, kind, name)
        };
      }
      default:
        throw validation(`testing not supported for asset kind "${kind}"`);
    }
  }
};

// src/infra/auth.ts
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
var scrypt = promisify(scryptCb);
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}
async function verifyPassword(password, stored) {
  const [salt, hashHex] = stored.split(":");
  if (!salt || !hashHex) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
function signToken(claims) {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: "12h" });
}
function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
function permissionGrants(permissions, action) {
  return permissions.some((p) => p === "*" || p === action || p.endsWith(":*") && action.startsWith(p.slice(0, -1)));
}

// src/modules/iam/service.ts
var sanitize = (u) => {
  const { passwordHash: _drop, ...rest } = u;
  return rest;
};
var DEFAULT_ROLES = {
  admin: ["*"],
  developer: ["workflow:view", "workflow:edit", "workflow:run", "query:read", "task:manage"],
  author: ["workflow:view", "workflow:edit"],
  release: ["workflow:view", "workflow:deploy", "workflowInstance:admin"],
  operator: ["workflow:view", "workflow:run", "query:read", "workflowInstance:manage", "analytics:query"],
  worker: ["task:manage", "workflowInstance:manage"],
  viewer: ["workflow:view", "query:read"]
};
var IamService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  users() {
    return this.ctx.store.repo(Collections.users);
  }
  groups() {
    return this.ctx.store.repo(Collections.groups);
  }
  roles() {
    return this.ctx.store.repo(Collections.roles);
  }
  /** Bootstraps a fresh deployment: default roles (if none exist) + one admin user (if no users exist
   *  at all) so there's always a way in. Call once at server startup — safe to call repeatedly
   *  (no-ops once seeded). */
  async ensureSeeded(defaultAdminPassword) {
    const existingRoles = await this.roles().query((r) => r.tenantId === this.ctx.tenantId);
    if (existingRoles.length === 0) {
      for (const [name, permissions] of Object.entries(DEFAULT_ROLES)) {
        await this.roles().put({ id: this.ctx.newId(), tenantId: this.ctx.tenantId, name, permissions });
      }
    }
    const existingUsers = await this.users().query((u) => u.tenantId === this.ctx.tenantId);
    if (existingUsers.length === 0) {
      await this.createUser({ username: "admin", password: defaultAdminPassword, roles: ["admin"], groups: [] }, "system");
      return { seededAdmin: true };
    }
    return { seededAdmin: false };
  }
  async login(username, password) {
    const u = (await this.users().query((x) => x.tenantId === this.ctx.tenantId && x.username === username))[0];
    if (!u || !u.active || !await verifyPassword(password, u.passwordHash)) throw authRequired("invalid username or password");
    const token = signToken({ sub: u.id, username: u.username, roles: u.roles, groups: u.groups });
    return { token, user: sanitize(u) };
  }
  /** Resolves a role-name list to its union of granted permission strings (missing/unknown role names
   *  simply contribute nothing — a deleted role silently drops from anyone still holding it). */
  async permissionsFor(roleNames) {
    if (!roleNames.length) return [];
    const rows = await this.roles().query((r) => r.tenantId === this.ctx.tenantId && roleNames.includes(r.name));
    return rows.flatMap((r) => r.permissions);
  }
  async authorize(roleNames, action) {
    return permissionGrants(await this.permissionsFor(roleNames), action);
  }
  // ---- users ----
  async listUsers() {
    return (await this.users().query((u) => u.tenantId === this.ctx.tenantId)).sort((a, b) => a.username.localeCompare(b.username)).map(sanitize);
  }
  async getUser(id) {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound("User");
    return sanitize(u);
  }
  async createUser(input, actor) {
    const username = (input.username || "").trim();
    if (!username) throw validation("username is required");
    if (!input.password || input.password.length < 8) throw validation("password must be at least 8 characters");
    const dupe = await this.users().query((u2) => u2.tenantId === this.ctx.tenantId && u2.username === username);
    if (dupe.length) throw conflict(`username "${username}" already exists`);
    const u = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      username,
      passwordHash: await hashPassword(input.password),
      roles: input.roles || [],
      groups: input.groups || [],
      active: true,
      createdAt: this.ctx.clock()
    };
    await this.users().put(u);
    await this.ctx.audit({ actor, kind: "user.created", data: { username } });
    return sanitize(u);
  }
  async updateUser(id, patch, actor) {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound("User");
    if (patch.roles !== void 0) u.roles = patch.roles;
    if (patch.groups !== void 0) u.groups = patch.groups;
    if (patch.active !== void 0) u.active = patch.active;
    await this.users().put(u);
    await this.ctx.audit({ actor, kind: "user.updated", data: { userId: id } });
    return sanitize(u);
  }
  async setPassword(id, newPassword, actor) {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound("User");
    if (!newPassword || newPassword.length < 8) throw validation("password must be at least 8 characters");
    u.passwordHash = await hashPassword(newPassword);
    await this.users().put(u);
    await this.ctx.audit({ actor, kind: "user.password_changed", data: { userId: id } });
  }
  /** Self-service variant of setPassword — for a user changing their OWN password (no admin:iam
   *  needed), gated by knowing the current password rather than by permission. */
  async changeOwnPassword(id, currentPassword, newPassword) {
    const u = await this.users().get(id);
    if (!u || u.tenantId !== this.ctx.tenantId) throw notFound("User");
    if (!await verifyPassword(currentPassword || "", u.passwordHash)) throw forbidden("current password is incorrect");
    if (!newPassword || newPassword.length < 8) throw validation("new password must be at least 8 characters");
    u.passwordHash = await hashPassword(newPassword);
    await this.users().put(u);
    await this.ctx.audit({ actor: u.username, kind: "user.password_changed", data: { userId: id, self: true } });
  }
  // ---- groups ----
  async listGroups() {
    return (await this.groups().query((g) => g.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async createGroup(input, actor) {
    const name = (input.name || "").trim();
    if (!name) throw validation("name is required");
    if ((await this.groups().query((g2) => g2.tenantId === this.ctx.tenantId && g2.name === name)).length) throw conflict(`group "${name}" already exists`);
    const g = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, name, description: input.description };
    await this.groups().put(g);
    await this.ctx.audit({ actor, kind: "group.created", data: { name } });
    return g;
  }
  async deleteGroup(id, actor) {
    const g = await this.groups().get(id);
    if (!g || g.tenantId !== this.ctx.tenantId) throw notFound("Group");
    await this.groups().delete(id);
    await this.ctx.audit({ actor, kind: "group.deleted", data: { name: g.name } });
  }
  // ---- roles ----
  async listRoles() {
    return (await this.roles().query((r) => r.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async createRole(input, actor) {
    const name = (input.name || "").trim();
    if (!name) throw validation("name is required");
    if ((await this.roles().query((r2) => r2.tenantId === this.ctx.tenantId && r2.name === name)).length) throw conflict(`role "${name}" already exists`);
    const r = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, name, permissions: input.permissions || [] };
    await this.roles().put(r);
    await this.ctx.audit({ actor, kind: "role.created", data: { name } });
    return r;
  }
  async updateRole(id, permissions, actor) {
    const r = await this.roles().get(id);
    if (!r || r.tenantId !== this.ctx.tenantId) throw notFound("Role");
    if (r.name === "admin") throw forbidden("the admin role's permissions cannot be changed");
    r.permissions = permissions;
    await this.roles().put(r);
    await this.ctx.audit({ actor, kind: "role.updated", data: { roleId: id } });
    return r;
  }
  async deleteRole(id, actor) {
    const r = await this.roles().get(id);
    if (!r || r.tenantId !== this.ctx.tenantId) throw notFound("Role");
    if (r.name === "admin") throw forbidden("the admin role cannot be deleted");
    await this.roles().delete(id);
    await this.ctx.audit({ actor, kind: "role.deleted", data: { name: r.name } });
  }
};

// src/modules/audit/service.ts
var AuditService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  repo() {
    return this.ctx.store.repo(Collections.audit);
  }
  async list(q2 = {}) {
    const all = await this.repo().query((e) => {
      if (e.tenantId !== this.ctx.tenantId) return false;
      if (q2.actor && e.actor !== q2.actor) return false;
      if (q2.kind && e.kind !== q2.kind && !(q2.kind.endsWith(".") && e.kind.startsWith(q2.kind))) return false;
      if (q2.workflowId && e.workflowId !== q2.workflowId) return false;
      if (q2.deploymentId && e.deploymentId !== q2.deploymentId) return false;
      if (q2.instanceId && e.instanceId !== q2.instanceId) return false;
      if (q2.taskId && e.taskId !== q2.taskId) return false;
      if (q2.from && e.at < q2.from) return false;
      if (q2.to && e.at > q2.to) return false;
      return true;
    });
    all.sort((a, b) => a.at < b.at ? 1 : -1);
    const offset = q2.offset ?? 0;
    const limit = q2.limit ?? 50;
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
  /** Distinct kinds + actors present in the log — populates the filter dropdowns. */
  async facets() {
    const all = await this.repo().query((e) => e.tenantId === this.ctx.tenantId);
    return {
      kinds: [...new Set(all.map((e) => e.kind))].sort(),
      actors: [...new Set(all.map((e) => e.actor))].sort()
    };
  }
};

// src/modules/timers/service.ts
var TimerService = class {
  constructor(ctx, emit4 = () => {
  }) {
    this.ctx = ctx;
    this.instances = new InstanceService(ctx, emit4);
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
          try {
            await this.instances.startScheduled(job);
          } finally {
            if (job.cycle) await this.reschedule(job, nowIso);
          }
        } else {
          const inst = await this.instances.fireTimer(job);
          if (job.cycle && inst.tokens.some((t) => t.id === job.tokenId)) await this.reschedule(job, nowIso);
        }
      } catch {
      }
    }
    return fired;
  }
  // --- Jobs & Timers screen ---
  async list(q2 = {}) {
    return (await this.repo().query((t) => t.tenantId === this.ctx.tenantId && (!q2.status || t.status === q2.status) && (!q2.instanceId || t.instanceId === q2.instanceId) && (!q2.kind || t.kind === q2.kind))).sort((a, b) => (a.status === "scheduled" ? 0 : 1) - (b.status === "scheduled" ? 0 : 1) || a.dueAt.localeCompare(b.dueAt) * (a.status === "scheduled" ? 1 : -1));
  }
  async getJob(id) {
    const j = await this.repo().get(id);
    if (!j || j.tenantId !== this.ctx.tenantId) throw notFound("TimerJob");
    return j;
  }
  async cancel(id, actor) {
    const j = await this.getJob(id);
    if (j.status !== "scheduled") throw conflict(`job is ${j.status}, not cancellable`);
    j.status = "cancelled";
    await this.repo().put(j);
    await this.ctx.audit({ actor, kind: "job.cancelled", instanceId: j.instanceId || void 0, nodeId: j.nodeId, data: { jobId: id } });
    return j;
  }
  /** Fire a scheduled job right now instead of waiting for dueAt ("Trigger" on the Jobs screen). Same
   *  "leave it scheduled, don't fire" rule for a suspended instance as tick() above — a manual trigger
   *  shouldn't be able to do what the periodic poller itself refuses to do. */
  async trigger(id, actor) {
    const j = await this.getJob(id);
    if (j.status !== "scheduled") throw conflict(`job is ${j.status}, not triggerable`);
    if (j.kind !== "start") {
      const inst = await this.instances.get(j.instanceId).catch(() => null);
      if (inst && inst.status === "suspended") throw conflict("instance is suspended; resume it before triggering this job");
    }
    j.status = "fired";
    j.fired += 1;
    await this.repo().put(j);
    await this.ctx.audit({ actor, kind: "job.triggered", instanceId: j.instanceId || void 0, nodeId: j.nodeId, data: { jobId: id } });
    if (j.kind === "start") await this.instances.startScheduled(j);
    else await this.instances.fireTimer(j);
    return j;
  }
  /** Move a scheduled job's fire time ("Reschedule"); also revives a cancelled job. */
  async rescheduleJob(id, dueAt, actor) {
    const j = await this.getJob(id);
    if (j.status === "fired") throw conflict("job already fired");
    if (!dueAt || Number.isNaN(Date.parse(dueAt))) throw validation("dueAt must be an ISO date-time");
    j.dueAt = new Date(dueAt).toISOString();
    j.status = "scheduled";
    await this.repo().put(j);
    await this.ctx.audit({ actor, kind: "job.rescheduled", instanceId: j.instanceId || void 0, nodeId: j.nodeId, data: { jobId: id, dueAt: j.dueAt } });
    return j;
  }
  /** Schedules the next occurrence of a recurring (cycled) job — unless its ISO-8601 repeat count
   *  ("R3/PT1H" = 3 times; "R/PT1H" = unbounded) has already been reached. */
  async reschedule(job, nowIso) {
    const limit = parseCycleRepeatCount(job.cycle);
    if (limit !== null && job.fired >= limit) return;
    const next = {
      ...job,
      id: this.ctx.newId(),
      status: "scheduled",
      fired: job.fired,
      dueAt: computeDue({ cycle: job.cycle }, nowIso)
    };
    await this.repo().put(next);
  }
};

// src/modules/export/service.ts
import fs3 from "fs";
import os from "os";
import path4 from "path";

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
  autowire,
  dmnToDecisionModel
} from "@fabrixly/bpmn-sdk";
import { fromEngine as fromEngine2, validateModel as validateModel2 } from "@fabrixly/bpmn-sdk";

// src/modules/export/validate-jbpm-export.ts
var isJs = (lang) => !lang || lang === "js" || lang === "javascript" || lang === "ecmascript";
function validateJbpmExport(engine) {
  const issues = [];
  const processes = engine.processes || [];
  if (processes.length === 0) {
    issues.push({
      processId: engine.id || "project",
      kind: "unsupported_feature",
      rule: "no-processes",
      message: "Project contains no processes to export.",
      remedy: "Add at least one process to the project before exporting."
    });
    return { valid: false, issues };
  }
  for (const p of processes) {
    const pLabel = p.name || p.id;
    const nodes = p.nodes || [];
    const flows = p.flows || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const starts = nodes.filter((n) => n.type === "start");
    if (starts.length === 0) {
      issues.push({
        processId: p.id,
        processName: pLabel,
        kind: "unsupported_feature",
        rule: "missing-start-event",
        message: `Process "${pLabel}" has no Start Event. Real jBPM requires every executable process to have a Start Event.`,
        remedy: "Add a Start Event to initiate process execution."
      });
    }
    const ends = nodes.filter((n) => n.type === "end");
    if (ends.length === 0) {
      issues.push({
        processId: p.id,
        processName: pLabel,
        kind: "unsupported_feature",
        rule: "missing-end-event",
        message: `Process "${pLabel}" has no End Event. Real jBPM requires every process execution path to terminate at an End Event.`,
        remedy: "Add an End Event to terminate process execution."
      });
    }
    const inspectNode = (n) => {
      const nLabel = n.name || n.id || n.type;
      if (n.type === "raw") {
        issues.push({
          processId: p.id,
          processName: pLabel,
          nodeId: n.id,
          nodeName: nLabel,
          kind: "unsupported_node",
          rule: "unsupported-raw-node",
          message: `Node "${nLabel}" is an unmodeled raw construct (bpmnLocal: "${n.bpmnLocal || "unknown"}"). jBPM cannot represent or execute unparsed opaque blobs.`,
          remedy: "Replace this raw node with a standard BPMN 2.0 activity or gateway."
        });
      } else if (!NODE_DEF_BY_TYPE[n.type]) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          nodeId: n.id,
          nodeName: nLabel,
          kind: "unsupported_node",
          rule: "unrecognized-node-type",
          message: `Node "${nLabel}" uses engine type "${n.type}" which is not a recognized BPMN 2.0 / jBPM element.`,
          remedy: "Use a standard jBPM node type (e.g. Script, User Task, Service Task, Gateway)."
        });
      }
      if (n.type === "script") {
        const lang = n.lang;
        if (isJs(lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: "unsupported_code",
            rule: "script-lang-javascript",
            message: `Script task "${nLabel}" is written in JavaScript (lang: "${lang || "js"}"). Real jBPM only supports Java or MVEL dialects.`,
            remedy: 'Rewrite the script in Java dialect and set lang to "java", or run this process in the Node.js engine.'
          });
        } else if (lang === "java" && n.code) {
          const res = validateJavaSupport(String(n.code));
          if (res.errors.length > 0) {
            issues.push({
              processId: p.id,
              processName: pLabel,
              nodeId: n.id,
              nodeName: nLabel,
              kind: "unsupported_code",
              rule: "java-safety-violation",
              message: `Java script in "${nLabel}" contains forbidden construct: ${res.errors.join("; ")}`,
              remedy: "Remove the forbidden construct to ensure compatibility with jBPM execution."
            });
          }
        }
      }
      if (n.onEntry) {
        const lang = n.onEntryLang;
        if (isJs(lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: "unsupported_code",
            rule: "on-entry-lang-javascript",
            message: `Node "${nLabel}" has an onEntry action script written in JavaScript. jBPM requires Java dialect for lifecycle actions.`,
            remedy: 'Rewrite the onEntry script in Java and set onEntryLang to "java".'
          });
        }
      }
      if (n.onExit) {
        const lang = n.onExitLang;
        if (isJs(lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: "unsupported_code",
            rule: "on-exit-lang-javascript",
            message: `Node "${nLabel}" has an onExit action script written in JavaScript. jBPM requires Java dialect for lifecycle actions.`,
            remedy: 'Rewrite the onExit script in Java and set onExitLang to "java".'
          });
        }
      }
      if (n.type === "http") {
        const a = n;
        if (isJs(a.lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: "unsupported_code",
            rule: "http-lang-javascript",
            message: `Service task "${nLabel}" uses JavaScript payload mapping, which is not supported in jBPM.`,
            remedy: "Configure the service task to use Java/Jackson mapping, or use a jBPM Rest WorkItemHandler."
          });
        }
      }
      if (n.type === "workItem" && !n.handler) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          nodeId: n.id,
          nodeName: nLabel,
          kind: "unsupported_feature",
          rule: "workitem-missing-handler",
          message: `Work item "${nLabel}" has no handler specified. jBPM requires a WorkItemHandler definition.`,
          remedy: "Specify the registered jBPM WorkItemHandler name in the task properties."
        });
      }
      if (n.type === "rule") {
        const a = n;
        if (!a.ruleflowGroup && !a.dmn && !a.decisionTree && !a.scorecard) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: "unsupported_feature",
            rule: "rule-missing-target",
            message: `Business rule task "${nLabel}" references no ruleflow group or decision asset.`,
            remedy: "Specify a ruleflow-group name or bind a DMN decision model."
          });
        }
      }
      if (n.type === "forEach") {
        const a = n;
        if (!a.process || !a.over) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: "unsupported_feature",
            rule: "multi-instance-missing-config",
            message: `Multi-instance activity "${nLabel}" is missing target process or collection expression.`,
            remedy: "Specify the called process and collection variable in properties."
          });
        }
      }
      if (n.type === "subprocess" && Array.isArray(n.nodes)) {
        for (const subNode of n.nodes) {
          inspectNode(subNode);
        }
      }
    };
    for (const n of nodes) {
      inspectNode(n);
    }
    for (const f of flows) {
      if (f.when) {
        const lang = f.lang;
        if (isJs(lang)) {
          const flowLabel = f.id || `${f.from} -> ${f.to}`;
          issues.push({
            processId: p.id,
            processName: pLabel,
            flowId: f.id,
            kind: "unsupported_code",
            rule: "condition-lang-javascript",
            message: `Sequence flow "${flowLabel}" uses a JavaScript condition expression. Real jBPM requires Java or MVEL dialect.`,
            remedy: 'Rewrite the condition expression in Java dialect (e.g. return amount > 1000;) and set condition language to "java".'
          });
        }
      }
      if (!byId.has(f.from)) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          flowId: f.id,
          kind: "unsupported_feature",
          rule: "flow-broken-from",
          message: `Sequence flow "${f.id || "unnamed"}" source node "${f.from}" does not exist.`,
          remedy: "Connect the sequence flow to a valid existing node."
        });
      }
      if (!byId.has(f.to)) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          flowId: f.id,
          kind: "unsupported_feature",
          rule: "flow-broken-to",
          message: `Sequence flow "${f.id || "unnamed"}" target node "${f.to}" does not exist.`,
          remedy: "Connect the sequence flow to a valid existing node."
        });
      }
    }
  }
  return {
    valid: issues.length === 0,
    issues
  };
}

// src/modules/export/service.ts
var BINARY = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".zip", ".jar", ".xls", ".xlsx"]);
function exportKjar(engine) {
  const check = validateJbpmExport(engine);
  if (!check.valid) {
    const summary = check.issues.slice(0, 5).map((i) => `\u2022 [${i.kind.toUpperCase()}] ${i.message}`).join("\n");
    const more = check.issues.length > 5 ? `
...and ${check.issues.length - 5} more issue(s)` : "";
    throw jbpmExportDenied(
      `Export to jBPM denied: project contains ${check.issues.length} construct(s) unsupported by real jBPM.
${summary}${more}`,
      { issues: check.issues }
    );
  }
  const dir = fs3.mkdtempSync(path4.join(os.tmpdir(), "kjar-"));
  try {
    const project = fromEngineProject(engine);
    project.root = dir;
    project.descriptor ||= {};
    project.descriptor.gav ||= { groupId: "com.acme", artifactId: String(engine.id || "process").replace(/[^A-Za-z0-9_-]/g, "-"), version: "1.0.0-SNAPSHOT", name: engine.name };
    writeProject(project, dir);
    const files = {};
    const walk = (d, rel = "") => {
      for (const e of fs3.readdirSync(d, { withFileTypes: true })) {
        const p = path4.join(d, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(p, r);
        else files[r] = BINARY.has(path4.extname(e.name).toLowerCase()) ? fs3.readFileSync(p).toString("base64") : fs3.readFileSync(p, "utf8");
      }
    };
    walk(dir);
    return { files };
  } finally {
    fs3.rmSync(dir, { recursive: true, force: true });
  }
}

// src/modules/import/service.ts
import fs4 from "fs";
import os2 from "os";
import path5 from "path";
var slug4 = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
var formNameFromPath = (p) => path5.basename(p).replace(/-taskform\.form$|\.form$/i, "");
var FIELD_WIDGET = {
  InputText: "text",
  InputTextArea: "textarea",
  InputInteger: "integer",
  InputDecimal: "decimal",
  InputNumber: "number",
  CheckBox: "checkbox",
  DropDownList: "dropdown",
  RadioGroup: "radio",
  InputDate: "date"
};
function formFieldsFromXml(root) {
  const fields = [];
  for (const el of root?.children || []) {
    if (el.name !== "field") continue;
    const props = {};
    for (const p of el.children || []) if (p.name === "property") props[p.attrs?.name] = p.attrs?.value;
    const bind = props.outputBinding || props.inputBinding || el.attrs?.name;
    if (!bind) continue;
    fields.push({
      bind,
      label: props.label || bind,
      widget: FIELD_WIDGET[el.attrs?.type] || "text",
      required: props.fieldRequired === "true",
      readOnly: props.readonly === "true",
      placeholder: props.placeholder || void 0
    });
  }
  return fields;
}
function rulesetGroupsFromDrl(drl, fallbackGroup) {
  const byGroup = /* @__PURE__ */ new Map();
  for (const r of drl.rules || []) {
    const group = r.attrs?.ruleflowGroup || fallbackGroup;
    (byGroup.get(group) || byGroup.set(group, []).get(group)).push(r.name);
  }
  return [...byGroup.entries()].map(([group, ruleNames]) => ({ group, ruleNames }));
}
function convertAssets(engine) {
  const report = { formsImported: [], rulesetPlaceholders: [], decisionsImported: [], skipped: [] };
  const assets = engine.assets;
  if (!assets) return report;
  const forms = engine.forms ||= [];
  const rulesets = engine.rulesets ||= [];
  const decisions = engine.decisions ||= [];
  const existingFormNames = new Set(forms.map((f) => f.name));
  const existingRulesetGroups = new Set(rulesets.map((r) => r.group));
  const existingDecisionNames = new Set(decisions.map((d) => d.name));
  for (const [assetPath, val] of Object.entries(assets)) {
    if (typeof val === "string") {
      report.skipped.push({ path: assetPath, kind: "text", reason: "unrecognized file type" });
      continue;
    }
    const { kind, model } = val;
    if (kind === "form") {
      const name = formNameFromPath(assetPath);
      if (existingFormNames.has(name)) {
        report.skipped.push({ path: assetPath, kind, reason: `form "${name}" already imported` });
        continue;
      }
      forms.push({ id: slug4(name), name, model: { className: "" }, fields: formFieldsFromXml(model.xml) });
      existingFormNames.add(name);
      report.formsImported.push(name);
    } else if (kind === "drl") {
      const fallbackGroup = path5.basename(assetPath).replace(/\.(rdrl|rdslr|drl)$/i, "");
      for (const g of rulesetGroupsFromDrl(model, fallbackGroup)) {
        if (existingRulesetGroups.has(g.group)) continue;
        rulesets.push({ group: g.group, package: model.package, rules: [] });
        existingRulesetGroups.add(g.group);
        report.rulesetPlaceholders.push(g);
      }
    } else if (kind === "dmn") {
      const parsed = dmnToDecisionModel(model.xml);
      if (!parsed) {
        report.skipped.push({ path: assetPath, kind, reason: "no decisionTable-driven decision found (literalExpression/businessKnowledgeModel-only DMN isn't evaluated by this engine)" });
        continue;
      }
      if (existingDecisionNames.has(parsed.name)) {
        report.skipped.push({ path: assetPath, kind, reason: `decision model "${parsed.name}" already imported` });
        continue;
      }
      decisions.push(parsed);
      existingDecisionNames.add(parsed.name);
      report.decisionsImported.push(parsed.name);
    } else {
      report.skipped.push({
        path: assetPath,
        kind,
        reason: kind === "workItemDefinition" ? "custom work-item definitions have no equivalent asset kind yet \u2014 recreate the service task manually" : "no automatic conversion for this asset kind"
      });
    }
  }
  return report;
}
function javaScriptify(code) {
  if (!code) return "";
  let js = code;
  js = js.replace(/System\.out\.println\s*\(/g, "console.log(");
  js = js.replace(/System\.out\.print\s*\(/g, "console.log(");
  js = js.replace(/System\.(getenv|getProperty)\s*\(\s*"([^"]+)"\s*\)/g, '((env && env["$2"]) || "")');
  js = js.replace(/String\.valueOf\s*\(/g, "String(");
  js = js.replace(/\.length\s*\(\s*\)/g, ".length");
  js = js.replace(/catch\s*\(\s*(?:[a-zA-Z0-9_\.]+\s+)?([a-zA-Z0-9_]+)\s*\)/g, "catch ($1)");
  js = js.replace(/new\s+([a-zA-Z0-9_\.]+)<[^>]+>\s*\(/g, "new $1(");
  js = js.replace(/\.class\b/g, "");
  const castPattern = /(?<![\w\.\$])\(\s*(?:int|long|double|float|boolean|char|short|byte|(?:[a-z0-9_]+\.)*[A-Z][a-zA-Z0-9_]*(?:<[^>]+>)?)\s*\)\s*(?![;,=\)])/g;
  js = js.replace(castPattern, "");
  const declPattern = /\b(?:int|long|double|float|boolean|char|short|byte|(?:[a-z0-9_]+\.)*[A-Z][a-zA-Z0-9_]*(?:<[^>]+>)?)\s+([a-zA-Z0-9_]+)\s*([=;])/g;
  js = js.replace(declPattern, "let $1 $2");
  js = js.replace(/for\s*\(\s*(?:[a-zA-Z0-9_\\.<>]+)\s+([a-zA-Z0-9_]+)\s*:\s*([^)]+)\)/g, "for (let $1 of $2)");
  js = js.replace(/for\s*\(\s*int\s+([a-zA-Z0-9_]+)\s*=/g, "for (let $1 =");
  return js;
}
function convertProjectToNodeEngine(engine) {
  for (const proc of engine.processes || []) {
    for (const node of proc.nodes || []) {
      if (node.type === "script") {
        node.lang = "js";
        const js = javaScriptify(node.code);
        node.code = js.trim() ? js : "// no-op";
      }
      if (node.onEntry) {
        node.onEntryLang = "js";
        node.onEntry = javaScriptify(node.onEntry);
      }
      if (node.onExit) {
        node.onExitLang = "js";
        node.onExit = javaScriptify(node.onExit);
      }
      if (node.exitScript) {
        node.lang = "js";
        node.exitScript = javaScriptify(node.exitScript);
      }
      if (node.type === "subprocess" && Array.isArray(node.nodes)) {
        for (const sub of node.nodes) {
          if (sub.type === "script") {
            sub.lang = "js";
            const js = javaScriptify(sub.code);
            sub.code = js.trim() ? js : "// no-op";
          }
          if (sub.onEntry) {
            sub.onEntryLang = "js";
            sub.onEntry = javaScriptify(sub.onEntry);
          }
          if (sub.onExit) {
            sub.onExitLang = "js";
            sub.onExit = javaScriptify(sub.onExit);
          }
        }
        for (const flow of node.flows || []) {
          if (flow.when) {
            flow.lang = "js";
            flow.when = javaScriptify(flow.when);
          }
        }
      }
    }
    for (const flow of proc.flows || []) {
      if (flow.when) {
        flow.lang = "js";
        flow.when = javaScriptify(flow.when);
      }
    }
  }
  return engine;
}
function kjarToEngine(files) {
  if (!files || !Object.keys(files).length) throw validation("no files to import");
  if (Array.isArray(files.processes)) {
    return files;
  }
  if (files.engine && Array.isArray(files.engine.processes)) {
    return files.engine;
  }
  const dir = fs4.mkdtempSync(path5.join(os2.tmpdir(), "kjar-in-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const p = path5.join(dir, rel);
      fs4.mkdirSync(path5.dirname(p), { recursive: true });
      fs4.writeFileSync(p, content);
    }
    const engine = toEngineProject(parseProject(dir));
    return convertProjectToNodeEngine(engine);
  } finally {
    fs4.rmSync(dir, { recursive: true, force: true });
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
    const assetReport = convertAssets(engine);
    const wf = await new WorkflowService(this.ctx).create({ name: name || engine.name || engine.id || "Imported project" }, actor);
    await new VersionService(this.ctx).saveDraft(wf.defaultBranchId, engine, actor);
    await this.ctx.audit({ actor, kind: "project.imported", workflowId: wf.id, data: { processes: engine.processes?.length || 0, ...assetReport } });
    return { workflowId: wf.id, processes: engine.processes?.length || 0, ...assetReport };
  }
  /** Import a kjar straight to a running deployment in one step — no manual Publish/Deploy detour
   *  through the project first. Mirrors jBPM's own "deploy this artifact" ops flow: the import still
   *  creates a normal project + draft (so it's editable afterwards like any other), but also publishes
   *  and deploys that exact draft immediately. Deploying edits a NEW version, same as the UI's own
   *  Publish+Deploy buttons — this never mutates an already-active deployment in place, since that
   *  would desync it from whatever instances are already running against it. */
  async importAndDeploy(files, name, actor, opts) {
    const engine = kjarToEngine(files);
    const assetReport = convertAssets(engine);
    const wf = await new WorkflowService(this.ctx).create({ name: name || engine.name || engine.id || "Imported project" }, actor);
    const ver = new VersionService(this.ctx);
    const draft = await ver.saveDraft(wf.defaultBranchId, engine, actor);
    const { published } = await ver.publish(draft.id, actor, "v1");
    const dep = await new DeploymentService(this.ctx).deploy(published.id, { environment: opts.environment, tags: opts.tags, env: opts.env, activate: true }, actor);
    await this.ctx.audit({ actor, kind: "project.imported", workflowId: wf.id, data: { processes: engine.processes?.length || 0, deployed: true, deploymentId: dep.id, ...assetReport } });
    return { workflowId: wf.id, processes: engine.processes?.length || 0, deploymentId: dep.id, ...assetReport };
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
  Workflow: { type: "object", properties: { id: { type: "string" }, key: { type: "string" }, name: { type: "string" }, description: { type: "string" }, defaultBranchId: { type: "string" }, folderId: { type: "string", nullable: true }, variables: { type: "array", items: {} }, createdAt: { type: "string", format: "date-time" } } },
  Folder: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, parentId: { type: "string", nullable: true }, createdAt: { type: "string", format: "date-time" } } },
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
  Summary: { type: "object", properties: { instances: { type: "object" }, tasks: { type: "object" }, deployments: { type: "object" }, jobs: { type: "object" } } },
  User: { type: "object", properties: { id: { type: "string" }, username: { type: "string" }, roles: { type: "array", items: { type: "string" } }, groups: { type: "array", items: { type: "string" } }, active: { type: "boolean" }, createdAt: { type: "string" } } },
  ExecutionError: { type: "object", properties: { id: { type: "string" }, type: { type: "string", enum: ["process", "task", "job", "integration"] }, instanceId: { type: "string" }, taskId: { type: "string" }, jobId: { type: "string" }, workflowId: { type: "string" }, deploymentId: { type: "string" }, processId: { type: "string" }, nodeId: { type: "string" }, nodeName: { type: "string" }, nodeType: { type: "string" }, message: { type: "string" }, stack: { type: "string" }, at: { type: "string" }, occurrences: { type: "integer" }, acknowledged: { type: "boolean" }, acknowledgedBy: { type: "string" }, acknowledgedAt: { type: "string" } } },
  AuditEvent: { type: "object", properties: { id: { type: "string" }, at: { type: "string" }, actor: { type: "string" }, kind: { type: "string" }, workflowId: { type: "string" }, deploymentId: { type: "string" }, instanceId: { type: "string" }, taskId: { type: "string" }, nodeId: { type: "string" }, data: { type: "object" } } },
  Notification: { type: "object", properties: { id: { type: "string" }, userId: { type: "string" }, kind: { type: "string" }, title: { type: "string" }, body: { type: "string" }, link: { type: "string" }, instanceId: { type: "string" }, taskId: { type: "string" }, deploymentId: { type: "string" }, read: { type: "boolean" }, at: { type: "string" } } },
  TaskComment: { type: "object", properties: { id: { type: "string" }, taskId: { type: "string" }, author: { type: "string" }, body: { type: "string" }, at: { type: "string" } } },
  SystemSettings: { type: "object", properties: { defaultPageSize: { type: "integer", enum: [10, 20, 50, 100] }, instanceRetentionDays: { type: "integer" }, auditRetentionDays: { type: "integer" }, allowRunningVariableEdits: { type: "boolean" }, executorIntervalSeconds: { type: "integer" }, defaultJobRetries: { type: "integer" }, slaWarnThresholdPct: { type: "integer" }, sessionTimeoutHours: { type: "integer" }, emailEnabled: { type: "boolean" }, emailFrom: { type: "string" }, smtpHost: { type: "string" }, smtpPort: { type: "integer" }, updatedAt: { type: "string" }, updatedBy: { type: "string" } } },
  VariableChange: { type: "object", properties: { name: { type: "string" }, from: {}, to: {}, at: { type: "string" }, actor: { type: "string" } } },
  Group: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, description: { type: "string" } } },
  Role: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, permissions: { type: "array", items: { type: "string" } } } }
};
var paths = {
  "/catalog/nodes": { get: { tags: ["Catalog"], summary: "Node palette, property schemas and connection ports", responses: ok({ type: "object" }) } },
  "/catalog/nodes/{engineType}": { get: { tags: ["Catalog"], summary: "One node type definition", parameters: [idParam("engineType", "Engine node type")], responses: { ...ok({ type: "object" }), "404": { description: "Not found", content: { "application/json": { schema: ref("Error") } } } } } },
  "/catalog/processes": { get: { tags: ["Catalog"], summary: "Every process behind a currently-active deployment, tenant-wide \u2014 what a call activity / multi-instance node can resolve", responses: ok({ type: "object" }) } },
  "/validate": { post: { tags: ["Authoring"], summary: "Validate an in-progress process (no save)", requestBody: jsonBody({ type: "object" }), responses: ok(ref("ValidationResult")) } },
  "/import/jbpm": { post: { tags: ["Import/Export"], summary: "Import a jBPM kjar (file map) as a new project", requestBody: jsonBody({ type: "object", properties: { files: { type: "object", additionalProperties: { type: "string" } }, name: { type: "string" } } }), responses: created({ type: "object", properties: { workflowId: { type: "string" }, processes: { type: "integer" } } }) } },
  "/import/jbpm/deploy": { post: { tags: ["Import/Export"], summary: "Import a jBPM kjar and deploy it immediately, in one step", requestBody: jsonBody({ type: "object", properties: { files: { type: "object", additionalProperties: { type: "string" } }, name: { type: "string" }, environment: { type: "string" }, tags: { type: "array", items: { type: "string" } }, env: { type: "object", additionalProperties: { type: "string" } } } }), responses: created({ type: "object", properties: { workflowId: { type: "string" }, processes: { type: "integer" }, deploymentId: { type: "string" } } }) } },
  "/folders": {
    get: { tags: ["Projects"], summary: "List folders (Projects-page tree)", responses: ok(listOf("Folder")) },
    post: { tags: ["Projects"], summary: "Create a folder", requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, parentId: { type: "string", nullable: true } } }), responses: created(ref("Folder")) }
  },
  "/folders/{id}": {
    get: { tags: ["Projects"], summary: "Get a folder", parameters: [idParam()], responses: ok(ref("Folder")) },
    patch: { tags: ["Projects"], summary: "Rename or move a folder", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, parentId: { type: "string", nullable: true } } }), responses: ok(ref("Folder")) },
    delete: { tags: ["Projects"], summary: "Delete an empty folder", parameters: [idParam()], responses: { "204": { description: "Deleted" }, "409": { description: "Folder is not empty", content: { "application/json": { schema: ref("Error") } } } } }
  },
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
  "/workflows/{id}/export-engine": { get: { tags: ["Projects"], summary: "Export project engine JSON for Node engine runner", parameters: [idParam()], responses: ok({ type: "object" }) } },
  "/workflows/{id}/jbpm-compatibility": { get: { tags: ["Projects"], summary: "Inspect project compatibility with jBPM KIE runtime", parameters: [idParam()], responses: ok({ type: "object", properties: { compatible: { type: "boolean" }, errors: { type: "array", items: { type: "string" } }, warnings: { type: "array", items: { type: "string" } } } }) } },
  "/workflows/{id}/assets": {
    get: { tags: ["Assets"], summary: "List project assets by kind", parameters: [idParam()], responses: ok({ type: "object" }) },
    post: { tags: ["Assets"], summary: "Add an asset", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { kind: { type: "string" }, name: { type: "string" }, fields: { type: "object", description: "Kind-specific fields beyond the name, e.g. { fact, baseline, target } for a scorecard \u2014 see GET /workflows/{id}/assets for each kind's nameField." } } }), responses: created({ type: "object" }) }
  },
  "/workflows/{id}/assets/{kind}/{name}": {
    get: { tags: ["Assets"], summary: "Get one asset, with the process nodes that reference it", parameters: [idParam(), idParam("kind", "Asset kind key, e.g. forms/rulesets/decisions"), idParam("name", "The asset's name (or nameField value, e.g. a ruleset's group)")], responses: ok({ type: "object", properties: { kind: { type: "string" }, asset: { type: "object" }, usedBy: { type: "array", items: { type: "object" } } } }) },
    patch: { tags: ["Assets"], summary: "Update an asset (rename and/or edit its fields); renaming re-points every process reference", parameters: [idParam(), idParam("kind", "Asset kind key"), idParam("name", "Current asset name")], requestBody: jsonBody({ type: "object" }), responses: ok({ type: "object", properties: { kind: { type: "string" }, name: { type: "string" } } }) },
    delete: { tags: ["Assets"], summary: "Delete an asset \u2014 blocked (409) while any process node still references it", parameters: [idParam(), idParam("kind", "Asset kind key"), idParam("name", "Asset name")], responses: { "204": { description: "Deleted" }, "409": { description: "Still referenced", content: { "application/json": { schema: ref("Error") } } } } }
  },
  "/workflows/{id}/assets/{kind}/{name}/test": {
    post: { tags: ["Assets"], summary: "Execute, simulate, or test an asset according to its jBPM purpose", parameters: [idParam(), idParam("kind", "Asset kind key"), idParam("name", "Asset name")], requestBody: jsonBody({ type: "object" }, false), responses: ok({ type: "object" }) }
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
  "/versions/{id}/export-engine": { get: { tags: ["Import/Export"], summary: "Export version engine JSON for Node engine runner", parameters: [idParam()], responses: ok({ type: "object" }) } },
  "/versions/{id}/jbpm-compatibility": { get: { tags: ["Import/Export"], summary: "Inspect version compatibility with jBPM KIE runtime", parameters: [idParam()], responses: ok({ type: "object", properties: { compatible: { type: "boolean" }, errors: { type: "array", items: { type: "string" } }, warnings: { type: "array", items: { type: "string" } } } }) } },
  "/deployments": { get: { tags: ["Deployments"], summary: "List deployments across all projects", parameters: [q("workflowId", "Filter by project"), q("environment", "Filter by environment"), q("status", "Filter by status")], responses: ok(listOf("Deployment")) } },
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
  "/tasks": { get: { tags: ["Human Tasks"], summary: "List tasks", parameters: [q("assignee", "Owned by user"), q("group", "Group queue"), q("status", "Task status"), q("overdue", "true = only tasks past their dueAt and not yet completed/skipped")], responses: ok(listOf("Task")) } },
  "/tasks/{id}": {
    get: { tags: ["Human Tasks"], summary: "Get a task", parameters: [idParam()], responses: ok(ref("Task")) },
    patch: { tags: ["Human Tasks"], summary: "Admin edits: priority / due date (null dueAt clears it)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { priority: { type: "integer" }, dueAt: { type: "string", format: "date-time", nullable: true } } }), responses: ok(ref("Task")) }
  },
  "/tasks/{id}/claim": { post: { tags: ["Human Tasks"], summary: "Claim a task", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/release": { post: { tags: ["Human Tasks"], summary: "Release a task", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/complete": { post: { tags: ["Human Tasks"], summary: "Complete a task (resumes the instance)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { outputs: { type: "object" } } }), responses: ok(ref("Task")) } },
  "/tasks/{id}/skip": { post: { tags: ["Human Tasks"], summary: "Skip a task without completing it (only if the node is declared skippable)", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/start": { post: { tags: ["Human Tasks"], summary: "Start working (reserved \u2192 inprogress; starting from Ready implicitly claims)", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/stop": { post: { tags: ["Human Tasks"], summary: "Stop working (inprogress \u2192 reserved, ownership kept)", parameters: [idParam()], responses: ok(ref("Task")) } },
  "/tasks/{id}/save": { post: { tags: ["Human Tasks"], summary: "Save partial outputs without completing", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { outputs: { type: "object" } } }), responses: ok(ref("Task")) } },
  "/tasks/{id}/delegate": { post: { tags: ["Human Tasks"], summary: "Delegate to a user (lands reserved in their inbox)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { to: { type: "string" } } }), responses: ok(ref("Task")) } },
  "/tasks/{id}/forward": { post: { tags: ["Human Tasks"], summary: "Forward to a user or group queue (back to Ready; target must claim)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { user: { type: "string" }, group: { type: "string" } } }), responses: ok(ref("Task")) } },
  "/tasks/{id}/remind": { post: { tags: ["Human Tasks"], summary: "Send the current owner a reminder notification", parameters: [idParam()], responses: ok({ type: "object", properties: { notified: { type: "string" } } }) } },
  "/tasks/{id}/comments": {
    get: { tags: ["Human Tasks"], summary: "List comments", parameters: [idParam()], responses: ok(listOf("TaskComment")) },
    post: { tags: ["Human Tasks"], summary: "Add a comment", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { body: { type: "string" } } }), responses: created(ref("TaskComment")) }
  },
  "/tasks/{id}/comments/{cid}": { delete: { tags: ["Human Tasks"], summary: "Delete a comment (author or business admin)", parameters: [idParam(), idParam("cid", "Comment id")], responses: { "204": { description: "Deleted" } } } },
  "/tasks/{id}/events": { get: { tags: ["Human Tasks"], summary: "Task audit trail (the Logs tab)", parameters: [idParam()], responses: ok(listOf("AuditEvent")) } },
  "/instances/{id}/variables": { put: { tags: ["Instances"], summary: "Edit instance variables inline (audited; refused once the instance has ended)", parameters: [idParam()], requestBody: jsonBody({ type: "object", additionalProperties: {} }), responses: ok(ref("Instance")) } },
  "/instances/{id}/variable-history": { get: { tags: ["Instances"], summary: "Per-variable change history (from the audit trail)", parameters: [idParam(), q("name", "Only this variable")], responses: ok(listOf("VariableChange")) } },
  "/errors": { get: { tags: ["Execution Errors"], summary: "List execution errors (the operational failure queue)", parameters: [q("type", "Comma-separated: process,task,job,integration"), q("instanceId", "Filter by instance"), q("taskId", "Filter by task"), q("jobId", "Filter by job"), q("workflowId", "Filter by project"), q("processId", "Filter by process"), q("acknowledged", "true / false"), q("from", "ISO lower bound"), q("to", "ISO upper bound"), q("limit", "Page size"), q("offset", "Page offset")], responses: ok({ type: "object", properties: { items: { type: "array", items: ref("ExecutionError") }, total: { type: "integer" } } }) } },
  "/errors/summary": { get: { tags: ["Execution Errors"], summary: "Counts for the nav badge / Home KPI", responses: ok({ type: "object", properties: { total: { type: "integer" }, unacknowledged: { type: "integer" }, last24h: { type: "integer" } } }) } },
  "/errors/{id}": { get: { tags: ["Execution Errors"], summary: "Get one error", parameters: [idParam()], responses: ok(ref("ExecutionError")) } },
  "/errors/{id}/ack": { post: { tags: ["Execution Errors"], summary: "Acknowledge (take ownership; idempotent)", parameters: [idParam()], responses: ok(ref("ExecutionError")) } },
  "/errors/ack": { post: { tags: ["Execution Errors"], summary: "Bulk acknowledge", requestBody: jsonBody({ type: "object", properties: { ids: { type: "array", items: { type: "string" } } } }), responses: ok({ type: "object", properties: { results: { type: "array", items: { type: "object", properties: { id: { type: "string" }, ok: { type: "boolean" }, reason: { type: "string" } } } } } }) } },
  "/jobs": { get: { tags: ["Jobs & Timers"], summary: "List timer jobs", parameters: [q("status", "scheduled|fired|cancelled"), q("instanceId", "Filter by instance"), q("kind", "duration|cycle|date|start")], responses: ok(listOf("TimerJob")) } },
  "/jobs/{id}": { get: { tags: ["Jobs & Timers"], summary: "Get a job", parameters: [idParam()], responses: ok(ref("TimerJob")) } },
  "/jobs/{id}/cancel": { post: { tags: ["Jobs & Timers"], summary: "Cancel a scheduled job", parameters: [idParam()], responses: ok(ref("TimerJob")) } },
  "/jobs/{id}/trigger": { post: { tags: ["Jobs & Timers"], summary: "Fire a scheduled job now", parameters: [idParam()], responses: ok(ref("TimerJob")) } },
  "/jobs/{id}/reschedule": { post: { tags: ["Jobs & Timers"], summary: "Move the fire time (also revives a cancelled job)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { dueAt: { type: "string", format: "date-time" } } }), responses: ok(ref("TimerJob")) } },
  "/audit": { get: { tags: ["Governance"], summary: "Audit log (admin)", parameters: [q("actor", "Filter by actor"), q("kind", "Exact kind or prefix ending in '.' (e.g. 'task.')"), q("workflowId", "Filter by project"), q("deploymentId", "Filter by deployment"), q("instanceId", "Filter by instance"), q("taskId", "Filter by task"), q("from", "ISO lower bound"), q("to", "ISO upper bound"), q("limit", "Page size"), q("offset", "Page offset")], responses: ok({ type: "object", properties: { items: { type: "array", items: ref("AuditEvent") }, total: { type: "integer" } } }) } },
  "/audit/facets": { get: { tags: ["Governance"], summary: "Distinct kinds + actors for the filter dropdowns (admin)", responses: ok({ type: "object", properties: { kinds: { type: "array", items: { type: "string" } }, actors: { type: "array", items: { type: "string" } } } }) } },
  "/notifications": { get: { tags: ["Notifications"], summary: "The caller's notifications (bell panel)", parameters: [q("unread", "true = unread only"), q("limit", "Max rows (default 50)")], responses: ok({ type: "object", properties: { items: { type: "array", items: ref("Notification") }, unread: { type: "integer" } } }) } },
  "/notifications/read-all": { post: { tags: ["Notifications"], summary: "Mark all read", responses: ok({ type: "object", properties: { marked: { type: "integer" } } }) } },
  "/notifications/{id}/read": { post: { tags: ["Notifications"], summary: "Mark one read", parameters: [idParam()], responses: ok(ref("Notification")) } },
  "/settings/system": {
    get: { tags: ["Governance"], summary: "Global system settings (singleton; defaults if never saved)", responses: ok(ref("SystemSettings")) },
    put: { tags: ["Governance"], summary: "Update system settings (admin)", requestBody: jsonBody(ref("SystemSettings")), responses: ok(ref("SystemSettings")) }
  },
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
  "/query/jobs": { get: { tags: ["Query & Analytics"], summary: "Timer jobs", parameters: [q("status", "scheduled|fired|cancelled")], responses: ok(listOf("TimerJob")) } },
  "/auth/login": { post: { tags: ["IAM"], security: [], summary: "Log in \u2014 issues a JWT (Bearer token) for every other endpoint", requestBody: jsonBody({ type: "object", properties: { username: { type: "string" }, password: { type: "string" } } }), responses: { ...ok({ type: "object", properties: { token: { type: "string" }, user: ref("User") } }), "401": { description: "Invalid credentials", content: { "application/json": { schema: ref("Error") } } } } } },
  "/auth/me": { get: { tags: ["IAM"], summary: "The caller\u2019s own identity + resolved permissions (from their current roles)", responses: ok({ type: "object", properties: { user: { type: "object", properties: { id: { type: "string" }, username: { type: "string" }, roles: { type: "array", items: { type: "string" } }, groups: { type: "array", items: { type: "string" } } } }, permissions: { type: "array", items: { type: "string" } } } }) } },
  "/auth/me/password": { post: { tags: ["IAM"], summary: "Change your own password (requires the current one)", requestBody: jsonBody({ type: "object", properties: { currentPassword: { type: "string" }, newPassword: { type: "string" } } }), responses: { "204": { description: "Changed" }, "403": { description: "Current password incorrect", content: { "application/json": { schema: ref("Error") } } } } } },
  "/users": {
    get: { tags: ["IAM"], summary: "List users (admin)", responses: ok(listOf("User")) },
    post: { tags: ["IAM"], summary: "Create a user (admin)", requestBody: jsonBody({ type: "object", properties: { username: { type: "string" }, password: { type: "string" }, roles: { type: "array", items: { type: "string" } }, groups: { type: "array", items: { type: "string" } } } }), responses: created(ref("User")) }
  },
  "/users/{id}": {
    get: { tags: ["IAM"], summary: "Get a user (admin)", parameters: [idParam()], responses: ok(ref("User")) },
    patch: { tags: ["IAM"], summary: "Update a user\u2019s roles/groups/active flag (admin)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { roles: { type: "array", items: { type: "string" } }, groups: { type: "array", items: { type: "string" } }, active: { type: "boolean" } } }), responses: ok(ref("User")) }
  },
  "/users/{id}/password": { post: { tags: ["IAM"], summary: "Set a user\u2019s password (admin)", parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { password: { type: "string" } } }), responses: { "204": { description: "Changed" } } } },
  "/groups": {
    get: { tags: ["IAM"], summary: "List groups (admin)", responses: ok(listOf("Group")) },
    post: { tags: ["IAM"], summary: "Create a group (admin)", requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, description: { type: "string" } } }), responses: created(ref("Group")) }
  },
  "/groups/{id}": { delete: { tags: ["IAM"], summary: "Delete a group (admin)", parameters: [idParam()], responses: { "204": { description: "Deleted" } } } },
  "/roles": {
    get: { tags: ["IAM"], summary: "List roles (admin)", responses: ok(listOf("Role")) },
    post: { tags: ["IAM"], summary: "Create a role (admin)", requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, permissions: { type: "array", items: { type: "string" } } } }), responses: created(ref("Role")) }
  },
  "/roles/{id}": {
    patch: { tags: ["IAM"], summary: 'Replace a role\u2019s permissions (admin; the built-in "admin" role is immutable)', parameters: [idParam()], requestBody: jsonBody({ type: "object", properties: { permissions: { type: "array", items: { type: "string" } } } }), responses: ok(ref("Role")) },
    delete: { tags: ["IAM"], summary: 'Delete a role (admin; the built-in "admin" role cannot be deleted)', parameters: [idParam()], responses: { "204": { description: "Deleted" } } }
  }
};
var openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "jBPM-style BPM Engine API",
    version: "0.1.0",
    description: "Node-native BPM engine REST API \u2014 authoring, versioning, deployment lifecycle, runtime process instances, human tasks, KIE-Server-style query & analytics, and IAM (users/groups/roles). `POST /auth/login` issues a JWT; send it as `Authorization: Bearer <token>` on every other request. Each route requires a permission granted by one of the caller\u2019s roles \u2014 see `DEFAULT_ROLES` in modules/iam/service.ts."
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
    { name: "Execution Errors" },
    { name: "Jobs & Timers" },
    { name: "Notifications" },
    { name: "Governance" },
    { name: "Query & Analytics" },
    { name: "Import/Export" },
    { name: "IAM" }
  ],
  components: {
    schemas,
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } }
  },
  security: [{ bearerAuth: [] }],
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

// src/http/routes/workflow-instances.ts
import { Router } from "express";

// src/http/route-context.ts
var ctxOf = (req2) => req2.ctx;
var actorOf = (req2) => req2.actor;

// src/http/auth-middleware.ts
function requireAuth(req2, _res, next) {
  const header = req2.header("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : void 0;
  if (!token) return next(authRequired());
  try {
    const claims = verifyToken(token);
    req2.user = claims;
    req2.actor = claims.username;
    next();
  } catch {
    next(authRequired("invalid or expired token"));
  }
}
function requirePermission(action) {
  return async (req2, _res, next) => {
    try {
      const user = req2.user;
      if (!user) throw authRequired();
      const ctx = req2.ctx;
      if (user.username === "admin" || Array.isArray(user.roles) && user.roles.includes("admin")) {
        return next();
      }
      const member = (await ctx.store.repo(Collections.tenantMembers).query((m) => {
        if (m.tenantId !== ctx.tenantId) return false;
        if (m.status !== "active") return false;
        if (user.sub && m.userId === user.sub) return true;
        if (user.username && m.email && m.email.toLowerCase() === user.username.toLowerCase()) return true;
        return false;
      }))[0];
      if (member) {
        if (member.role === "owner" || member.role === "admin" || member.role === "system_admin") {
          return next();
        }
        if (member.permissions && permissionGrants(member.permissions, action)) {
          return next();
        }
      }
      const roles = await ctx.store.repo(Collections.roles).query((r) => r.tenantId === ctx.tenantId && user.roles.includes(r.name));
      const perms = roles.flatMap((r) => r.permissions);
      if (!permissionGrants(perms, action)) throw forbidden(`missing permission: ${action}`);
      next();
    } catch (e) {
      next(e);
    }
  };
}
function requireWorkspaceAccess(req2, _res, next) {
  (async () => {
    try {
      const user = req2.user;
      if (!user) throw authRequired();
      const requestedTenantId = req2.headers["x-tenant-id"]?.trim() || req2.ctx?.tenantId || "default";
      const ctx = req2.ctx;
      const isSystemAdmin = user.username === "admin" || Array.isArray(user.roles) && user.roles.includes("admin");
      if (requestedTenantId === "all" || requestedTenantId === "*") {
        if (!isSystemAdmin) {
          throw forbidden("Platform system administrator access required for platform-wide scope.");
        }
        req2.ctx = makeContext({ store: ctx.store, tenantId: "all" });
        return next();
      }
      const tenants = await ctx.store.repo(Collections.tenants).query((t) => t.id === requestedTenantId);
      const tenant = tenants[0];
      if (!tenant) {
        throw forbidden(`Workspace "${requestedTenantId}" not found or access denied`);
      }
      if (tenant.status === "suspended") {
        throw forbidden("This workspace has been suspended. Contact support.");
      }
      if (tenant.status === "pending_verification") {
        throw forbidden("This workspace is pending activation.");
      }
      if (!isSystemAdmin) {
        const members = await ctx.store.repo(Collections.tenantMembers).query((m) => {
          if (m.tenantId !== requestedTenantId) return false;
          if (m.status !== "active") return false;
          if (user.sub && m.userId === user.sub) return true;
          if (user.username && m.email && m.email.toLowerCase() === user.username.toLowerCase()) return true;
          return false;
        });
        let hasAccess = members.length > 0;
        if (!hasAccess && user.sub) {
          const u = await ctx.store.repo(Collections.users).get(user.sub);
          if (u && u.tenantId === requestedTenantId && u.active) {
            hasAccess = true;
          }
        }
        if (!hasAccess) {
          throw forbidden("You are not a member of the requested workspace.");
        }
      }
      if (ctx.tenantId !== requestedTenantId) {
        req2.ctx = makeContext({ store: ctx.store, tenantId: requestedTenantId });
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}

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

// src/workflow-service/query-eval.ts
function getPath(obj, path6) {
  if (obj == null) return void 0;
  return path6.split(".").reduce((c, p) => c == null ? void 0 : c[p], obj);
}
function matchesOp(actual, op, expected) {
  switch (op) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return actual != null && expected != null && actual > expected;
    case "gte":
      return actual != null && expected != null && actual >= expected;
    case "lt":
      return actual != null && expected != null && actual < expected;
    case "lte":
      return actual != null && expected != null && actual <= expected;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "contains":
      return typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    default:
      return false;
  }
}
function matchesAllFilters(row, filters) {
  if (!filters?.length) return true;
  return filters.every((f) => matchesOp(getPath(row, f.field), f.op, f.value));
}
function evaluateQuery(rows, def28) {
  let filtered = rows.filter((r) => matchesAllFilters(r, def28.filters));
  if (def28.groupBy) {
    const buckets2 = /* @__PURE__ */ new Map();
    for (const r of filtered) {
      const key = String(getPath(r, def28.groupBy) ?? "(none)");
      let b = buckets2.get(key);
      if (!b) {
        b = { count: 0, durations: [] };
        buckets2.set(key, b);
      }
      b.count += 1;
      if (def28.metric === "avgDurationMs" && def28.durationFrom && def28.durationTo) {
        const from = Date.parse(String(getPath(r, def28.durationFrom) ?? ""));
        const to = Date.parse(String(getPath(r, def28.durationTo) ?? ""));
        if (!Number.isNaN(from) && !Number.isNaN(to)) b.durations.push(Math.max(0, to - from));
      }
    }
    const groups = [...buckets2].map(([key, b]) => ({
      key,
      count: b.count,
      ...def28.metric === "avgDurationMs" ? { avgDurationMs: b.durations.length ? Math.round(b.durations.reduce((a, x) => a + x, 0) / b.durations.length) : 0 } : {}
    }));
    return { groups };
  }
  if (def28.sort) {
    const { field, dir } = def28.sort;
    filtered = [...filtered].sort((a, b) => {
      const av = getPath(a, field), bv = getPath(b, field);
      const cmp = av == null ? -1 : bv == null ? 1 : av < bv ? -1 : av > bv ? 1 : 0;
      return dir === "desc" ? -cmp : cmp;
    });
  }
  if (def28.limit != null) filtered = filtered.slice(0, def28.limit);
  return { rows: filtered };
}

// src/workflow-service/store/generic-store.ts
var COLLECTIONS = {
  workflowDefinition: "workflow_definition",
  workflowInstance: "workflow_instance",
  workflowInstanceAudit: "workflow_instance_audit",
  workflowInstanceComment: "workflow_instance_comment",
  savedQuery: "saved_query"
};
var GenericWorkflowServiceStore = class {
  constructor(store2) {
    this.store = store2;
  }
  store;
  definitions() {
    return this.store.repo(COLLECTIONS.workflowDefinition);
  }
  instances() {
    return this.store.repo(COLLECTIONS.workflowInstance);
  }
  audits() {
    return this.store.repo(COLLECTIONS.workflowInstanceAudit);
  }
  comments() {
    return this.store.repo(COLLECTIONS.workflowInstanceComment);
  }
  savedQueries() {
    return this.store.repo(COLLECTIONS.savedQuery);
  }
  async runTypedQuery(entity, tenantId, definition) {
    const repo = entity === "workflowInstance" ? this.instances() : entity === "workflowInstanceAudit" ? this.audits() : this.comments();
    const rows = await repo.query((r) => r.tenantId === tenantId);
    return evaluateQuery(rows, definition);
  }
};

// src/workflow-service/store/index.ts
import { createRequire } from "module";
import { fileURLToPath as fileURLToPath2 } from "url";
var req = createRequire(fileURLToPath2(import.meta.url));
var genericCache = /* @__PURE__ */ new WeakMap();
var pgCached;
function resolveWorkflowServiceStore(genericStore) {
  if (config.store === "pg" && config.pgUrl) {
    if (!pgCached) {
      const { WorkflowServicePgStore } = req("./pg-store.ts");
      pgCached = new WorkflowServicePgStore(config.pgUrl);
    }
    return pgCached;
  }
  let s = genericCache.get(genericStore);
  if (!s) {
    s = new GenericWorkflowServiceStore(genericStore);
    genericCache.set(genericStore, s);
  }
  return s;
}

// src/workflow-service/services/workflow-definition-service.ts
import Ajv from "ajv";
var ajv = new Ajv({ allErrors: true, strict: false });
var compiledCache = /* @__PURE__ */ new WeakMap();
var WorkflowDefinitionService = class {
  constructor(ctx, store2) {
    this.ctx = ctx;
    this.store = store2;
  }
  ctx;
  store;
  repo() {
    return this.store.definitions();
  }
  async get(id) {
    const d = await this.repo().get(id);
    if (!d || d.tenantId !== this.ctx.tenantId) throw notFound("WorkflowDefinition");
    return d;
  }
  async getByName(name) {
    const [d] = await this.repo().query((x) => x.tenantId === this.ctx.tenantId && x.name === name);
    if (!d) throw notFound(`WorkflowDefinition "${name}"`);
    return d;
  }
  async list() {
    return (await this.repo().query((d) => d.tenantId === this.ctx.tenantId)).sort((a, b) => a.name.localeCompare(b.name));
  }
  async create(input, actor) {
    const name = (input.name || "").trim();
    if (!name) throw validation("name is required");
    if (!input.deploymentId?.trim()) throw validation("deploymentId is required");
    await new DeploymentService(this.ctx).get(input.deploymentId);
    const dupe = await this.repo().query((d) => d.tenantId === this.ctx.tenantId && d.name === name);
    if (dupe.length) throw conflict(`a workflow definition named "${name}" already exists`);
    const dataSchema = input.dataSchema || {};
    this.assertValidSchema(dataSchema);
    const now = this.ctx.clock();
    const def28 = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      name,
      deploymentId: input.deploymentId,
      dataSchema,
      schemaValidationEnabled: !!input.schemaValidationEnabled,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor
    };
    await this.repo().put(def28);
    await this.ctx.audit({ actor, kind: "workflowDefinition.created", deploymentId: def28.deploymentId, data: { id: def28.id, name } });
    return def28;
  }
  async update(id, patch, actor) {
    const d = await this.get(id);
    if (patch.deploymentId) await new DeploymentService(this.ctx).get(patch.deploymentId);
    if (patch.name && patch.name.trim() !== d.name) {
      const dupe = await this.repo().query((x) => x.tenantId === this.ctx.tenantId && x.id !== id && x.name === patch.name.trim());
      if (dupe.length) throw conflict(`a workflow definition named "${patch.name}" already exists`);
    }
    if (patch.dataSchema) this.assertValidSchema(patch.dataSchema);
    const next = {
      ...d,
      name: patch.name?.trim() || d.name,
      deploymentId: patch.deploymentId || d.deploymentId,
      dataSchema: patch.dataSchema ?? d.dataSchema,
      schemaValidationEnabled: patch.schemaValidationEnabled ?? d.schemaValidationEnabled,
      updatedAt: this.ctx.clock(),
      updatedBy: actor
    };
    await this.repo().put(next);
    await this.ctx.audit({ actor, kind: "workflowDefinition.updated", deploymentId: next.deploymentId, data: { id, changed: Object.keys(patch) } });
    return next;
  }
  assertValidSchema(schema) {
    try {
      this.compiled(schema);
    } catch (e) {
      throw validation(`invalid data schema: ${e.message}`);
    }
  }
  compiled(schema) {
    let v = compiledCache.get(schema);
    if (!v) {
      v = ajv.compile(schema);
      compiledCache.set(schema, v);
    }
    return v;
  }
  /** Validates `data` against `definition.dataSchema` — a no-op (never throws) when
   *  `schemaValidationEnabled` is false, matching the user's own framing: "if schema validation
   *  enabled that will be validated then updated, if disabled directly can be updated." */
  validateData(definition, data) {
    if (!definition.schemaValidationEnabled) return;
    const validate = this.compiled(definition.dataSchema);
    if (!validate(data)) {
      throw validation("workflowData failed schema validation", { errors: validate.errors });
    }
  }
};

// src/workflow-service/services/workflow-instance-service.ts
var WorkflowInstanceService = class {
  constructor(ctx, store2, emit4 = () => {
  }) {
    this.ctx = ctx;
    this.store = store2;
    this.definitions = new WorkflowDefinitionService(ctx, store2);
    this.bpmInstances = new InstanceService(ctx, emit4);
    this.tasksApi = new TaskService(ctx, emit4);
    this.deployments = new DeploymentService(ctx);
    this.queries = new QueryService(ctx);
  }
  ctx;
  store;
  definitions;
  bpmInstances;
  tasksApi;
  deployments;
  queries;
  repo() {
    return this.store.instances();
  }
  async get(id) {
    const w = await this.repo().get(id);
    if (!w || w.tenantId !== this.ctx.tenantId) throw notFound("WorkflowInstance");
    return w;
  }
  async list(filter = {}) {
    return (await this.repo().query((w) => w.tenantId === this.ctx.tenantId && (!filter.workflowName || w.workflowName === filter.workflowName) && (!filter.workflowDefinitionId || w.workflowDefinitionId === filter.workflowDefinitionId) && (!filter.status || w.status === filter.status) && (!filter.piid || w.piid === filter.piid))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  /** Convenience search into `data` (business fields) alongside the flat filters `list()` already
   *  covers — a plain-equality quick-search, not the full ad-hoc query engine (see
   *  query-engine-service.ts) which supports operators/groupBy/saved queries; this exists so "find a
   *  case by one of its own data fields" doesn't require reaching for the heavier tool. */
  async search(filter) {
    const base = await this.list({ workflowName: filter.workflowName, status: filter.status });
    if (!filter.data || !Object.keys(filter.data).length) return base;
    return base.filter((w) => Object.entries(filter.data).every(([k, v]) => w.data?.[k] === v));
  }
  /** Resolves the WorkflowDefinition by name, validates `workflowData` against its schema (a no-op
   *  if validation isn't enabled), creates the case row, then starts the underlying BPM instance and
   *  backfills `piid` — a BPM-start failure marks the case `status:'failed'` with `startError` rather
   *  than leaving it stuck at `'initiated'` forever or silently vanishing; the row always ends in a
   *  resolved, explainable state either way. */
  async create(input, actor) {
    if (!input.workflowName?.trim()) throw validation("workflowName is required");
    const def28 = await this.definitions.getByName(input.workflowName.trim());
    const data = input.workflowData ?? {};
    this.definitions.validateData(def28, data);
    const dep = await this.deployments.get(def28.deploymentId);
    const now = this.ctx.clock();
    let row = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      workflowDefinitionId: def28.id,
      workflowName: def28.name,
      deploymentId: def28.deploymentId,
      data,
      status: "initiated",
      piid: null,
      createdAt: now,
      createdBy: actor,
      updatedAt: now,
      updatedBy: actor
    };
    await this.repo().put(row);
    await this.addAudit(row.id, actor, "workflowInstance.created", { workflowName: def28.name });
    try {
      const bpm = await this.bpmInstances.start({ workflowId: dep.workflowId, deploymentId: def28.deploymentId, variables: input.variables || {} }, actor);
      row = { ...row, piid: bpm.id, status: bpm.status === "failed" ? "failed" : "active", updatedAt: this.ctx.clock(), updatedBy: actor };
      if (bpm.status === "failed") row.startError = bpm.error?.message;
      await this.repo().put(row);
      await this.addAudit(row.id, actor, "workflowInstance.bpmStarted", { piid: bpm.id, bpmStatus: bpm.status });
    } catch (e) {
      row = { ...row, status: "failed", startError: e.message, updatedAt: this.ctx.clock(), updatedBy: actor };
      await this.repo().put(row);
      await this.addAudit(row.id, actor, "workflowInstance.startFailed", { error: e.message });
    }
    return row;
  }
  /** Workflow-level status — an open, business-defined vocabulary (e.g. "Pending Review",
   *  "Escalated") tracked independently of the underlying BPM `Instance.status`, which stays whatever
   *  the engine says regardless of what a case's business status is set to. */
  async updateStatus(id, status, actor) {
    if (!status?.trim()) throw validation("status is required");
    const w = await this.get(id);
    const next = { ...w, status: status.trim(), updatedAt: this.ctx.clock(), updatedBy: actor };
    await this.repo().put(next);
    await this.addAudit(id, actor, "workflowInstance.statusChanged", { from: w.status, to: next.status });
    return next;
  }
  /** Replaces `data` wholesale (PUT semantics) — validated against the definition's schema if
   *  validation is enabled, applied as-is otherwise. */
  async updateData(id, data, actor) {
    const w = await this.get(id);
    const def28 = await this.definitions.get(w.workflowDefinitionId);
    this.definitions.validateData(def28, data);
    const next = { ...w, data, updatedAt: this.ctx.clock(), updatedBy: actor };
    await this.repo().put(next);
    await this.addAudit(id, actor, "workflowInstance.dataUpdated", {});
    return next;
  }
  async requirePiid(w) {
    if (!w.piid) throw conflict("this workflow instance has no BPM process instance yet (piid is unset)");
    return w.piid;
  }
  async signal(id, name, payload, actor) {
    const w = await this.get(id);
    const piid = await this.requirePiid(w);
    await this.addAudit(id, actor, "workflowInstance.signaled", { name });
    return this.bpmInstances.signal(piid, name, payload, actor);
  }
  /** Every Task at any depth under this case's BPM subtree — inside a sub-process, a call activity, a
   *  multi-instance fan-out, however many levels down — active or long since completed (and possibly
   *  delegated away from whoever originally got it; see the ownership-timeline analytics endpoint for
   *  reconstructing that history). */
  async tasks(id) {
    const w = await this.get(id);
    if (!w.piid) return [];
    const descendantIds = new Set((await this.bpmInstances.descendants(w.piid)).map((i) => i.id));
    return (await this.ctx.store.repo(Collections.tasks).query((t) => t.tenantId === this.ctx.tenantId && descendantIds.has(t.instanceId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async signals(id) {
    const w = await this.get(id);
    if (!w.piid) return null;
    const bpm = await this.bpmInstances.get(w.piid).catch(() => null);
    if (!bpm?.processId) return null;
    return this.queries.processSignals(bpm.processId);
  }
  /** Completes a specific task belonging to this case (at any depth) — the "user decision" action.
   *  Scoped through the case (not a bare taskId passthrough) so a caller can't accidentally act on a
   *  task from an unrelated instance just by guessing an id. */
  async decision(id, taskId, outputs, actor) {
    const mine = await this.tasks(id);
    if (!mine.some((t) => t.id === taskId)) throw notFound("Task on this workflow instance");
    const task = await this.tasksApi.complete(taskId, outputs, actor);
    await this.addAudit(id, actor, "workflowInstance.decision", { taskId, outputs });
    return task;
  }
  /** Delegates the case's current open task. If more than one task is open, `taskId` disambiguates —
   *  matches the plan's "current open task" convenience while still supporting the general case. */
  async delegate(id, to, actor, taskId) {
    const mine = await this.tasks(id);
    const open = mine.filter((t) => t.status !== "completed" && t.status !== "skipped" && t.status !== "exited" && t.status !== "error");
    const target = taskId ? open.find((t) => t.id === taskId) : open.length === 1 ? open[0] : void 0;
    if (!target) throw conflict(taskId ? "that task is not an open task on this workflow instance" : `${open.length} open tasks on this workflow instance \u2014 pass taskId to disambiguate`);
    const task = await this.tasksApi.delegate(target.id, to, actor);
    await this.addAudit(id, actor, "workflowInstance.delegated", { taskId: target.id, to });
    return task;
  }
  async aggregate(id) {
    const w = await this.get(id);
    const [bpmInstance, tasks, signals, comments, audits] = await Promise.all([
      w.piid ? this.bpmInstances.get(w.piid).catch(() => null) : Promise.resolve(null),
      this.tasks(id),
      this.signals(id),
      this.listComments(id),
      this.listAudits(id)
    ]);
    return { workflowInstance: w, bpmInstance, tasks, signals, commentCount: comments.length, auditCount: audits.length };
  }
  // ---- comments (dedicated table — see domain.ts's doc comment on why this isn't the shared Collections.comments) ----
  async listComments(id) {
    await this.get(id);
    return (await this.store.comments().query((c) => c.tenantId === this.ctx.tenantId && c.workflowInstanceId === id)).sort((a, b) => a.at.localeCompare(b.at));
  }
  async addComment(id, body, author) {
    await this.get(id);
    if (!body?.trim()) throw validation("comment body is required");
    const c = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, workflowInstanceId: id, author, body: body.trim(), at: this.ctx.clock() };
    await this.store.comments().put(c);
    await this.addAudit(id, author, "workflowInstance.commented", {});
    return c;
  }
  async deleteComment(id, commentId, actor) {
    await this.get(id);
    const c = await this.store.comments().get(commentId);
    if (!c || c.tenantId !== this.ctx.tenantId || c.workflowInstanceId !== id) throw notFound("Comment");
    if (c.author !== actor) throw validation("only the comment author can delete it");
    await this.store.comments().delete(commentId);
    await this.addAudit(id, actor, "workflowInstance.comment.deleted", {});
  }
  // ---- audit (dedicated table) — see domain.ts's doc comment on why this isn't the shared Collections.audit ----
  async listAudits(id) {
    await this.get(id);
    return (await this.store.audits().query((a) => a.tenantId === this.ctx.tenantId && a.workflowInstanceId === id)).sort((a, b) => b.at.localeCompare(a.at));
  }
  /** System-generated audit entries flow through here too (every mutating method above calls this) —
   *  it's also exposed to callers directly so a manual, out-of-band audit note can be recorded, per
   *  the user's own requirement ("create audits" alongside "create comments"). */
  async addAudit(id, actor, kind, data) {
    const a = { id: this.ctx.newId(), tenantId: this.ctx.tenantId, workflowInstanceId: id, actor, kind, data, at: this.ctx.clock() };
    await this.store.audits().put(a);
    return a;
  }
  async deleteAudit(id, auditId, actor) {
    await this.get(id);
    const a = await this.store.audits().get(auditId);
    if (!a || a.tenantId !== this.ctx.tenantId || a.workflowInstanceId !== id) throw notFound("Audit entry");
    await this.store.audits().delete(auditId);
  }
};

// src/workflow-service/services/workflow-analytics-service.ts
var durationMs2 = (from, to) => from && to ? Math.max(0, Date.parse(to) - Date.parse(from)) : void 0;
var WorkflowAnalyticsService = class {
  constructor(ctx, store2) {
    this.ctx = ctx;
    this.store = store2;
    this.bpmInstances = new InstanceService(ctx);
    this.tasksApi = new TaskService(ctx);
    this.queries = new QueryService(ctx);
  }
  ctx;
  store;
  bpmInstances;
  tasksApi;
  queries;
  isAll() {
    return this.ctx.tenantId === "all" || this.ctx.tenantId === "*";
  }
  async summary() {
    const isAll = this.isAll();
    const cases = await this.store.instances().query((w) => isAll || w.tenantId === this.ctx.tenantId);
    const byStatus = {};
    for (const c of cases) byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    return { total: cases.length, byStatus, withoutPiid: cases.filter((c) => !c.piid).length };
  }
  /** TAT by case type (workflow definition name) uses the underlying BPM instance's own
   *  `startedAt`/`endedAt` — well-defined regardless of whatever free-form business `status` string a
   *  case is in — rather than the case's own `status`, which has no fixed "this means done" value.
   *  TAT by user reuses the existing task-level analytics unchanged. */
  async tat() {
    const isAll = this.isAll();
    const cases = await this.store.instances().query((w) => (isAll || w.tenantId === this.ctx.tenantId) && !!w.piid);
    const byName = /* @__PURE__ */ new Map();
    for (const c of cases) {
      const bpm = await this.bpmInstances.get(c.piid).catch(() => null);
      const ms = bpm ? durationMs2(bpm.startedAt, bpm.endedAt) : void 0;
      if (ms == null) continue;
      (byName.get(c.workflowName) ?? byName.set(c.workflowName, []).get(c.workflowName)).push(ms);
    }
    const stats2 = (v) => ({ count: v.length, avgMs: v.length ? Math.round(v.reduce((a, x) => a + x, 0) / v.length) : 0, minMs: v.length ? Math.min(...v) : 0, maxMs: v.length ? Math.max(...v) : 0 });
    const byWorkflowName = [...byName].map(([workflowName, v]) => ({ workflowName, ...stats2(v) }));
    const taskAnalytics = await this.queries.taskAnalytics();
    return { byWorkflowName, byUser: taskAnalytics.byAssignee };
  }
  /** Reconstructs how long EACH holder actually held a task, from its own audit trail
   *  (`task.delegated`/`task.forwarded` events carry `data.{from,to}` — see modules/tasks/service.ts).
   *  Segments always partition [task.createdAt, task.completedAt-or-now] contiguously — no gaps, no
   *  overlaps, by construction — so `segments` always sums to `totalMs`. With zero hand-offs, this
   *  collapses to the exact same single-holder duration `QueryService.taskAnalytics()` already
   *  attributes to `completedBy || assignee` — this is a strict refinement, not a contradiction. */
  async ownershipTimeline(taskId) {
    const task = await this.tasksApi.get(taskId);
    const events = (await this.tasksApi.events(taskId)).filter((e) => e.kind === "task.delegated" || e.kind === "task.forwarded").sort((a, b) => a.at.localeCompare(b.at));
    const end = task.completedAt || this.ctx.clock();
    const segments = [];
    let holder = events.length ? events[0].data?.from || task.group || "(unassigned)" : task.completedBy || task.assignee || task.group || "(unassigned)";
    let start2 = task.createdAt;
    for (const e of events) {
      segments.push({ holder, from: start2, to: e.at, durationMs: durationMs2(start2, e.at) ?? 0 });
      holder = e.data?.to || "(unassigned)";
      start2 = e.at;
    }
    segments.push({ holder, from: start2, to: end, durationMs: durationMs2(start2, end) ?? 0 });
    return { taskId, segments, totalMs: segments.reduce((a, s) => a + s.durationMs, 0) };
  }
  /** Every task at any depth under `rootPiid`'s BPM subtree, active or completed — the
   *  "all tasks/processes/subprocesses at any level" cross-cutting view. Each entry's `instance`
   *  shows which specific (possibly nested) BPM instance the task actually belongs to. */
  async tasksAndProcesses(rootPiid) {
    const instances = await this.bpmInstances.descendants(rootPiid);
    if (!instances.length) throw notFound("BPM instance");
    const ids = new Set(instances.map((i) => i.id));
    const tasks = (await this.ctx.store.repo(Collections.tasks).query((t) => t.tenantId === this.ctx.tenantId && ids.has(t.instanceId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { instances, tasks };
  }
};

// src/workflow-service/services/query-engine-service.ts
var TYPED_ENTITIES = ["workflowInstance", "workflowInstanceAudit", "workflowInstanceComment"];
var MAX_LIMIT = 500;
var VALID_OPS = /* @__PURE__ */ new Set(["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]);
var QueryEngineService = class {
  constructor(ctx, store2) {
    this.ctx = ctx;
    this.store = store2;
  }
  ctx;
  store;
  assertValidDefinition(def28) {
    const entities = [...TYPED_ENTITIES, "instance", "task"];
    if (!entities.includes(def28.entity)) throw validation(`entity must be one of: ${entities.join(", ")}`);
    for (const f of def28.filters || []) {
      if (!f.field || typeof f.field !== "string") throw validation("every filter needs a field");
      if (!VALID_OPS.has(f.op)) throw validation(`unsupported filter op "${f.op}"`);
    }
    if (def28.limit != null && (typeof def28.limit !== "number" || def28.limit < 1)) throw validation("limit must be a positive number");
  }
  async run(definition) {
    this.assertValidDefinition(definition);
    const capped = { ...definition, limit: Math.min(definition.limit ?? 100, MAX_LIMIT) };
    if (TYPED_ENTITIES.includes(capped.entity)) {
      return this.store.runTypedQuery(capped.entity, this.ctx.tenantId, capped);
    }
    const collection = capped.entity === "instance" ? Collections.instances : Collections.tasks;
    const rows = await this.ctx.store.repo(collection).query((r) => r.tenantId === this.ctx.tenantId);
    return evaluateQuery(rows, capped);
  }
  // ---- saved queries ----
  async list(actor) {
    return (await this.store.savedQueries().query((q2) => q2.tenantId === this.ctx.tenantId && (!q2.ownerId || q2.ownerId === actor))).sort((a, b) => a.name.localeCompare(b.name));
  }
  async get(id, actor) {
    const q2 = await this.store.savedQueries().get(id);
    if (!q2 || q2.tenantId !== this.ctx.tenantId || q2.ownerId && q2.ownerId !== actor) throw notFound("SavedQuery");
    return q2;
  }
  async save(input, actor) {
    if (!input.name?.trim()) throw validation("name is required");
    this.assertValidDefinition(input.definition);
    const q2 = {
      id: this.ctx.newId(),
      tenantId: this.ctx.tenantId,
      name: input.name.trim(),
      definition: input.definition,
      ownerId: input.shared ? void 0 : actor,
      createdAt: this.ctx.clock(),
      createdBy: actor
    };
    await this.store.savedQueries().put(q2);
    await this.ctx.audit({ actor, kind: "savedQuery.created", data: { id: q2.id, name: q2.name } });
    return q2;
  }
  async runSaved(id, actor) {
    const q2 = await this.get(id, actor);
    return this.run(q2.definition);
  }
  async delete(id, actor) {
    const q2 = await this.get(id, actor);
    if (q2.createdBy !== actor) throw forbidden("only the creator can delete a saved query");
    await this.store.savedQueries().delete(id);
    await this.ctx.audit({ actor, kind: "savedQuery.deleted", data: { id } });
  }
};

// src/http/routes/workflow-instances.ts
var perm = requirePermission;
var emit2 = hub.engineEmit;
var wfStore = (req2) => resolveWorkflowServiceStore(ctxOf(req2).store);
var defs = (req2) => new WorkflowDefinitionService(ctxOf(req2), wfStore(req2));
var insts = (req2) => new WorkflowInstanceService(ctxOf(req2), wfStore(req2), emit2);
var analytics = (req2) => new WorkflowAnalyticsService(ctxOf(req2), wfStore(req2));
var qe = (req2) => new QueryEngineService(ctxOf(req2), wfStore(req2));
function buildWorkflowInstanceRoutes() {
  const r = Router();
  r.post("/workflow-definitions", perm("workflowInstance:admin"), asyncHandler(async (req2, res) => res.status(201).json(await defs(req2).create(req2.body || {}, actorOf(req2)))));
  r.get("/workflow-definitions", perm("workflowInstance:admin"), asyncHandler(async (req2, res) => res.json({ items: await defs(req2).list() })));
  r.get("/workflow-definitions/:id", perm("workflowInstance:admin"), asyncHandler(async (req2, res) => res.json(await defs(req2).get(req2.params.id))));
  r.patch("/workflow-definitions/:id", perm("workflowInstance:admin"), asyncHandler(async (req2, res) => res.json(await defs(req2).update(req2.params.id, req2.body || {}, actorOf(req2)))));
  r.post("/workflow-instances", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.status(201).json(await insts(req2).create(req2.body || {}, actorOf(req2)))));
  r.get("/workflow-instances", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json({ items: await insts(req2).list(req2.query) })));
  r.post("/workflow-instances/search", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json({ items: await insts(req2).search(req2.body || {}) })));
  r.get("/workflow-instances/:id", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json(await insts(req2).aggregate(req2.params.id))));
  r.patch("/workflow-instances/:id/status", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json(await insts(req2).updateStatus(req2.params.id, req2.body?.status, actorOf(req2)))));
  r.put("/workflow-instances/:id/data", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json(await insts(req2).updateData(req2.params.id, req2.body || {}, actorOf(req2)))));
  r.post("/workflow-instances/:id/signal", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json(await insts(req2).signal(req2.params.id, req2.body?.name, req2.body?.payload, actorOf(req2)))));
  r.post("/workflow-instances/:id/tasks/:taskId/decision", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json(await insts(req2).decision(req2.params.id, req2.params.taskId, req2.body?.outputs || {}, actorOf(req2)))));
  r.post("/workflow-instances/:id/delegate", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json(await insts(req2).delegate(req2.params.id, req2.body?.to, actorOf(req2), req2.body?.taskId))));
  r.get("/workflow-instances/:id/tasks", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json({ items: await insts(req2).tasks(req2.params.id) })));
  r.get("/workflow-instances/:id/signals", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json(await insts(req2).signals(req2.params.id))));
  r.get("/workflow-instances/:id/comments", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json({ items: await insts(req2).listComments(req2.params.id) })));
  r.post("/workflow-instances/:id/comments", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.status(201).json(await insts(req2).addComment(req2.params.id, req2.body?.body, actorOf(req2)))));
  r.delete("/workflow-instances/:id/comments/:commentId", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => {
    await insts(req2).deleteComment(req2.params.id, req2.params.commentId, actorOf(req2));
    res.status(204).end();
  }));
  r.get("/workflow-instances/:id/audits", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.json({ items: await insts(req2).listAudits(req2.params.id) })));
  r.post("/workflow-instances/:id/audits", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => res.status(201).json(await insts(req2).addAudit(req2.params.id, actorOf(req2), req2.body?.kind || "workflowInstance.note", req2.body?.data))));
  r.delete("/workflow-instances/:id/audits/:auditId", perm("workflowInstance:manage"), asyncHandler(async (req2, res) => {
    await insts(req2).deleteAudit(req2.params.id, req2.params.auditId, actorOf(req2));
    res.status(204).end();
  }));
  r.get("/workflow-analytics/summary", perm("query:read"), asyncHandler(async (req2, res) => res.json(await analytics(req2).summary())));
  r.get("/workflow-analytics/tat", perm("query:read"), asyncHandler(async (req2, res) => res.json(await analytics(req2).tat())));
  r.get("/workflow-instances/:id/tasks/:taskId/ownership-timeline", perm("query:read"), asyncHandler(async (req2, res) => res.json(await analytics(req2).ownershipTimeline(req2.params.taskId))));
  r.get("/analytics/tasks-and-processes/:piid", perm("query:read"), asyncHandler(async (req2, res) => res.json(await analytics(req2).tasksAndProcesses(req2.params.piid))));
  r.post("/analytics/query/run", perm("analytics:query"), asyncHandler(async (req2, res) => res.json(await qe(req2).run(req2.body || {}))));
  r.get("/analytics/queries", perm("analytics:query"), asyncHandler(async (req2, res) => res.json({ items: await qe(req2).list(actorOf(req2)) })));
  r.post("/analytics/queries", perm("analytics:query"), asyncHandler(async (req2, res) => res.status(201).json(await qe(req2).save(req2.body || {}, actorOf(req2)))));
  r.post("/analytics/queries/:id/run", perm("analytics:query"), asyncHandler(async (req2, res) => res.json(await qe(req2).runSaved(req2.params.id, actorOf(req2)))));
  r.delete("/analytics/queries/:id", perm("analytics:query"), asyncHandler(async (req2, res) => {
    await qe(req2).delete(req2.params.id, actorOf(req2));
    res.status(204).end();
  }));
  return r;
}

// src/http/rate-limit.ts
var buckets = /* @__PURE__ */ new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 5 * 6e4).unref?.();
function rateLimit(opts) {
  const keyOf = opts.keyOf || ((req2) => req2.user?.sub || req2.ip || "anon");
  return (req2, _res, next) => {
    const key = `${req2.method} ${req2.baseUrl}${req2.path}::${keyOf(req2)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > opts.max) return next(rateLimited(`rate limit exceeded (max ${opts.max} per ${Math.round(opts.windowMs / 1e3)}s) \u2014 try again shortly`));
    next();
  };
}

// src/http/routes.ts
var ctxOf2 = (req2) => req2.ctx;
var actorOf2 = (req2) => req2.actor;
var emit3 = hub.engineEmit;
var perm2 = requirePermission;
var startLimiter = rateLimit({ windowMs: 6e4, max: 120 });
var deployLimiter = rateLimit({ windowMs: 6e4, max: 20 });
var importLimiter = rateLimit({ windowMs: 6e4, max: 20 });
function buildRoutes() {
  const r = Router2();
  r.get("/openapi.json", (_req, res) => res.json(openapiSpec));
  r.get("/docs", (_req, res) => res.type("html").send(swaggerHtml));
  r.get("/catalog/nodes", (_req, res) => res.json({
    categories: CATEGORIES,
    nodes: NODE_DEFS.flatMap((d) => d.palette),
    // palette tiles
    schemas: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.schema])),
    // engineType → property form
    ports: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.ports])),
    // engineType → { in, out }
    diagram: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.diagram])),
    // engineType → { icon, color, shape } for diagram rendering
    typeLabels: Object.fromEntries(NODE_DEFS.map((d) => [d.engineType, d.typeLabel]))
    // engineType → neutral display name
  }));
  r.get("/catalog/nodes/:engineType", (req2, res) => {
    const def28 = NODE_DEF_BY_TYPE[req2.params.engineType];
    if (!def28) return res.status(404).json({ error: { code: "NOT_FOUND", message: "node type not found" } });
    res.json(def28);
  });
  r.get("/catalog/processes", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const ctx = ctxOf2(req2);
    const deployments = await new DeploymentService(ctx).list({ status: "active" });
    const wfNames = /* @__PURE__ */ new Map();
    const wfSvc = new WorkflowService(ctx);
    const items = [];
    for (const dep of deployments) {
      if (!wfNames.has(dep.workflowId)) {
        const wf = await wfSvc.get(dep.workflowId).catch(() => null);
        wfNames.set(dep.workflowId, wf?.name || dep.workflowId);
      }
      for (const p of dep.engine?.processes || []) {
        items.push({ id: p.id, name: p.name || p.id, workflowId: dep.workflowId, workflowName: wfNames.get(dep.workflowId), environment: dep.environment, vars: p.vars || [] });
      }
    }
    res.json({ items });
  }));
  r.post("/validate", asyncHandler(async (req2, res) => res.json(await new ValidationService().validate(req2.body?.engine?.processes?.[0] || req2.body?.process || req2.body))));
  r.post("/import/jbpm", perm2("workflow:edit"), importLimiter, asyncHandler(async (req2, res) => res.status(201).json(await new ImportService(ctxOf2(req2)).importKjar(req2.body?.files, req2.body?.name, actorOf2(req2)))));
  r.post("/import/jbpm/deploy", perm2("workflow:deploy"), importLimiter, asyncHandler(async (req2, res) => res.status(201).json(await new ImportService(ctxOf2(req2)).importAndDeploy(
    req2.body?.files,
    req2.body?.name,
    actorOf2(req2),
    { environment: req2.body?.environment || "prod", tags: req2.body?.tags, env: req2.body?.env }
  ))));
  r.get("/folders", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new FolderService(ctxOf2(req2)).list() })));
  r.post("/folders", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.status(201).json(await new FolderService(ctxOf2(req2)).create(req2.body, actorOf2(req2)))));
  r.get("/folders/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new FolderService(ctxOf2(req2)).get(req2.params.id))));
  r.patch("/folders/:id", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.json(await new FolderService(ctxOf2(req2)).update(req2.params.id, req2.body, actorOf2(req2)))));
  r.delete("/folders/:id", perm2("workflow:edit"), asyncHandler(async (req2, res) => {
    await new FolderService(ctxOf2(req2)).delete(req2.params.id);
    res.status(204).end();
  }));
  r.get("/workflows", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new WorkflowService(ctxOf2(req2)).list() })));
  r.post("/workflows", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.status(201).json(await new WorkflowService(ctxOf2(req2)).create(req2.body, actorOf2(req2)))));
  r.get("/workflows/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new WorkflowService(ctxOf2(req2)).get(req2.params.id))));
  r.patch("/workflows/:id", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.json(await new WorkflowService(ctxOf2(req2)).update(req2.params.id, req2.body, actorOf2(req2)))));
  r.delete("/workflows/:id", perm2("workflow:edit"), asyncHandler(async (req2, res) => {
    await new WorkflowService(ctxOf2(req2)).archive(req2.params.id, actorOf2(req2));
    res.status(204).end();
  }));
  r.put("/workflows/:id/permissions", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.json(await new WorkflowService(ctxOf2(req2)).setPermissions(req2.params.id, req2.body, actorOf2(req2)))));
  r.put("/workflows/:id/variables", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.json(await new WorkflowService(ctxOf2(req2)).setVariables(req2.params.id, req2.body, actorOf2(req2)))));
  r.get("/workflows/:id/processes", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new ProcessService(ctxOf2(req2)).list(req2.params.id) })));
  r.post("/workflows/:id/processes", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.status(201).json(await new ProcessService(ctxOf2(req2)).add(req2.params.id, req2.body?.name, actorOf2(req2)))));
  r.get("/workflows/:id/processes/:pid", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new ProcessService(ctxOf2(req2)).getProcess(req2.params.id, req2.params.pid))));
  r.put("/workflows/:id/processes/:pid", perm2("workflow:edit"), asyncHandler(async (req2, res) => {
    await new ProcessService(ctxOf2(req2)).saveProcess(req2.params.id, req2.params.pid, req2.body?.process || req2.body, actorOf2(req2));
    res.json({ ok: true });
  }));
  r.patch("/workflows/:id/processes/:pid", perm2("workflow:edit"), asyncHandler(async (req2, res) => {
    await new ProcessService(ctxOf2(req2)).rename(req2.params.id, req2.params.pid, req2.body?.name, actorOf2(req2));
    res.json({ ok: true });
  }));
  r.delete("/workflows/:id/processes/:pid", perm2("workflow:edit"), asyncHandler(async (req2, res) => {
    await new ProcessService(ctxOf2(req2)).remove(req2.params.id, req2.params.pid, actorOf2(req2));
    res.status(204).end();
  }));
  r.get("/workflows/:id/engine", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new ProcessService(ctxOf2(req2)).getEngine(req2.params.id))));
  r.get("/workflows/:id/export-engine", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new ProcessService(ctxOf2(req2)).getEngine(req2.params.id))));
  r.get("/workflows/:id/jbpm-compatibility", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const engine = await new ProcessService(ctxOf2(req2)).getEngine(req2.params.id);
    res.json(validateJbpmExport(engine));
  }));
  r.get("/workflows/:id/assets", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new AssetsService(ctxOf2(req2)).list(req2.params.id))));
  r.post("/workflows/:id/assets", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.status(201).json(await new AssetsService(ctxOf2(req2)).add(req2.params.id, req2.body?.kind, req2.body?.name, actorOf2(req2), req2.body?.fields))));
  r.get("/workflows/:id/assets/:kind/:name", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new AssetsService(ctxOf2(req2)).get(req2.params.id, req2.params.kind, req2.params.name))));
  r.patch("/workflows/:id/assets/:kind/:name", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.json(await new AssetsService(ctxOf2(req2)).update(req2.params.id, req2.params.kind, req2.params.name, req2.body || {}, actorOf2(req2)))));
  r.post("/workflows/:id/assets/:kind/:name/test", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new AssetsService(ctxOf2(req2)).testAsset(req2.params.id, req2.params.kind, req2.params.name, req2.body || {}))));
  r.delete("/workflows/:id/assets/:kind/:name", perm2("workflow:edit"), asyncHandler(async (req2, res) => {
    await new AssetsService(ctxOf2(req2)).remove(req2.params.id, req2.params.kind, req2.params.name, actorOf2(req2));
    res.status(204).end();
  }));
  r.get("/workflows/:id/branches", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new BranchService(ctxOf2(req2)).listByWorkflow(req2.params.id) })));
  r.post("/workflows/:id/branches", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.status(201).json(await new BranchService(ctxOf2(req2)).create(req2.params.id, req2.body, actorOf2(req2)))));
  r.get("/branches/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new BranchService(ctxOf2(req2)).get(req2.params.id))));
  r.get("/branches/:id/versions", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new VersionService(ctxOf2(req2)).listByBranch(req2.params.id) })));
  r.post("/branches/:id/versions", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.status(201).json(await new VersionService(ctxOf2(req2)).saveDraft(req2.params.id, req2.body.engine, actorOf2(req2), req2.body.message))));
  r.get("/versions/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new VersionService(ctxOf2(req2)).get(req2.params.id))));
  r.post("/versions/:id/publish", perm2("workflow:edit"), asyncHandler(async (req2, res) => res.json(await new VersionService(ctxOf2(req2)).publish(req2.params.id, actorOf2(req2), req2.body?.label))));
  r.post("/versions/:id/validate", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new VersionService(ctxOf2(req2)).validate(req2.params.id))));
  r.get("/versions/:a/diff/:b", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new VersionService(ctxOf2(req2)).diff(req2.params.a, req2.params.b))));
  r.post("/versions/:id/deploy", perm2("workflow:deploy"), deployLimiter, asyncHandler(async (req2, res) => res.status(201).json(await new DeploymentService(ctxOf2(req2)).deploy(req2.params.id, req2.body, actorOf2(req2)))));
  r.get("/versions/:id/export", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const v = await new VersionService(ctxOf2(req2)).get(req2.params.id);
    res.json(exportKjar(v.engine));
  }));
  r.get("/versions/:id/export-engine", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const v = await new VersionService(ctxOf2(req2)).get(req2.params.id);
    res.json(v.engine);
  }));
  r.get("/versions/:id/jbpm-compatibility", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const v = await new VersionService(ctxOf2(req2)).get(req2.params.id);
    res.json(validateJbpmExport(v.engine));
  }));
  r.get("/deployments", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new DeploymentService(ctxOf2(req2)).list(req2.query) })));
  r.get("/workflows/:id/deployments", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new DeploymentService(ctxOf2(req2)).listByWorkflow(req2.params.id) })));
  r.get("/deployments/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new DeploymentService(ctxOf2(req2)).get(req2.params.id))));
  r.post("/deployments/:id/tags", perm2("workflow:deploy"), asyncHandler(async (req2, res) => res.json(await new DeploymentService(ctxOf2(req2)).setTags(req2.params.id, req2.body, actorOf2(req2)))));
  r.post("/deployments/:id/activate", perm2("workflow:deploy"), asyncHandler(async (req2, res) => res.json(await new DeploymentService(ctxOf2(req2)).activate(req2.params.id, actorOf2(req2)))));
  r.post("/deployments/:id/rollback", perm2("workflow:deploy"), asyncHandler(async (req2, res) => res.json(await new DeploymentService(ctxOf2(req2)).rollback(req2.body.environment, req2.body.toDeploymentId, actorOf2(req2)))));
  r.post("/deployments/:id/undeploy", perm2("workflow:deploy"), asyncHandler(async (req2, res) => res.json(await new DeploymentService(ctxOf2(req2)).undeploy(req2.params.id, actorOf2(req2)))));
  r.post("/deployments/:id/archive", perm2("workflow:deploy"), asyncHandler(async (req2, res) => res.json(await new DeploymentService(ctxOf2(req2)).archive(req2.params.id, actorOf2(req2)))));
  r.get("/deployments/:id/export", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const d = await new DeploymentService(ctxOf2(req2)).get(req2.params.id);
    res.json(exportKjar(d.engine));
  }));
  r.get("/deployments/:id/definitions", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const d = await new DeploymentService(ctxOf2(req2)).get(req2.params.id);
    res.json({ items: (d.engine.processes || []).map((p) => ({ id: p.id, name: p.name || p.id, nodes: (p.nodes || []).length, startable: (p.nodes || []).some((n) => n.type === "start") })) });
  }));
  r.post("/instances", perm2("workflow:run"), startLimiter, asyncHandler(async (req2, res) => res.status(201).json(await new InstanceService(ctxOf2(req2), emit3).start(req2.body, actorOf2(req2)))));
  r.get("/instances", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new InstanceService(ctxOf2(req2)).list(req2.query) })));
  r.get("/instances/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).get(req2.params.id))));
  r.get("/instances/:id/history", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).history(req2.params.id))));
  r.get("/instances/:id/diagram-state", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).diagramState(req2.params.id))));
  r.get("/instances/:id/graph", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).graph(req2.params.id))));
  r.get("/instances/:id/related", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).related(req2.params.id))));
  r.post("/instances/:id/signal", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2), emit3).signal(req2.params.id, req2.body?.name, req2.body?.payload, actorOf2(req2)))));
  r.post("/instances/:id/retry", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2), emit3).retry(req2.params.id, req2.body?.nodeId, actorOf2(req2)))));
  r.post("/instances/:id/suspend", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).suspend(req2.params.id, actorOf2(req2)))));
  r.post("/instances/:id/resume", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).resumeInstance(req2.params.id, actorOf2(req2)))));
  r.post("/instances/:id/abort", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).abort(req2.params.id, actorOf2(req2)))));
  r.put("/instances/:id/variables", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await new InstanceService(ctxOf2(req2)).updateVariables(req2.params.id, req2.body || {}, actorOf2(req2)))));
  r.get("/instances/:id/variable-history", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await new InstanceService(ctxOf2(req2)).variableHistory(req2.params.id, req2.query.name) })));
  r.get("/tasks", perm2("task:manage"), asyncHandler(async (req2, res) => res.json({ items: await new TaskService(ctxOf2(req2)).list({ ...req2.query, overdue: req2.query.overdue === "true" }) })));
  r.get("/tasks/:id", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).get(req2.params.id))));
  r.post("/tasks/:id/claim", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).claim(req2.params.id, actorOf2(req2)))));
  r.post("/tasks/:id/release", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).release(req2.params.id, actorOf2(req2)))));
  r.post("/tasks/:id/complete", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2), emit3).complete(req2.params.id, req2.body?.outputs || {}, actorOf2(req2)))));
  r.post("/tasks/:id/skip", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2), emit3).skip(req2.params.id, actorOf2(req2)))));
  r.post("/tasks/:id/start", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).start(req2.params.id, actorOf2(req2)))));
  r.post("/tasks/:id/stop", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).stop(req2.params.id, actorOf2(req2)))));
  r.post("/tasks/:id/save", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).saveOutputs(req2.params.id, req2.body?.outputs || {}, actorOf2(req2)))));
  r.post("/tasks/:id/delegate", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).delegate(req2.params.id, req2.body?.to, actorOf2(req2)))));
  r.post("/tasks/:id/forward", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).forward(req2.params.id, { user: req2.body?.user, group: req2.body?.group }, actorOf2(req2)))));
  r.post("/tasks/:id/remind", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).remind(req2.params.id, actorOf2(req2)))));
  r.patch("/tasks/:id", perm2("task:manage"), asyncHandler(async (req2, res) => res.json(await new TaskService(ctxOf2(req2)).update(req2.params.id, { priority: req2.body?.priority, dueAt: req2.body?.dueAt }, actorOf2(req2)))));
  r.get("/tasks/:id/comments", perm2("task:manage"), asyncHandler(async (req2, res) => res.json({ items: await new TaskService(ctxOf2(req2)).listComments(req2.params.id) })));
  r.post("/tasks/:id/comments", perm2("task:manage"), asyncHandler(async (req2, res) => res.status(201).json(await new TaskService(ctxOf2(req2)).addComment(req2.params.id, req2.body?.body, actorOf2(req2)))));
  r.delete("/tasks/:id/comments/:cid", perm2("task:manage"), asyncHandler(async (req2, res) => {
    await new TaskService(ctxOf2(req2)).deleteComment(req2.params.id, req2.params.cid, actorOf2(req2));
    res.status(204).end();
  }));
  r.get("/tasks/:id/events", perm2("task:manage"), asyncHandler(async (req2, res) => res.json({ items: await new TaskService(ctxOf2(req2)).events(req2.params.id) })));
  const errs = (req2) => new ErrorService(ctxOf2(req2));
  r.get("/errors", perm2("workflow:view"), asyncHandler(async (req2, res) => {
    const { type, acknowledged, limit, offset, ...rest } = req2.query;
    res.json(await errs(req2).list({
      ...rest,
      type: type ? type.split(",") : void 0,
      acknowledged: acknowledged === void 0 ? void 0 : acknowledged === "true",
      limit: limit ? Number(limit) : void 0,
      offset: offset ? Number(offset) : void 0
    }));
  }));
  r.get("/errors/summary", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await errs(req2).summary())));
  r.get("/errors/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await errs(req2).get(req2.params.id))));
  r.post("/errors/:id/ack", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await errs(req2).acknowledge(req2.params.id, actorOf2(req2)))));
  r.post("/errors/ack", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json({ results: await errs(req2).acknowledgeMany(req2.body?.ids || [], actorOf2(req2)) })));
  const timers2 = (req2) => new TimerService(ctxOf2(req2), emit3);
  r.get("/jobs", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json({ items: await timers2(req2).list(req2.query) })));
  r.get("/jobs/:id", perm2("workflow:view"), asyncHandler(async (req2, res) => res.json(await timers2(req2).getJob(req2.params.id))));
  r.post("/jobs/:id/cancel", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await timers2(req2).cancel(req2.params.id, actorOf2(req2)))));
  r.post("/jobs/:id/trigger", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await timers2(req2).trigger(req2.params.id, actorOf2(req2)))));
  r.post("/jobs/:id/reschedule", perm2("workflow:run"), asyncHandler(async (req2, res) => res.json(await timers2(req2).rescheduleJob(req2.params.id, req2.body?.dueAt, actorOf2(req2)))));
  r.get("/audit", perm2("admin:iam"), asyncHandler(async (req2, res) => {
    const { limit, offset, ...rest } = req2.query;
    res.json(await new AuditService(ctxOf2(req2)).list({ ...rest, limit: limit ? Number(limit) : void 0, offset: offset ? Number(offset) : void 0 }));
  }));
  r.get("/audit/facets", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json(await new AuditService(ctxOf2(req2)).facets())));
  r.get("/notifications", asyncHandler(async (req2, res) => res.json(await new NotificationService(ctxOf2(req2)).listFor(actorOf2(req2), { unread: req2.query.unread === "true", limit: req2.query.limit ? Number(req2.query.limit) : void 0 }))));
  r.post("/notifications/read-all", asyncHandler(async (req2, res) => res.json(await new NotificationService(ctxOf2(req2)).markAllRead(actorOf2(req2)))));
  r.post("/notifications/:id/read", asyncHandler(async (req2, res) => res.json(await new NotificationService(ctxOf2(req2)).markRead(req2.params.id, actorOf2(req2)))));
  r.get("/settings/system", asyncHandler(async (req2, res) => res.json(await new SettingsService(ctxOf2(req2)).get())));
  r.put("/settings/system", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json(await new SettingsService(ctxOf2(req2)).update(req2.body || {}, actorOf2(req2)))));
  const q2 = (req2) => new QueryService(ctxOf2(req2));
  const s = (req2) => req2.query.status;
  r.get("/query/process-definitions", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).processDefinitions() })));
  r.get("/query/process-definitions/:processId/instances", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).processInstances(req2.params.processId, s(req2)) })));
  r.get("/query/process-definitions/:processId/signals", perm2("query:read"), asyncHandler(async (req2, res) => res.json(await q2(req2).processSignals(req2.params.processId))));
  r.get("/query/users", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).users() })));
  r.get("/query/users/:user/tasks", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).tasksForUser(req2.params.user, s(req2)) })));
  r.get("/query/users/:user/tasks/completed", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).tasksCompletedByUser(req2.params.user) })));
  r.get("/query/groups/:group/tasks", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).tasksForGroup(req2.params.group, s(req2)) })));
  r.get("/query/instances/:id/tasks", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).instanceTasks(req2.params.id) })));
  r.get("/query/analytics/tasks", perm2("query:read"), asyncHandler(async (req2, res) => res.json(await q2(req2).taskAnalytics())));
  r.get("/query/analytics/processes", perm2("query:read"), asyncHandler(async (req2, res) => res.json(await q2(req2).processAnalytics())));
  r.get("/query/analytics/summary", perm2("query:read"), asyncHandler(async (req2, res) => res.json(await q2(req2).summary())));
  r.get("/query/jobs", perm2("query:read"), asyncHandler(async (req2, res) => res.json({ items: await q2(req2).jobs(s(req2)) })));
  const iam = (req2) => new IamService(ctxOf2(req2));
  r.get("/users", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json({ items: await iam(req2).listUsers() })));
  r.post("/users", perm2("admin:iam"), asyncHandler(async (req2, res) => res.status(201).json(await iam(req2).createUser(req2.body, actorOf2(req2)))));
  r.get("/users/:id", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json(await iam(req2).getUser(req2.params.id))));
  r.patch("/users/:id", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json(await iam(req2).updateUser(req2.params.id, req2.body, actorOf2(req2)))));
  r.post("/users/:id/password", perm2("admin:iam"), asyncHandler(async (req2, res) => {
    await iam(req2).setPassword(req2.params.id, req2.body?.password, actorOf2(req2));
    res.status(204).end();
  }));
  r.get("/groups", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json({ items: await iam(req2).listGroups() })));
  r.post("/groups", perm2("admin:iam"), asyncHandler(async (req2, res) => res.status(201).json(await iam(req2).createGroup(req2.body, actorOf2(req2)))));
  r.delete("/groups/:id", perm2("admin:iam"), asyncHandler(async (req2, res) => {
    await iam(req2).deleteGroup(req2.params.id, actorOf2(req2));
    res.status(204).end();
  }));
  r.get("/roles", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json({ items: await iam(req2).listRoles() })));
  r.post("/roles", perm2("admin:iam"), asyncHandler(async (req2, res) => res.status(201).json(await iam(req2).createRole(req2.body, actorOf2(req2)))));
  r.patch("/roles/:id", perm2("admin:iam"), asyncHandler(async (req2, res) => res.json(await iam(req2).updateRole(req2.params.id, req2.body?.permissions || [], actorOf2(req2)))));
  r.delete("/roles/:id", perm2("admin:iam"), asyncHandler(async (req2, res) => {
    await iam(req2).deleteRole(req2.params.id, actorOf2(req2));
    res.status(204).end();
  }));
  r.use(buildWorkflowInstanceRoutes());
  return r;
}

// src/http/auth-routes.ts
import { Router as Router3 } from "express";
var ctxOf3 = (req2) => req2.ctx;
var loginLimiter = rateLimit({ windowMs: 6e4, max: 10, keyOf: (req2) => req2.ip || "anon" });
function buildAuthRoutes() {
  const r = Router3();
  r.post("/login", loginLimiter, asyncHandler(async (req2, res) => {
    const { username, password } = req2.body || {};
    res.json(await new IamService(ctxOf3(req2)).login(String(username || ""), String(password || "")));
  }));
  r.get("/me", requireAuth, asyncHandler(async (req2, res) => {
    const claims = req2.user;
    const permissions = await new IamService(ctxOf3(req2)).permissionsFor(claims.roles);
    res.json({ user: { id: claims.sub, username: claims.username, roles: claims.roles, groups: claims.groups }, permissions });
  }));
  r.post("/me/password", requireAuth, asyncHandler(async (req2, res) => {
    const claims = req2.user;
    await new IamService(ctxOf3(req2)).changeOwnPassword(claims.sub, req2.body?.currentPassword, req2.body?.newPassword);
    res.status(204).end();
  }));
  return r;
}

// src/http/tenant-routes.ts
import { Router as Router4 } from "express";

// src/modules/tenants/service.ts
var SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
var RESERVED_SLUGS = /* @__PURE__ */ new Set([
  "api",
  "app",
  "auth",
  "admin",
  "system",
  "public",
  "dashboard",
  "settings",
  "null",
  "undefined",
  "root",
  "support",
  "workspace",
  "tenants",
  "billing",
  "login",
  "logout",
  "help",
  "docs",
  "home",
  "status"
]);
var TenantService = class {
  constructor(ctx) {
    this.ctx = ctx;
  }
  ctx;
  tenantRepo() {
    return this.ctx.store.repo(Collections.tenants);
  }
  memberRepo() {
    return this.ctx.store.repo(Collections.tenantMembers);
  }
  planRepo() {
    return this.ctx.store.repo(Collections.plans);
  }
  userRepo() {
    return this.ctx.store.repo(Collections.users);
  }
  roleRepo() {
    return this.ctx.store.repo(Collections.roles);
  }
  async checkSlug(slug5) {
    const s = slug5.trim().toLowerCase();
    if (!SLUG_PATTERN.test(s) || s.length < 2 || s.length > 50 || RESERVED_SLUGS.has(s)) {
      return { available: false };
    }
    const all = await this.tenantRepo().query(() => true);
    const existing = all.find((t) => t.slug.toLowerCase() === s);
    return { available: !existing };
  }
  async signup(data) {
    const name = data.name.trim();
    const slug5 = data.slug.trim().toLowerCase();
    const ownerEmail = data.ownerEmail.trim().toLowerCase();
    const ownerName = data.ownerName?.trim() || ownerEmail.split("@")[0];
    if (!name || name.length < 2 || name.length > 100) {
      throw validation("Workspace name must be between 2 and 100 characters");
    }
    if (!SLUG_PATTERN.test(slug5) || slug5.length < 2 || slug5.length > 50) {
      throw validation("Workspace address must use lowercase letters, numbers, and single hyphens (2-50 characters)");
    }
    if (RESERVED_SLUGS.has(slug5)) {
      throw validation(`Workspace address "${slug5}" is reserved and cannot be used`);
    }
    if (!ownerEmail || !ownerEmail.includes("@")) {
      throw validation("A valid owner email address is required");
    }
    const check = await this.checkSlug(slug5);
    if (!check.available) {
      throw conflict(`Workspace address "${slug5}" is already taken`);
    }
    const tenantId = `org_${this.ctx.newId().replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
    const now = this.ctx.clock();
    const tenant = {
      id: tenantId,
      tenantId,
      name,
      slug: slug5,
      status: "active",
      plan: "trial",
      planExpiresAt: new Date(Date.parse(now) + 14 * 24 * 3600 * 1e3).toISOString(),
      settings: {
        timezone: "UTC",
        dateFormat: "YYYY-MM-DD",
        brandName: name
      },
      ownerEmail,
      ownerName,
      createdAt: now,
      updatedAt: now
    };
    await this.tenantRepo().put(tenant);
    const allUsers = await this.userRepo().query(() => true);
    const matchedUser = allUsers.find((u) => u.username.toLowerCase() === ownerEmail.toLowerCase() || u.id === ownerEmail);
    const userId = matchedUser ? matchedUser.id : ownerEmail;
    const membership = {
      id: this.ctx.newId(),
      tenantId,
      userId,
      email: ownerEmail,
      role: "owner",
      status: "active",
      displayName: ownerName,
      permissions: ["*"],
      joinedAt: now,
      lastActiveAt: now
    };
    await this.memberRepo().put(membership);
    return tenant;
  }
  async listMyTenants(userId, search, limit = 10, requestedTenantId) {
    const allMembers = await this.memberRepo().query(() => true);
    const allTenants = await this.tenantRepo().query(() => true);
    const user = await this.userRepo().get(userId);
    const username = user?.username || userId;
    const userMemberships = allMembers.filter(
      (m) => (m.userId === userId || m.userId === username || m.email?.toLowerCase() === userId.toLowerCase() || m.email?.toLowerCase() === username.toLowerCase()) && m.status === "active"
    );
    const isSystemAdmin = userId === "admin" || username === "admin" || user?.roles?.includes("admin") || userMemberships.some((m) => m.role === "system_admin");
    const activeMap = /* @__PURE__ */ new Map();
    for (const t of allTenants) {
      if (t.status === "active") activeMap.set(t.id, t);
    }
    let rows = [];
    for (const m of userMemberships) {
      const t = activeMap.get(m.tenantId);
      if (t) {
        rows.push({
          id: t.id,
          name: t.name,
          slug: t.slug,
          role: m.role,
          isCurrent: false
        });
      }
    }
    if (isSystemAdmin) {
      rows.unshift({
        id: "all",
        name: "All Workspaces (Platform View)",
        slug: "platform-wide",
        role: "system_admin",
        isCurrent: requestedTenantId === "all",
        support: true
      });
      const have = new Set(rows.map((r) => r.id));
      if (requestedTenantId && !have.has(requestedTenantId)) {
        const named = activeMap.get(requestedTenantId);
        if (named) {
          rows.push({
            id: named.id,
            name: named.name,
            slug: named.slug,
            role: "system_admin",
            isCurrent: true,
            support: true
          });
          have.add(named.id);
        }
      }
      if (search && search.trim()) {
        const q2 = search.trim().toLowerCase();
        for (const t of activeMap.values()) {
          if (!have.has(t.id) && (t.name.toLowerCase().includes(q2) || t.slug.toLowerCase().includes(q2))) {
            rows.push({
              id: t.id,
              name: t.name,
              slug: t.slug,
              role: "system_admin",
              isCurrent: false,
              support: true
            });
            have.add(t.id);
          }
        }
      }
    }
    if (search && search.trim()) {
      const q2 = search.trim().toLowerCase();
      rows = rows.filter((r) => r.name.toLowerCase().includes(q2) || r.slug.toLowerCase().includes(q2));
      if (limit > 0) {
        rows = rows.slice(0, limit);
      }
    }
    const currentTenantId = rows.find((r) => r.id === requestedTenantId)?.id ?? rows[0]?.id ?? null;
    rows.forEach((r) => {
      r.isCurrent = r.id === currentTenantId;
    });
    return { tenants: rows, currentTenantId };
  }
  async getMyProfile(userId, tenantId) {
    const allMembers = await this.memberRepo().query(() => true);
    const allTenants = await this.tenantRepo().query(() => true);
    const user = await this.userRepo().get(userId);
    const username = user?.username || userId;
    const isSystemAdmin = userId === "admin" || username === "admin" || user?.roles?.includes("admin") || allMembers.some(
      (m) => (m.userId === userId || m.userId === username || m.email?.toLowerCase() === userId.toLowerCase() || m.email?.toLowerCase() === username.toLowerCase()) && m.role === "system_admin"
    );
    if (tenantId === "all" && isSystemAdmin) {
      return {
        userId,
        email: userId.includes("@") ? userId : `${userId}@platform.local`,
        member: {
          id: `mem_${userId}_platform`,
          tenantId: "all",
          role: "system_admin",
          status: "active",
          displayName: "Platform Administrator",
          permissions: ["*"],
          joinedAt: this.ctx.clock()
        },
        tenant: { id: "all", name: "All Workspaces (Platform View)", slug: "platform-wide" }
      };
    }
    const membership = allMembers.find(
      (m) => (m.userId === userId || m.userId === username || m.email?.toLowerCase() === userId.toLowerCase() || m.email?.toLowerCase() === username.toLowerCase()) && m.tenantId === tenantId
    );
    const tenant = allTenants.find((t) => t.id === tenantId);
    const effectiveRole = membership?.role ?? (isSystemAdmin ? "system_admin" : "viewer");
    const effectivePermissions = membership?.permissions || (effectiveRole === "system_admin" || effectiveRole === "owner" || effectiveRole === "admin" ? ["*"] : ["workflow:view", "instance:view", "task:view"]);
    return {
      userId,
      email: membership?.email || (userId.includes("@") ? userId : `${userId}@local`),
      member: {
        id: membership?.id || `mem_${userId}_${tenantId}`,
        tenantId,
        role: effectiveRole,
        status: membership?.status || "active",
        displayName: membership?.displayName || userId,
        permissions: effectivePermissions,
        joinedAt: membership?.joinedAt || this.ctx.clock()
      },
      tenant: tenant ? { id: tenant.id, name: tenant.name, slug: tenant.slug } : null
    };
  }
  async getCurrentTenant(tenantId) {
    if (tenantId === "all") {
      const now = this.ctx.clock();
      return {
        id: "all",
        tenantId: "all",
        name: "All Workspaces (Platform View)",
        slug: "platform-wide",
        status: "active",
        plan: "enterprise",
        createdAt: now,
        updatedAt: now
      };
    }
    const all = await this.tenantRepo().query(() => true);
    const tenant = all.find((t) => t.id === tenantId);
    if (!tenant) throw notFound(`Workspace "${tenantId}" not found`);
    return tenant;
  }
  async listMemberships(userId) {
    const allMembers = await this.memberRepo().query(() => true);
    const allTenants = await this.tenantRepo().query(() => true);
    const tenantMap = new Map(allTenants.map((t) => [t.id, t]));
    const userMembers = allMembers.filter((m) => m.userId === userId || m.email?.toLowerCase() === userId.toLowerCase());
    return userMembers.map((m) => {
      const t = tenantMap.get(m.tenantId);
      return {
        id: t?.id || m.tenantId,
        name: t?.name || "Workspace",
        slug: t?.slug || m.tenantId,
        status: t?.status || "active",
        plan: t?.plan || "trial",
        role: m.role,
        memberStatus: m.status
      };
    });
  }
  async listPublicPlans() {
    const plans = await this.planRepo().query(() => true);
    if (plans.length > 0) return plans;
    return [
      {
        id: "plan_trial",
        tenantId: "system",
        key: "trial",
        name: "Free trial",
        description: "Explore the visual workflow designer, process engine, and execution runtime for 14 days.",
        isDefault: true,
        isCustom: false,
        trialDays: 14,
        contactConfig: null,
        limits: { maxWorkflows: 10, maxInstances: 500, maxTeamMembers: 5 },
        features: ["Visual Workflow Designer", "Process Execution", "Task Inbox", "Decision Tables", "Versioned Deployments"]
      },
      {
        id: "plan_custom",
        tenantId: "system",
        key: "custom",
        name: "Custom plan",
        description: "Volume, custom integrations, dedicated execution sidecars, and limits agreed with us. Contact us to configure your workspace.",
        isDefault: false,
        isCustom: true,
        trialDays: null,
        contactConfig: { type: "email", value: `sales@${config.domain}`, label: "Contact us" },
        limits: { maxWorkflows: -1, maxInstances: -1, maxTeamMembers: -1 },
        features: ["Unlimited Workflows & Instances", "Dedicated Execution Sidecar", "Custom hitPolicies & Rules", "High-availability clustering", "Dedicated 24/7 SLA Support"]
      }
    ];
  }
  async seedDefaultsIfEmpty() {
    const tenants = await this.tenantRepo().query(() => true);
    const defaultTenantId = "default";
    let defaultTenant = tenants.find((t) => t.id === defaultTenantId || t.slug === "default");
    if (!defaultTenant) {
      defaultTenant = {
        id: defaultTenantId,
        tenantId: defaultTenantId,
        name: "Default Workspace",
        slug: "default",
        status: "active",
        plan: "trial",
        planExpiresAt: null,
        settings: { timezone: "UTC", dateFormat: "YYYY-MM-DD", brandName: config.appName },
        ownerEmail: `admin@${config.domain}`,
        ownerName: "System Administrator",
        createdAt: this.ctx.clock(),
        updatedAt: this.ctx.clock()
      };
      await this.tenantRepo().put(defaultTenant);
    }
    const members = await this.memberRepo().query(() => true);
    const hasAdminMember = members.some((m) => m.userId === "admin" && m.tenantId === defaultTenantId);
    if (!hasAdminMember) {
      await this.memberRepo().put({
        id: "mem_admin_default",
        tenantId: defaultTenantId,
        userId: "admin",
        email: "admin@local",
        role: "system_admin",
        status: "active",
        displayName: "System Admin",
        permissions: ["*"],
        joinedAt: this.ctx.clock(),
        lastActiveAt: this.ctx.clock()
      });
    }
    const plans = await this.planRepo().query(() => true);
    if (plans.length === 0) {
      const defaultPlans = await this.listPublicPlans();
      for (const p of defaultPlans) {
        await this.planRepo().put(p);
      }
    }
  }
};

// src/http/tenant-routes.ts
var ctxOf4 = (req2) => req2.ctx;
function buildPublicTenantRoutes() {
  const r = Router4();
  r.get("/tenants/check/:slug", asyncHandler(async (req2, res) => {
    const service = new TenantService(ctxOf4(req2));
    const result = await service.checkSlug(req2.params.slug);
    res.json({ success: true, data: result });
  }));
  r.post("/tenants/signup", asyncHandler(async (req2, res) => {
    const service = new TenantService(ctxOf4(req2));
    const tenant = await service.signup(req2.body || {});
    res.status(201).json({ success: true, data: tenant });
  }));
  r.get("/public/plans", asyncHandler(async (req2, res) => {
    const service = new TenantService(ctxOf4(req2));
    const plans = await service.listPublicPlans();
    res.json({ success: true, data: plans });
  }));
  return r;
}
function buildTenantRoutes() {
  const r = Router4();
  r.get("/me/tenants", requireAuth, asyncHandler(async (req2, res) => {
    const claims = req2.user;
    const requested = req2.headers["x-tenant-id"]?.trim();
    const search = typeof req2.query.search === "string" ? req2.query.search : void 0;
    const limit = typeof req2.query.limit === "string" ? parseInt(req2.query.limit, 10) : 10;
    const service = new TenantService(ctxOf4(req2));
    const { tenants, currentTenantId } = await service.listMyTenants(claims.sub, search, limit, requested);
    res.json({ success: true, data: tenants, currentTenantId });
  }));
  r.get("/me/profile", requireAuth, asyncHandler(async (req2, res) => {
    const claims = req2.user;
    const requested = req2.headers["x-tenant-id"]?.trim() || ctxOf4(req2).tenantId;
    const service = new TenantService(ctxOf4(req2));
    const profile = await service.getMyProfile(claims.sub, requested);
    res.json({ success: true, data: profile });
  }));
  r.get("/tenants/current", requireAuth, asyncHandler(async (req2, res) => {
    const requested = req2.headers["x-tenant-id"]?.trim() || ctxOf4(req2).tenantId;
    const service = new TenantService(ctxOf4(req2));
    const tenant = await service.getCurrentTenant(requested);
    res.json({ success: true, data: tenant });
  }));
  r.get("/tenants", requireAuth, asyncHandler(async (req2, res) => {
    const claims = req2.user;
    const service = new TenantService(ctxOf4(req2));
    const memberships = await service.listMemberships(claims.sub);
    res.json({ success: true, data: memberships });
  }));
  r.get("/system/stats", requireAuth, asyncHandler(async (req2, res) => {
    const claims = req2.user;
    const isSystemAdmin = claims.username === "admin" || Array.isArray(claims.roles) && claims.roles.includes("admin");
    if (!isSystemAdmin) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Platform system administrator access required" } });
    }
    const ctx = ctxOf4(req2);
    const [allTenants, allMembers, allInstances, allTasks, allDeployments] = await Promise.all([
      ctx.store.repo(Collections.tenants).query(() => true),
      ctx.store.repo(Collections.tenantMembers).query(() => true),
      ctx.store.repo(Collections.instances).query(() => true),
      ctx.store.repo(Collections.tasks).query(() => true),
      ctx.store.repo(Collections.deployments).query(() => true)
    ]);
    const activeTenants = allTenants.filter((t) => t.status === "active").length;
    const activeMembers = allMembers.filter((m) => m.status === "active").length;
    const tenantsByPlan = {};
    for (const t of allTenants) {
      tenantsByPlan[t.plan] = (tenantsByPlan[t.plan] || 0) + 1;
    }
    res.json({
      success: true,
      data: {
        totalTenants: allTenants.length,
        activeTenants,
        totalMembers: activeMembers,
        tenantsByPlan: Object.entries(tenantsByPlan).map(([plan, count]) => ({ plan, count })),
        engine: {
          totalInstances: allInstances.length,
          activeInstances: allInstances.filter((i) => i.status === "running" || i.status === "waiting").length,
          totalTasks: allTasks.length,
          openTasks: allTasks.filter((t) => t.status === "created" || t.status === "inprogress").length,
          totalDeployments: allDeployments.length,
          activeDeployments: allDeployments.filter((d) => d.status === "active").length
        }
      }
    });
  }));
  return r;
}

// src/app.ts
function resolveStore() {
  if (config.store === "pg") {
    if (!config.pgUrl) throw new Error("STORE=pg requires PG_URL to be set");
    return new PgStore(config.pgUrl);
  }
  return new FileStore(config.dataDir);
}
function createApp(store2) {
  const app2 = express();
  const theStore = store2 || resolveStore();
  app2.use(express.json({ limit: "4mb" }));
  app2.use((req2, res, next) => {
    res.header("Access-Control-Allow-Origin", process.env.APP_ORIGIN || "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-tenant-id");
    res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS");
    if (req2.method === "OPTIONS") return res.status(204).end();
    next();
  });
  app2.use((req2, res, next) => {
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-Frame-Options", "DENY");
    res.header("Referrer-Policy", "no-referrer");
    if (req2.path !== "/api/docs") res.header("Content-Security-Policy", "default-src 'none'");
    next();
  });
  app2.use((req2, _res, next) => {
    const tenantHeader = req2.headers["x-tenant-id"]?.trim();
    const tenantId = tenantHeader || config.defaultTenant;
    req2.ctx = makeContext({ store: theStore, tenantId });
    next();
  });
  const seedCtx = makeContext({ store: theStore, tenantId: config.defaultTenant });
  new TenantService(seedCtx).seedDefaultsIfEmpty().catch(() => {
  });
  app2.get("/api/health", (_req, res) => res.json({ ok: true, service: "jbpm-engine-server", version: "0.1.0" }));
  app2.use("/api", buildPublicTenantRoutes());
  app2.use("/api/auth", buildAuthRoutes());
  app2.use("/api", buildTenantRoutes());
  app2.use("/api", requireAuth, requireWorkspaceAccess, buildRoutes());
  app2.use(errorMiddleware);
  return { app: app2, store: theStore };
}

// src/infra/ws-auth.ts
function authenticateWsUpgrade(req2) {
  const token = new URL(req2.url || "", "http://internal").searchParams.get("token");
  try {
    verifyToken(token || "");
    return true;
  } catch {
    return false;
  }
}

// src/index.ts
var { app, store } = createApp();
var server = http.createServer(app);
var wss = new WebSocketServer({ server, path: config.wsPath });
wss.on("connection", (ws, req2) => {
  if (!authenticateWsUpgrade(req2)) {
    ws.close(4001, "unauthorized");
    return;
  }
  hub.add(ws);
});
var timerCtx = makeContext({ store, tenantId: config.defaultTenant });
var timers = new TimerService(timerCtx, hub.engineEmit);
setInterval(() => {
  timers.tick((/* @__PURE__ */ new Date()).toISOString()).catch((e) => logger.error("timer tick failed", { err: e.message }));
}, 5e3);
var iamCtx = makeContext({ store, tenantId: config.defaultTenant });
new IamService(iamCtx).ensureSeeded(config.adminInitialPassword).then(({ seededAdmin }) => {
  if (seededAdmin) logger.info("seeded initial admin user", { username: "admin", note: "set ADMIN_INITIAL_PASSWORD before first boot in anything but local dev" });
  server.listen(config.port, () => {
    logger.info("jbpm-engine server up", { port: config.port, ws: config.wsPath, store: config.store, dataDir: config.dataDir });
  });
}).catch((e) => {
  logger.error("IAM seeding failed \u2014 refusing to start", { err: e.message });
  process.exit(1);
});
