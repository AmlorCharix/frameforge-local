function makeVideoArgs(outPath,fps,mode){
  if(!['preview','final'].includes(mode))throw new Error('Unsupported render output mode.');
  if(!Number.isInteger(fps)||fps<1||fps>120)throw new Error('Invalid animation frame rate.');
  return ['-y','-framerate',String(fps),'-start_number','1','-i',`${outPath}_${mode}_frame_%04d.png`,'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',`${outPath}_${mode}.mp4`];
}
module.exports={makeVideoArgs};
