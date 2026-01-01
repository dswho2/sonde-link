import { Pool, QueryResult } from 'pg';
import { WindData } from './wind.service';
import { RawBalloonData, BalloonDataPoint } from '../types/balloon';

export class PostgresService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? {
        rejectUnauthorized: false
      } : false
    });
    this.initializeTables();
  }

  private async initializeTables() {
    const client = await this.pool.connect();

    try {
      // Wind Cache Table
      await client.query(`
        CREATE TABLE IF NOT EXISTS wind_cache (
          lat REAL,
          lon REAL,
          altitude_km REAL,
          data TEXT,
          timestamp BIGINT,
          PRIMARY KEY (lat, lon, altitude_km, timestamp)
        )
      `);

      // Raw Balloon Snapshots
      await client.query(`
        CREATE TABLE IF NOT EXISTS balloon_snapshots (
          timestamp TEXT PRIMARY KEY,
          raw_data TEXT
        )
      `);

      // Tracked Balloons
      await client.query(`
        CREATE TABLE IF NOT EXISTS tracked_balloons (
          id TEXT,
          timestamp TEXT,
          lat REAL,
          lon REAL,
          alt REAL,
          speed_kmh REAL,
          direction_deg REAL,
          status TEXT,
          hour_offset INTEGER,
          PRIMARY KEY (id, timestamp)
        )
      `);

      // Indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_tracked_balloons_timestamp
        ON tracked_balloons(timestamp)
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_balloon_trajectory
        ON tracked_balloons(id, timestamp)
      `);

      console.log('✅ PostgreSQL tables initialized');
    } catch (error) {
      console.error('Error initializing PostgreSQL tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // --- Wind Cache Methods ---

  async getWindCache(lat: number, lon: number, altitude_km: number, timestamp?: number): Promise<{ data: WindData; timestamp: number } | null> {
    const rLat = Number(lat.toFixed(1));
    const rLon = Number(lon.toFixed(1));
    const rAlt = Number(altitude_km.toFixed(1));

    const client = await this.pool.connect();
    try {
      let result: QueryResult;

      if (timestamp) {
        result = await client.query(
          'SELECT data, timestamp FROM wind_cache WHERE lat = $1 AND lon = $2 AND altitude_km = $3 AND timestamp = $4',
          [rLat, rLon, rAlt, timestamp]
        );
      } else {
        result = await client.query(
          'SELECT data, timestamp FROM wind_cache WHERE lat = $1 AND lon = $2 AND altitude_km = $3 ORDER BY timestamp DESC LIMIT 1',
          [rLat, rLon, rAlt]
        );
      }

      if (result.rows.length === 0) return null;

      return {
        data: JSON.parse(result.rows[0].data),
        timestamp: result.rows[0].timestamp,
      };
    } finally {
      client.release();
    }
  }

  async setWindCache(data: WindData): Promise<void> {
    const rLat = Number(data.latitude.toFixed(1));
    const rLon = Number(data.longitude.toFixed(1));
    const rAlt = Number(data.altitude_km.toFixed(1));
    const ts = new Date(data.timestamp).getTime();

    const client = await this.pool.connect();
    try {
      await client.query(
        'INSERT INTO wind_cache (lat, lon, altitude_km, data, timestamp) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (lat, lon, altitude_km, timestamp) DO UPDATE SET data = $4',
        [rLat, rLon, rAlt, JSON.stringify(data), ts]
      );
    } finally {
      client.release();
    }
  }

  async clearExpiredWindCache(maxAgeMs: number): Promise<void> {
    const aggressiveCutoff = Date.now() - 48 * 60 * 60 * 1000;
    const client = await this.pool.connect();
    try {
      await client.query('DELETE FROM wind_cache WHERE timestamp < $1', [aggressiveCutoff]);
    } finally {
      client.release();
    }
  }

  // --- Balloon Snapshot Methods ---

  async saveBalloonSnapshot(timestamp: string, rawData: RawBalloonData[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(
        'INSERT INTO balloon_snapshots (timestamp, raw_data) VALUES ($1, $2) ON CONFLICT (timestamp) DO UPDATE SET raw_data = $2',
        [timestamp, JSON.stringify(rawData)]
      );
    } finally {
      client.release();
    }
  }

  async getBalloonSnapshot(timestamp: string): Promise<RawBalloonData[] | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT raw_data FROM balloon_snapshots WHERE timestamp = $1',
        [timestamp]
      );
      return result.rows.length > 0 ? JSON.parse(result.rows[0].raw_data) : null;
    } finally {
      client.release();
    }
  }

  async getLatestSnapshotTimestamp(): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT timestamp FROM balloon_snapshots ORDER BY timestamp DESC LIMIT 1'
      );
      return result.rows.length > 0 ? result.rows[0].timestamp : null;
    } finally {
      client.release();
    }
  }

  async getAllSnapshots(): Promise<{ timestamp: string, data: RawBalloonData[] }[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT timestamp, raw_data FROM balloon_snapshots ORDER BY timestamp DESC'
      );
      return result.rows.map(r => ({
        timestamp: r.timestamp,
        data: JSON.parse(r.raw_data)
      }));
    } finally {
      client.release();
    }
  }

  // --- Tracked Balloon Methods ---

  async saveTrackedBalloons(balloons: BalloonDataPoint[]): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      for (const b of balloons) {
        await client.query(
          `INSERT INTO tracked_balloons
          (id, timestamp, lat, lon, alt, speed_kmh, direction_deg, status, hour_offset)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (id, timestamp) DO UPDATE SET
            lat = $3, lon = $4, alt = $5, speed_kmh = $6,
            direction_deg = $7, status = $8, hour_offset = $9`,
          [
            b.id,
            b.timestamp,
            b.latitude,
            b.longitude,
            b.altitude_km,
            b.speed_kmh ?? null,
            b.direction_deg ?? null,
            b.status ?? 'active',
            b.hour_offset
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMaxBalloonId(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT MAX(CAST(substr(id, 9) AS INTEGER)) as max_id
        FROM tracked_balloons
        WHERE id LIKE 'balloon_%'
      `);
      return result.rows[0]?.max_id ?? 0;
    } finally {
      client.release();
    }
  }

  async getTrackedBalloonsByHour(hourOffset: number): Promise<BalloonDataPoint[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM tracked_balloons WHERE hour_offset = $1',
        [hourOffset]
      );
      return result.rows.map(this.mapRowToBalloon);
    } finally {
      client.release();
    }
  }

  async getTrackedBalloonsAtTimestamp(timestamp: string): Promise<BalloonDataPoint[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM tracked_balloons WHERE timestamp = $1',
        [timestamp]
      );
      console.log(`📊 Query tracked_balloons for ${timestamp}: Found ${result.rows.length} balloons`);
      return result.rows.map(this.mapRowToBalloon);
    } finally {
      client.release();
    }
  }

  async getBalloonTrajectory(balloonId: string): Promise<BalloonDataPoint[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM tracked_balloons WHERE id = $1 ORDER BY timestamp ASC',
        [balloonId]
      );
      return result.rows.map(this.mapRowToBalloon);
    } finally {
      client.release();
    }
  }

  async getAllTrackedBalloons(): Promise<BalloonDataPoint[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query('SELECT * FROM tracked_balloons');
      return result.rows.map(this.mapRowToBalloon);
    } finally {
      client.release();
    }
  }

  async cleanupStaleData(): Promise<{ deletedTrackedBalloons: number; deletedSnapshots: number }> {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 24);
    const cutoffTimestamp = cutoffTime.toISOString();

    const client = await this.pool.connect();
    try {
      const trackedResult = await client.query(
        'DELETE FROM tracked_balloons WHERE timestamp < $1',
        [cutoffTimestamp]
      );

      const snapshotsResult = await client.query(
        'DELETE FROM balloon_snapshots WHERE timestamp < $1',
        [cutoffTimestamp]
      );

      const deletedTrackedBalloons = trackedResult.rowCount ?? 0;
      const deletedSnapshots = snapshotsResult.rowCount ?? 0;

      console.log(`Database cleanup: Deleted ${deletedTrackedBalloons} tracked balloons and ${deletedSnapshots} snapshots older than ${cutoffTimestamp}`);

      return { deletedTrackedBalloons, deletedSnapshots };
    } finally {
      client.release();
    }
  }

  async clearAllData(): Promise<void> {
    console.log('⚠️  Clearing all balloon data from database...');

    const client = await this.pool.connect();
    try {
      const trackedResult = await client.query('DELETE FROM tracked_balloons');
      const snapshotsResult = await client.query('DELETE FROM balloon_snapshots');

      console.log(`Cleared ${trackedResult.rowCount ?? 0} tracked balloons and ${snapshotsResult.rowCount ?? 0} snapshots`);
    } finally {
      client.release();
    }
  }

  private mapRowToBalloon(row: any): BalloonDataPoint {
    return {
      id: row.id,
      timestamp: row.timestamp,
      latitude: row.lat,
      longitude: row.lon,
      altitude_km: row.alt,
      speed_kmh: row.speed_kmh,
      direction_deg: row.direction_deg,
      status: row.status as 'active' | 'lost' | 'new',
      hour_offset: row.hour_offset,
      confidence: 1.0
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
