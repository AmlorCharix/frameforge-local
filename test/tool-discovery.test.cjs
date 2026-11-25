const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseRegistryAppPath, findInTree, discoverTools } = require('../src/tool-discovery.cjs');

test('reads quoted and environment-expanded Windows App Paths values', () => {
  const output='HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\blender.exe\r\n    (Default)    REG_EXPAND_SZ    "%LOCALAPPDATA%\\Apps\\Blender\\blender.exe"\r\n';
  assert.equal(parseRegistryAppPath(output,'blender.exe',{LOCALAPPDATA:'C:\\Users\\tester\\AppData\\Local'}),'C:\\Users\\tester\\AppData\\Local\\Apps\\Blender\\blender.exe');
});

test('searches bounded installation trees case-insensitively', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameforge-find-'));
  const target=path.join(root,'bin','nested'),exe=path.join(target,'BlEnDeR.ExE');
  try{
    await fs.mkdir(target,{recursive:true});await fs.writeFile(exe,'fake executable');
    assert.equal(await findInTree(root,'blender.exe',{maxDepth:2}),exe);
    assert.equal(await findInTree(root,'blender.exe',{maxDepth:1}),null);
  }finally{try{await fs.unlink(exe);}catch{}try{await fs.rmdir(target);}catch{}try{await fs.rmdir(path.dirname(target));}catch{}try{await fs.rmdir(root);}catch{}}
});

test('discovers executable paths and intentionally leaves the ONNX voice to the user', async () => {
  const tools=await discoverTools(path.join(os.tmpdir(),'frameforge-test-userdata'));
  for(const name of ['ollama','blender','piper','ffmpeg','python','voice'])assert.ok(Object.hasOwn(tools,name),`missing ${name} result`);
  assert.equal(tools.voice,null);
  for(const name of ['ollama','blender','piper','ffmpeg','python'])if(tools[name])assert.ok(fsSync.statSync(tools[name]).isFile(),`${name} path should be an executable file`);
});
