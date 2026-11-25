const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('frameforge', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  pickFile: kind => ipcRenderer.invoke('pick-file', kind),
  openFile: file => ipcRenderer.invoke('open-file', file),
  setupStatus: () => ipcRenderer.invoke('setup-status'),
  installMissing: tools => ipcRenderer.invoke('install-missing', tools),
  pullModels: cfg => ipcRenderer.invoke('pull-models', cfg),
  generate: cfg => ipcRenderer.invoke('generate', cfg),
  speak: cfg => ipcRenderer.invoke('speak', cfg),
  approve: cfg => ipcRenderer.invoke('approve', cfg),
  onEvent: fn => { const handler = (_, data) => fn(data); ipcRenderer.on('job-event', handler); return () => ipcRenderer.removeListener('job-event', handler); }
});
