// Read/write the kjar scaffolding around the .bpmn files, so a whole project round-trips
// (and can be generated from scratch from JSON).
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, kids, kid, cdataText } from './xml.js';
import type { ProjectDescriptor, DeploymentDescriptor, Gav, WorkItemHandler, EnvironmentEntry, WorkItemDefinition } from './types.js';

const SCAFFOLD_FILES = [
  'pom.xml',
  'src/main/resources/META-INF/kmodule.xml',
  'src/main/resources/META-INF/persistence.xml',
  'global/WorkDefinitions.wid',
  'project.imports',
  'project.repositories',
];
const DD_PATH = 'src/main/resources/META-INF/kie-deployment-descriptor.xml';
// Extra assets that must round-trip verbatim (rules, decisions, Java handlers, forms, icons, …).
// Text-based Business Central / Drools / OptaPlanner assets that must round-trip verbatim.
// (Binary assets — .xls/.xlsx decision-table & score-card spreadsheets — are not text-captured.)
const SKIP_DIRS = new Set(['node_modules', 'target', '.git', 'dist', 'bpmn-sdk', '.mvn']);
// binary files can't round-trip as UTF-8 text, so they're the only things NOT captured; everything
// else (rules, decisions, forms, java, wid, properties, AND any arbitrary .xml/.md/.json/config/…)
// is carried verbatim so a jBPM project round-trips losslessly, never dropping a file.
const BINARY_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.zip', '.jar', '.gz', '.tar', '.class', '.xls', '.xlsx', '.sxls', '.doc', '.docx', '.ppt', '.pptx', '.pdf', '.so', '.dll']);

function collectAssets(dir: string, projectDir: string, out: Record<string, string>, bin: Record<string, string>): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) collectAssets(path.join(dir, e.name), projectDir, out, bin); continue; }
    const ext = path.extname(e.name).toLowerCase();
    if (ext === '.bpmn' || ext === '.bpmn2') continue;     // processes — captured separately
    const rel = path.relative(projectDir, path.join(dir, e.name));
    if (SCAFFOLD_FILES.includes(rel) || rel === DD_PATH) continue; // handled elsewhere
    const abs = path.join(dir, e.name);
    if (BINARY_EXTS.has(ext)) bin[rel] = fs.readFileSync(abs).toString('base64');   // binaries -> base64
    else out[rel] = fs.readFileSync(abs, 'utf8');                                   // everything else -> text
  }
}

const DT_SHORT = (fqn: string) => fqn.split('.').pop() || fqn;

/** Best-effort parse of an MVEL WorkDefinitions.wid into work-item definitions. */
export function parseWid(text: string): WorkItemDefinition[] {
  const defs: WorkItemDefinition[] = [];
  const nameRe = /"name"\s*:\s*"([^"]+)"/g;
  const marks: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(text))) marks.push({ name: m[1], at: m.index });
  for (let i = 0; i < marks.length; i++) {
    const slice = text.slice(marks[i].at, i + 1 < marks.length ? marks[i + 1].at : text.length);
    const g = (re: RegExp) => { const mm = re.exec(slice); return mm ? mm[1] : undefined; };
    const block = (label: string): Record<string, string> => {
      const b = new RegExp(`"${label}"\\s*:\\s*\\[([\\s\\S]*?)\\]`).exec(slice);
      const map: Record<string, string> = {};
      if (b) for (const pm of b[1].matchAll(/"([^"]+)"\s*:\s*new\s+([A-Za-z0-9_.]+)\s*\(/g)) map[pm[1]] = DT_SHORT(pm[2]);
      return map;
    };
    defs.push({
      name: marks[i].name,
      displayName: g(/"displayName"\s*:\s*"([^"]*)"/),
      category: g(/"category"\s*:\s*"([^"]*)"/),
      icon: g(/"icon"\s*:\s*"([^"]*)"/),
      defaultHandler: g(/"defaultHandler"\s*:\s*"([^"]*)"/),
      parameters: block('parameters'),
      results: block('results'),
    });
  }
  return defs;
}

/** Generate an MVEL WorkDefinitions.wid from a list of work-item definitions. */
export function widMvel(defs: WorkItemDefinition[]): string {
  const kv = (map?: Record<string, string>) =>
    Object.entries(map || {}).map(([k, t]) => `            "${k}" : new ${t.includes('.') ? t : t}()`).join(',\n');
  const entry = (d: WorkItemDefinition) =>
    `    [\n` +
    `        "name" : "${d.name}",\n` +
    `        "displayName" : "${d.displayName || d.name}",\n` +
    `        "category" : "${d.category || 'Custom'}",\n` +
    `        "icon" : "${d.icon || 'defaultservicenodeicon.png'}",\n` +
    `        "defaultHandler" : "${d.defaultHandler || ''}",\n` +
    `        "parameters" : [\n${kv(d.parameters)}\n        ],\n` +
    `        "results" : [\n${kv(d.results)}\n        ]\n` +
    `    ]`;
  return `[\n${defs.map(entry).join(',\n')}\n]\n`;
}

