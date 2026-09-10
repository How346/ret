# WhatsApp integration snippets

## preload.js
```js
// Add these methods to your existing preload.js contextBridge.
sendBillImage: (payload) => ipcRenderer.invoke('send-bill-image', payload),
onWhatsAppQR: (callback) => ipcRenderer.on('whatsapp-qr', (_event, dataUrl) => callback(dataUrl)),
onWhatsAppReady: (callback) => ipcRenderer.on('whatsapp-ready', callback),
onWhatsAppStatus: (callback) => ipcRenderer.on('whatsapp-status', (_event, status) => callback(status)),
onWhatsAppError: (callback) => ipcRenderer.on('whatsapp-error', (_event, message) => callback(message)),

```

## renderer.js
```js
// Renderer example: send the dynamically generated bill image.
// base64Image must be the RAW base64 payload (without data:image/png;base64,).
async function sendBillToWhatsApp(base64Image, phone, message) {
  const rawBase64 = String(base64Image).replace(/^data:image\/[^;]+;base64,/i, '');
  return window.electronAPI.sendBillImage({
    base64Image: rawBase64,
    phone,
    message
  });
}

// QR UI
window.electronAPI.onWhatsAppQR((dataUrl) => {
  const img = document.getElementById('whatsapp-qr');
  const status = document.getElementById('whatsapp-status');
  if (img) {
    img.src = dataUrl;
    img.hidden = false;
  }
  if (status) status.textContent = 'Scan this QR code with WhatsApp';
});

window.electronAPI.onWhatsAppReady(() => {
  const img = document.getElementById('whatsapp-qr');
  const status = document.getElementById('whatsapp-status');
  if (img) img.hidden = true;
  if (status) status.textContent = 'WhatsApp connected';
});

```

## HTML
```html
<div id="whatsapp-panel">
  <div id="whatsapp-status">Connecting WhatsApp…</div>
  <img id="whatsapp-qr" alt="WhatsApp QR code" width="320" height="320" hidden />
</div>

```
