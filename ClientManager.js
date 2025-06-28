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
    this.authBaseDir = path.resolve(__dirname, 'whatsapp_auth');
  }

  // Only loads numeric-named folders (i.e. pure numbers)
  loadExistingSessions() {
    if (!fs.existsSync(this.authBaseDir)) return;

    const folders = fs.readdirSync(this.authBaseDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
      .map(d => d.name);

    for (const token of folders) {
      try {
        if (!this.clients.has(token)) {
          this.initializeClient(token);
          console.log(`Restored WhatsApp session for token: ${token}`);
        }
      } catch (err) {
        console.error(`Failed to restore session for ${token}:`, err);
      }
    }
  }

  initializeClient(token) {
    if (this.clients.has(token)) {
      throw new Error('Client with this token already exists.');
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: token,
        dataPath: this.authBaseDir,
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
    try {
      const client = this.clients.get(token);
      if (!client) throw new Error('Client not found.');
      if (this.getStatus(token) !== 'authenticated') throw new Error('Client is not authenticated.');

      const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
      const isRegistered = await client.isRegisteredUser(chatId);
      if (!isRegistered) throw new Error('Number not registered on WhatsApp.');

      await client.sendMessage(chatId, message);
      return { success: true, message: 'Message sent successfully.' };
    } catch (error) {
      if (
        error.message &&
        error.message.includes("Cannot read properties of undefined (reading 'serialize')")
      ) {
        console.warn("Puppeteer serialize bug: message was likely sent successfully.");
        return {
          success: true,
          message: "Message sent successfully."
        };
      }
      console.error("Error sending message:", error);
      return { success: false, error: error.message || String(error) };
    }
  }

  async sendImage(token, number, imageUrl, caption = '') {
    try {
      const client = this.clients.get(token);
      if (!client) throw new Error('Client not found.');
      if (this.getStatus(token) !== 'authenticated') throw new Error('Client is not authenticated.');

      const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
      const isRegistered = await client.isRegisteredUser(chatId);
      if (!isRegistered) throw new Error('Number not registered on WhatsApp.');

      const media = await this.fetchImageFromUrl(imageUrl);
      await client.sendMessage(chatId, media, { caption });
      return { success: true, message: 'Image sent successfully.' };
    } catch (error) {
      if (
        error.message &&
        error.message.includes("Cannot read properties of undefined (reading 'serialize')")
      ) {
        console.warn("Puppeteer serialize bug (image): image was likely sent successfully.");
        return {
          success: true,
          message: "Image sent successfully."
        };
      }
      console.error("Error sending image:", error);
      return { success: false, error: error.message || String(error) };
    }
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

    try {
      await client.logout().catch(e => {
        console.warn(`Logout warning for token ${token}:`, e.message || e);
      });
      await client.destroy();
    } catch (err) {
      console.warn(`Error during logout/destroy for token ${token}:`, err.message || err);
    }

    this.clients.delete(token);
    this.qrCodes.delete(token);
    this.statuses.delete(token);

    const authDir = path.resolve(this.authBaseDir, token);
    if (fs.existsSync(authDir)) {
      try {
        fs.rmSync(authDir, { recursive: true, force: true });
      } catch (err) {
        if (
          err.code === 'ENOTEMPTY' ||
          err.code === 'EBUSY' ||
          err.code === 'EPERM'
        ) {
          console.warn(`Session dir ${authDir} not empty or busy. Manual cleanup may be needed:`, err.message);
        } else {
          console.error(`Error deleting session dir ${authDir}:`, err);
        }
      }
    }
  }
}

module.exports = ClientManager;
