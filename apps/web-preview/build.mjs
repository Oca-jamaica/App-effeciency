// Builds the single-file browser preview: bundles src/app.tsx (with the real domain package) and inlines it.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, 'dist', 'ascend-preview.html');
const result = await build({
  entryPoints: [join(here, 'src', 'app.tsx')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  legalComments: 'none',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync(join(here, 'template.html'), 'utf8').replace('/*__BUNDLE__*/', () => js);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
