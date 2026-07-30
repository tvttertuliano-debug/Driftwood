'use strict';

/**
 * Ponte estreita entre a página e o disco. Só quatro funções: o renderizador
 * não tem acesso a Node, e é assim que deve ser.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('driftwood', {
  save: (key, value) => ipcRenderer.invoke('driftwood:save', key, value),
  load: (key) => ipcRenderer.invoke('driftwood:load', key),
  clear: (key) => ipcRenderer.invoke('driftwood:clear', key),
  sair: () => ipcRenderer.invoke('driftwood:sair'),
  modo: (process.argv.find((a) => a.startsWith('--driftwood-mode=')) ?? '=janela').split('=')[1],
});
