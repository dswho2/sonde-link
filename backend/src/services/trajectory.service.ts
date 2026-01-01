/**
 * Balloon Trajectory Prediction Service
 * Uses historical balloon data + wind data to predict future positions
 *
 * Prediction Methods:
 * 1. Simple Persistence: Assume balloon continues at current velocity
 * 2. Wind-Based: Use wind data at balloon's altitude to predict drift
 * 3. Hybrid: Combine historical movement with wind data
 */

import { BalloonDataPoint } from '../types/balloon';
import { WindService, WindData } from './wind.service';
import { IDatabase } from './database.factory';

const EARTH_RADIUS_KM = 6371;

export interface PredictedPosition {
  latitude: number;
  longitude: number;
  altitude_km: number;
  timestamp: string;
  confidence: number;
  method: 'persistence' | 'wind' | 'hybrid';
}

export interface BalloonTrajectory {
  balloon_id: string;
  historical_positions: BalloonDataPoint[];
  predicted_positions: PredictedPosition[];
  prediction_horizon_hours: number;
}

export interface ValueDataPoint {
  hour: number;
  actual_position: {
    latitude: number;
    longitude: number;
    altitude_km: number;
    timestamp: string;
  };
  predicted_position: {
    latitude: number;
    longitude: number;
    altitude_km: number;
    confidence: number;
  };
  prediction_error_km: number;
  value_score: number;
}

export interface ValueCalculationResult {
  balloon_id: string;
  calculation_timestamp: string;
  hours_calculated: number;
  method: 'persistence' | 'wind' | 'hybrid';
  overall_value_score: number;
  value_over_time: ValueDataPoint[];
}

export class TrajectoryService {
  private windService: WindService;
  private db: IDatabase;

  constructor(db: IDatabase) {
    this.db = db;
    this.windService = new WindService(db);
  }

  /**
   * Batch fetch wind data for multiple balloon locations
   * This is much more efficient than fetching individually
   */
  async getWindForLocations(
    locations: Array<{ latitude: number; longitude: number; altitude_km: number }>
  ): Promise<Map<string, WindData>> {
    return await this.windService.getWindAtMultipleLocations(locations);
  }

  /**
   * Predict trajectory using pre-fetched wind data (no additional API calls)
   * This is synchronous and uses the wind data map for lookups
   */
  predictTrajectoryWithWindData(
    balloon: BalloonDataPoint,
    historicalPositions: BalloonDataPoint[],
    windDataMap: Map<string, WindData>,
    predictionHours: number = 6,
    method: 'persistence' | 'wind' | 'hybrid' = 'hybrid'
  ): BalloonTrajectory {
    const predictions: PredictedPosition[] = [];
    let currentPos = balloon;

    for (let hour = 1; hour <= predictionHours; hour++) {
      let prediction: PredictedPosition;

      // Look up wind data for current position
      const windKey = `${currentPos.latitude.toFixed(2)},${currentPos.longitude.toFixed(2)},${currentPos.altitude_km.toFixed(1)}`;
      const windData = windDataMap.get(windKey);

      switch (method) {
        case 'persistence':
          prediction = this.predictByPersistenceSync(currentPos, historicalPositions, 1);
          break;
        case 'wind':
          prediction = this.predictByWindSync(currentPos, windData, 1);
          break;
        case 'hybrid':
          prediction = this.predictByHybridSync(currentPos, historicalPositions, windData, 1);
          break;
      }

      predictions.push(prediction);

      // Use this prediction as the starting point for the next iteration
      currentPos = {
        ...currentPos,
        latitude: prediction.latitude,
        longitude: prediction.longitude,
        altitude_km: prediction.altitude_km,
      };
    }

    return {
      balloon_id: balloon.id,
      historical_positions: historicalPositions,
      predicted_positions: predictions,
      prediction_horizon_hours: predictionHours,
    };
  }

  /**
   * Convert latitude/longitude displacement to distance
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  private toDegrees(radians: number): number {
    return radians * (180 / Math.PI);
  }

  /**
   * Calculate new position given start position and displacement
   */
  private calculateNewPosition(
    lat: number,
    lon: number,
    displacement_km: number,
    bearing_deg: number
  ): { latitude: number; longitude: number } {
    const bearing_rad = this.toRadians(bearing_deg);
    const lat_rad = this.toRadians(lat);
    const angular_distance = displacement_km / EARTH_RADIUS_KM;

    const new_lat_rad = Math.asin(
      Math.sin(lat_rad) * Math.cos(angular_distance) +
      Math.cos(lat_rad) * Math.sin(angular_distance) * Math.cos(bearing_rad)
    );

    const new_lon_rad =
      this.toRadians(lon) +
      Math.atan2(
        Math.sin(bearing_rad) * Math.sin(angular_distance) * Math.cos(lat_rad),
        Math.cos(angular_distance) - Math.sin(lat_rad) * Math.sin(new_lat_rad)
      );

    return {
      latitude: this.toDegrees(new_lat_rad),
      longitude: this.toDegrees(new_lon_rad),
    };
  }

