const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn, spawnSync } = require('node:child_process');
const http = require('node:http');

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

function findOnPath(command) {
  if (process.platform !== 'win32') return null;
  const result=spawnSync('where.exe',[command],{encoding:'utf8',windowsHide:true});
  return result.status===0 ? result.stdout.split(/\r?\n/).map(x=>x.trim()).find(x=>x && path.isAbsolute(x)) || null : null;
}
async function firstExisting(paths) {
  for (const candidate of paths.filter(Boolean)) try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch {}
  return null;
}
async function detectPrograms() {
  const ollama=await firstExisting([
    findOnPath('ollama.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Programs','Ollama','ollama.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles,'Ollama','ollama.exe')
  ]);
  let blender=await firstExisting([findOnPath('blender.exe')]);
  if (!blender) {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA,'Programs')].filter(Boolean)) {
      for (const folder of ['Blender Foundation','Blender']) {
        try {
          const root=path.join(base,folder), entries=await fs.readdir(root,{withFileTypes:true});
          for (const entry of entries.filter(x=>x.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}))) {
            const hit=await firstExisting([path.join(root,entry.name,'blender.exe')]); if (hit) { blender=hit; break; }
          }
        } catch {}
        if (blender) break;
      }
      if (blender) break;
    }
  }
  return {ollama,blender};
}
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
ipcMain.handle('install-missing', async (_, requested) => {
  if (process.platform!=='win32') throw new Error('Automatic installation is available in the Windows app. Use the official Ollama and Blender download pages on this computer.');
  if (!Array.isArray(requested) || requested.some(x=>!['ollama','blender'].includes(x))) throw new Error('Invalid setup selection.');
  if (!findOnPath('winget.exe') && !(process.env.LOCALAPPDATA && require('node:fs').existsSync(path.join(process.env.LOCALAPPDATA,'Microsoft','WindowsApps','winget.exe')))) throw new Error('Windows Package Manager (winget) is not available. Install the official apps from ollama.com/download/windows and blender.org/download, then press Check setup again.');
  const before=await detectPrograms();
  const installs=[['ollama','Ollama.Ollama','Ollama'],['blender','BlenderFoundation.Blender','Blender']].filter(([key])=>requested.includes(key) && !before[key]);
  for (const [,id,label] of installs) {
    send('setup-progress',`Downloading and installing ${label} with Windows Package Manager…`);
    const exe=findOnPath('winget.exe') || path.join(process.env.LOCALAPPDATA,'Microsoft','WindowsApps','winget.exe');
    await runProcess(exe,['install','--id',id,'--exact','--source','winget','--accept-source-agreements','--accept-package-agreements','--silent'],process.cwd(),3600000,null,chunk=>{
      const lines=chunk.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); if(lines.length) send('setup-progress',`${label}: ${lines[lines.length-1].slice(-180)}`);
    });
  }
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
const specSchema = {
  type: 'object', required: ['title','seconds','fps','objects','narration'], additionalProperties: false,
  properties: {
    title: { type:'string' }, seconds: { type:'integer', minimum:4, maximum:12 }, fps: { type:'integer', enum:[12,24] },
    narration: { type:'string', maxLength:500 },
    objects: { type:'array', minItems:1, maxItems:8, items:{ type:'object', required:['name','shape','color','start','end','size'], additionalProperties:false, properties:{ name:{type:'string'}, shape:{type:'string',enum:['sphere','cube','cone','torus','cylinder']}, color:{type:'string',enum:['coral','gold','mint','blue','violet','white']}, start:{type:'array',items:{type:'number',minimum:-5,maximum:5},minItems:3,maxItems:3}, end:{type:'array',items:{type:'number',minimum:-5,maximum:5},minItems:3,maxItems:3}, size:{type:'number',minimum:0.3,maximum:2.2} } } }
  }
};
function validateScene(scene) {
  if (!scene || typeof scene !== 'object' || typeof scene.title !== 'string' || !Number.isInteger(scene.seconds) || scene.seconds < 4 || scene.seconds > 12 || ![12,24].includes(scene.fps) || !Array.isArray(scene.objects) || scene.objects.length < 1 || scene.objects.length > 8 || typeof scene.narration !== 'string') throw new Error('The model returned a scene that did not pass validation. Try a simpler prompt.');
  const shapes = ['sphere','cube','cone','torus','cylinder'], colors = ['coral','gold','mint','blue','violet','white'];
  for (const o of scene.objects) if (!shapes.includes(o.shape) || !colors.includes(o.color) || !Array.isArray(o.start) || !Array.isArray(o.end) || o.start.length !== 3 || o.end.length !== 3 || [...o.start,...o.end].some(v => !Number.isFinite(v)||Math.abs(v)>5) || !Number.isFinite(o.size)||o.size<.3||o.size>2.2) throw new Error('The model suggested an unsupported object or movement. Please try again.');
  return scene;
}
function blenderScript(scene, outPath, feedback = '') {
  const payload = JSON.stringify({ scene, outPath, mode: feedback });
  return `import bpy, json, math\nfrom mathutils import Vector\np=${JSON.stringify(payload)}\nd=json.loads(p)\ns=d['scene']\nbpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)\ncolors={'coral':(0.92,0.22,0.24,1),'gold':(1,.62,.12,1),'mint':(.2,.82,.62,1),'blue':(.18,.48,.94,1),'violet':(.58,.32,.88,1),'white':(.9,.93,1,1)}\nfor item in s['objects']:\n m=bpy.data.materials.new(item['name']+' material'); m.diffuse_color=colors[item['color']]\n shape=item['shape']; loc=item['start']; size=item['size']\n if shape=='sphere': bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,radius=size,location=loc)\n elif shape=='cube': bpy.ops.mesh.primitive_cube_add(size=size*1.6,location=loc)\n elif shape=='cone': bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=size,depth=size*1.8,location=loc)\n elif shape=='torus': bpy.ops.mesh.primitive_torus_add(major_radius=size,minor_radius=size*.25,location=loc)\n else: bpy.ops.mesh.primitive_cylinder_add(vertices=32,radius=size,depth=size*1.7,location=loc)\n ob=bpy.context.object; ob.name=item['name'][:64]; ob.data.materials.append(m)\n ob.location=Vector(item['start']); ob.keyframe_insert(data_path='location',frame=1)\n ob.location=Vector(item['end']); ob.keyframe_insert(data_path='location',frame=s['seconds']*s['fps'])\n ob.rotation_euler[2]=math.radians(360); ob.keyframe_insert(data_path='rotation_euler',frame=s['seconds']*s['fps'])\n for fc in ob.animation_data.action.fcurves:\n  for kp in fc.keyframe_points: kp.interpolation='BEZIER'\nbpy.ops.object.camera_add(location=(9,-13,9)); cam=bpy.context.object; cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler(); cam.data.lens=42; bpy.context.scene.camera=cam\nfor loc,power,size in [((4,-6,8),1600,7),((-5,-2,4),900,5)]:\n bpy.ops.object.light_add(type='AREA',location=loc); bpy.context.object.data.energy=power; bpy.context.object.data.shape='DISK'; bpy.context.object.data.size=size; bpy.context.object.rotation_euler=(Vector((0,0,0))-bpy.context.object.location).to_track_quat('-Z','Y').to_euler()\nsc=bpy.context.scene; sc.frame_start=1; sc.frame_end=s['seconds']*s['fps']; sc.render.resolution_x=960; sc.render.resolution_y=540; sc.render.resolution_percentage=65; sc.render.image_settings.file_format='PNG'; sc.render.filepath=d['outPath']+'_review.png'; sc.world.color=(.055,.065,.09); sc.render.engine='BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'\nsc.frame_set(max(1,sc.frame_end//2)); bpy.ops.render.render(write_still=True)\nsc.render.resolution_percentage=100 if d['mode']=='final' else 65; sc.render.image_settings.file_format='FFMPEG'; sc.render.ffmpeg.format='MPEG4'; sc.render.ffmpeg.codec='H264'; sc.render.filepath=d['outPath']+('_final.mp4' if d['mode']=='final' else '_preview.mp4'); bpy.ops.render.render(animation=True)\nprint('FRAMEFORGE_RENDER_DONE')\n`;
}
ipcMain.handle('generate', async (_, cfg) => {
  if (!(await listOllamaModels())) throw new Error('Ollama is not running. Open Local model & tool setup and start Ollama.');
  const models=await listOllamaModels()||[];
  if (!models.some(x=>x===cfg.model||x.startsWith(cfg.model+':'))) throw new Error(`The Ollama model “${cfg.model}” is not downloaded yet. Use Download selected AI models in setup.`);
  const root = path.resolve(cfg.folder || '');
  if (!cfg.folder || !path.isAbsolute(root)) throw new Error('Choose a project folder first.');
  const outDir = path.join(root, 'FrameForge'); await fs.mkdir(outDir, { recursive: true });
  const slug = (cfg.prompt || 'animation').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32) || 'animation';
  const outPath = path.join(outDir, `${slug}-${Date.now()}`);
  let feedback = '', chosen;
  send('progress', 'Asking your local model to plan the scene…');
  let raw = await ollama({ model: cfg.model || 'qwen2.5:7b', stream:false, format:specSchema, messages:[{role:'system',content:'Design a visually clear, polished short 3D animation using only the provided objects and simple linear motion. Keep the scene centered, use varied shapes and colors, and describe the scene in one short voiceover sentence. Return only the required JSON.'},{role:'user',content:`Create a short animation for this prompt: ${String(cfg.prompt).slice(0,1200)}${cfg.revise ? `\nReview notes to address: ${cfg.revise}` : ''}`} ] });
  for (let attempt=1; attempt<=3; attempt++) {
    let scene; try { scene=validateScene(JSON.parse(raw)); } catch (e) { if (attempt===1) throw e; break; }
    if (!cfg.blender || !path.isAbsolute(cfg.blender)) throw new Error('Select the Blender executable in Settings.');
    const jsonPath = `${outPath}-scene.json`, pyPath=`${outPath}-render.py`;
    await fs.writeFile(jsonPath, JSON.stringify(scene,null,2), 'utf8');
    await fs.writeFile(pyPath, blenderScript(scene,outPath,'preview'), 'utf8');
    const finalScript = `${outPath}-final.py`;
    await fs.writeFile(finalScript, blenderScript(scene,outPath,'final'), 'utf8');
    send('progress', `Rendering draft ${attempt} of 3 in Blender…`);
    await runProcess(cfg.blender,['-b','--python',pyPath],outDir,900000);
    const image=await fs.readFile(`${outPath}_review.png`);
    send('preview', { attempt, image: `data:image/png;base64,${image.toString('base64')}`, video:`${outPath}_preview.mp4`, narration:scene.narration, title:scene.title });
    chosen={scene,attempt,video:`${outPath}_preview.mp4`,finalVideo:`${outPath}_final.mp4`,finalScript,image:`${outPath}_review.png`,json:jsonPath};
    if (attempt===3) break;
    send('progress', 'Asking the vision model whether the composition is clear…');
    try {
      const critique=await ollama({ model:cfg.visionModel||'llava:7b',stream:false,messages:[{role:'user',content:'Review this still frame from a short 3D animation. If the subject is visible and composition is clear, answer only APPROVED. Otherwise give one short concrete improvement suggestion. The user prompt was: '+String(cfg.prompt).slice(0,400),images:[image.toString('base64')]}] });
      if (/\bAPPROVED\b/i.test(critique)) break;
      feedback=critique.slice(0,500); raw=await ollama({model:cfg.model||'qwen2.5:7b',stream:false,format:specSchema,messages:[{role:'system',content:'Revise the JSON scene to address the review note. Keep to the schema.'},{role:'user',content:`Original request: ${cfg.prompt}\nReview note: ${feedback}\nCurrent scene: ${JSON.stringify(scene)}`} ]});
    } catch { send('progress','Vision review was unavailable. You can review this draft yourself.'); break; }
  }
  send('ready', { ...chosen, outputFolder:outDir }); return { ...chosen, outputFolder:outDir };
});

ipcMain.handle('speak', async (_, cfg) => {
  if (!cfg.piper || !cfg.voice || !path.isAbsolute(cfg.piper) || !path.isAbsolute(cfg.voice)) throw new Error('Choose the Piper executable and voice model in Settings.');
  if (!cfg.ffmpeg || !path.isAbsolute(cfg.ffmpeg)) throw new Error('Choose FFmpeg to add the voice to the final video.');
  const wav=cfg.video.replace(/_final\.mp4$/,'_voice.wav'), muxed=cfg.video.replace(/\.mp4$/,'_with-voice.mp4');
  await runProcess(cfg.piper,['--model',cfg.voice,'--output_file',wav],path.dirname(wav),120000,cfg.text);
  await runProcess(cfg.ffmpeg,['-y','-i',cfg.video,'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-shortest',muxed],path.dirname(wav),300000);
  return muxed;
});
ipcMain.handle('approve', async (_, cfg) => {
  send('progress','Rendering the final quality version…');
  await runProcess(cfg.blender,['-b','--python',cfg.script],path.dirname(cfg.video),1800000);
  return cfg.video;
});
