const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function findOnPath(command, platform=process.platform) {
  if(platform!=='win32')return null;
  const result=spawnSync('where.exe',[command],{encoding:'utf8',windowsHide:true,timeout:10000});
  return result.status===0?result.stdout.split(/\r?\n/).map(x=>x.trim()).find(x=>x&&path.isAbsolute(x))||null:null;
}
async function firstExisting(paths) {
  for(const candidate of paths.filter(Boolean))try{if((await fs.stat(candidate)).isFile())return candidate;}catch{}
  return null;
}
function expandEnvironment(value,env=process.env){
  return value.replace(/%([^%]+)%/g,(_,name)=>env[name]||`%${name}%`).replace(/^"|"$/g,'').trim();
}
function parseRegistryAppPath(output,exe,env=process.env){
  const match=String(output).match(/\(Default\)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im);
  if(!match)return null;
  let value=expandEnvironment(match[1].trim(),env);
  if(!/\.exe$/i.test(value))value=path.join(value,exe);
  return path.isAbsolute(value)?value:null;
}
function registryAppPath(exe,platform=process.platform,env=process.env){
  if(platform!=='win32')return [];
  const keys=[
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`,
    `HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`
  ];
  return keys.map(key=>{
    const result=spawnSync('reg.exe',['query',key,'/ve'],{encoding:'utf8',windowsHide:true,timeout:10000});
    return result.status===0?parseRegistryAppPath(result.stdout,exe,env):null;
  }).filter(Boolean);
}
async function findInTree(root,filename,{maxDepth=4,maxDirectories=3000}={}){
  if(!root)return null;
  const queue=[{dir:root,depth:0}];let visited=0;
  while(queue.length&&visited<maxDirectories){
    const {dir,depth}=queue.shift();visited++;
    try{
      const entries=await fs.readdir(dir,{withFileTypes:true});
      for(const entry of entries)if(entry.isFile()&&entry.name.toLowerCase()===filename.toLowerCase())return path.join(dir,entry.name);
      if(depth<maxDepth)for(const entry of entries)if(entry.isDirectory()&&!entry.name.startsWith('.'))queue.push({dir:path.join(dir,entry.name),depth:depth+1});
    }catch{}
  }
  return null;
}
async function findVersionedProgram(bases,folders,exe){
  for(const base of bases.filter(Boolean))for(const folder of folders){
    const root=path.join(base,folder);
    try{
      const entries=(await fs.readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()).sort((a,b)=>b.name.localeCompare(a.name,undefined,{numeric:true}));
      const direct=await firstExisting([path.join(root,exe)]);if(direct)return direct;
      for(const entry of entries){const hit=await firstExisting([path.join(root,entry.name,exe)]);if(hit)return hit;}
    }catch{}
  }
  return null;
}
async function scanWingetPackages(env,packagePrefix,exe){
  const root=env.LOCALAPPDATA&&path.join(env.LOCALAPPDATA,'Microsoft','WinGet','Packages');
  if(!root)return null;
  try{
    const packages=(await fs.readdir(root,{withFileTypes:true})).filter(x=>x.isDirectory()&&x.name.toLowerCase().startsWith(packagePrefix.toLowerCase()));
    for(const pkg of packages){const found=await findInTree(path.join(root,pkg.name),exe,{maxDepth:5});if(found)return found;}
  }catch{}
  return null;
}
function validPython(candidate,platform=process.platform,env=process.env){
  if(!candidate||candidate.toLowerCase().includes('\\windowsapps\\'))return null;
  try{if(!fsSync.statSync(candidate).isFile())return null;}catch{return null;}
  const result=spawnSync(candidate,['--version'],{encoding:'utf8',windowsHide:true,timeout:10000});
  return result.status===0?candidate:null;
}
async function discoverTools(userData,platform=process.platform,env=process.env){
  if(platform!=='win32')return {ollama:null,blender:null,piper:null,ffmpeg:null,python:null,voice:null};
  const local=env.LOCALAPPDATA,programFiles=env.ProgramFiles,programFilesX86=env['ProgramFiles(x86)'],programData=env.ProgramData;
  const ollama=await firstExisting([
    findOnPath('ollama.exe',platform),...registryAppPath('ollama.exe',platform,env),
    local&&path.join(local,'Programs','Ollama','ollama.exe'),local&&path.join(local,'Ollama','ollama.exe'),
    programFiles&&path.join(programFiles,'Ollama','ollama.exe'),programFilesX86&&path.join(programFilesX86,'Ollama','ollama.exe'),
    await scanWingetPackages(env,'Ollama.Ollama_','ollama.exe')
  ]);
  const blender=await firstExisting([
    findOnPath('blender.exe',platform),...registryAppPath('blender.exe',platform,env),
    await findVersionedProgram([programFiles,programFilesX86,local&&path.join(local,'Programs')],['Blender Foundation','Blender'],'blender.exe'),
    await scanWingetPackages(env,'BlenderFoundation.Blender_','blender.exe')
  ]);
  const ffmpeg=await firstExisting([
    findOnPath('ffmpeg.exe',platform),...registryAppPath('ffmpeg.exe',platform,env),
    local&&path.join(local,'Microsoft','WinGet','Links','ffmpeg.exe'),
    programFiles&&path.join(programFiles,'ffmpeg','bin','ffmpeg.exe'),programFiles&&path.join(programFiles,'FFmpeg','bin','ffmpeg.exe'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',programData&&path.join(programData,'chocolatey','bin','ffmpeg.exe'),
    await scanWingetPackages(env,'Gyan.FFmpeg_','ffmpeg.exe')
  ]);
  const managedDir=userData&&path.join(userData,'tools','piper-venv','Scripts');
  const managedPython=managedDir&&path.join(managedDir,'python.exe');
  const managedPiper=managedDir&&path.join(managedDir,'piper.exe');
  const externalPiper=await firstExisting([
    findOnPath('piper.exe',platform),...registryAppPath('piper.exe',platform,env),
    local&&path.join(local,'Programs','Piper','piper.exe'),local&&path.join(local,'Piper','piper.exe'),
    programFiles&&path.join(programFiles,'Piper','piper.exe'),programFilesX86&&path.join(programFilesX86,'Piper','piper.exe'),
    env.APPDATA&&path.join(env.APPDATA,'Python','Python312','Scripts','piper.exe'),
    local&&path.join(local,'Programs','Python','Python312','Scripts','piper.exe')
  ]);
  const piperPython=await firstExisting([managedPython]);
  let piper=externalPiper;
  if(piperPython){
    const result=spawnSync(piperPython,['-c','import piper'],{encoding:'utf8',windowsHide:true,timeout:20000});
    if(result.status===0)piper=(await firstExisting([managedPiper]))||piperPython;
  }
  const pythonCandidates=[
    findOnPath('python.exe',platform),
    local&&path.join(local,'Programs','Python','Python312','python.exe'),
    programFiles&&path.join(programFiles,'Python312','python.exe')
  ];
  const python=pythonCandidates.map(x=>validPython(x,platform,env)).find(Boolean)||null;
  return {ollama,blender,piper,ffmpeg,python,voice:null};
}

module.exports={findOnPath,firstExisting,expandEnvironment,parseRegistryAppPath,registryAppPath,findInTree,discoverTools};
