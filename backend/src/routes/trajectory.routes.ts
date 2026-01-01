/**
 * Trajectory API Routes
 * Endpoints for balloon trajectory prediction and wind data
 */

import express from 'express';
import { TrajectoryService } from '../services/trajectory.service';
import { TrajectoryResponse } from '../types/balloon';
import { WindService } from '../services/wind.service';

// OPTIMIZATION: Use singleton service instances for shared caching
import { windborneService, tracker } from '../services';

const router = express.Router();
const trajectoryService = new TrajectoryService();
const windService = new WindService();

/**
 * GET /api/trajectory/wind-field
 * Get wind data for a grid of locations at a specific altitude/pressure level
 * IMPORTANT: This must be defined BEFORE /:balloonId route
 *
 * Query params:
 * - latMin: minimum latitude (default: -85)
 * - latMax: maximum latitude (default: 85)
 * - lngMin: minimum longitude (default: -180)
 * - lngMax: maximum longitude (default: 180)
 * - gridSize: spacing between grid points in degrees (default: 2)
 * - pressure: pressure level in hPa (default: 850) - options: 1000, 975, 950, 925, 900, 850, 800, 700, 600, 500, 400, 300, 250, 200, 150, 100, 70, 50, 30
 * - altitude: altitude in km (alternative to pressure)
 */
router.get('/wind-field', async (req, res) => {
  try {
    const latMin = parseFloat(req.query.latMin as string) || -85;
    const latMax = parseFloat(req.query.latMax as string) || 85;
    const lngMin = parseFloat(req.query.lngMin as string) || -180;
    const lngMax = parseFloat(req.query.lngMax as string) || 180;
    const gridSize = parseFloat(req.query.gridSize as string) || 3; // Default 3 degrees for good balance
    const pressure = parseFloat(req.query.pressure as string);
    const altitude = parseFloat(req.query.altitude as string);

    // Validate bounds
    if (latMin < -90 || latMax > 90 || latMin >= latMax) {
      res.status(400).json({
        error: 'Invalid latitude bounds. Must be between -90 and 90, with latMin < latMax.',
      });
      return;
    }

    if (lngMin < -180 || lngMax > 180 || lngMin >= lngMax) {
      res.status(400).json({
        error: 'Invalid longitude bounds. Must be between -180 and 180, with lngMin < lngMax.',
      });
      return;
    }

    if (gridSize < 1 || gridSize > 20) {
      res.status(400).json({
        error: 'Invalid grid size. Must be between 1 and 20 degrees.',
      });
      return;
    }

    // Limit total grid points - Open-Meteo supports up to 1000 locations per request
    const totalPoints = ((latMax - latMin) / gridSize) * ((lngMax - lngMin) / gridSize);
    if (totalPoints > 1000) {
      res.status(400).json({
        error: `Too many grid points (${Math.round(totalPoints)}). Maximum is 1000. Increase gridSize or reduce bounds.`,
      });
      return;
    }

    // Build location array
    const locations: Array<{ latitude: number; longitude: number; altitude_km: number }> = [];

    // Determine altitude - prefer altitude parameter, fall back to pressure, default to 850hPa (~1.5km)
    let altitude_km: number;
    if (altitude !== undefined && !isNaN(altitude)) {
      altitude_km = altitude;
    } else if (pressure !== undefined && !isNaN(pressure)) {
      // Convert pressure to altitude using standard atmosphere
      const P0 = 1013.25;
      const H = 7.4;
      altitude_km = -H * Math.log(pressure / P0);
    } else {
      // Default to 850hPa (~1.5km) - typical balloon altitude
      altitude_km = 1.5;
    }

    for (let lat = latMin; lat <= latMax; lat += gridSize) {
      for (let lng = lngMin; lng <= lngMax; lng += gridSize) {
        locations.push({
          latitude: lat,
          longitude: lng,
          altitude_km,
        });
      }
    }

    console.log(`Fetching wind data for ${locations.length} grid points at ${altitude_km.toFixed(1)}km altitude`);

    // Fetch wind data for all locations
    const windDataMap = await windService.getWindAtMultipleLocations(locations);

    // Convert to array format for response
    const windField = Array.from(windDataMap.values());

    res.json({
      grid: {
        latMin,
        latMax,
        lngMin,
        lngMax,
        gridSize,
        altitude_km,
      },
      count: windField.length,
      data: windField,
    });
  } catch (error) {
    console.error('Error fetching wind field:', error);
    res.status(500).json({
      error: 'Failed to fetch wind field data',
    });
  }
});

