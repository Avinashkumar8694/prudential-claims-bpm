// functions/io.mjs — reusable I/O / CLI helpers shared by the examples.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// true when a module is being executed directly (`node file.mjs`), not imported.
export const isMain = (metaUrl) => !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;

// default output dir for an example: argv[2], else <example dir>/out/<name>.
export const outDir = (metaUrl, name) => process.argv[2] || path.join(path.dirname(fileURLToPath(metaUrl)), 'out', name);
