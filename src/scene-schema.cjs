const specSchema={
  type:'object',required:['title','seconds','fps','objects','narration'],additionalProperties:false,
  properties:{
    title:{type:'string',maxLength:80},seconds:{type:'integer',minimum:4,maximum:12},fps:{type:'integer',enum:[12,24]},
    narration:{type:'string',maxLength:240},
    objects:{type:'array',minItems:1,maxItems:8,items:{type:'object',required:['name','shape','color','start','end','size'],additionalProperties:false,properties:{name:{type:'string',maxLength:40},shape:{type:'string',enum:['sphere','cube','cone','torus','cylinder']},color:{type:'string',enum:['coral','gold','mint','blue','violet','white']},start:{type:'array',items:{type:'number',minimum:-2.5,maximum:3.5},minItems:3,maxItems:3},end:{type:'array',items:{type:'number',minimum:-2.5,maximum:3.5},minItems:3,maxItems:3},size:{type:'number',minimum:0.3,maximum:1.8}}}}
  }
};
function validateScene(scene){
  if(!scene||typeof scene!=='object'||Array.isArray(scene))throw new Error('Scene must be a JSON object.');
  if(!Array.isArray(scene.objects)||scene.objects.length<1)throw new Error('Scene needs at least one supported object.');
  const shapes=['sphere','cube','cone','torus','cylinder'],colors=['coral','gold','mint','blue','violet','white'];
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const objects=scene.objects.slice(0,8).map((o,i)=>{
    o=o&&typeof o==='object'&&!Array.isArray(o)?o:{};
    const size=clamp(Number.isFinite(o.size)?o.size:0.8,0.3,1.8);
    const point=(v,fallback)=>{
      if(!Array.isArray(v)||v.length!==3)return fallback;
      const x=Number.isFinite(v[0])?clamp(v[0],-2.5,2.5):fallback[0];
      const y=Number.isFinite(v[1])?clamp(v[1],-2.5,2.5):fallback[1];
      const z=Number.isFinite(v[2])?clamp(v[2],size,3.5):fallback[2];
      return [x,y,z];
    };
    return {name:(typeof o.name==='string'&&o.name.trim()?o.name.trim():`Object ${i+1}`).slice(0,40),shape:shapes.includes(o.shape)?o.shape:'sphere',color:colors.includes(o.color)?o.color:'gold',start:point(o.start,[0,0,Math.max(1,size)]),end:point(o.end,[1,0,Math.max(1,size)]),size};
  });
  const seconds=Number.isFinite(scene.seconds)?clamp(Math.round(scene.seconds),4,12):6;
  const title=typeof scene.title==='string'&&scene.title.trim()?scene.title.trim().slice(0,80):'A small animated scene';
  const narration=typeof scene.narration==='string'?scene.narration.trim().slice(0,240):'';
  return {title,seconds,fps:scene.fps===12?12:24,objects,narration};
}
const SCENE_RULES=`Create only a small, simple Blender scene. Output exactly one JSON object matching the schema; never output Python, Blender code, markdown, extra keys, custom assets, or unsupported instructions. Supported shapes are sphere, cube, cone, torus, cylinder. Supported colors are coral, gold, mint, blue, violet, white. Use 1 to 8 objects. Each object has only name, shape, color, start, end, size. start and end are [x,y,z] positions in Blender world coordinates: x and y must be from -2.5 to 2.5; z must be from 0.3 to 3.5. Keep both endpoints in this range. Use size from 0.3 to 1.8. Animate location from start to end; the app supplies a gentle spin automatically. Do not invent rotations, scale animation, rigs, physics, modifiers, cameras, lights, or materials. Use 4 to 12 seconds and fps 12 or 24. Left/right means negative/positive x; toward/away from the camera means negative/positive y; height is z. Keep objects near the center and above the ground. Translate complicated requests into a simple arrangement and movement using these supported primitives. Keep narration to one short sentence.`;
async function safeScene(raw,cfg,prompt,{ollama,send}){
  for(let repair=0;repair<3;repair++){
    try{return validateScene(JSON.parse(raw));}
    catch(e){
      if(repair===2)throw new Error('Ollama could not return a usable scene after two correction attempts. Try a shorter prompt or a different local model.');
      send('progress',`Correcting the scene format (${repair+1} of 2)…`);
      raw=await ollama({model:cfg.model||'qwen2.5:7b',stream:false,format:specSchema,messages:[{role:'system',content:SCENE_RULES+' Repair the supplied result to follow every rule exactly. Use valid JSON only.'},{role:'user',content:`User request: ${prompt}\nProblem: ${e.message}\nInvalid model output: ${String(raw).slice(0,5000)}`} ]});
    }
  }
}
module.exports={specSchema,validateScene,SCENE_RULES,safeScene};
