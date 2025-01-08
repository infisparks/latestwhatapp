// index.js

const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios'); // For fetching images
const fs = require('fs');
const path = require('path');

// Initialize Express app
const app = express();
const port = 3000;

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Remove the static file serving as it's no longer needed
// app.use(express.static(path.join(__dirname, 'public')));

// NOTE: Using 'puppeteer' now, not 'puppeteer-core'
const puppeteer = require('puppeteer');

// Initialize WhatsApp client with local authentication
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true, // Run in headless mode for API-only
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  },
});

// Variables to store QR code and authentication status
let isAuthenticated = false;
let qrCode = null;

// Display QR code in terminal and store it for API access
client.on('qr', (qr) => {
  console.log('QR RECEIVED', qr);
  qrcode.generate(qr, { small: true });
  qrCode = qr; // Store the latest QR code
});

// Log successful authentication and update status
client.on('ready', () => {
  console.log('WhatsApp Client is ready!');
  isAuthenticated = true;
  qrCode = null; // Clear QR code once authenticated
});

// Handle authentication failures
client.on('auth_failure', msg => {
  console.error('AUTHENTICATION FAILURE', msg);
  isAuthenticated = false;
  qrCode = null;
});

// Log incoming messages (optional)
client.on('message', msg => {
  console.log(`Message from ${msg.from}: ${msg.body}`);
});

// Initialize the client
client.initialize();

/**
 * Helper function to fetch image from URL and convert to MessageMedia
 * @param {string} imageUrl - The URL of the image to fetch
 * @returns {Promise<MessageMedia>} - The MessageMedia object
 */
const fetchImageFromUrl = async (imageUrl) => {
  try {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const mimeType = response.headers['content-type'];
    const filename = path.basename(imageUrl).split('?')[0] || 'image.jpg';
    return new MessageMedia(mimeType, buffer.toString('base64'), filename);
  } catch (error) {
    throw new Error('Failed to fetch image from URL.');
  }
};

/**
 * Endpoint to check WhatsApp client status
 * GET /status
 * Response:
 *  - If authenticated: { authenticated: true }
 *  - If not authenticated: { authenticated: false }
 */
app.get('/status', (req, res) => {
  res.json({ authenticated: isAuthenticated });
});

/**
 * Endpoint to retrieve the current QR code for authentication
 * GET /qr
 * Response:
 *  - If QR code is available: { qr: 'QR_CODE_TEXT' }
 *  - If already authenticated: { message: 'Already authenticated.' }
 */
app.get('/qr', (req, res) => {
  if (isAuthenticated) {
    return res.status(400).json({ message: 'Already authenticated.' });
  }
  if (!qrCode) {
    return res.status(404).json({ message: 'QR code not available at the moment.' });
  }
  // Send the QR code text directly
  res.json({ qr: qrCode });
});

/**
 * Endpoint to send text message
 * POST /send-text
 * Body Parameters:
 *  - number: string (recipient's number)
 *  - message: string (message to send)
 */
app.post('/send-text', async (req, res) => {
  const { number, message } = req.body;

  if (!number || !message) {
    return res.status(400).json({ success: false, error: 'Number and message are required.' });
  }

  if (!isAuthenticated) {
    return res.status(403).json({ success: false, error: 'WhatsApp client is not authenticated. Please authenticate first.' });
  }

  try {
    // Ensure the number is in the correct format
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;

    await client.sendMessage(chatId, message);
    res.json({ success: true, message: 'Message sent successfully.' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: 'Failed to send message.' });
  }
});

/**
 * Endpoint to send image via URL
 * POST /send-image-url
 * Body Parameters:
 *  - number: string (recipient's number)
 *  - imageUrl: string (URL of the image to send)
 *  - caption: string (optional caption for the image)
 */
app.post('/send-image-url', async (req, res) => {
  const { number, imageUrl, caption } = req.body;

  if (!number || !imageUrl) {
    return res.status(400).json({ success: false, error: 'Number and image URL are required.' });
  }

  if (!isAuthenticated) {
    return res.status(403).json({ success: false, error: 'WhatsApp client is not authenticated. Please authenticate first.' });
  }

  try {
    // Ensure the number is in the correct format
    const chatId = number.includes('@c.us') ? number : `${number}@c.us`;

    // Fetch the image from the URL
    const media = await fetchImageFromUrl(imageUrl);

    await client.sendMessage(chatId, media, { caption: caption || '' });

    res.json({ success: true, message: 'Image sent successfully.' });
  } catch (error) {
    console.error('Error sending image:', error);
    res.status(500).json({ success: false, error: 'Failed to send image.' });
  }
});

/**
 * Optional: Endpoint to log out the WhatsApp client
 * POST /logout
 * This can help to reset the authentication and generate a new QR code
 */
app.post('/logout', async (req, res) => {
  try {
    await client.logout();
    isAuthenticated = false;
    qrCode = null;
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({ success: false, error: 'Failed to log out.' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`WhatsApp API server running at http://localhost:${port}`);
});
