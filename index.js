const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const ClientManager = require('./ClientManager');
const app = express();
const port = 3000;

// Prevent crashes on unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

app.use(cors()); // CORS enabled for all origins
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const clientManager = new ClientManager();
clientManager.loadExistingSessions();

clientManager.on('qr', (token, qr) => {
  console.log(`QR for ${token}: ${qr}`);
});

clientManager.on('ready', (token) => {
  console.log(`Client ${token} is authenticated and ready.`);
});

clientManager.on('auth_failure', (token, msg) => {
  console.error(`Authentication failed for ${token}:`, msg);
});

const validatePhoneNumber = (number) => {
  const regex = /^\d{10,15}$/;
  return regex.test(number);
};

app.post('/sessions', (req, res) => {
  const { number } = req.body;

  if (!number) {
    return res.status(400).json({ success: false, error: 'Phone number is required.' });
  }
  if (!validatePhoneNumber(number)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number. Only digits allowed, min 10 digits.' });
  }

  const token = number;

  try {
    clientManager.initializeClient(token);
    res.json({ success: true, message: 'Session initialized. Please authenticate using the QR code.' });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.get('/status/:token', (req, res) => {
  const { token } = req.params;

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ authenticated: false, message: 'Session not found.' });
  }

  const status = clientManager.getStatus(token);
  res.json({ authenticated: status === 'authenticated', status });
});

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

app.post('/send-text', async (req, res) => {
  const { token, number, message } = req.body;

  if (!token || !number || !message) {
    return res.status(400).json({ success: false, error: 'Token, number, and message are required.' });
  }
  if (!validatePhoneNumber(token) || !validatePhoneNumber(number)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format. Only digits allowed.' });
  }
  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ success: false, error: 'Session not found.' });
  }

  try {
    const result = await clientManager.sendText(token, number, message);

    if (
      (result && result.error && result.error.includes("Cannot read properties of undefined (reading 'serialize')")) ||
      (result && result.error && result.error.includes('getMessageModel'))
    ) {
      return res.json({ success: true, message: "Message sent successfully." });
    }

    if (result.success) {
      return res.json({ success: true, message: result.message || 'Message sent successfully.' });
    }
    res.status(400).json({ success: false, error: result.error || 'Failed to send message.' });
  } catch (error) {
    if (
      error.message && (
        error.message.includes("Cannot read properties of undefined (reading 'serialize')") ||
        error.message.includes('getMessageModel')
      )
    ) {
      return res.json({ success: true, message: "Message sent successfully." });
    }
    console.error('Error sending message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/send-image-url', async (req, res) => {
  const { token, number, imageUrl, caption } = req.body;

  if (!token || !number || !imageUrl) {
    return res.status(400).json({ success: false, error: 'Token, number, and imageUrl are required.' });
  }
  if (!validatePhoneNumber(token) || !validatePhoneNumber(number)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format. Only digits allowed.' });
  }
  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ success: false, error: 'Session not found.' });
  }

  try {
    const result = await clientManager.sendImage(token, number, imageUrl, caption);

    if (
      (result && result.error && result.error.includes("Cannot read properties of undefined (reading 'serialize')")) ||
      (result && result.error && result.error.includes('getMessageModel'))
    ) {
      return res.json({ success: true, message: "Image sent successfully." });
    }

    if (result.success) {
      return res.json({ success: true, message: result.message || 'Image sent successfully.' });
    }
    res.status(400).json({ success: false, error: result.error || 'Failed to send image.' });
  } catch (error) {
    if (
      error.message && (
        error.message.includes("Cannot read properties of undefined (reading 'serialize')") ||
        error.message.includes('getMessageModel')
      )
    ) {
      return res.json({ success: true, message: "Image sent successfully." });
    }
    console.error('Error sending image:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/sessions', (req, res) => {
  const sessions = clientManager.listSessions().map((token) => ({
    token,
    status: clientManager.getStatus(token),
  }));
  res.json({ sessions });
});

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

app.post('/logout', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: 'Token is required.' });
  }
  if (!validatePhoneNumber(token)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format. Only digits allowed.' });
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

app.listen(port, () => {
  console.log(`WhatsApp API server running at http://localhost:${port}`);
});
