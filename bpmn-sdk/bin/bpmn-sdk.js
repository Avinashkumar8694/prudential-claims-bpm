#!/usr/bin/env node
'use strict';
// Thin CJS launcher for the compiled CLI.
require('../dist/cli.js').run(process.argv.slice(2));