  /**
   * Synchronous version of predictByPersistence - uses historical data only
   */
  private predictByPersistenceSync(
    current: BalloonDataPoint,
    historicalPositions: BalloonDataPoint[],
    hoursAhead: number
  ): PredictedPosition {
    let speed_kmh = current.speed_kmh || 0;
    let direction_deg = current.direction_deg || 0;

    if (speed_kmh === 0) {
      const futureTime = new Date(current.timestamp);
      futureTime.setHours(futureTime.getHours() + hoursAhead);

      return {
        latitude: current.latitude,
        longitude: current.longitude,
        altitude_km: current.altitude_km,
        timestamp: futureTime.toISOString(),
        confidence: 0.3,
        method: 'persistence',
      };
    }

    const displacement_km = speed_kmh * hoursAhead;
    const newPos = this.calculateNewPosition(
      current.latitude,
      current.longitude,
      displacement_km,
      direction_deg
    );

    const futureTime = new Date(current.timestamp);
    futureTime.setHours(futureTime.getHours() + hoursAhead);

    return {
      ...newPos,
      altitude_km: current.altitude_km,
      timestamp: futureTime.toISOString(),
      confidence: Math.max(0.2, 0.8 - hoursAhead * 0.15),
      method: 'persistence',
    };
  }

  /**
   * Synchronous version of predictByWind - uses pre-fetched wind data
   */
  private predictByWindSync(
    current: BalloonDataPoint,
    windData: WindData | undefined,
    hoursAhead: number
  ): PredictedPosition {
    if (!windData) {
      // Fall back to stationary assumption
      const futureTime = new Date(current.timestamp);
      futureTime.setHours(futureTime.getHours() + hoursAhead);

      return {
        latitude: current.latitude,
        longitude: current.longitude,
        altitude_km: current.altitude_km,
        timestamp: futureTime.toISOString(),
        confidence: 0.3,
        method: 'wind',
      };
    }

    const displacement_km = windData.wind_speed_kmh * hoursAhead;
    const newPos = this.calculateNewPosition(
      current.latitude,
      current.longitude,
      displacement_km,
      windData.wind_direction_deg
    );

    const futureTime = new Date(current.timestamp);
    futureTime.setHours(futureTime.getHours() + hoursAhead);

    return {
      ...newPos,
      altitude_km: current.altitude_km,
      timestamp: futureTime.toISOString(),
      confidence: Math.max(0.3, 0.9 - hoursAhead * 0.12),
      method: 'wind',
    };
  }

  /**
   * Synchronous version of predictByHybrid - combines persistence and wind data
   */
  private predictByHybridSync(
    current: BalloonDataPoint,
    historicalPositions: BalloonDataPoint[],
    windData: WindData | undefined,
    hoursAhead: number
  ): PredictedPosition {
    const persistencePred = this.predictByPersistenceSync(current, historicalPositions, hoursAhead);
    const windPred = this.predictByWindSync(current, windData, hoursAhead);

    // Weight: 60% wind, 40% persistence
    const weight_wind = 0.6;
    const weight_persistence = 0.4;

    const latitude = windPred.latitude * weight_wind + persistencePred.latitude * weight_persistence;
    const longitude = windPred.longitude * weight_wind + persistencePred.longitude * weight_persistence;

    const futureTime = new Date(current.timestamp);
    futureTime.setHours(futureTime.getHours() + hoursAhead);

    return {
      latitude,
      longitude,
      altitude_km: current.altitude_km,
      timestamp: futureTime.toISOString(),
      confidence: Math.max(0.4, 0.95 - hoursAhead * 0.1),
      method: 'hybrid',
    };
  }

