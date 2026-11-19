// Bundles the extension into dist/ so the .vsix ships two files instead of thousands from node_modules.
// - dist/extension.js: the extension (CommonJS), with every dependency inlined except `vscode`.
// - dist/agent-sdk.mjs: the Claude Agent SDK and what it imports (MCP SDK, zod, ajv). It is ESM-only
//   and loaded with a native import() when Claude is first used (see loadSdk in src/ai/host.ts).
const esbuild = require('esbuild');
const { existsSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const common = { bundle: true, platform: 'node', target: 'node20', minify: true, keepNames: true, legalComments: 'none', metafile: true, logLevel: 'warning' };

Promise.all([
  esbuild.build({
    ...common,
    entryPoints: [join(root, 'src', 'extension.ts')],
    outfile: join(root, 'dist', 'extension.js'),
    format: 'cjs',
    external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
  }),
  esbuild.build({
    ...common,
    entryPoints: [require.resolve('@anthropic-ai/claude-agent-sdk', { paths: [root] })],
    outfile: join(root, 'dist', 'agent-sdk.mjs'),
    format: 'esm',
    // Bundled CommonJS dependencies (ajv) call require() for Node built-ins, which ESM output lacks.
    banner: { js: "// Claude Agent SDK (c) Anthropic PBC; see THIRD_PARTY_NOTICES.txt.\nimport { createRequire as __motaCreateRequire } from 'node:module'; const require = __motaCreateRequire(import.meta.url);" },
  }),
]).then(results => writeNotices(results.flatMap(r => Object.keys(r.metafile.inputs)))).catch(() => process.exit(1));

/** License texts of every npm package inlined into the bundles, in dist/THIRD_PARTY_NOTICES.txt. */
function writeNotices(inputs) {
  const packages = new Map();
  for (const input of inputs) {
    const m = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, '/'));
    if (!m) continue;
    const dir = join(root, m[1]);
    if (packages.has(dir) || !existsSync(join(dir, 'package.json'))) continue;
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find(f => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    packages.set(dir, `${pkg.name}@${pkg.version} (${pkg.license ?? 'see package'})\n\n${file ? readFileSync(join(dir, file), 'utf8').trim() : 'No license file in the package.'}`);
  }
  const body = [...packages.values()].sort().join(`\n\n${'-'.repeat(72)}\n\n`);
  writeFileSync(join(root, 'dist', 'THIRD_PARTY_NOTICES.txt'), `MoTA Android bundles the following packages.\n\n${body}\n`);
  console.log(`dist/: extension.js, agent-sdk.mjs, notices for ${packages.size} packages`);
}
