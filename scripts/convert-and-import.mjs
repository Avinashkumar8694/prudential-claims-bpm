// Convert jBPM project (from zip or directory) to native Node.js engine project,
// import it, deploy it, and test execution against mock server.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import { parseProject, toEngineProject } from '../bpmn-sdk/dist/index.js';
import { convertProjectToNodeEngine } from '../jbpm-engine/server/src/modules/import/service.ts';

const projectDir = path.join(rootDir, 'extracted_projects/policy_system/project');
const outFile = path.join(rootDir, 'policy_system_node_project.json');

console.log('1. Parsing jBPM project from:', projectDir);
const rawProject = parseProject(projectDir);
console.log(`   Found ${rawProject.processes.length} BPMN processes and ${Object.keys(rawProject.assets || {}).length} assets.`);

console.log('2. Converting to Node.js Engine project...');
const engineProject = toEngineProject(rawProject);
const converted = convertProjectToNodeEngine(engineProject);
console.log(`   Converted ${converted.processes.length} processes to Node.js engine format (all scripts/conditions in JS).`);

fs.writeFileSync(outFile, JSON.stringify(converted, null, 2), 'utf8');
console.log('3. Saved converted project to:', outFile);

// Summary of converted processes
console.log('\n--- Converted Processes ---');
converted.processes.forEach((proc, idx) => {
  const scripts = (proc.nodes || []).filter(n => n.type === 'script').length;
  const workItems = (proc.nodes || []).filter(n => n.type === 'workItem').length;
  const userTasks = (proc.nodes || []).filter(n => n.type === 'userTask').length;
  const calls = (proc.nodes || []).filter(n => n.type === 'call').length;
  console.log(`[${idx + 1}] ${proc.id} ("${proc.name}"): ${proc.nodes?.length || 0} nodes (scripts: ${scripts}, workItems: ${workItems}, userTasks: ${userTasks}, calls: ${calls})`);
});