  /**
   * Predict using simple persistence (balloon continues at current velocity)
   */
  /**
   * Predict using simple persistence (balloon continues at current velocity)
   */
  private async predictByPersistence(
    current: BalloonDataPoint,
    hoursAhead: number
  ): Promise<PredictedPosition> {
    let speed_kmh = current.speed_kmh;
    let direction_deg = current.direction_deg;

    if (!speed_kmh || !direction_deg) {
      // No velocity data - try to get from wind service instead of assuming stationary
      const wind = await this.windService.getWindAtLocation(
        current.latitude,
        current.longitude,
        current.altitude_km,
        current.timestamp // Pass timestamp!
      );
      if (wind) {
        speed_kmh = wind.wind_speed_kmh;
        direction_deg = wind.wind_direction_deg;
      } else {
        // Still no data, assume stationary
        speed_kmh = 0;
        direction_deg = 0;
      }
    }

    if (speed_kmh === 0) {
      // Assume stationary
      const futureTime = new Date(current.timestamp);
      futureTime.setHours(futureTime.getHours() + hoursAhead);

      return {
        latitude: current.latitude,
        longitude: current.longitude,
        altitude_km: current.altitude_km,
        timestamp: futureTime.toISOString(),
        confidence: 0.3,
        method: 'persistence',
      };
    }

    const displacement_km = speed_kmh! * hoursAhead;
    const newPos = this.calculateNewPosition(
      current.latitude,
      current.longitude,
      displacement_km,
      direction_deg!
    );

    const futureTime = new Date(current.timestamp);
    futureTime.setHours(futureTime.getHours() + hoursAhead);

    return {
      ...newPos,
      altitude_km: current.altitude_km,
      timestamp: futureTime.toISOString(),
      confidence: Math.max(0.2, 0.8 - hoursAhead * 0.15), // Confidence decreases with time
      method: 'persistence',
    };
  }

  /**
   * Predict using wind data
   */
  private async predictByWind(
    current: BalloonDataPoint,
    hoursAhead: number
  ): Promise<PredictedPosition> {
    const windData = await this.windService.getWindAtLocation(
      current.latitude,
      current.longitude,
      current.altitude_km
    );

    if (!windData) {
      // Fall back to persistence if wind data unavailable
      return await this.predictByPersistence(current, hoursAhead);
    }

    // Wind components are in m/s, convert to km/h
    const wind_speed_kmh = windData.wind_speed_kmh;

    // Calculate displacement based on wind
    const displacement_km = wind_speed_kmh * hoursAhead;
    const newPos = this.calculateNewPosition(
      current.latitude,
      current.longitude,
      displacement_km,
      windData.wind_direction_deg
    );

    const futureTime = new Date(current.timestamp);
    futureTime.setHours(futureTime.getHours() + hoursAhead);

    return {
      ...newPos,
      altitude_km: current.altitude_km,
      timestamp: futureTime.toISOString(),
      confidence: Math.max(0.3, 0.9 - hoursAhead * 0.12), // Higher initial confidence with wind data
      method: 'wind',
    };
  }

  /**
   * Predict using hybrid method (combines historical velocity + wind data)
   */
  private async predictByHybrid(
    current: BalloonDataPoint,
    hoursAhead: number
  ): Promise<PredictedPosition> {
    // Get both predictions
    const persistencePred = await this.predictByPersistence(current, hoursAhead);
    const windPred = await this.predictByWind(current, hoursAhead);

    // Weight: 60% wind, 40% persistence (wind is more reliable for stratospheric balloons)
    const weight_wind = 0.6;
    const weight_persistence = 0.4;

    const latitude =
      windPred.latitude * weight_wind + persistencePred.latitude * weight_persistence;
    const longitude =
      windPred.longitude * weight_wind + persistencePred.longitude * weight_persistence;

    const futureTime = new Date(current.timestamp);
    futureTime.setHours(futureTime.getHours() + hoursAhead);

    return {
      latitude,
      longitude,
      altitude_km: current.altitude_km,
      timestamp: futureTime.toISOString(),
      confidence: Math.max(0.4, 0.95 - hoursAhead * 0.1), // Highest confidence with hybrid
      method: 'hybrid',
    };
  }

  /**
   * Generate trajectory prediction for a balloon
   * @param balloon - Current balloon position
   * @param historicalPositions - Past positions of this balloon
   * @param predictionHours - How many hours to predict ahead
   * @param method - Prediction method to use
   */
  async predictTrajectory(
    balloon: BalloonDataPoint,
    historicalPositions: BalloonDataPoint[],
    predictionHours: number = 3,
    method: 'persistence' | 'wind' | 'hybrid' = 'hybrid'
  ): Promise<BalloonTrajectory> {
    const predictions: PredictedPosition[] = [];

    let currentPos = balloon;

    for (let hour = 1; hour <= predictionHours; hour++) {
      let prediction: PredictedPosition;

      switch (method) {
        case 'persistence':
          prediction = await this.predictByPersistence(currentPos, 1);
          break;
        case 'wind':
          prediction = await this.predictByWind(currentPos, 1);
          break;
        case 'hybrid':
          prediction = await this.predictByHybrid(currentPos, 1);
          break;
      }

      predictions.push(prediction);

      // Use this prediction as the starting point for the next iteration
      currentPos = {
        ...currentPos,
        latitude: prediction.latitude,
        longitude: prediction.longitude,
        timestamp: prediction.timestamp,
      };
    }

    return {
      balloon_id: balloon.id,
      historical_positions: historicalPositions,
      predicted_positions: predictions,
      prediction_horizon_hours: predictionHours,
    };
  }

