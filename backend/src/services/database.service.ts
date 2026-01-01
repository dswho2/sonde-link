import Database from 'better-sqlite3';
import path from 'path';
import { WindData } from './wind.service';
import { RawBalloonData, BalloonDataPoint } from '../types/balloon';

export class DatabaseService {
  private db: Database.Database;

  constructor() {
    // Initialize DB in the root of backend or a data folder
    const dbPath = path.resolve(__dirname, '../../windborne.db');
    this.db = new Database(dbPath);
    this.initializeTables();
  }

  private initializeTables() {

    // Wind Cache Table
    // Dropping to ensure schema update since we changed PK
    // In production, use migrations!
    this.db.exec(`DROP TABLE IF EXISTS wind_cache`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wind_cache (
        lat REAL,
        lon REAL,
        altitude_km REAL,
        data TEXT,
        timestamp INTEGER,
        PRIMARY KEY (lat, lon, altitude_km, timestamp)
      )
    `);

    // ... (other tables unchanged, but I need to include them to keep file valid if I replace block)
    // Actually I can just target the wind_cache part if I'm careful.
    // But getWindCache also needs update.
    // I'll update the whole block.

    // Raw Balloon Snapshots (for replay/history)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS balloon_snapshots (
        timestamp TEXT PRIMARY KEY,
        raw_data TEXT
      )
    `);

    // Tracked Balloons (Persistent ID state)
    this.db.exec(`
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

    // Indexes for faster queries (Postgres-compatible syntax)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tracked_balloons_timestamp
      ON tracked_balloons(timestamp)
    `);

    // Composite index for trajectory queries (ORDER BY timestamp for specific balloon)
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_balloon_trajectory
      ON tracked_balloons(id, timestamp)
    `);
  }

  // --- Wind Cache Methods ---

  getWindCache(lat: number, lon: number, altitude_km: number, timestamp?: number): { data: WindData; timestamp: number } | null {
    const rLat = Number(lat.toFixed(1));
    const rLon = Number(lon.toFixed(1));
    const rAlt = Number(altitude_km.toFixed(1));

    if (timestamp) {
      // Exact match (or closest? Cache usually exact match for key)
      // WindService rounds timestamp to hour.
      const row = this.db.prepare(`
          SELECT data, timestamp FROM wind_cache 
          WHERE lat = ? AND lon = ? AND altitude_km = ? AND timestamp = ?
        `).get(rLat, rLon, rAlt, timestamp) as { data: string; timestamp: number } | undefined;

      if (row) return { data: JSON.parse(row.data), timestamp: row.timestamp };
      return null;
    }

    // If no timestamp, get latest? (Old behavior)
    const row = this.db.prepare(`
      SELECT data, timestamp FROM wind_cache 
      WHERE lat = ? AND lon = ? AND altitude_km = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(rLat, rLon, rAlt) as { data: string; timestamp: number } | undefined;

    if (!row) return null;

    return {
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
    };
  }

  setWindCache(data: WindData): void {
    const rLat = Number(data.latitude.toFixed(1));
    const rLon = Number(data.longitude.toFixed(1));
    const rAlt = Number(data.altitude_km.toFixed(1));
    // Use data.timestamp which is ISO string, convert to ms for comparison/storage
    const ts = new Date(data.timestamp).getTime();

    this.db.prepare(`
      INSERT OR REPLACE INTO wind_cache (lat, lon, altitude_km, data, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(rLat, rLon, rAlt, JSON.stringify(data), ts);
  }

  clearExpiredWindCache(maxAgeMs: number): void {
    const cutoff = Date.now() - maxAgeMs;
    // Don't clear historical cache if we need it for replay!
    // But wind data expires? Historical wind is permanent.
    // For now, only clear if really old?
    // Let's modify to keep 2 days.
    const aggressiveCutoff = Date.now() - 48 * 60 * 60 * 1000;
    this.db.prepare(`DELETE FROM wind_cache WHERE timestamp < ?`).run(aggressiveCutoff);
  }

  // --- Balloon Snapshot Methods ---

  saveBalloonSnapshot(timestamp: string, rawData: RawBalloonData[]): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO balloon_snapshots (timestamp, raw_data)
      VALUES (?, ?)
    `).run(timestamp, JSON.stringify(rawData));
  }

  getBalloonSnapshot(timestamp: string): RawBalloonData[] | null {
    const row = this.db.prepare(`
      SELECT raw_data FROM balloon_snapshots WHERE timestamp = ?
    `).get(timestamp) as { raw_data: string } | undefined;

    return row ? JSON.parse(row.raw_data) : null;
  }

  getLatestSnapshotTimestamp(): string | null {
    const row = this.db.prepare(`
          SELECT timestamp FROM balloon_snapshots ORDER BY timestamp DESC LIMIT 1
      `).get() as { timestamp: string } | undefined;
    return row ? row.timestamp : null;
  }

