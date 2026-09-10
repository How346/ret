// whatsapp-service.js
// Electron main-process WhatsApp Web integration.
// Dependencies: whatsapp-web.js, qrcode

const { ipcMain } = require('electron');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const QRCode = require('qrcode');

let whatsappClient = null;
let whatsappWindow = null;
let initialized = false;

function setWhatsAppWindow(win) {
  whatsappWindow = win;
}

function sendToRenderer(channel, ...args) {
  if (whatsappWindow && !whatsappWindow.isDestroyed()) {
    whatsappWindow.webContents.send(channel, ...args);
  }
}

function cleanPhoneNumber(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function initializeWhatsApp() {
  if (initialized) return;
  initialized = true;

  whatsappClient = new Client({
    authStrategy: new LocalAuth({
      clientId: 'quick-retail-nexus'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  });

  whatsappClient.on('qr', async (qr) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320
      });
      sendToRenderer('whatsapp-qr', qrDataUrl);
      sendToRenderer('whatsapp-status', { state: 'qr', message: 'Scan the QR code' });
    } catch (error) {
      sendToRenderer('whatsapp-error', error.message);
    }
  });

  whatsappClient.on('ready', () => {
    sendToRenderer('whatsapp-ready');
    sendToRenderer('whatsapp-status', { state: 'ready', message: 'WhatsApp connected' });
  });

  whatsappClient.on('authenticated', () => {
    sendToRenderer('whatsapp-status', { state: 'authenticated', message: 'Authenticated' });
  });

  whatsappClient.on('auth_failure', (message) => {
    sendToRenderer('whatsapp-error', `WhatsApp authentication failed: ${message}`);
  });

  whatsappClient.on('disconnected', (reason) => {
    sendToRenderer('whatsapp-status', { state: 'disconnected', message: String(reason) });
  });

  whatsappClient.initialize().catch((error) => {
    sendToRenderer('whatsapp-error', error.message);
  });

  ipcMain.handle('send-bill-image', async (_event, { base64Image, phone, message }) => {
    if (!whatsappClient) {
      throw new Error('WhatsApp is not initialized.');
    }

    if (!base64Image) {
      throw new Error('Bill image is empty.');
    }

    if (!whatsappClient.info) {
      throw new Error('WhatsApp is not ready. Please connect WhatsApp first.');
    }

    const cleanPhone = cleanPhoneNumber(phone);
    if (!cleanPhone) {
      throw new Error('Invalid phone number.');
    }

    // Accept either raw base64 or a data URL, while still constructing
    // MessageMedia from the image in memory.
    const rawBase64 = String(base64Image).replace(
      /^data:image\/(?:png|jpeg|jpg);base64,/i,
      ''
    );

    const chatId = `${cleanPhone}@c.us`;
    const media = new MessageMedia('image/png', rawBase64, 'bill.png');

    if (message && String(message).trim()) {
      await whatsappClient.sendMessage(chatId, String(message));
    }

    const result = await whatsappClient.sendMessage(chatId, media);
    return {
      ok: true,
      messageId: result && result.id ? result.id._serialized : null
    };
  });
}

module.exports = {
  setWhatsAppWindow,
  initializeWhatsApp
};
