/**
 * ClientManager.js
 */

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
    // Prevent initializing the same client multiple times
    if (this.clients.has(token)) {
      throw new Error('Client with this token already exists.');
    }

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: token,
        dataPath: path.resolve(__dirname, 'whatsapp_auth'),
      }),
      puppeteer: {
        headless: true, // You can set to 'new' if supported
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      },
    });

    // Handle QR code generation
    client.on('qr', (qr) => {
      console.log(`QR RECEIVED for ${token}`);
      qrcode.generate(qr, { small: true });
      this.qrCodes.set(token, qr);
      this.emit('qr', token, qr);
    });

    // When the client is ready
    client.on('ready', () => {
      console.log(`WhatsApp Client ${token} is ready!`);
      this.statuses.set(token, 'authenticated');
      this.qrCodes.delete(token);
      this.emit('ready', token);
    });

    // Authentication failure
    client.on('auth_failure', (msg) => {
      console.error(`AUTHENTICATION FAILURE for ${token}:`, msg);
      this.statuses.set(token, 'auth_failure');
      this.qrCodes.delete(token);
      this.emit('auth_failure', token, msg);
    });

    // Disconnection handler
    client.on('disconnected', (reason) => {
      console.log(`Client ${token} was disconnected. Reason: ${reason}`);
      this.statuses.set(token, 'logged_out');
      this.emit('disconnected', token, reason);
    });

    // Log incoming messages (optional)
    client.on('message', (msg) => {
      console.log(`Message from ${msg.from} on ${token}: ${msg.body}`);
      // Handle incoming messages here if needed
    });

    // Initialize the client
    client.initialize();

    // Store client references
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

    // Ensure the number is in the correct format
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
      const mimeType = response.headers['content-type'] || 'image/jpeg';
      const filename = path.basename(imageUrl).split('?')[0] || 'image.jpg';

      return new MessageMedia(mimeType, buffer.toString('base64'), filename);
    } catch (error) {
      throw new Error('Failed to fetch image from URL.');
    }
  }

  listSessions() {
    return Array.from(this.clients.keys());
  }

  /**
   * Removes a session:
   * - Attempts to destroy the client.
   * - Cleans up stored authentication files gracefully.
   */
  async removeSession(token) {
    const client = this.clients.get(token);
    if (!client) {
      throw new Error('Client not found.');
    }

    // Destroy the client
    try {
      await client.destroy();
    } catch (err) {
      console.error(`Failed to destroy client for token ${token}:`, err);
    }

    // Clean up references
    this.clients.delete(token);
    this.qrCodes.delete(token);
    this.statuses.delete(token);

    // Attempt to remove the stored auth folder
    const authDir = path.resolve(__dirname, 'whatsapp_auth', token);
    if (fs.existsSync(authDir)) {
      try {
        // Use fs.rmSync with recursive and force to handle locked files
        fs.rmSync(authDir, { recursive: true, force: true });
        console.log(`Successfully removed auth directory for token ${token}`);
      } catch (err) {
        console.error(`Failed to remove auth folder for token ${token}:`, err);
        // Optionally, you can retry after a delay or notify the admin
      }
    }
  }
}

module.exports = ClientManager;
