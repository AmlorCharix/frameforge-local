const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');
const { discoverTools } = require('./tool-discovery.cjs');
const { blenderScript } = require('./blender-script.cjs');
const { makeVideoArgs } = require('./video-encoding.cjs');

let win;
function createWindow() {
  win = new BrowserWindow({ width: 1220, height: 850, minWidth: 920, minHeight: 700, backgroundColor: '#10120f', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('pick-file', async (_, kind) => {
  const filters = kind === 'voice' ? [{ name: 'Piper voice', extensions: ['onnx'] }] : [{ name: 'Applications', extensions: process.platform === 'win32' ? ['exe'] : ['*'] }];
  const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('open-file', async (_, filePath) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Invalid file path.');
  return shell.openPath(filePath);
});

function ollama(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({ hostname: '127.0.0.1', port: 11434, path: '/api/chat', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 180000 }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', chunk => data += chunk); res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Ollama returned HTTP ${res.statusCode}. Is Ollama running?`));
        try { resolve(JSON.parse(data).message.content); } catch { reject(new Error('Could not read Ollama response.')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Ollama timed out after 3 minutes.'))); req.on('error', reject); req.end(body);
  });
}
function send(event, message) { win?.webContents.send('job-event', { event, message }); }
function runProcess(exe, args, cwd, timeoutMs = 900000, stdinText = null, onOutput = null) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd, windowsHide: true, shell: false }); let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${path.basename(exe)} timed out.`)); }, timeoutMs);
    const collect = d => { const chunk=d.toString(); output = (output + chunk).slice(-5000); onOutput?.(chunk); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    if (stdinText !== null) child.stdin.end(stdinText);
    child.on('error', e => { clearTimeout(timer); reject(e); }); child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`${path.basename(exe)} exited with code ${code}. ${output.slice(-1400)}`)); });
  });
}
async function runBlender(exe,script,cwd,timeoutMs){
  const output=await runProcess(exe,['-b','--python',script],cwd,timeoutMs);
  if(!output.includes('FRAMEFORGE_RENDER_DONE'))throw new Error(`Blender stopped before completing the render. ${output.slice(-1800)||'No Blender output was returned.'}`);
  return output;
}

function findOnPath(command) {
  if (process.platform !== 'win32') return null;
  const result=spawnSync('where.exe',[command],{encoding:'utf8',windowsHide:true});
  return result.status===0 ? result.stdout.split(/\r?\n/).map(x=>x.trim()).find(x=>x && path.isAbsolute(x)) || null : null;
}
async function firstExisting(paths) {
  for (const candidate of paths.filter(Boolean)) try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch {}
  return null;
}
async function detectPrograms(){return discoverTools(app.getPath('userData'));}
let ollamaServeStarted=false;
function listOllamaModels() {
  return new Promise(resolve=>{
    const req=http.get({hostname:'127.0.0.1',port:11434,path:'/api/tags',timeout:2500},res=>{
      let data=''; res.setEncoding('utf8'); res.on('data',d=>data+=d); res.on('end',()=>{try{resolve(JSON.parse(data).models.map(m=>m.name));}catch{resolve(null);}});
    });
    req.on('timeout',()=>{req.destroy();resolve(null);}); req.on('error',()=>resolve(null));
  });
}
async function startOllamaIfNeeded(ollamaPath) {
  if (await listOllamaModels()) return true;
  if (!ollamaPath || ollamaServeStarted) return false;
  ollamaServeStarted=true;
  try { const service=spawn(ollamaPath,['serve'],{detached:true,stdio:'ignore',windowsHide:true}); service.unref(); } catch { ollamaServeStarted=false; return false; }
  for (let i=0;i<8;i++) { await new Promise(r=>setTimeout(r,2000)); if (await listOllamaModels()) return true; }
  ollamaServeStarted=false;
  return false;
}
ipcMain.handle('setup-status', async () => {
  const programs=await detectPrograms(), running=await startOllamaIfNeeded(programs.ollama), models=running?await listOllamaModels():null;
  return {...programs,ollamaRunning:models!==null,models:models||[],winget:process.platform==='win32' && (Boolean(findOnPath('winget.exe')) || Boolean(process.env.LOCALAPPDATA && require('node:fs').existsSync(path.join(process.env.LOCALAPPDATA,'Microsoft','WindowsApps','winget.exe'))))};
});
async function setupPiper() {
  const toolsDir=path.join(app.getPath('userData'),'tools'), envDir=path.join(toolsDir,'piper-venv'), pythonPath=path.join(envDir,'Scripts','python.exe');
  await fs.mkdir(toolsDir,{recursive:true});
  if(!(await firstExisting([pythonPath]))){
    const basePython=(await detectPrograms()).python;
    if(!basePython)throw new Error('Python 3.12 was not found after installation. Restart Windows, then check setup again.');
    send('setup-progress','Creating a private Piper environment…');
    await runProcess(basePython,['-m','venv',envDir],toolsDir,300000);
  }
  send('setup-progress','Downloading the Piper text-to-speech engine…');
  await runProcess(pythonPath,['-m','pip','install','--disable-pip-version-check','piper-tts'],toolsDir,1800000,null,chunk=>{
    const lines=chunk.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length)send('setup-progress',`Piper: ${lines[lines.length-1].slice(-160)}`);
  });
  const detected=await detectPrograms();
  return {piper:detected.piper||pythonPath};
}
ipcMain.handle('install-missing', async (_, requested) => {
  if (process.platform!=='win32') throw new Error('Automatic installation is available in the Windows app. Use the official Ollama and Blender download pages on this computer.');
  if (!Array.isArray(requested) || requested.some(x=>!['ollama','blender','piper','ffmpeg'].includes(x))) throw new Error('Invalid setup selection.');
  if (!findOnPath('winget.exe') && !(process.env.LOCALAPPDATA && require('node:fs').existsSync(path.join(process.env.LOCALAPPDATA,'Microsoft','WindowsApps','winget.exe')))) throw new Error('Windows Package Manager (winget) is not available. Install Ollama from ollama.com/download/windows, Blender from blender.org/download, Python from python.org/downloads/windows, and FFmpeg from ffmpeg.org/download.html, then check setup again.');
  const before=await detectPrograms();
  const installs=[['ollama','Ollama.Ollama','Ollama'],['blender','BlenderFoundation.Blender','Blender'],['ffmpeg','Gyan.FFmpeg','FFmpeg']].filter(([key])=>requested.includes(key) && !before[key]);
  if(requested.includes('piper')&&!before.piper&&!before.python)installs.push(['python','Python.Python.3.12','Python for Piper']);
  for (const [,id,label] of installs) {
    send('setup-progress',`Downloading and installing ${label} with Windows Package Manager…`);
    const exe=findOnPath('winget.exe') || path.join(process.env.LOCALAPPDATA,'Microsoft','WindowsApps','winget.exe');
    await runProcess(exe,['install','--id',id,'--exact','--source','winget','--accept-source-agreements','--accept-package-agreements','--silent'],process.cwd(),3600000,null,chunk=>{
      const lines=chunk.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if(lines.length) send('setup-progress',`${label}: ${lines[lines.length-1].slice(-180)}`);
    });
  }
  if(requested.includes('piper')&&!before.piper)await setupPiper();
  const after=await detectPrograms();
  await startOllamaIfNeeded(after.ollama);
  send('setup-progress','Setup finished. Refreshing detected tool locations…');
  return {...after,ollamaRunning:(await listOllamaModels())!==null};
});
ipcMain.handle('pull-models', async (_, cfg) => {
  const validName=/^[a-zA-Z0-9_.:-]{1,100}$/;
  const textModel=String(cfg?.textModel||'qwen2.5:7b'), visionModel=String(cfg?.visionModel||'llava:7b');
  if (!validName.test(textModel) || !validName.test(visionModel)) throw new Error('Enter valid Ollama model names first.');
  if (!(await listOllamaModels())) throw new Error('Ollama is not running yet. Install or start Ollama, then check setup again.');
  const ollamaPath=(await detectPrograms()).ollama;
  if (!ollamaPath) throw new Error('Could not find the Ollama command-line program. Check setup again after installing Ollama.');
  const present=await listOllamaModels()||[];
  for (const model of [...new Set([textModel,visionModel])]) {
    if (present.some(x=>x===model||x.startsWith(model+':'))) continue;
    send('setup-progress',`Downloading AI model ${model}… this can take a while.`);
    await runProcess(ollamaPath,['pull',model],process.cwd(),3600000,null,chunk=>{
      const lines=chunk.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if(lines.length) send('setup-progress',`${model}: ${lines[lines.length-1].slice(-160)}`);
    });
  }
  return {models:await listOllamaModels()||[]};
});
async function readPreviewImage(outDir,outPath){
  const expected=`${outPath}_review.png`;
  try{return await fs.readFile(expected);}
  catch(error){
    const prefix=`${path.basename(outPath)}_review`.toLowerCase();
    let nearby=[];
    try{nearby=(await fs.readdir(outDir)).filter(name=>name.toLowerCase().startsWith(prefix)&&name.toLowerCase().endsWith('.png'));}catch{}
    if(nearby.length){
      try{return await fs.readFile(path.join(outDir,nearby[0]));}catch{}
    }
    let outputs=[];try{outputs=(await fs.readdir(outDir)).filter(name=>name.startsWith(path.basename(outPath))).slice(0,12);}catch{}
    throw new Error(`Blender finished but did not save the preview image where FrameForge expected it. Expected: ${expected}. Files produced: ${outputs.join(', ')||'none found'}. Check that the project folder is writable and try again.`);
  }
}
async function clearFrames(outDir,outPath,mode){
  const prefix=`${path.basename(outPath)}_${mode}_frame_`;
  for(const name of await fs.readdir(outDir))if(name.startsWith(prefix)&&name.toLowerCase().endsWith('.png'))await fs.unlink(path.join(outDir,name));
}
async function encodeAnimation(ffmpeg,outPath,scene,mode,outDir){
  if(!ffmpeg||!path.isAbsolute(ffmpeg))throw new Error('FFmpeg was not found. Open Local model & tool setup and install or select FFmpeg.');
  const output=`${outPath}_${mode}.mp4`;
  send('progress',`Encoding the ${mode} video with FFmpeg…`);
  await runProcess(ffmpeg,makeVideoArgs(outPath,scene.fps,mode),outDir,900000,null,chunk=>{
    const lines=chunk.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length)send('progress',`Encoding video: ${lines[lines.length-1].slice(-140)}`);
  });
  const stat=await fs.stat(output);
  if(stat.size<1000)throw new Error(`FFmpeg created an empty ${mode} video at ${output}.`);
  await clearFrames(outDir,outPath,mode);
  return output;
}
ipcMain.handle('generate', async (_, cfg) => {
  if (!(await listOllamaModels())) throw new Error('Ollama is not running. Open Local model & tool setup and start Ollama.');
  const models=await listOllamaModels()||[];
  if (!models.some(x=>x===cfg.model||x.startsWith(cfg.model+':'))) throw new Error(`The Ollama model “${cfg.model}” is not downloaded yet. Use Download selected AI models in setup.`);
  if(!cfg.ffmpeg||!path.isAbsolute(cfg.ffmpeg))throw new Error('FFmpeg is required to create MP4 videos. Open Local model & tool setup and install or select it.');
  const root = path.resolve(cfg.folder || '');
  if (!cfg.folder || !path.isAbsolute(root)) throw new Error('Choose a project folder first.');
  const outDir = path.join(root, 'FrameForge'); await fs.mkdir(outDir, { recursive: true });
  const slug = (cfg.prompt || 'animation').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32) || 'animation';
  const outPath = path.join(outDir, `${slug}-${Date.now()}`);
  let feedback = '', chosen;
  send('progress', 'Asking your local model to plan the scene…');
  let raw = await ollama({ model: cfg.model || 'qwen2.5:7b', stream:false, format:specSchema, messages:[{role:'system',content:SCENE_RULES+' Make the scene visually clear, polished, centered, and use varied supported shapes and colors. Return only the required JSON.'},{role:'user',content:`Create a short animation for this prompt: ${String(cfg.prompt).slice(0,1200)}${cfg.revise ? `\nReview notes to address: ${cfg.revise}` : ''}`} ] });
  for (let attempt=1; attempt<=3; attempt++) {
    const scene=await safeScene(raw,cfg,String(cfg.prompt).slice(0,1200),{ollama,send});
    if (!cfg.blender || !path.isAbsolute(cfg.blender)) throw new Error('Select the Blender executable in Settings.');
    const jsonPath = `${outPath}-scene.json`, pyPath=`${outPath}-render.py`;
    await fs.writeFile(jsonPath, JSON.stringify(scene,null,2), 'utf8');
    await fs.writeFile(pyPath, blenderScript(scene,outPath,'preview'), 'utf8');
    const finalScript = `${outPath}-final.py`;
    await fs.writeFile(finalScript, blenderScript(scene,outPath,'final'), 'utf8');
    await clearFrames(outDir,outPath,'preview');
    send('progress', `Rendering draft ${attempt} of 3 in Blender…`);
    await runBlender(cfg.blender,pyPath,outDir,900000);
    await encodeAnimation(cfg.ffmpeg,outPath,scene,'preview',outDir);
    const image=await readPreviewImage(outDir,outPath);
    send('preview', { attempt, image: `data:image/png;base64,${image.toString('base64')}`, video:`${outPath}_preview.mp4`, narration:scene.narration, title:scene.title });
    chosen={scene,attempt,video:`${outPath}_preview.mp4`,finalVideo:`${outPath}_final.mp4`,finalScript,image:`${outPath}_review.png`,json:jsonPath};
    if (attempt===3) break;
    send('progress', 'Asking the vision model whether the composition is clear…');
    try {
      const critique=await ollama({ model:cfg.visionModel||'llava:7b',stream:false,messages:[{role:'user',content:'Review this still frame from a short 3D animation. If the subject is visible and composition is clear, answer only APPROVED. Otherwise give one short concrete improvement suggestion. The user prompt was: '+String(cfg.prompt).slice(0,400),images:[image.toString('base64')]}] });
      if (/\bAPPROVED\b/i.test(critique)) break;
      feedback=critique.slice(0,500); raw=await ollama({model:cfg.model||'qwen2.5:7b',stream:false,format:specSchema,messages:[{role:'system',content:SCENE_RULES+' Revise the supplied JSON scene to address the review note. Keep to every rule and return only valid JSON.'},{role:'user',content:`Original request: ${cfg.prompt}\nReview note: ${feedback}\nCurrent scene: ${JSON.stringify(scene)}`} ]});
    } catch { send('progress','Vision review was unavailable. You can review this draft yourself.'); break; }
  }
  send('ready', { ...chosen, outputFolder:outDir }); return { ...chosen, outputFolder:outDir };
});

ipcMain.handle('speak', async (_, cfg) => {
  if (!cfg.piper || !cfg.voice || !path.isAbsolute(cfg.piper) || !path.isAbsolute(cfg.voice)) throw new Error('Choose the Piper executable and voice model in Settings.');
  if (!cfg.ffmpeg || !path.isAbsolute(cfg.ffmpeg)) throw new Error('Choose FFmpeg to add the voice to the final video.');
  const wav=cfg.video.replace(/_final\.mp4$/,'_voice.wav'), muxed=cfg.video.replace(/\.mp4$/,'_with-voice.mp4');
  const managedScripts=path.join(app.getPath('userData'),'tools','piper-venv','Scripts');
  const isManaged=path.dirname(path.resolve(cfg.piper)).toLowerCase()===path.resolve(managedScripts).toLowerCase();
  const isPython=path.basename(cfg.piper).toLowerCase()==='python.exe';
  let modernCli=isManaged||isPython;
  if(!modernCli){const help=spawnSync(cfg.piper,['--help'],{encoding:'utf8',windowsHide:true,timeout:5000});const helpText=`${help.stdout||''}\n${help.stderr||''}`;modernCli=helpText.includes('--data-dir')&&!helpText.includes('--output_file');}
  if(modernCli){
    const voiceName=path.basename(cfg.voice,'.onnx'),args=isPython?['-m','piper']:[];
    args.push('--data-dir',path.dirname(cfg.voice),'-m',voiceName,'-f',wav,'--',String(cfg.text||''));
    await runProcess(cfg.piper,args,path.dirname(wav),120000);
  }else await runProcess(cfg.piper,['--model',cfg.voice,'--output_file',wav],path.dirname(wav),120000,cfg.text);
  await runProcess(cfg.ffmpeg,['-y','-i',cfg.video,'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-shortest',muxed],path.dirname(wav),300000);
  return muxed;
});
ipcMain.handle('approve', async (_, cfg) => {
  send('progress','Rendering the final quality version…');
  if(!cfg.ffmpeg||!path.isAbsolute(cfg.ffmpeg))throw new Error('FFmpeg is required to create MP4 videos. Select it in Local model & tool setup.');
  const outPath=cfg.video.replace(/_final\.mp4$/,'');
  await clearFrames(path.dirname(cfg.video),outPath,'final');
  await runBlender(cfg.blender,cfg.script,path.dirname(cfg.video),1800000);
  return encodeAnimation(cfg.ffmpeg,outPath,cfg.scene,'final',path.dirname(cfg.video));
});