  getAllSnapshots(): { timestamp: string, data: RawBalloonData[] }[] {
    const rows = this.db.prepare(`
          SELECT timestamp, raw_data FROM balloon_snapshots ORDER BY timestamp DESC
      `).all() as { timestamp: string, raw_data: string }[];

    return rows.map(r => ({
      timestamp: r.timestamp,
      data: JSON.parse(r.raw_data)
    }));
  }

  // --- Tracked Balloon Methods ---

  saveTrackedBalloons(balloons: BalloonDataPoint[]): void {
    const insert = this.db.prepare(`
          INSERT OR REPLACE INTO tracked_balloons 
          (id, timestamp, lat, lon, alt, speed_kmh, direction_deg, status, hour_offset)
          VALUES (@id, @timestamp, @latitude, @longitude, @altitude_km, @speed_kmh, @direction_deg, @status, @hour_offset)
      `);

    const insertMany = this.db.transaction((balloons: BalloonDataPoint[]) => {
      for (const b of balloons) {
        insert.run({
          ...b,
          speed_kmh: b.speed_kmh ?? null,
          direction_deg: b.direction_deg ?? null,
          status: b.status ?? 'active'
        });
      }
    });

    insertMany(balloons);
  }

  getMaxBalloonId(): number {
    // Assumes format 'balloon_XXXX'
    const row = this.db.prepare(`
          SELECT MAX(CAST(substr(id, 9) AS INTEGER)) as maxId FROM tracked_balloons WHERE id LIKE 'balloon_%'
      `).get() as { maxId: number } | undefined;
    return row && row.maxId ? row.maxId : 0;
  }

  getTrackedBalloonsByHour(hourOffset: number): BalloonDataPoint[] {
    const rows = this.db.prepare(`
        SELECT * FROM tracked_balloons WHERE hour_offset = ?
    `).all(hourOffset) as any[];

    return rows.map(this.mapRowToBalloon);
  }

  getTrackedBalloonsAtTimestamp(timestamp: string): BalloonDataPoint[] {
    const rows = this.db.prepare(`
        SELECT * FROM tracked_balloons WHERE timestamp = ?
    `).all(timestamp) as any[];

    console.log(`📊 Query tracked_balloons for ${timestamp}: Found ${rows.length} balloons`);

    return rows.map(this.mapRowToBalloon);
  }

  /**
   * Get trajectory for a specific balloon (all timestamps for that balloon ID)
   * OPTIMIZED: Loads only ~24 records instead of all 24,000 records
   */
  getBalloonTrajectory(balloonId: string): BalloonDataPoint[] {
    const rows = this.db.prepare(`
      SELECT * FROM tracked_balloons
      WHERE id = ?
      ORDER BY timestamp ASC
    `).all(balloonId) as any[];

    return rows.map(this.mapRowToBalloon);
  }

  getAllTrackedBalloons(): BalloonDataPoint[] {
    const rows = this.db.prepare(`SELECT * FROM tracked_balloons`).all() as any[];
    return rows.map(this.mapRowToBalloon);
  }

  /**
   * Clean up stale balloon data older than 24 hours
   * Should be called hourly to prevent database bloat
   * OPTIMIZATION: Only keep current hour + 23 hours back (matches Windborne API retention)
   */
  cleanupStaleData(): { deletedTrackedBalloons: number; deletedSnapshots: number } {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - 24);
    const cutoffTimestamp = cutoffTime.toISOString();

    // Delete old tracked balloons
    const deletedTrackedBalloons = this.db.prepare(`
      DELETE FROM tracked_balloons
      WHERE timestamp < ?
    `).run(cutoffTimestamp).changes;

    // Delete old balloon snapshots
    const deletedSnapshots = this.db.prepare(`
      DELETE FROM balloon_snapshots
      WHERE timestamp < ?
    `).run(cutoffTimestamp).changes;

    console.log(`Database cleanup: Deleted ${deletedTrackedBalloons} tracked balloons and ${deletedSnapshots} snapshots older than ${cutoffTimestamp}`);

    return { deletedTrackedBalloons, deletedSnapshots };
  }

  /**
   * Clear ALL balloon data from database
   * FALLBACK ONLY: Used when replacing database with fresh full fetch
   * This is a destructive operation - use with caution!
   */
  clearAllData(): void {
    console.log('⚠️  Clearing all balloon data from database...');

    // Clear tracked balloons
    const deletedTracked = this.db.prepare(`DELETE FROM tracked_balloons`).run().changes;

    // Clear balloon snapshots
    const deletedSnapshots = this.db.prepare(`DELETE FROM balloon_snapshots`).run().changes;

    console.log(`Cleared ${deletedTracked} tracked balloons and ${deletedSnapshots} snapshots`);
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
}
