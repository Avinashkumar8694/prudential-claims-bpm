// functions/report.mjs — reusable console reporting for the rules-runtime examples.

// print a set of facts (optionally only one _type) under a label.
export function printFacts(label, facts, type) {
  console.log(label);
  for (const f of (type ? facts.filter((x) => x._type === type) : facts)) console.log(' ', JSON.stringify(f));
}

// print the engine firing trace (order reflects priority).
export function printTrace(trace, label = '\nFIRING TRACE:') {
  console.log(label);
  for (const t of trace) console.log('  -', t);
}

// print a "wrote N files" summary for a project export.
export function printWritten(label, dir, written) {
  console.log(`Exported ${label} to ${dir} (${written.length} files):\n  ${written.join('\n  ')}`);
}
