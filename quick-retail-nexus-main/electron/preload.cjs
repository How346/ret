const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronPrint', {
  printHtml: (html, options = {}) => ipcRenderer.invoke('print-html', { html, options }),
});
