import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('static', 'dist', { recursive: true });

const ctx = await esbuild.context({
  entryPoints: { background: 'src/background/index.ts', app: 'src/ui/main.tsx' },
  outdir: 'dist',
  bundle: true,
  // Fonts are copied from static/ as-is; CSS references them by relative URL.
  external: ['fonts/*'],
  format: 'esm',
  target: 'chrome121',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
});

// Content scripts can't be ES modules.
const contentCtx = await esbuild.context({
  entryPoints: { formguard: 'src/content/formguard.ts' },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome121',
  minify: !watch,
  logLevel: 'info',
});

if (watch) {
  await Promise.all([ctx.watch(), contentCtx.watch()]);
} else {
  await Promise.all([ctx.rebuild(), contentCtx.rebuild()]);
  await Promise.all([ctx.dispose(), contentCtx.dispose()]);
}
