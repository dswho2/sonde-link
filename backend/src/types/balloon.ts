/**
 * Type definitions for balloon tracking system
 * Based on CLAUDE.md specifications
 */

export interface BalloonDataPoint {
  id: string;           // Tracked ID (e.g., "balloon_042")
  latitude: number;
  longitude: number;
  altitude_km: number;
  timestamp: string;    // ISO 8601: "2025-10-17T21:00:00Z"
  hour_offset: number;  // 0=current, 1=1hr ago, ..., 23=23hrs ago
  speed_kmh?: number;   // Calculated from trajectory
  direction_deg?: number;
  confidence: number;   // Tracking confidence (0-1)
  status: 'active' | 'new' | 'lost';
  trajectory?: BalloonTrajectory; // Optional trajectory data (included in main balloon response)
}

export interface RawBalloonData {
  // Raw data from Windborne API: [latitude, longitude, altitude_km]
  0: number; // latitude
  1: number; // longitude
  2: number; // altitude_km
}

export interface BalloonResponse {
  updated_at: string;
  data_age_minutes: number;
  source: string;
  balloon_count: number;
  balloons: BalloonDataPoint[];
}

export interface Settings {
  autoUpdateEnabled: boolean;
  lastUpdateTimestamp: string | null;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastUpdate: string | null;
  dataFreshness: number; // minutes since last update
  balloonCount: number;
  autoUpdateEnabled: boolean;
}

// Phase 2: Trajectory and Wind Data Types

export interface PredictedPosition {
  latitude: number;
  longitude: number;
  altitude_km: number;
  timestamp: string;
  confidence: number;
  method: 'persistence' | 'wind' | 'hybrid' | 'historical';
}

export interface BalloonTrajectory {
  balloon_id: string;
  historical_positions: BalloonDataPoint[]; // Past positions (solid blue line)
  future_positions?: BalloonDataPoint[]; // Known future positions relative to timeframe (dotted blue line)
  predicted_positions: PredictedPosition[]; // Actual predictions (for wind-based forecasting)
  prediction_horizon_hours: number;
}

export interface WindData {
  latitude: number;
  longitude: number;
  altitude_km: number;
  pressure_hpa: number;
  wind_u_ms: number;
  wind_v_ms: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  timestamp: string;
}

export interface TrajectoryResponse {
  balloon_id: string;
  trajectory: BalloonTrajectory;
  wind_data?: WindData;
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
