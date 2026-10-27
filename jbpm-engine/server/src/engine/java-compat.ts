// Java-dialect SAFETY pre-check: a fast, synchronous, no-JVM-required denylist scan that runs before
// a `lang: 'java'` script/condition/exitScript is ever sent anywhere. Real execution — and real
// syntax validity — is decided by the JVM sidecar (java-sidecar.ts / jbpm-engine/java-runtime), which
// compiles and runs the script text completely unmodified with an actual javac + JVM: this file is
// NOT a Java-subset parser or transpiler (there used to be one here; it's gone — see below) and does
// not decide what's syntactically legal Java. Its only job is to block constructs that would be
// syntactically fine but operationally unsafe in this engine's specific runtime shape:
//
//  - The sidecar is ONE persistent process shared by every script execution in this server (across
//    all processes/instances/tenants) — not a fresh sandbox per script. A script that spawns threads,
//    calls System.exit, or blocks on I/O doesn't just affect itself; it can corrupt or kill unrelated,
//    concurrently-queued script runs (see ScriptRunner.java's System.out-capture comment for the
//    single-threaded-request assumption this depends on).
//  - The sidecar's classpath is the full JDK plus a hand-written Jackson shim (no Maven in this
//    environment to fetch real third-party jars) — so unlike a real jBPM/KIE deployment, arbitrary
//    filesystem/network/process access from a script is not something an ops team explicitly opted
//    into via deployment configuration; it's blocked here instead.
//
// Everything else — lambdas, method references, the Stream API, try-with-resources, anonymous inner
// classes, varargs, multi-catch, annotations, java.time, and so on — is REAL, valid Java 8 (the JDK
// installed alongside this engine) and runs natively in the sidecar with no restriction here. Newer
// syntax the installed JDK's javac can't parse (switch expressions/yield, records, var, text blocks)
// is rejected by the sidecar's own compiler with a precise diagnostic — duplicating that check here
// would just be a second, less accurate copy of what the real compiler already does.
export const KNOWN_LIMITATIONS = [
  'no arbitrary third-party libraries — only java.* / javax.* (the JDK itself) and a source-compatible Jackson shim (com.fasterxml.jackson.*) are on the classpath',
  'no custom application classes — a script is compiled standalone, so it can\'t reference another class from the deployed project',
  'newer-than-Java-8 syntax (switch expressions/yield, records, var, text blocks) fails to compile — the installed JDK is Java 8',
] as const;

/** Blank out string/char literals and comments (replacing their contents with spaces, preserving
 *  newlines and overall length) so denylist patterns never fire on incidental text like a log
 *  message containing a blocked word, or a comment mentioning one. A simple char-scan, not a full
 *  lexer — good enough since it only needs to find quote/comment BOUNDARIES, not parse expressions. */
function blankStringsAndComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n - 1 && !(src[j] === '*' && src[j + 1] === '/')) j++;
      j = Math.min(j + 2, n);
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else if (c === '"' || c === '\'') {
      const quote = c;
      let j = i + 1;
      while (j < n && src[j] !== quote && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      j = Math.min(j + 1, n);
      out += src.slice(i, j).replace(/[^\n]/g, ' ');
      i = j;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const DENYLIST: { pattern: RegExp; message: string | ((m: RegExpExecArray) => string) }[] = [
  // Reflection that can load/instantiate arbitrary classpath classes or bypass access control. Plain
  // `.getClass()` (e.g. `e.getClass().getName()` in a catch block) is left alone — it's harmless.
  { pattern: /\bClass\.forName\b/, message: 'Class.forName is not supported — arbitrary class loading is blocked for safety' },
  { pattern: /\.setAccessible\s*\(/, message: '.setAccessible(...) is not supported — bypassing access control is blocked for safety' },
  { pattern: /\bjava\.lang\.reflect\./, message: 'java.lang.reflect.* is not supported — reflection is blocked for safety' },

  // Threading/concurrency: the sidecar is a single persistent process shared by every script
  // execution; a script spawning its own threads (or blocking one) would break the isolation between
  // unrelated, concurrently-queued script runs.
  { pattern: /\bnew\s+Thread\s*\(/, message: 'creating a Thread is not supported — scripts run synchronously in a shared process' },
  { pattern: /\bThread\.(sleep|currentThread)\b/, message: 'Thread.sleep/currentThread are not supported — scripts run synchronously in a shared process' },
  { pattern: /\bsynchronized\b|\bvolatile\b/, message: 'synchronized/volatile are not supported — scripts run synchronously in a shared process' },
  { pattern: /\bExecutors\.|\bExecutorService\b|\bCompletableFuture\b/, message: 'thread pools / async execution are not supported — scripts run synchronously in a shared process' },

  // Filesystem access — a script task has no business reading/writing the host filesystem.
  { pattern: /\bjava\.io\.|\bjava\.nio\.|\bFileInputStream\b|\bFileOutputStream\b|\bFiles\.|\bPaths\.get\b/, message: 'file/IO APIs are not supported — a script task has no filesystem access' },

  // Process control — a script must never spawn OS processes or kill the shared sidecar (which would
  // abort every in-flight script execution across every running process instance, not just its own).
  { pattern: /\bRuntime\.getRuntime\s*\(\s*\)|\bProcessBuilder\b/, message: 'spawning OS processes is not supported' },
  { pattern: /\bSystem\.exit\s*\(|\.halt\s*\(/, message: 'System.exit/.halt are not supported — that would kill the shared script runtime for every in-flight process' },

  // Raw network access — use an HTTP/REST task node (audited, retried, timed-out by the engine),
  // not ad-hoc sockets/connections from inside a script.
  { pattern: /\bjava\.net\.|\bHttpURLConnection\b/, message: 'raw network access is not supported from a script — use an HTTP/REST task node instead' },
];

export interface JavaValidationResult { errors: string[]; warnings: string[]; }

/** Fast, synchronous safety pre-check — catches the constructs above without ever touching the JVM
 *  sidecar. It intentionally does NOT decide whether the code otherwise compiles; pair with an
 *  async dry-compile against the sidecar (see java-sidecar.ts's validateJava) for that ground truth. */
export function validateJavaSupport(code: string): JavaValidationResult {
  const errors: string[] = [];
  const scan = blankStringsAndComments(code);
  for (const { pattern, message } of DENYLIST) {
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    const m = re.exec(scan);
    if (m) errors.push(typeof message === 'function' ? message(m) : message);
  }
  return { errors, warnings: [] };
}
