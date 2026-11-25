const test = require('node:test');
const assert = require('node:assert/strict');
const { makeVideoArgs } = require('../src/video-encoding.cjs');

test('builds safe FFmpeg arguments for numbered rendered frames', () => {
  assert.deepEqual(makeVideoArgs('C:\\Project Files\\shot',24,'preview'),[
    '-y','-framerate','24','-start_number','1','-i','C:\\Project Files\\shot_preview_frame_%04d.png',
    '-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart','C:\\Project Files\\shot_preview.mp4'
  ]);
  assert.throws(()=>makeVideoArgs('shot',24,'unexpected'),/Unsupported render output mode/);
  assert.throws(()=>makeVideoArgs('shot',0,'final'),/Invalid animation frame rate/);
});
