#!/usr/bin/env node
/**
 * Build the production frontend bundle.
 *
 * Usage:
 *   node scripts/build.mjs            # one-shot build to static/dist/
 *   node scripts/build.mjs --watch    # rebuild on file changes
 *
 * Output: static/dist/app.js (+ source map). When ``APP_ENV=prod``,
 * ``static/index.html`` swaps its <script> tag to point at this file
 * (see the ``CachedStaticFiles`` notes in app.py). In dev the source
 * tree is served raw — no build step required.
 */

import { build, context } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const ENTRY     = resolve(ROOT, 'static/js/main.js');
const OUTDIR    = resolve(ROOT, 'static/dist');

mkdirSync(OUTDIR, { recursive: true });

/** Shared esbuild config — minified ES2020 module so older browsers stay supported. */
const config = {
    entryPoints: [ENTRY],
    outfile:     `${OUTDIR}/app.js`,
    bundle:      true,
    format:      'esm',
    target:      ['es2020'],
    minify:      true,
    sourcemap:   true,
    legalComments: 'none',
    treeShaking: true,
    logLevel:    'info',
    // Keep import.meta.url working for any module that needs it.
    define: { 'process.env.NODE_ENV': '"production"' },
};

const watch = process.argv.includes('--watch');

if (watch) {
    const ctx = await context(config);
    await ctx.watch();
    console.log('esbuild: watching for changes...');
} else {
    await build(config);
    console.log(`esbuild: wrote ${config.outfile}`);
}
