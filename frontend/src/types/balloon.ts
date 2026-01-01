/**
 * Frontend type definitions matching backend API
 */

export interface BalloonDataPoint {
  id: string;
  latitude: number;
  longitude: number;
  altitude_km: number;
  timestamp: string;
  hour_offset: number;
  speed_kmh?: number;
  direction_deg?: number;
  confidence: number;
  status: 'active' | 'new' | 'lost';
  trajectory?: BalloonTrajectory; // Included in main balloon response
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
  dataAgeMinutes: number;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastUpdate: string | null;
  dataFreshness: number;
  balloonCount: number;
  autoUpdateEnabled: boolean;
}

// Phase 2: Trajectory and Prediction Types

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

export interface TrajectoryResponse {
  balloon_id: string;
  trajectory: BalloonTrajectory;
}

export interface MultipleTrajectoryResponse {
  trajectories: TrajectoryResponse[];
}

export type PredictionMethod = 'persistence' | 'wind' | 'hybrid';

export interface TrajectoryOptions {
  hours?: number;
  method?: PredictionMethod;
  limit?: number;
}

export interface HistoryItem {
  id: string;
  value_score: number;
  score_timestamp: string | null;
  trail: [number, number, number, string][]; // lat, lon, alt, iso_time
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