function readGav(pomXml: string): Gav | undefined {
  try {
    const p = parseXml(pomXml); // <project>
    const txt = (n: string) => { const c = kid(p, n); return c ? (cdataText(c) || c.text) : undefined; };
    const g = txt('groupId'); const a = txt('artifactId'); const v = txt('version');
    if (!a) return undefined;
    return { groupId: g || 'org.kie.templates', artifactId: a, version: v || '1.0.0-SNAPSHOT', name: txt('name'), packaging: txt('packaging') || 'kjar' };
  } catch { return undefined; }
}

function readDeployment(xml: string): DeploymentDescriptor | undefined {
  try {
    const d = parseXml(xml);
    const t = (n: string) => { const c = kid(d, n); return c ? (cdataText(c) || c.text) : undefined; };
    const wih = kid(d, 'work-item-handlers');
    const env = kid(d, 'environment-entries');
    const readList = (parent: typeof d | undefined, tag: string): { name: string; resolver: string; identifier: string }[] =>
      parent ? kids(parent, tag).map((h) => ({
        name: (kid(h, 'name') && (cdataText(kid(h, 'name')!) || kid(h, 'name')!.text)) || '',
        resolver: (kid(h, 'resolver') && (cdataText(kid(h, 'resolver')!) || kid(h, 'resolver')!.text)) || 'mvel',
        identifier: (kid(h, 'identifier') && (cdataText(kid(h, 'identifier')!) || kid(h, 'identifier')!.text)) || '',
      })) : [];
    return {
      persistenceUnit: t('persistence-unit'), auditPersistenceUnit: t('audit-persistence-unit'),
      auditMode: t('audit-mode'), persistenceMode: t('persistence-mode'), runtimeStrategy: t('runtime-strategy'),
      workItemHandlers: readList(wih, 'work-item-handler'),
      environmentEntries: readList(env, 'environment-entry'),
    };
  } catch { return undefined; }
}

export function parseDescriptor(projectDir: string): ProjectDescriptor {
  const files: Record<string, string> = {};
  for (const rel of SCAFFOLD_FILES) {
    const abs = path.join(projectDir, rel);
    if (fs.existsSync(abs)) files[rel] = fs.readFileSync(abs, 'utf8');
  }
  // capture extra assets so they round-trip: text verbatim, binaries as base64 (nothing is dropped)
  const binaryFiles: Record<string, string> = {};
  collectAssets(projectDir, projectDir, files, binaryFiles);
  const gav = files['pom.xml'] ? readGav(files['pom.xml']) : undefined;
  const ddAbs = path.join(projectDir, DD_PATH);
  const deployment = fs.existsSync(ddAbs) ? readDeployment(fs.readFileSync(ddAbs, 'utf8')) : undefined;
  const widText = files['global/WorkDefinitions.wid'];
  const workDefinitions = widText ? parseWid(widText) : undefined;
  return { gav, deployment, workDefinitions, files, ...(Object.keys(binaryFiles).length ? { binaryFiles } : {}) };
}