  /**
   * Calculate balloon value score based on prediction accuracy over time
   * Uses batch wind data fetching to avoid rate limiting
   *
   * @param balloonId - ID of balloon to calculate value for
   * @param trajectory - Historical trajectory data for the balloon
   * @param hours - Number of hours to calculate (default: 24)
   * @param method - Prediction method to use
   * @returns Value calculation result with time series data
   */
  async calculateBalloonValueOptimized(
    balloonId: string,
    trajectory: BalloonDataPoint[],
    hours: number = 24,
    method: 'persistence' | 'wind' | 'hybrid' = 'hybrid'
  ): Promise<ValueCalculationResult> {
    // Validate we have enough data
    if (trajectory.length < 2) {
      throw new Error(`Insufficient data: need at least 2 data points, have ${trajectory.length}`);
    }

    // Limit hours to available data
    const maxHours = Math.min(hours, trajectory.length - 1);

    if (maxHours < 1) {
      throw new Error(`Insufficient data: need at least 2 hours of data`);
    }

    // Sort trajectory from oldest to newest (reverse of typical order)
    const sortedTrajectory = [...trajectory].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Batch fetch wind data ONLY for positions we'll actually use in calculations
    // We need maxHours positions (for prediction starting points)
    // Wind service now groups by pressure level only, fetching all timestamps in one request
    console.log(`Fetching wind data for ${maxHours} positions (out of ${sortedTrajectory.length} available)...`);

    const windLocations = sortedTrajectory.slice(0, maxHours).map((pos) => ({
      latitude: pos.latitude,
      longitude: pos.longitude,
      altitude_km: pos.altitude_km,
      timestamp: pos.timestamp, // Include individual timestamps
    }));

    const windDataMap = await this.windService.getWindAtMultipleLocations(windLocations);
    console.log(`Fetched wind data for ${windDataMap.size} locations`);

    // Calculate predictions and errors for each hour
    const valueOverTime: ValueDataPoint[] = [];

    // Start from oldest data and predict forward
    for (let i = 0; i < maxHours; i++) {
      const currentPos = sortedTrajectory[i]; // Hour N
      const actualNextPos = sortedTrajectory[i + 1]; // Hour N+1 (actual)

      // Get wind data for current position
      const windKey = `${currentPos.latitude.toFixed(2)},${currentPos.longitude.toFixed(2)},${currentPos.altitude_km.toFixed(1)},${currentPos.timestamp}`;
      const windData = windDataMap.get(windKey);

      // Get historical context (all positions up to current)
      const historicalContext = sortedTrajectory.slice(0, i + 1);

      // Predict next position
      let prediction: PredictedPosition;
      try {
        switch (method) {
          case 'persistence':
            prediction = this.predictByPersistenceSync(currentPos, historicalContext, 1);
            break;
          case 'wind':
            prediction = this.predictByWindSync(currentPos, windData, 1);
            break;
          case 'hybrid':
            prediction = this.predictByHybridSync(currentPos, historicalContext, windData, 1);
            break;
        }
      } catch (error) {
        console.warn(`Failed to predict for hour ${i}:`, error);
        // Skip this hour if prediction fails
        continue;
      }

      // Calculate prediction error
      const errorKm = this.calculateDistance(
        prediction.latitude,
        prediction.longitude,
        actualNextPos.latitude,
        actualNextPos.longitude
      );

      valueOverTime.push({
        hour: i,
        actual_position: {
          latitude: actualNextPos.latitude,
          longitude: actualNextPos.longitude,
          altitude_km: actualNextPos.altitude_km,
          timestamp: actualNextPos.timestamp,
        },
        predicted_position: {
          latitude: prediction.latitude,
          longitude: prediction.longitude,
          altitude_km: prediction.altitude_km,
          confidence: prediction.confidence,
        },
        prediction_error_km: errorKm,
        value_score: errorKm, // Can normalize/scale as needed
      });
    }

    // Calculate overall score (average error)
    const avgError =
      valueOverTime.length > 0
        ? valueOverTime.reduce((sum, v) => sum + v.prediction_error_km, 0) / valueOverTime.length
        : 0;

    console.log(
      `Calculated value for ${balloonId}: ${avgError.toFixed(2)} km avg error over ${valueOverTime.length} hours`
    );

    return {
      balloon_id: balloonId,
      calculation_timestamp: new Date().toISOString(),
      hours_calculated: maxHours,
      method,
      overall_value_score: avgError,
      value_over_time: valueOverTime,
    };
  }

  /**
   * Calculate distance between two points using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
      Math.cos(this.toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
  }
}
