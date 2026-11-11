const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
assert.equal(pkg.scripts.build, 'vite build', 'the app should use the Vite build');

const build = spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' });
assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

const html = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
const script = html.match(/<script[^>]+src="(\/cricut-sticker-print-tool\/assets\/[^\"]+\.js)"/);
assert.ok(script, 'built index should reference a JavaScript asset at the configured base path');
assert.ok(fs.existsSync(path.join(root, 'dist', script[1].replace('/cricut-sticker-print-tool/', ''))));
console.log('Vite build output and referenced JavaScript asset OK');
