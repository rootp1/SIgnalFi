// backend/server.ts
import express from 'express';
import cors from 'cors';
import * as dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// --- DATABASE CONNECTION ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Simple API endpoint to check if the server is running
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// TODO: Implement all the other necessary endpoints
// For now, we'll just log the requests to show it's working

app.post('/api/follow', (req, res) => {
  const { userId, traderToFollow } = req.body;
  console.log(`User ${userId} requested to follow ${traderToFollow}`);
  // In a real scenario, you would add DB logic here:
  // await pool.query('INSERT INTO subscriptions ...');
  res.status(200).json({ message: 'Follow request received' });
});

app.post('/api/settings', (req, res) => {
  const { userId, tradeAmount } = req.body;
  console.log(`User ${userId} updated settings to ${tradeAmount}`);
  // DB logic would go here
  res.status(200).json({ message: 'Settings update received' });
});

app.post('/api/signal', (req, res) => {
  const { broadcasterUsername } = req.body;
  console.log(`Signal received from ${broadcasterUsername}. Broadcasting to followers...`);
  // DB logic to find followers and then bot logic to notify them would go here
  res.status(200).json({ message: 'Signal received' });
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server is running on http://localhost:${PORT}`);
});
