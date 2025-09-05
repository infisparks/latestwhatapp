// index.js

const express = require('express');
const path = require('path');
const fs = require('fs');
const ClientManager = require('./ClientManager');
const cors = require('cors');
const app = express();
const port = 3000;

// Configure CORS
const corsOptions = {
  origin: 'https://infisparks.github.io'
};
app.use(cors(corsOptions));

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize ClientManager
const clientManager = new ClientManager();

// Listen to events from ClientManager
clientManager.on('qr', (token, qr) => {
  console.log(`QR for ${token}: ${qr}`);
});

clientManager.on('code', (token, code) => {
    console.log(`Pairing code for ${token}: ${code}`);
});

clientManager.on('ready', (token) => {
  console.log(`Client ${token} is authenticated and ready.`);
});

clientManager.on('auth_failure', (token, msg) => {
  console.error(`Authentication failed for ${token}:`, msg);
});

// Helper function to validate phone number format
const validatePhoneNumber = (number) => {
  const regex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  return regex.test(number);
};

// New endpoint for pairing with a phone number and returning the code in the response
app.post('/pair', async (req, res) => {
    const { number, token } = req.body;

    if (!number || !token) {
        return res.status(400).json({ success: false, error: 'Phone number and token are required.' });
    }

    if (!validatePhoneNumber(number)) {
        return res.status(400).json({ success: false, error: 'Invalid phone number format.' });
    }

    try {
        // First, check if a client with this token already exists to avoid re-initializing.
        if (clientManager.clients.has(token)) {
             const existingCode = clientManager.getPairingCode(token);
             if (existingCode) {
                 return res.status(200).json({ success: true, message: 'Client session already initializing.', pairingCode: existingCode });
             }
        }

        // Initialize the client with the phone number for pairing
        clientManager.initializeClient(token, { phoneNumber: number });
        
        // Wait for the 'code' event to be emitted
        const pairingCode = await new Promise((resolve) => {
            const onCode = (emittedToken, code) => {
                if (emittedToken === token) {
                    clientManager.removeListener('code', onCode);
                    resolve(code);
                }
            };
            clientManager.on('code', onCode);
        });

        res.json({ 
            success: true, 
            message: 'Pairing code generated. Enter this code on your phone to link your device.', 
            pairingCode 
        });

    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * Endpoint to check status of a specific client
 * GET /status/:token
 */
app.get('/status/:token', (req, res) => {
  const { token } = req.params;

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ authenticated: false, message: 'Session not found.' });
  }

  const status = clientManager.getStatus(token);
  res.json({ authenticated: status === 'authenticated', status });
});

/**
 * Endpoint to retrieve QR code for a specific client
 * GET /qr/:token
 */
app.get('/qr/:token', (req, res) => {
  const { token } = req.params;

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  const status = clientManager.getStatus(token);
  if (status === 'authenticated') {
    return res.status(400).json({ message: 'Already authenticated.' });
  }

  const qr = clientManager.getQRCode(token);
  if (!qr) {
    return res.status(404).json({ message: 'QR code not available at the moment.' });
  }

  res.json({ qr });
});

/**
 * Endpoint to send text message
 * POST /send-text
 * Body Parameters:
 * - token: string (phone number)
 * - number: string (recipient's number)
 * - message: string (message to send)
 */
app.post('/send-text', async (req, res) => {
  const { token, number, message } = req.body;

  if (!token || !number || !message) {
    return res.status(400).json({ success: false, error: 'Token, number, and message are required.' });
  }

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ success: false, error: 'Session not found.' });
  }

  if (!validatePhoneNumber(number)) {
    return res.status(400).json({ success: false, error: 'Invalid recipient phone number format.' });
  }

  try {
    await clientManager.sendText(token, number, message);
    res.json({ success: true, message: 'Message sent successfully.' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to send image via URL
 * POST /send-image-url
 * Body Parameters:
 * - token: string (phone number)
 * - number: string (recipient's number)
 * - imageUrl: string (URL of the image to send)
 * - caption: string (optional)
 */
app.post('/send-image-url', async (req, res) => {
  const { token, number, imageUrl, caption } = req.body;

  if (!token || !number || !imageUrl) {
    return res.status(400).json({ success: false, error: 'Token, number, and imageUrl are required.' });
  }

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ success: false, error: 'Session not found.' });
  }

  if (!validatePhoneNumber(number)) {
    return res.status(400).json({ success: false, error: 'Invalid recipient phone number format.' });
  }

  try {
    await clientManager.sendImage(token, number, imageUrl, caption);
    res.json({ success: true, message: 'Image sent successfully.' });
  } catch (error) {
    console.error('Error sending image:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Endpoint to list all active sessions
 * GET /sessions
 * Response:
 * - Array of tokens with their status
 */
app.get('/sessions', (req, res) => {
  const sessions = clientManager.listSessions().map((token) => ({
    token,
    status: clientManager.getStatus(token),
  }));
  res.json({ sessions });
});

/**
 * Endpoint to remove a session
 * DELETE /sessions/:token
 */
app.delete('/sessions/:token', async (req, res) => {
  const { token } = req.params;

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ success: false, error: 'Session not found.' });
  }

  try {
    await clientManager.removeSession(token);
    res.json({ success: true, message: 'Session removed successfully.' });
  } catch (error) {
    console.error('Error removing session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Optional: Endpoint to log out a specific client
 * POST /logout
 * Body Parameters:
 * - token: string (phone number)
 */
app.post('/logout', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: 'Token is required.' });
  }

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ success: false, error: 'Session not found.' });
  }

  try {
    await clientManager.removeSession(token);
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