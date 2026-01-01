/**
 * Main Express Server
 * Windborne Weather Balloon Tracking Backend
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import balloonRoutes from './routes/balloons.routes';
import settingsRoutes from './routes/settings.routes';
import trajectoryRoutes from './routes/trajectory.routes';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api', balloonRoutes);
app.use('/api', settingsRoutes);
app.use('/api/trajectory', trajectoryRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Windborne Weather Balloon Tracking API',
    version: '2.0.0',
    description: 'Phase 2: Now with trajectory prediction and wind data integration!',
    endpoints: {
      balloons: '/api/balloons',
      balloon_by_id: '/api/balloons/:id',
      balloon_history: '/api/balloons/:id/history',
      trajectories: '/api/balloons/trajectories',
      trajectory_single: '/api/trajectory/:balloonId',
      trajectory_all: '/api/trajectory',
      health: '/api/health',
      settings: '/api/settings',
      auto_update: 'POST /api/settings/auto-update',
      refresh: 'POST /api/refresh',
    },
    phase2_features: {
      wind_data: 'Open-Meteo API for upper-air wind data',
      prediction_methods: ['persistence', 'wind', 'hybrid'],
      trajectory_visualization: 'Historical trails + future predictions',
    },
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

// Start server (only when not in Vercel serverless environment)
if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`\n🎈 Windborne Backend Server running on port ${PORT}`);
    console.log(`📍 API available at http://localhost:${PORT}/api`);
    console.log(`🔍 Health check at http://localhost:${PORT}/api/health\n`);
  });
}

// Export for Vercel serverless
export default app;
