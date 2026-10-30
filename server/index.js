import express from 'express';
import http from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDatabase } from './db.js';
import { initWebSocketServer } from './ws.js';
import { startSimulator } from './simulator.js';

import authRoutes from './routes/auth.js';
import slotsRoutes from './routes/slots.js';
import sensorsRoutes from './routes/sensors.js';
import vehiclesRoutes from './routes/vehicles.js';
import layoutRoutes from './routes/layout.js';
import lasersRoutes from './routes/lasers.js';
import devicesRoutes from './routes/devices.js';
import alertsRoutes from './routes/alerts.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

// Initialize SQLite database
initDatabase();

// Initialize WebSocket Gateway
initWebSocketServer(server);

// Start background Influx & Sensor Simulator
startSimulator();

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/slots', slotsRoutes);
app.use('/api/lot', slotsRoutes);
app.use('/api/sensors', sensorsRoutes);
app.use('/api/vehicles', vehiclesRoutes);
app.use('/api', vehiclesRoutes); // for /api/sessions
app.use('/api/layout', layoutRoutes);
app.use('/api/lasers', lasersRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'SmartPark AI Control Server',
    version: '2.5.0-SaaS',
    timestamp: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 SmartPark AI Backend & WebSocket Server active on http://localhost:${PORT}`);
});
