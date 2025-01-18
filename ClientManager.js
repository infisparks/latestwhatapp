// ClientManager.js

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

class ClientManager extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.qrCodes = new Map();
    this.statuses = new Map();
  }

  initializeClient(token) {
    if (this.clients.has(token)) {
      throw new Error('Client with this token already exists.');
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: token,
        dataPath: path.resolve(__dirname, 'whatsapp_auth'),
      }),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      },
    });

    client.on('qr', (qr) => {
      console.log(`QR RECEIVED for ${token}`);
      qrcode.generate(qr, { small: true });
      this.qrCodes.set(token, qr);
      this.emit('qr', token, qr);
    });

    client.on('ready', () => {
      console.log(`WhatsApp Client ${token} is ready!`);
      this.statuses.set(token, 'authenticated');
      this.qrCodes.delete(token);
      this.emit('ready', token);
    });

    client.on('auth_failure', (msg) => {
      console.error(`AUTHENTICATION FAILURE for ${token}:`, msg);
      this.statuses.set(token, 'auth_failure');
      this.qrCodes.delete(token);
      this.emit('auth_failure', token, msg);
    });

    client.on('message', (msg) => {
      console.log(`Message from ${msg.from} on ${token}: ${msg.body}`);
      // Handle incoming messages if needed
    });

    client.initialize();

    this.clients.set(token, client);
    this.statuses.set(token, 'initializing');
  }

  getQRCode(token) {
    return this.qrCodes.get(token) || null;
  }

  getStatus(token) {
    return this.statuses.get(token) || 'unknown';
  }

  async sendText(token, number, message) {
    const client = this.clients.get(token);
    if (!client) {
      throw new Error('Client not found.');
    }
    if (this.getStatus(token) !== 'authenticated') {
      throw new Error('Client is not authenticated.');
    }

    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
  }

  async sendImage(token, number, imageUrl, caption = '') {
    const client = this.clients.get(token);
    if (!client) {
      throw new Error('Client not found.');
    }
    if (this.getStatus(token) !== 'authenticated') {
      throw new Error('Client is not authenticated.');
    }

    const media = await this.fetchImageFromUrl(imageUrl);
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, media, { caption });
  }

  async fetchImageFromUrl(imageUrl) {
    try {
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data, 'binary');
      const mimeType = response.headers['content-type'];
      const filename = path.basename(imageUrl).split('?')[0] || 'image.jpg';
      return new MessageMedia(mimeType, buffer.toString('base64'), filename);
    } catch (error) {
      throw new Error('Failed to fetch image from URL.');
    }
  }

  listSessions() {
    return Array.from(this.clients.keys());
  }

  async removeSession(token) {
    const client = this.clients.get(token);
    if (!client) {
      throw new Error('Client not found.');
    }

    await client.logout();
    client.destroy();

    this.clients.delete(token);
    this.qrCodes.delete(token);
    this.statuses.delete(token);

    const authDir = path.resolve(__dirname, 'whatsapp_auth', token);
    if (fs.existsSync(authDir)) {
      fs.rmdirSync(authDir, { recursive: true });
    }
  }
}

module.exports = ClientManager;
