/**
 * Balloon API Routes
 * Implements REST endpoints from CLAUDE.md
 */

import { Router, Request, Response } from 'express';
import { BalloonResponse, HealthResponse, BalloonDataPoint } from '../types/balloon';
import { TrajectoryService } from '../services/trajectory.service';

// OPTIMIZATION: Use singleton service instances for shared caching
import { windborneService, tracker, db } from '../services';

const router = Router();
const trajectoryService = new TrajectoryService(db);

// Export services for backward compatibility
export { windborneService, tracker };

/**
 * GET /api/balloons/history
 * Get simplified history for all balloons + value metric
 * Optimized for slider replay
 */
router.get('/balloons/history', async (req: Request, res: Response) => {
  try {
    // Ensure we have latest data
    const rawData = await windborneService.getBalloonData();
    console.log(`[History] rawData points: ${rawData.length}`);

    const trackedData = await tracker.processHistoricalData(rawData);
    console.log(`[History] trackedData points: ${trackedData.length}`);

    const uniqueIds = tracker.getUniqueBalloonIds(trackedData);
    console.log(`[History] uniqueIds: ${uniqueIds.length}`);

    // Process all balloons - NO LIMIT
    const historyPayload = [];

    for (const id of uniqueIds) {
      const trail = tracker.getBalloonTrajectory(trackedData, id);

      historyPayload.push({
        id,
        value_score: 0,
        score_timestamp: null,
        trail: trail.map(p => [
          p.latitude,
          p.longitude,
          p.altitude_km,
          p.timestamp
        ])
      });
    }

    console.log(`[History] Returning ${historyPayload.length} balloons, first trail length: ${historyPayload[0]?.trail?.length || 0}`);
    res.json(historyPayload);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

/**
 * GET /api/balloons
 * Get balloon positions for a specific hour (lightweight - no full trajectories)
 *
 * Query parameters:
 * - hour_offset: Optional hour offset (0=current, 1=1hr ago, etc). Default: 0
 */
router.get('/balloons', async (req: Request, res: Response) => {
  try {
    // Get requested hour offset from query params (default: 0 for current hour)
    const requestedHourOffset = parseInt(req.query.hour_offset as string) || 0;

    // Load ONLY the requested hour's data from the database
    // Calculate the timestamp for the requested hour
    const currentTimestamp = windborneService.getCurrentTimestamp();
    const currentTime = new Date(currentTimestamp);
    const requestedTime = new Date(currentTime.getTime() - requestedHourOffset * 60 * 60 * 1000);
    const requestedTimestamp = requestedTime.toISOString().slice(0, 13) + ':00:00.000Z';

    // Load balloons for this specific timestamp from DB
    const balloonsAtTimestamp = await tracker.getBalloonsAtTimestamp(requestedTimestamp);

    console.log(`Loaded ${balloonsAtTimestamp.length} balloons for hour_offset ${requestedHourOffset} (${requestedTimestamp})`);

    // Return balloons WITHOUT full trajectory data (much more efficient)
    // Trajectory data will be fetched separately when a balloon is selected
    const balloonsWithoutTrajectories = balloonsAtTimestamp.map((balloon: BalloonDataPoint) => ({
      ...balloon,
      // Empty trajectory - will be loaded on demand
      trajectory: {
        balloon_id: balloon.id,
        historical_positions: [],
        future_positions: [],
        predicted_positions: [],
        prediction_horizon_hours: 0,
      },
    }));

    const response: BalloonResponse = {
      updated_at: windborneService.getCurrentTimestamp(),
      data_age_minutes: windborneService.getDataAgeMinutes(),
      source: 'Windborne Systems API',
      balloon_count: balloonsWithoutTrajectories.length,
      balloons: balloonsWithoutTrajectories,
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching balloons:', error);
    res.status(500).json({
      error: 'Failed to fetch balloon data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/balloons/:id
 * Get single balloon with its full trajectory (past + future) relative to a timeframe
 *
 * Query parameters:
 * - hour_offset: Optional reference hour (default: 0 for current)
 */
router.get('/balloons/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const referenceHourOffset = parseInt(req.query.hour_offset as string) || 0;

    // OPTIMIZED: Load only this balloon's trajectory from DB (24 records)
    // Instead of loading all 24,000 balloons via processHistoricalData
    const trajectoryPositions = await tracker.getBalloonTrajectoryFromDB(id);

    if (trajectoryPositions.length === 0) {
      return res.status(404).json({
        error: 'Balloon not found',
        message: `No balloon with ID ${id} found`,
      });
    }

    console.log(`Loaded trajectory for balloon ${id}: ${trajectoryPositions.length} positions (optimized query)`);

    // Split trajectory into past/future relative to the reference hour
    const pastPositions = trajectoryPositions.filter(p => p.hour_offset > referenceHourOffset);
    const futurePositions = trajectoryPositions.filter(p => p.hour_offset < referenceHourOffset);
    const currentPosition = trajectoryPositions.find(p => p.hour_offset === referenceHourOffset);

    // Include current position in both arrays for seamless line connection
    const historicalWithCurrent = currentPosition ? [...pastPositions, currentPosition] : pastPositions;
    const futureWithCurrent = currentPosition ? [currentPosition, ...futurePositions] : futurePositions;

    res.json({
      balloon_id: id,
      trajectory: {
        balloon_id: id,
        historical_positions: historicalWithCurrent,
        future_positions: futureWithCurrent,
        predicted_positions: [],
        prediction_horizon_hours: 0,
      },
      trajectory_length: trajectoryPositions.length,
      first_seen: trajectoryPositions[trajectoryPositions.length - 1]?.timestamp,
      last_seen: trajectoryPositions[0]?.timestamp,
      reference_hour_offset: referenceHourOffset,
    });
  } catch (error) {
    console.error(`Error fetching balloon ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to fetch balloon trajectory',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/balloons/trajectories
 * Get all tracked balloons with full history
 */
router.get('/balloons/trajectories', async (req: Request, res: Response) => {
  try {
    const rawData = await windborneService.getBalloonData();
    const trackedData = await tracker.processHistoricalData(rawData);

    // Group by balloon ID
    const uniqueIds = tracker.getUniqueBalloonIds(trackedData);
    const trajectories = uniqueIds.map((id) => ({
      id,
      trajectory: tracker.getBalloonTrajectory(trackedData, id),
    }));

    res.json({
      updated_at: windborneService.getCurrentTimestamp(),
      balloon_count: uniqueIds.length,
      trajectories,
    });
  } catch (error) {
    console.error('Error fetching trajectories:', error);
    res.status(500).json({
      error: 'Failed to fetch trajectories',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/balloons/:id/value
 * Calculate value score for a specific balloon based on prediction accuracy
 */
router.get('/balloons/:id/value', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const hours = parseInt(req.query.hours as string) || 24;
    const method = (req.query.method as 'persistence' | 'wind' | 'hybrid') || 'hybrid';

    // Validate parameters
    if (hours < 1 || hours > 24) {
      return res.status(400).json({
        error: 'Invalid hours parameter',
        message: 'hours must be between 1 and 24',
      });
    }

    if (!['persistence', 'wind', 'hybrid'].includes(method)) {
      return res.status(400).json({
        error: 'Invalid method parameter',
        message: 'method must be one of: persistence, wind, hybrid',
      });
    }

    // OPTIMIZED: Get balloon trajectory directly from DB (24 records)
    // Instead of loading all 24,000 balloons via processHistoricalData
    const trajectory = await tracker.getBalloonTrajectoryFromDB(id);

    if (trajectory.length === 0) {
      return res.status(404).json({
        error: 'Balloon not found',
        message: `No balloon with ID ${id} found`,
      });
    }

    if (trajectory.length < 2) {
      return res.status(400).json({
        error: 'Insufficient data',
        message: `Balloon ${id} has insufficient historical data (need at least 2 hours)`,
      });
    }

    // Calculate value using trajectory service
    const valueResult = await trajectoryService.calculateBalloonValueOptimized(
      id,
      trajectory,
      hours,
      method
    );

    res.json(valueResult);
  } catch (error) {
    console.error(`Error calculating value for balloon ${req.params.id}:`, error);
    res.status(500).json({
      error: 'Failed to calculate balloon value',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/health
 * API health and data freshness status
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const dataAge = windborneService.getDataAgeMinutes();
    const settings = windborneService.getSettings();

    // Try to get balloon count without full processing
    const rawData = await windborneService.getBalloonData();
    const currentBalloons = rawData.filter((b) => b.hour_offset === 0);

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (dataAge < 0) {
      status = 'unhealthy'; // No data yet
    } else if (dataAge > 90) {
      status = 'unhealthy'; // Very stale data
    } else if (dataAge > 65) {
      status = 'degraded'; // Stale data
    } else {
      status = 'healthy';
    }

    const response: HealthResponse = {
      status,
      lastUpdate: settings.lastUpdateTimestamp,
      dataFreshness: dataAge,
      balloonCount: currentBalloons.length,
      autoUpdateEnabled: settings.autoUpdateEnabled,
    };

    res.json(response);
  } catch (error) {
    console.error('Error checking health:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
