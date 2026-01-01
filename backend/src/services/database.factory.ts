import { DatabaseService } from './database.service';
import { PostgresService } from './database.postgres';
import { WindData } from './wind.service';
import { RawBalloonData, BalloonDataPoint } from '../types/balloon';

/**
 * Database interface that both SQLite and Postgres adapters implement
 * This enables seamless switching between databases via environment variables
 */
export interface IDatabase {
  // Wind Cache Methods
  getWindCache(lat: number, lon: number, altitude_km: number, timestamp?: number): Promise<{ data: WindData; timestamp: number } | null> | { data: WindData; timestamp: number } | null;
  setWindCache(data: WindData): Promise<void> | void;
  clearExpiredWindCache(maxAgeMs: number): Promise<void> | void;

  // Balloon Snapshot Methods
  saveBalloonSnapshot(timestamp: string, rawData: RawBalloonData[]): Promise<void> | void;
  getBalloonSnapshot(timestamp: string): Promise<RawBalloonData[] | null> | RawBalloonData[] | null;
  getLatestSnapshotTimestamp(): Promise<string | null> | string | null;
  getAllSnapshots(): Promise<{ timestamp: string, data: RawBalloonData[] }[]> | { timestamp: string, data: RawBalloonData[] }[];

  // Tracked Balloon Methods
  saveTrackedBalloons(balloons: BalloonDataPoint[]): Promise<void> | void;
  getMaxBalloonId(): Promise<number> | number;
  getTrackedBalloonsByHour(hourOffset: number): Promise<BalloonDataPoint[]> | BalloonDataPoint[];
  getTrackedBalloonsAtTimestamp(timestamp: string): Promise<BalloonDataPoint[]> | BalloonDataPoint[];
  getBalloonTrajectory(balloonId: string): Promise<BalloonDataPoint[]> | BalloonDataPoint[];
  getAllTrackedBalloons(): Promise<BalloonDataPoint[]> | BalloonDataPoint[];
  cleanupStaleData(): Promise<{ deletedTrackedBalloons: number; deletedSnapshots: number }> | { deletedTrackedBalloons: number; deletedSnapshots: number };
  clearAllData(): Promise<void> | void;
}

/**
 * Factory function to create the appropriate database service
 * based on environment configuration
 *
 * Set DATABASE_TYPE=postgres and DATABASE_URL=your_postgres_url for Postgres
 * Otherwise defaults to SQLite
 */
export function createDatabase(): IDatabase {
  const dbType = process.env.DATABASE_TYPE || 'sqlite';

  if (dbType === 'postgres') {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set when using PostgreSQL');
    }
    console.log('🐘 Using PostgreSQL database');
    return new PostgresService();
  }

  console.log('📦 Using SQLite database');
  return new DatabaseService();
}
