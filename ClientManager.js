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
    this.clients = new Map();   // Stores Client instances keyed by token
    this.qrCodes = new Map();   // Stores latest QR codes keyed by token
    this.statuses = new Map();  // Stores statuses: 'initializing', 'authenticated', 'logged_out', 'auth_failure'
  }

  /**
   * Initializes a new WhatsApp client session.
   * Note: The client is stored in the map immediately (with status 'initializing')
   * to avoid race conditions.
   */
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
        headless: true, // Change to 'new' if supported in your environment
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      },
    });

    // Set event listeners

    // QR code generation
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

    // Store client and mark it as 'initializing' before starting initialization.
    this.clients.set(token, client);
    this.statuses.set(token, 'initializing');

    // Start client initialization
    client.initialize();
  }

  /**
   * Returns the latest QR code for the given token.
   */
  getQRCode(token) {
    return this.qrCodes.get(token) || null;
  }

  /**
   * Returns the status of the client for the given token.
   */
  getStatus(token) {
    return this.statuses.get(token) || 'unknown';
  }

  /**
   * Sends a text message using the client identified by the token.
   */
  async sendText(token, number, message) {
    const client = this.clients.get(token);
    if (!client) {
      throw new Error('Client not found.');
    }
    if (this.getStatus(token) !== 'authenticated') {
      throw new Error('Client is not authenticated.');
    }

    // Ensure the number is in the correct format (e.g., 1234567890 => 1234567890@c.us)
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
    await client.sendMessage(chatId, message);
  }

  /**
   * Sends an image message using the client identified by the token.
   */
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

  /**
   * Fetches an image from a URL and returns a MessageMedia object.
   */
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

  /**
   * Lists all active session tokens.
   */
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

    // Clean up stored references
    this.clients.delete(token);
    this.qrCodes.delete(token);
    this.statuses.delete(token);

    // Remove the stored auth folder for the client
    const authDir = path.resolve(__dirname, 'whatsapp_auth', token);
    if (fs.existsSync(authDir)) {
      try {
        fs.rmSync(authDir, { recursive: true, force: true });
        console.log(`Successfully removed auth directory for token ${token}`);
      } catch (err) {
        console.error(`Failed to remove auth folder for token ${token}:`, err);
      }
    }
  }
}

module.exports = ClientManager;
