// Runs load-probe.mts in a child process and samples the CHILD's RSS from this (separate) process with `ps`,
// so the measurement isn't starved by the probe's own event loop. Env (N, QUOTA, SCRIPT_*) passes through.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
const probe = path.join(import.meta.dirname, 'load-probe.mts');
const child = spawn(process.execPath, ['--import', 'tsx', probe], { stdio: ['ignore', 'pipe', 'inherit'] });
const rssMb = () => { try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)]).toString().trim()) / 1024; } catch { return 0; } };
let out = '', base = 0, peak = 0;
child.stdout.on('data', (d) => { out += d; });
const t = setInterval(() => { const r = rssMb(); if (r) { peak = Math.max(peak, r); if (!base && out === '') base = r; } }, 15);
child.on('exit', () => {
  clearInterval(t);
  console.log(out.trim());
  console.log(JSON.stringify({ externalRssMB: { firstSample: Math.round(base), peak: Math.round(peak), growth: Math.round(peak - base) } }));
});