/**
 * GET /api/trajectory/:balloonId
 * Get predicted trajectory for a specific balloon
 *
 * Query params:
 * - hours: prediction horizon (default: 3)
 * - method: prediction method - 'persistence', 'wind', 'hybrid' (default: 'persistence' to avoid rate limits)
 */
router.get('/:balloonId', async (req, res) => {
  try {
    const { balloonId } = req.params;
    const predictionHours = parseInt(req.query.hours as string) || 3;
    const method = (req.query.method as 'persistence' | 'wind' | 'hybrid') || 'hybrid';

    // Validate prediction hours
    if (predictionHours < 1 || predictionHours > 12) {
      res.status(400).json({
        error: 'Invalid prediction hours. Must be between 1 and 12.',
      });
      return;
    }

    // Get balloon data from windborne service
    const rawData = await windborneService.getBalloonData();
    const trackedData = tracker.processHistoricalData(rawData);

    // Find the balloon's historical positions
    const balloonPositions = trackedData
      .filter((b) => b.id === balloonId)
      .sort((a, b) => a.hour_offset - b.hour_offset); // Oldest to newest

    if (balloonPositions.length === 0) {
      res.status(404).json({
        error: `Balloon ${balloonId} not found`,
      });
      return;
    }

    // Get the most recent position (lowest hour_offset)
    const currentPosition = balloonPositions[0];

    // Generate trajectory prediction
    const trajectory = await trajectoryService.predictTrajectory(
      currentPosition,
      balloonPositions,
      predictionHours,
      method
    );

    const response: TrajectoryResponse = {
      balloon_id: balloonId,
      trajectory,
    };

    res.json(response);
  } catch (error) {
    console.error('Error generating trajectory:', error);
    res.status(500).json({
      error: 'Failed to generate trajectory prediction',
    });
  }
});

/**
 * GET /api/trajectory
 * Get trajectories for multiple balloons (currently active balloons)
 *
 * Query params:
 * - limit: number of balloons to return trajectories for (default: 10)
 * - hours: prediction horizon (default: 3)
 * - method: prediction method (default: 'persistence' to avoid rate limits)
 */
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const predictionHours = parseInt(req.query.hours as string) || 3;
    const method = (req.query.method as 'persistence' | 'wind' | 'hybrid') || 'hybrid';

    // Get balloon data from windborne service
    const rawData = await windborneService.getBalloonData();
    const trackedData = tracker.processHistoricalData(rawData);

    // Get unique active balloons (lowest hour_offset available)
    const minHourOffset = Math.min(...trackedData.map((b) => b.hour_offset));
    const activeBalloons = trackedData
      .filter((b) => b.hour_offset === minHourOffset && b.status === 'active')
      .slice(0, limit);

    if (activeBalloons.length === 0) {
      res.json({ trajectories: [] });
      return;
    }

    // Generate trajectories for each balloon
    const trajectories = await Promise.all(
      activeBalloons.map(async (balloon) => {
        const historicalPositions = trackedData
          .filter((b) => b.id === balloon.id)
          .sort((a, b) => a.hour_offset - b.hour_offset);

        const trajectory = await trajectoryService.predictTrajectory(
          balloon,
          historicalPositions,
          predictionHours,
          method
        );

        return {
          balloon_id: balloon.id,
          trajectory,
        };
      })
    );

    res.json({ trajectories });
  } catch (error) {
    console.error('Error generating trajectories:', error);
    res.status(500).json({
      error: 'Failed to generate trajectory predictions',
    });
  }
});

export default router;
