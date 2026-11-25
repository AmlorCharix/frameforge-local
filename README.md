# FrameForge Local

A Windows desktop starter app with a browser-style interface. It asks a local Ollama model to plan a small scene, then runs a generated, restricted Blender script inside a folder you choose. The app can ask an Ollama vision model to review a rendered still and retry up to two times. You can inspect the preview and explicitly approve before the final render.

## What you need

- Windows 10 or 11 (64-bit)
- [Ollama](https://ollama.com/) running locally, with a text model pulled (for example `ollama pull qwen2.5:7b`). For image review, pull a vision model too (for example `ollama pull llava:7b`). Model names depend on your machine and Ollama library.
- Blender installed locally. This app does not bundle Blender.
- Optional: Piper TTS and a Piper voice model (`.onnx` plus its matching `.onnx.json`) for spoken narration. Without Piper, the video has no generated voice.
- Optional: FFmpeg on PATH to combine Piper narration with the rendered video.

On launch, the app checks whether Ollama and Blender are installed and whether the Ollama server is running. In **Local model & tool setup**, choose **Check & install missing apps** to install missing tools with Windows Package Manager (`winget`). The app asks before it installs anything; Windows may also show its own installer approval. If `winget` is not available, install from [Ollama's Windows download page](https://ollama.com/download/windows) and [Blender's download page](https://www.blender.org/download/), then check again. Once Ollama is running, **Download selected AI models** pulls the text and vision models named in the settings. Model downloads can use several GB of disk space and internet data, so they have a separate confirmation.

## Run from source

Install Node.js 20 or newer, then in this folder run `npm install` and `npm start`.

## Build the Windows installer

On Windows, run `npm install` then `npm run dist`. The installer is created in `dist/`. To publish the source, create a public GitHub repository and push this folder. Pushing a version tag such as `v0.1.0` runs the included GitHub Actions workflow, builds the Windows installer, and attaches the `.exe` to a GitHub release. Do not commit installers or rendered user projects to the source repository.

## Safety and limits

The model returns JSON scene data; it does not write arbitrary code. The app validates and converts a small set of objects and motions into its own Blender script. Blender is launched only for the selected project folder. Output files are written under a `FrameForge` subfolder of the folder you select. Local model calls go to `http://127.0.0.1:11434`; no hosted AI service is used. Review the generated files before sharing them. Estimates are rough and depend on the model, frame count, and computer. The review pass checks a single still image, so it cannot guarantee that every part of the animation looks right.

This is a starter project, not a signed installer. A public Windows release should be built on Windows and code-signed if you distribute it broadly.