// ---- templates (for from-scratch generation) ----
export function pomXml(gav: Gav): string {
  const kie = gav.kieVersion || '7.73.0.Final';
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>${gav.groupId}</groupId>
  <artifactId>${gav.artifactId}</artifactId>
  <version>${gav.version}</version>
  <packaging>kjar</packaging>
  <name>${gav.name || gav.artifactId}</name>
  <dependencies>
    <dependency><groupId>org.kie</groupId><artifactId>kie-api</artifactId><version>${kie}</version><scope>provided</scope></dependency>
    <dependency><groupId>org.kie</groupId><artifactId>kie-internal</artifactId><version>${kie}</version><scope>provided</scope></dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin><groupId>org.kie</groupId><artifactId>kie-maven-plugin</artifactId><version>${kie}</version><extensions>true</extensions></plugin>
    </plugins>
  </build>
</project>
`;
}

export const KMODULE_XML =
  '<kmodule xmlns="http://www.drools.org/xsd/kmodule" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>\n';

// Business Central workbench metadata (not required to build/deploy, but part of a real BC project).
export const PROJECT_IMPORTS = `<configuration>
  <imports>
    <imports>
${['java.lang.Number', 'java.lang.Boolean', 'java.lang.String', 'java.lang.Integer',
    'java.lang.Double', 'java.util.List', 'java.util.Collection', 'java.util.ArrayList']
    .map((t) => `      <import>\n        <type>${t}</type>\n      </import>`).join('\n')}
    </imports>
  </imports>
  <version>1.0</version>
</configuration>
`;

export const PROJECT_REPOSITORIES = `<project-repositories>
  <repositories>
    <repository>
      <include>true</include>
      <metadata>
        <id>central</id>
        <url>https://repo.maven.apache.org/maven2</url>
        <source>PROJECT</source>
      </metadata>
    </repository>
    <repository>
      <include>true</include>
      <metadata>
        <id>redhat-ga-repository</id>
        <url>https://maven.repository.redhat.com/ga/</url>
        <source>SETTINGS</source>
      </metadata>
    </repository>
  </repositories>
</project-repositories>
`;

export function deploymentXml(dd: DeploymentDescriptor): string {
  const h = (x: WorkItemHandler) => `        <work-item-handler>\n            <resolver>${x.resolver}</resolver>\n            <identifier>${x.identifier}</identifier>\n            <parameters/>\n            <name>${x.name}</name>\n        </work-item-handler>`;
  const e = (x: EnvironmentEntry) => `        <environment-entry>\n            <resolver>${x.resolver}</resolver>\n            <identifier>${x.identifier}</identifier>\n            <parameters/>\n            <name>${x.name}</name>\n        </environment-entry>`;
  const wih = (dd.workItemHandlers || []).map(h).join('\n');
  const env = (dd.environmentEntries || []).map(e).join('\n');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<deployment-descriptor xsi:schemaLocation="http://www.jboss.org/jbpm deployment-descriptor.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <persistence-unit>${dd.persistenceUnit || 'org.jbpm.domain'}</persistence-unit>
    <audit-persistence-unit>${dd.auditPersistenceUnit || 'org.jbpm.domain'}</audit-persistence-unit>
    <audit-mode>${dd.auditMode || 'JPA'}</audit-mode>
    <persistence-mode>${dd.persistenceMode || 'JPA'}</persistence-mode>
    <runtime-strategy>${dd.runtimeStrategy || 'SINGLETON'}</runtime-strategy>
    <marshalling-strategies/>
    <event-listeners/>
    <task-event-listeners/>
    <globals/>
    <work-item-handlers>${wih ? '\n' + wih + '\n    ' : ''}</work-item-handlers>
    <environment-entries>${env ? '\n' + env + '\n    ' : ''}</environment-entries>
    <configurations/>
    <required-roles/>
    <remoteable-classes/>
    <limit-serialization-classes>true</limit-serialization-classes>
</deployment-descriptor>
`;
}

/** Write the scaffolding files (verbatim where captured, generated from templates otherwise). */
export function writeDescriptor(descriptor: ProjectDescriptor | undefined, projectDir: string): string[] {
  const written: string[] = [];
  const desc = descriptor || {};
  const files = desc.files || {};
  const put = (rel: string, content: string) => {
    const abs = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    written.push(rel);
  };

  // 1) verbatim captured files (rules, java, forms, wid, …) except the deployment descriptor
  for (const [rel, content] of Object.entries(files)) if (rel !== DD_PATH) put(rel, content);
  // 1b) binary files (base64 -> bytes), carried byte-for-byte
  for (const [rel, b64] of Object.entries(desc.binaryFiles || {})) {
    const abs = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, Buffer.from(b64, 'base64'));
    written.push(rel);
  }

  // 2) generate what's missing
  if (!files['pom.xml'] && desc.gav) put('pom.xml', pomXml(desc.gav));
  if (!files['src/main/resources/META-INF/kmodule.xml']) put('src/main/resources/META-INF/kmodule.xml', KMODULE_XML);
  if (!files['project.imports']) put('project.imports', PROJECT_IMPORTS);
  if (!files['project.repositories']) put('project.repositories', PROJECT_REPOSITORIES);
  // .wid: prefer verbatim; else synthesize from the work-item-definition model
  if (!files['global/WorkDefinitions.wid'] && desc.workDefinitions && desc.workDefinitions.length) {
    put('global/WorkDefinitions.wid', widMvel(desc.workDefinitions));
  }

  // 3) deployment descriptor: regenerate from the semantic model (falls back to a default)
  const dd: DeploymentDescriptor = desc.deployment || {
    workItemHandlers: [{ name: 'Rest', resolver: 'mvel', identifier: 'new org.jbpm.process.workitem.rest.RESTWorkItemHandler(classLoader)' }],
    environmentEntries: [{ name: 'INTEGRATION_LAYER_URL', resolver: 'mvel', identifier: '"http://localhost:3000"' }],
  };
  put(DD_PATH, deploymentXml(dd));
  return written;
}
