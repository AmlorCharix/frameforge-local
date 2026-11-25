const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { discoverTools } = require('../src/tool-discovery.cjs');
const { blenderScript } = require('../src/blender-script.cjs');
const { makeVideoArgs } = require('../src/video-encoding.cjs');

test('Blender creates the draft still, preview video, and final video', async t => {
  const tools=await discoverTools(path.join(os.tmpdir(),'frameforge-test-userdata'));
  if(!tools.blender){t.skip('Blender is not installed on this machine.');return;}
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'frameforge-blender-'));
  const safeBase=path.resolve(os.tmpdir())+path.sep;
  assert.ok(path.resolve(root).startsWith(safeBase),'test output must stay in the OS temp folder');
  const out=path.join(root,'supported-shapes'),scene={title:'Supported shapes smoke test',seconds:4,fps:12,narration:'A quick test.',objects:['sphere','cube','cone','torus','cylinder'].map((shape,i)=>({name:`Object ${i+1}`,shape,color:['coral','gold','mint','blue','violet'][i],size:.45,start:[i-2,0,1],end:[i-1.5,0,1]}))};
  const draftScript=path.join(root,'draft.py'),finalScript=path.join(root,'final.py');
  try{
    await fs.writeFile(draftScript,blenderScript(scene,out,'preview'));
    await fs.writeFile(finalScript,blenderScript(scene,out,'final'));
    const draft=spawnSync(tools.blender,['-b','--python',draftScript],{cwd:root,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});
    assert.equal(draft.error,undefined,draft.error?.message);
    assert.equal(draft.status,0,`${draft.stdout||''}\n${draft.stderr||''}`.slice(-6000));
    assert.ok(draft.stdout.includes('FRAMEFORGE_RENDER_DONE'),`${draft.stdout||''}\n${draft.stderr||''}`.slice(-6000));
    const stills=(await fs.readdir(root)).filter(x=>x.toLowerCase().startsWith('supported-shapes_review')&&x.toLowerCase().endsWith('.png'));
    assert.ok(stills.length,`preview still missing; outputs: ${(await fs.readdir(root)).join(', ')}`);
    assert.ok((await fs.stat(path.join(root,stills[0]))).size>1000,'preview image should contain rendered data');
    const previewFrames=(await fs.readdir(root)).filter(x=>x.startsWith('supported-shapes_preview_frame_')&&x.endsWith('.png'));
    assert.equal(previewFrames.length,scene.seconds*scene.fps,'preview should contain one PNG per animation frame');
    if(tools.ffmpeg){
      const encoded=spawnSync(tools.ffmpeg,makeVideoArgs(out,scene.fps,'preview'),{cwd:root,encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024});
      assert.equal(encoded.error,undefined,encoded.error?.message);assert.equal(encoded.status,0,`${encoded.stdout||''}\n${encoded.stderr||''}`.slice(-4000));
      assert.ok((await fs.stat(path.join(root,'supported-shapes_preview.mp4'))).size>1000,'FFmpeg preview should contain rendered frames');
    }else t.diagnostic('FFmpeg is not installed here, so the MP4 encoding step was not exercised.');
    const final=spawnSync(tools.blender,['-b','--python',finalScript],{cwd:root,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});
    assert.equal(final.error,undefined,final.error?.message);
    assert.equal(final.status,0,`${final.stdout||''}\n${final.stderr||''}`.slice(-6000));
    assert.ok(final.stdout.includes('FRAMEFORGE_RENDER_DONE'),`${final.stdout||''}\n${final.stderr||''}`.slice(-6000));
    const finalFrames=(await fs.readdir(root)).filter(x=>x.startsWith('supported-shapes_final_frame_')&&x.endsWith('.png'));
    assert.equal(finalFrames.length,scene.seconds*scene.fps,'final render should contain one PNG per animation frame');
    if(tools.ffmpeg){
      const encoded=spawnSync(tools.ffmpeg,makeVideoArgs(out,scene.fps,'final'),{cwd:root,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:4*1024*1024});
      assert.equal(encoded.error,undefined,encoded.error?.message);assert.equal(encoded.status,0,`${encoded.stdout||''}\n${encoded.stderr||''}`.slice(-4000));
      assert.ok((await fs.stat(path.join(root,'supported-shapes_final.mp4'))).size>1000,'FFmpeg final should contain rendered frames');
    }
  }finally{
    for(const name of await fs.readdir(root))await fs.rm(path.join(root,name),{recursive:true,force:true});
    await fs.rmdir(root);
  }
});
