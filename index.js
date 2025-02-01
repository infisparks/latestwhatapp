/**
 * index.js
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors'); 
const ClientManager = require('./ClientManager');

const app = express();
const port = 3000;

// Enable CORS
app.use(cors());

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize ClientManager
const clientManager = new ClientManager();

// Listen to events from ClientManager
clientManager.on('qr', (token, qr) => {
  console.log(`QR for ${token}: ${qr}`);
});

clientManager.on('ready', (token) => {
  console.log(`Client ${token} is authenticated and ready.`);
});

clientManager.on('auth_failure', (token, msg) => {
  console.error(`Authentication failed for ${token}:`, msg);
});

clientManager.on('disconnected', (token, reason) => {
  console.log(`Client ${token} was logged out from mobile. Reason: ${reason}`);
  // Optionally, notify users or update a database about the logout
});

/**
 * Helper function to validate phone number format (E.164)
 */
const validatePhoneNumber = (number) => {
  const regex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  return regex.test(number);
};

/**
 * Endpoint to add a new session (initialize a client)
 * POST /sessions
 */
app.post('/sessions', async (req, res) => {
  const { number } = req.body;

  if (!number) {
    return res.status(400).json({ success: false, error: 'Phone number is required.' });
  }

  if (!validatePhoneNumber(number)) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format.' });
  }

  const token = number; // Use phone number as token

  // If a session already exists, decide how to handle it based on its status.
  if (clientManager.clients.has(token)) {
    const status = clientManager.getStatus(token);
    if (status === 'initializing') {
      return res.json({ success: true, message: 'Session is already initializing. Please scan the QR code.' });
    } else if (status === 'authenticated') {
      return res.json({ success: true, message: 'Session is already authenticated.' });
    } else if (status === 'logged_out' || status === 'auth_failure') {
      try {
        await clientManager.removeSession(token);
      } catch (error) {
        console.error('Error removing session:', error);
        // Continue to reinitialize the client
      }
    }
  }

  try {
    clientManager.initializeClient(token);
    return res.json({
      success: true,
      message: 'Session initialized. Please authenticate using the QR code.'
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
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
app.get('/qr/:token', async (req, res) => {
  const { token } = req.params;

  if (!clientManager.clients.has(token)) {
    return res.status(404).json({ message: 'Session not found.' });
  }

  let status = clientManager.getStatus(token);

  // If already authenticated, no QR code is needed.
  if (status === 'authenticated') {
    return res.status(400).json({ message: 'Already authenticated.' });
  }

  // For a session that has been logged out or encountered an authentication failure,
  // remove and reinitialize the client.
  if (status === 'logged_out' || status === 'auth_failure') {
    try {
      await clientManager.removeSession(token);
      clientManager.initializeClient(token);
    } catch (error) {
      console.error('Error re-initializing client:', error);
      return res.status(500).json({ message: 'Failed to reinitialize session.' });
    }
  }

  // Wait for the QR code to be generated.
  let qr = clientManager.getQRCode(token);
  const maxAttempts = 10;
  const delay = 1000; // 1 second
  let attempts = 0;

  while (!qr && attempts < maxAttempts) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    qr = clientManager.getQRCode(token);
    attempts++;
  }

  if (qr) {
    return res.json({ qr });
  } else {
    return res.status(500).json({ message: 'QR code not available yet. Please try again shortly.' });
  }
});

/**
 * Endpoint to send text message
 * POST /send-text
 * Body Parameters: { token, number, message }
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

  const status = clientManager.getStatus(token);
  if (status === 'initializing') {
    return res.status(503).json({ success: false, error: 'Client is still initializing. Please wait until the QR code is scanned.' });
  }
  if (status !== 'authenticated') {
    return res.status(400).json({ success: false, error: 'Client is not authenticated.' });
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
 * Body Parameters: { token, number, imageUrl, caption }
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

  const status = clientManager.getStatus(token);
  if (status === 'initializing') {
    return res.status(503).json({ success: false, error: 'Client is still initializing. Please wait until the QR code is scanned.' });
  }
  if (status !== 'authenticated') {
    return res.status(400).json({ success: false, error: 'Client is not authenticated.' });
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
 * Response: { sessions: [{ token, status }] }
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
    res.status(500).json({ success: false, error: 'Failed to remove session.' });
  }
});

/**
 * Endpoint to log out a specific client
 * POST /logout
 * Body Parameters: { token }
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

// Global error handlers to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Optionally, you can log this to a file or monitoring service
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Optionally, you can log this to a file or monitoring service
});

// Start the server
app.listen(port, () => {
  console.log(`WhatsApp API server running at http://localhost:${port}`);
});
