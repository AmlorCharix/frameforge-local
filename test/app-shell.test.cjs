const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'src','index.html'),'utf8');
const renderer=fs.readFileSync(path.join(root,'src','renderer.js'),'utf8');

test('renderer element lookups all exist in the HTML shell', () => {
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const lookups=[...renderer.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
  const missing=[...new Set(lookups.filter(id=>!ids.has(id)))];
  assert.deepEqual(missing,[],'renderer references missing HTML element IDs');
});

test('HTML local assets and preload entry points exist', () => {
  for(const [,file] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g))assert.ok(fs.existsSync(path.join(root,'src',file)),`missing local asset ${file}`);
  const main=fs.readFileSync(path.join(root,'src','main.cjs'),'utf8');
  assert.ok(main.includes("path.join(__dirname, 'preload.cjs')"));
  assert.ok(fs.existsSync(path.join(root,'src','preload.cjs')));
});
