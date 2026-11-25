const $=id=>document.getElementById(id);
const state={folder:null,blender:null,piper:null,voice:null,ffmpeg:null,result:null};
let setupState=null;
function saveSettings(){const s={folder:state.folder,blender:state.blender,piper:state.piper,voice:state.voice,ffmpeg:state.ffmpeg,model:$('model').value,vision:$('vision').value};localStorage.setItem('frameforge-settings',JSON.stringify(s));}
function loadSettings(){try{const s=JSON.parse(localStorage.getItem('frameforge-settings')||'{}');Object.assign(state,{folder:s.folder||null,blender:s.blender||null,piper:s.piper||null,voice:s.voice||null,ffmpeg:s.ffmpeg||null});$('model').value=s.model||'qwen2.5:7b';$('vision').value=s.vision||'llava:7b';$('folder-label').textContent=state.folder||'Choose where your project files will go';$('blender-label').textContent=state.blender||'Select blender.exe';$('piper-label').textContent=state.piper||'Select piper.exe';$('voice-label').textContent=state.voice||'Select a .onnx voice';$('ffmpeg-label').textContent=state.ffmpeg||'Select ffmpeg.exe';}catch{}}
loadSettings();
async function refreshSetup(){
  try{
    setupState=await frameforge.setupStatus();
    if(setupState.blender){state.blender=setupState.blender;$('blender-label').textContent=state.blender;saveSettings();}
    if(setupState.ffmpeg){state.ffmpeg=setupState.ffmpeg;$('ffmpeg-label').textContent=state.ffmpeg;saveSettings();}
    if(setupState.piper){state.piper=setupState.piper;$('piper-label').textContent=state.piper;saveSettings();}
    const missing=[];if(!setupState.ollama)missing.push('Ollama');if(!setupState.blender)missing.push('Blender');if(!setupState.piper)missing.push('Piper');if(!setupState.ffmpeg)missing.push('FFmpeg');
    const models=setupState.models||[], missingModels=[$('model').value,$('vision').value].filter(name=>!models.some(x=>x===name||x.startsWith(name+':')));
    let text=missing.length?`Missing: ${missing.join(', ')}.`:'Ollama, Blender, Piper, and FFmpeg are installed.';
    text+=setupState.ollamaRunning?(missingModels.length?` AI model(s) needed: ${missingModels.join(', ')}.`:' Ollama is ready.'):' Ollama is not running.';
    $('setup-status').textContent=text;
    const needsStart=Boolean(setupState.ollama&&!setupState.ollamaRunning);
    $('setup-btn').disabled=!missing.length&&!needsStart;
    $('setup-btn').textContent=missing.length?'Check & install missing apps':needsStart?'Start Ollama':'Apps detected';
    $('models-btn').disabled=!setupState.ollamaRunning||!missingModels.length;
    $('models-btn').textContent=missingModels.length?'Download selected AI models':'AI models ready';
    if(setupState.ollamaRunning){$('status-title').textContent='Local AI connected';}
  }catch(e){$('setup-status').textContent=`Could not check setup: ${e.message}`;}
}
refreshSetup();
$('setup-btn').onclick=async()=>{
  try{
    await refreshSetup();const missing=[];if(!setupState?.ollama)missing.push('ollama');if(!setupState?.blender)missing.push('blender');if(!setupState?.piper)missing.push('piper');if(!setupState?.ffmpeg)missing.push('ffmpeg');
    if(!missing.length){if(setupState?.ollamaRunning){$('setup-status').textContent='Ollama and Blender are installed.';return;}$('setup-btn').disabled=true;$('setup-status').textContent='Starting Ollama…';await frameforge.setupStatus();await refreshSetup();return;}
    const labels=missing.map(x=>({ollama:'Ollama',blender:'Blender',piper:'Piper TTS',ffmpeg:'FFmpeg'}[x])).join(' and ');
    if(!confirm(`Download and set up ${labels}? Apps install with Windows Package Manager. Piper and its Python runtime install in a private app folder. Windows may ask you to approve installers. The Piper voice .onnx file is selected separately.`))return;
    $('setup-btn').disabled=true;$('setup-status').textContent='Downloading and installing the missing apps…';
    await frameforge.installMissing(missing);await refreshSetup();
  }catch(e){$('setup-status').textContent=e.message;alert(e.message);}finally{$('setup-btn').disabled=false;}
};
$('models-btn').onclick=async()=>{
  const models=setupState?.models||[], names=[$('model').value,$('vision').value].filter(name=>!models.some(x=>x===name||x.startsWith(name+':')));
  if(!names.length){await refreshSetup();return;}
  if(!confirm(`Download ${names.join(' and ')} from Ollama? This may use several gigabytes of internet data and disk space.`))return;
  $('models-btn').disabled=true;$('setup-status').textContent=`Downloading AI models: ${names.join(', ')}…`;
  try{await frameforge.pullModels({textModel:$('model').value,visionModel:$('vision').value});await refreshSetup();}
  catch(e){$('setup-status').textContent=e.message;alert(e.message);}
  finally{$('models-btn').disabled=false;}
};
$('prompt').addEventListener('input',()=>{$('count').textContent=`${$('prompt').value.length} / 1200`;const n=$('prompt').value.length;$('estimate').textContent=n>500?'5–12 min':n>180?'4–10 min':'3–8 min';});
$('folder-btn').onclick=async()=>{const p=await frameforge.pickFolder();if(p){state.folder=p;$('folder-label').textContent=p;saveSettings();}};
for(const [id,key,label] of [['blender-btn','blender','blender-label'],['voice-btn','voice','voice-label'],['piper-btn','piper','piper-label'],['ffmpeg-btn','ffmpeg','ffmpeg-label']])$(id).onclick=async()=>{const p=await frameforge.pickFile(key);if(p){state[key]=p;$(`${label}`).textContent=p;saveSettings();}};
for(const id of ['model','vision'])$(id).addEventListener('change',()=>{saveSettings();refreshSetup();});
function setProgress(text,pct){$('status').textContent=text;$('meter').style.width=`${pct}%`;}
frameforge.onEvent(({event,message})=>{if(event==='setup-progress'){$('setup-status').textContent=message;}if(event==='progress'){setProgress(message,Math.min(parseFloat($('meter').style.width)||12,85));$('status-title').textContent='Working on your scene…';$('status-dot').style.background='#f3c86a';}if(event==='preview'){const img=$('preview').querySelector('img')||document.createElement('img');img.src=message.image;if(!img.parentNode)$('preview').append(img);$('preview').querySelectorAll('.orb,.orbit,.preview-caption').forEach(x=>x.classList.add('hidden'));$('attempt').textContent=`${message.attempt} / 3 DRAFTS`;$('voice-note').textContent=`Voiceover draft: “${message.narration}”`;$('voice-note').classList.remove('hidden');}if(event==='ready'){state.result=message;$('status-title').textContent='Draft ready for review';$('status-dot').style.background='#c5ee64';setProgress(`Draft saved in ${message.outputFolder}`,100);$('approve').classList.remove('hidden');$('open-preview').classList.remove('hidden');$('open-preview').onclick=()=>frameforge.openFile(message.video);}});
$('create').onclick=async()=>{const prompt=$('prompt').value.trim();if(!prompt)return alert('Describe the animation first.');if(!state.folder)return alert('Choose a project folder first.');if(!state.blender)return alert('Choose Blender in Local model & tool setup.');$('create').disabled=true;$('approve').classList.add('hidden');$('open-preview').classList.add('hidden');$('status-dot').style.background='#f3c86a';$('status-title').textContent='Starting local workflow…';setProgress('Connecting to Ollama on this computer…',8);try{await frameforge.generate({folder:state.folder,blender:state.blender,ffmpeg:state.ffmpeg,model:$('model').value,visionModel:$('vision').value,prompt,revise:''});}catch(e){$('status-title').textContent='Could not finish this draft';setProgress(e.message,0);alert(e.message);}finally{$('create').disabled=false;}};
$('approve').onclick=async()=>{if(!state.result)return;$('approve').disabled=true;try{const final=await frameforge.approve({blender:state.blender,ffmpeg:state.ffmpeg,scene:state.result.scene,video:state.result.finalVideo,script:state.result.finalScript});$('status-title').textContent='Final render complete';setProgress(`Saved final animation: ${final}`,100);$('approve').classList.add('hidden');if(state.piper&&state.voice&&state.ffmpeg){const ok=confirm('Create the voiceover and add it to this video?');if(ok){try{const voiced=await frameforge.speak({piper:state.piper,voice:state.voice,ffmpeg:state.ffmpeg,video:final,text:state.result.scene.narration});$('voice-note').textContent=`Voice video saved: ${voiced}`;await frameforge.openFile(voiced);}catch(e){alert(e.message);}}}else await frameforge.openFile(final);}catch(e){alert(e.message);setProgress(e.message,0);}finally{$('approve').disabled=false;}};
