/**
 * Windborne API Service
 * Implements incremental fetching strategy from CLAUDE.md
 */

import axios from 'axios';
import { RawBalloonData, BalloonDataPoint } from '../types/balloon';
import { IDatabase } from './database.factory';
import { BalloonTracker } from './tracker.service';

const WINDBORNE_API_BASE = 'https://a.windbornesystems.com/treasure';
const MAX_HOURS = 24;

export class WindborneService {
  private db: IDatabase;
  private tracker: BalloonTracker;
  private balloonHistory: BalloonDataPoint[] = [];
  private lastUpdateTimestamp: string | null = null;
  private autoUpdateEnabled: boolean = true;
  private updateCleanupInterval: NodeJS.Timeout | null = null;
  private nextScheduledRun: Date | null = null;
  private initializationPromise: Promise<void>;
  private isInitialized: boolean = false;

  constructor(db: IDatabase, tracker: BalloonTracker) {
    this.db = db;
    this.tracker = tracker;
    // Start async initialization but don't block constructor
    this.initializationPromise = this.initializeData();
  }

  /**
   * Initialize data on startup
   * Checks if we have current hour data, falls back to full fetch if needed
   */
  private async initializeData(): Promise<void> {
    try {
      console.log('🔍 Starting initialization...');

      const currentTimestamp = this.getCurrentTimestamp();
      console.log(`   Current timestamp: ${currentTimestamp}`);

      const latestFromDB = await this.db.getLatestSnapshotTimestamp();
      console.log(`   Latest DB timestamp: ${latestFromDB || 'null (empty DB)'}`);

      // Check if we have the current hour's data
      if (!latestFromDB || latestFromDB !== currentTimestamp) {
        console.log('⚠️  Current hour data missing - triggering fallback full fetch');
        console.log(`   Reason: latestFromDB=${latestFromDB}, currentTimestamp=${currentTimestamp}`);
        await this.fallbackFullFetch();
        console.log(`   After fallback: balloonHistory.length = ${this.balloonHistory.length}`);
      } else {
        console.log('✅ Current hour data found in database');
        // Load existing data from DB into memory
        const snapshots = await this.db.getAllSnapshots();
        console.log(`   Found ${snapshots.length} snapshots in database`);
        this.balloonHistory = [];

        for (const snap of snapshots) {
          if (this.hoursDiff(snap.timestamp, currentTimestamp) < 24) {
            const hourOffset = Math.round(this.hoursDiff(snap.timestamp, currentTimestamp));
            const hourData = snap.data.map((raw: RawBalloonData, index: number) => ({
              id: `temp_${hourOffset}_${index}`,
              latitude: raw[0],
              longitude: raw[1],
              altitude_km: raw[2],
              timestamp: snap.timestamp,
              hour_offset: hourOffset,
              confidence: 1.0,
              status: 'active' as const,
            }));
            this.balloonHistory.push(...hourData);
            console.log(`   Loaded hour ${hourOffset}: ${hourData.length} balloons (${snap.timestamp})`);
          }
        }

        this.lastUpdateTimestamp = latestFromDB;
        console.log(`✅ Loaded ${this.balloonHistory.length} balloons from database`);

        // IMPORTANT: Clear old tracked data and reprocess with new tracking logic
        console.log(`🗑️  Clearing old tracked balloons and cache to force reprocessing...`);
        await this.db.clearAllData();

        // Clear tracker's in-memory cache to force fresh processing
        (this.tracker as any).processedDataCache.clear();
        (this.tracker as any).cacheTimestamp = null;

        console.log(`🔄 Processing balloon tracking data...`);
        const trackedData = await this.tracker.processHistoricalData(this.balloonHistory);
        console.log(`✅ Tracking complete - ${trackedData.length} balloons processed`);
      }

      this.isInitialized = true;
      console.log('✅ Initialization complete');

      // Start the scheduler after data check (only in non-serverless environments)
      // In Vercel, we use cron jobs instead
      if (process.env.VERCEL !== '1') {
        this.startHourlyScheduler();
      } else {
        console.log('🌐 Running in Vercel serverless - scheduler disabled (using cron jobs instead)');
      }

    } catch (error) {
      console.error('❌ Error during initialization, starting scheduler anyway:', error);
      this.isInitialized = true;
      if (process.env.VERCEL !== '1') {
        this.startHourlyScheduler();
      }
    }
  }

  /**
   * Ensure initialization is complete before returning data
   * This method should be called by getBalloonData()
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      console.log('⏳ Waiting for initialization to complete...');
      await this.initializationPromise;
      console.log('✅ Initialization wait complete');
    }
  }

  /**
   * Fallback: Fetch all 24 hours and replace database
   * Used when:
   * - Server starts after :01:30 (missed scheduled update)
   * - Database is empty/corrupted
   * - Current hour data is missing
   * - Recovering from extended downtime
   */
  private async fallbackFullFetch(): Promise<void> {
    try {
      console.log('🔄 FALLBACK: Fetching all 24 hours from Windborne API...');
      const startTime = Date.now();

      // Fetch all 24 hours
      const allData = await this.fetchAll24Hours();
      console.log(`   fetchAll24Hours returned ${allData.length} balloons`);

      if (allData.length === 0) {
        console.error('❌ Fallback failed: No data received from API');
        return;
      }

      // Clear existing data from database
      console.log('🗑️  Clearing old database data...');
      await this.db.clearAllData();

      // Save all snapshots to database
      const hourGroups = new Map<string, BalloonDataPoint[]>();
      for (const balloon of allData) {
        if (!hourGroups.has(balloon.timestamp)) {
          hourGroups.set(balloon.timestamp, []);
        }
        hourGroups.get(balloon.timestamp)!.push(balloon);
      }

      console.log(`💾 Saving ${hourGroups.size} hours of data to database...`);
      for (const [timestamp, balloons] of hourGroups) {
        const rawData: RawBalloonData[] = balloons.map(b => [
          b.latitude,
          b.longitude,
          b.altitude_km
        ]);
        await this.db.saveBalloonSnapshot(timestamp, rawData);
        console.log(`   Saved snapshot for ${timestamp}: ${balloons.length} balloons`);
      }

      // Update in-memory cache
      this.balloonHistory = allData;
      this.lastUpdateTimestamp = this.getCurrentTimestamp();

      // IMPORTANT: Process and save to tracked_balloons table
      console.log(`🔄 Processing balloon tracking data...`);
      const trackedData = await this.tracker.processHistoricalData(this.balloonHistory);
      await this.db.saveTrackedBalloons(trackedData);
      console.log(`✅ Saved ${trackedData.length} tracked balloons to database`);

      const elapsed = Date.now() - startTime;
      console.log(`✅ Fallback complete in ${elapsed}ms - ${allData.length} balloons loaded across ${hourGroups.size} hours`);
      console.log(`   balloonHistory.length = ${this.balloonHistory.length}`);
      console.log(`   lastUpdateTimestamp = ${this.lastUpdateTimestamp}`);

    } catch (error) {
      console.error('❌ Fallback full fetch failed:', error);
      throw error;
    }
  }

  /**
   * Start coordinated hourly update + cleanup scheduler
   *
   * TIMING STRATEGY:
   * - Windborne API releases new data at the top of each hour (XX:00)
   * - We schedule updates at XX:01:30 to ensure data is available
   * - First: Fetch new hour data (00.json)
   * - Then: Clean up data older than 24 hours
   *
   * PRODUCTION OPTIMIZATION:
   * - Only fetches newest hour (incremental)
   * - Deletes oldest hour in same cycle
   * - Keeps database size constant (~24 hours of data)
   */
  private startHourlyScheduler(): void {
    console.log('🚀 Starting coordinated hourly update + cleanup scheduler...');

    // Run initial cleanup on startup
    this.db.cleanupStaleData();

    // Calculate time until next hour + 90 seconds (XX:01:30)
    const scheduleNextRun = () => {
      const now = new Date();
      const nextHour = new Date(now);
      nextHour.setHours(nextHour.getHours() + 1, 1, 30, 0); // Next hour at :01:30

      const delay = nextHour.getTime() - now.getTime();
      this.nextScheduledRun = nextHour;

      console.log(`⏰ Next update scheduled for: ${nextHour.toISOString()} (in ${Math.round(delay / 1000)}s)`);

      this.updateCleanupInterval = setTimeout(async () => {
        await this.runHourlyUpdate();
        scheduleNextRun(); // Schedule next run
      }, delay);
    };

    scheduleNextRun();
  }

  /**
   * Execute hourly update + cleanup cycle
   * This runs at :01:30 of every hour
   * Includes fallback to full fetch if incremental update fails
   */
  private async runHourlyUpdate(): Promise<void> {
    if (!this.autoUpdateEnabled) {
      console.log('⏭️  Auto-update disabled, skipping hourly update');
      return;
    }

    try {
      console.log('🔄 Running hourly update cycle...');
      const startTime = Date.now();

      // Step 1: Fetch new hour data from Windborne API
      console.log('📥 Fetching latest hour data from Windborne API...');
      const currentTimestamp = this.getCurrentTimestamp();
      const newHourData = await this.fetchHourData(0);

      if (newHourData.length > 0) {
        console.log(`✅ Fetched ${newHourData.length} balloons for ${currentTimestamp}`);

        // Save snapshot to database
        await this.db.saveBalloonSnapshot(currentTimestamp, newHourData);

        // Update in-memory cache (if we're using it)
        const trackedBalloons: BalloonDataPoint[] = newHourData.map((raw, index) => ({
          id: `temp_0_${index}`,
          latitude: raw[0],
          longitude: raw[1],
          altitude_km: raw[2],
          timestamp: currentTimestamp,
          hour_offset: 0,
          confidence: 1.0,
          status: 'active' as const,
        }));

        // Add new hour to beginning, remove old data
        this.balloonHistory.unshift(...trackedBalloons);
        this.balloonHistory = this.balloonHistory.filter(
          (b) => this.hoursDiff(b.timestamp, currentTimestamp) < 24
        );

        // Update hour_offset for all existing data
        this.balloonHistory = this.balloonHistory.map((b) => ({
          ...b,
          hour_offset: Math.round(this.hoursDiff(b.timestamp, currentTimestamp)),
        }));

        // CRITICAL: Process all historical data to track balloons and build trajectories
        // This ensures new balloons are matched against previous hours and saved with proper IDs
        console.log(`🔄 Processing balloon tracking for all ${this.balloonHistory.length} balloons...`);
        const fullyTrackedData = await this.tracker.processHistoricalData(this.balloonHistory);
        console.log(`✅ Tracking complete - ${fullyTrackedData.length} balloons processed`);

        this.lastUpdateTimestamp = currentTimestamp;
      } else {
        // FALLBACK: If incremental fetch returns no data, do full fetch
        console.warn('⚠️  No balloon data received from incremental fetch - triggering fallback');
        await this.fallbackFullFetch();
      }

      // Step 2: Clean up stale data (older than 24 hours)
      console.log('🧹 Cleaning up stale data...');
      const { deletedTrackedBalloons, deletedSnapshots } = await this.db.cleanupStaleData();

      const elapsed = Date.now() - startTime;
      console.log(`✨ Hourly update complete in ${elapsed}ms (deleted ${deletedTrackedBalloons} tracked + ${deletedSnapshots} snapshots)`);

    } catch (error) {
      console.error('❌ Error during hourly update:', error);
      // On error, try fallback as last resort
      console.log('🔄 Attempting fallback full fetch due to error...');
      try {
        await this.fallbackFullFetch();
      } catch (fallbackError) {
        console.error('❌ Fallback also failed:', fallbackError);
      }
    }
  }

  /**
   * Stop the hourly scheduler (for graceful shutdown)
   */
  stopHourlyScheduler(): void {
    if (this.updateCleanupInterval) {
      clearTimeout(this.updateCleanupInterval);
      this.updateCleanupInterval = null;
      console.log('🛑 Hourly scheduler stopped');
    }
  }

  /**
   * Get next scheduled run time (for debugging/monitoring)
   */
  getNextScheduledRun(): Date | null {
    return this.nextScheduledRun;
  }

  /**
   * Fetch data from a specific hour endpoint
   * @param hourOffset - 0 for current (00.json), 1 for 1 hour ago (01.json), etc.
   */
  async fetchHourData(hourOffset: number): Promise<RawBalloonData[]> {
    const paddedHour = hourOffset.toString().padStart(2, '0');
    const url = `${WINDBORNE_API_BASE}/${paddedHour}.json`;

    try {
      const response = await axios.get<RawBalloonData[]>(url, {
        timeout: 10000,
        validateStatus: (status) => status === 200,
      });

      // Validate data structure
      if (!Array.isArray(response.data)) {
        console.error(`Invalid data from ${url}: not an array`);
        return [];
      }

      // Filter out corrupted/invalid entries
      const validData = response.data.filter((entry) => {
        if (!Array.isArray(entry) || entry.length !== 3) return false;
        const [lat, lon, alt] = entry;
        return (
          typeof lat === 'number' &&
          typeof lon === 'number' &&
          typeof alt === 'number' &&
          lat >= -90 && lat <= 90 &&
          lon >= -180 && lon <= 180 &&
          alt > 0 && alt < 50 // Stratospheric balloons typically under 50km
        );
      });

      // Save raw snapshot to DB (using hour offset to calculate timestamp)
      // Note: This function doesn't know the exact timestamp, but the caller does. 
      // Actually, standard is 00.json is current hour.
      // We'll let the caller handle saving snapshots because they compute the timestamp.
      return validData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`Failed to fetch ${url}:`, error.message);
      } else {
        console.error(`Unexpected error fetching ${url}:`, error);
      }
      return [];
    }
  }

  /**
   * Fetch all 24 hours of data (initial load or catch-up)
   */
  async fetchAll24Hours(): Promise<BalloonDataPoint[]> {
    console.log('Fetching all 24 hours of data...');
    const allData: BalloonDataPoint[] = [];

    // Fetch all hours in parallel for speed
    const fetchPromises = Array.from({ length: MAX_HOURS }, (_, i) =>
      this.fetchHourData(i)
    );

    const results = await Promise.all(fetchPromises);

    // Process each hour's data
    for (let hourOffset = 0; hourOffset < MAX_HOURS; hourOffset++) {
      const rawData = results[hourOffset];
      const timestamp = this.getTimestampForOffset(hourOffset);

      // Save snapshot to DB
      if (rawData.length > 0) {
        await this.db.saveBalloonSnapshot(timestamp, rawData);
      }

      // Convert raw data to BalloonDataPoints
      // For initial load, we don't have tracking yet - just assign temporary IDs
      const hourData = rawData.map((raw, index) => ({
        id: `temp_${hourOffset}_${index}`,
        latitude: raw[0],
        longitude: raw[1],
        altitude_km: raw[2],
        timestamp,
        hour_offset: hourOffset,
        confidence: 1.0,
        status: 'active' as const,
      }));

      allData.push(...hourData);
    }

    console.log(`Fetched ${allData.length} balloon data points across 24 hours`);
    return allData;
  }

  /**
   * Get ISO timestamp for a given hour offset
   * @param hourOffset - 0 for current hour, 1 for 1 hour ago, etc.
   */
  private getTimestampForOffset(hourOffset: number): string {
    const now = new Date();
    const targetDate = new Date(now);
    targetDate.setUTCHours(now.getUTCHours() - hourOffset, 0, 0, 0);
    return targetDate.toISOString();
  }

  /**
   * Get current hour timestamp
   */
  getCurrentTimestamp(): string {
    return this.getTimestampForOffset(0);
  }

  /**
   * Check if two timestamps are consecutive hours
   */
  private isConsecutiveHour(lastTimestamp: string, currentTimestamp: string): boolean {
    const last = new Date(lastTimestamp);
    const current = new Date(currentTimestamp);
    const diffMs = current.getTime() - last.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // Allow some tolerance (should be 1 hour difference)
    return diffHours >= 0.9 && diffHours <= 1.1;
  }

  /**
   * Calculate hours difference between two timestamps
   */
  private hoursDiff(timestamp1: string, timestamp2: string): number {
    const t1 = new Date(timestamp1);
    const t2 = new Date(timestamp2);
    const diffMs = Math.abs(t2.getTime() - t1.getTime());
    return diffMs / (1000 * 60 * 60);
  }

  /**
   * Main method to get balloon data with smart incremental fetching
   */
  async getBalloonData(): Promise<BalloonDataPoint[]> {
    // Ensure initialization is complete before serving data
    await this.ensureInitialized();
    console.log(`📡 getBalloonData() called - balloonHistory has ${this.balloonHistory.length} balloons`);

    const currentTimestamp = this.getCurrentTimestamp();

    // First load or catch-up scenario (auto-update was disabled or server just started)
    // NOTE: isConsecutiveHour checks for ~1 hour difference, so it returns false if timestamps are the same
    // We need to handle the case where lastUpdateTimestamp === currentTimestamp (already up-to-date)
    if (
      !this.lastUpdateTimestamp ||
      (this.lastUpdateTimestamp !== currentTimestamp && !this.isConsecutiveHour(this.lastUpdateTimestamp, currentTimestamp))
    ) {
      console.log(`📍 Initial load or catch-up - lastUpdate=${this.lastUpdateTimestamp}, current=${currentTimestamp}`);

      // Try to load from DB first to see if we have recent data
      const latestFromDB = await this.db.getLatestSnapshotTimestamp();
      console.log(`   latestFromDB=${latestFromDB}, isConsecutive=${latestFromDB && this.isConsecutiveHour(latestFromDB, currentTimestamp)}`);

      if (latestFromDB && (latestFromDB === currentTimestamp || this.isConsecutiveHour(latestFromDB, currentTimestamp))) {
        console.log(`Found recent data in DB (${latestFromDB}), restoring history...`);
        // Load all available snapshots from DB
        const snapshots = await this.db.getAllSnapshots();
        this.balloonHistory = [];

        const now = new Date(currentTimestamp);

        for (const snap of snapshots) {
          // Only keep last 24 hours relative to NOW
          if (this.hoursDiff(snap.timestamp, currentTimestamp) < 24) {
            const hourOffset = Math.round(this.hoursDiff(snap.timestamp, currentTimestamp));

            const hourData = snap.data.map((raw: RawBalloonData, index: number) => ({
              id: `temp_${hourOffset}_${index}`,
              latitude: raw[0],
              longitude: raw[1],
              altitude_km: raw[2],
              timestamp: snap.timestamp,
              hour_offset: hourOffset,
              confidence: 1.0,
              status: 'active' as const,
            }));

            this.balloonHistory.push(...hourData);
          }
        }

        this.lastUpdateTimestamp = latestFromDB;

        // If we are still slightly behind (e.g. latestDB is 1 hour ago), let the next block handle it?
        // No, the next block checks currentTimestamp != lastUpdateTimestamp, so it will fetch the newest hour automatically!
        // Perfect.

        if (this.balloonHistory.length === 0) {
          // DB had data but it was all old
          console.log('DB data was too old, fetching fresh from API');
          this.balloonHistory = await this.fetchAll24Hours();
          this.lastUpdateTimestamp = currentTimestamp;
        }
      } else {
        // No useful DB data, fetch from API
        console.log('No recent DB data, fetching all 24 hours from API');
        this.balloonHistory = await this.fetchAll24Hours();
        this.lastUpdateTimestamp = currentTimestamp;
      }

      return this.balloonHistory;
    }

    // Normal incremental update (only fetch newest hour)
    if (currentTimestamp !== this.lastUpdateTimestamp) {
      console.log('Fetching only newest hour');
      const newHourData = await this.fetchHourData(0);
      const timestamp = currentTimestamp;

      if (newHourData.length > 0) {
        await this.db.saveBalloonSnapshot(timestamp, newHourData);
      }

      // Convert to BalloonDataPoints (temporary IDs for now, tracking comes later)
      const trackedBalloons: BalloonDataPoint[] = newHourData.map((raw, index) => ({
        id: `temp_0_${index}`,
        latitude: raw[0],
        longitude: raw[1],
        altitude_km: raw[2],
        timestamp,
        hour_offset: 0,
        confidence: 1.0,
        status: 'active' as const,
      }));

      // Add new hour to beginning, remove data older than 24 hours
      this.balloonHistory.unshift(...trackedBalloons);
      this.balloonHistory = this.balloonHistory.filter(
        (b) => this.hoursDiff(b.timestamp, currentTimestamp) < 24
      );

      // Update hour_offset for all existing data
      this.balloonHistory = this.balloonHistory.map((b) => ({
        ...b,
        hour_offset: Math.round(this.hoursDiff(b.timestamp, currentTimestamp)),
      }));

      this.lastUpdateTimestamp = currentTimestamp;
    }

    return this.balloonHistory;
  }

  /**
   * Get current settings (including scheduler status)
   */
  getSettings() {
    return {
      autoUpdateEnabled: this.autoUpdateEnabled,
      lastUpdateTimestamp: this.lastUpdateTimestamp,
      nextScheduledUpdate: this.nextScheduledRun?.toISOString() || null,
      secondsUntilNextUpdate: this.nextScheduledRun
        ? Math.max(0, Math.round((this.nextScheduledRun.getTime() - Date.now()) / 1000))
        : null,
    };
  }

  /**
   * Set auto-update enabled/disabled
   */
  setAutoUpdate(enabled: boolean): void {
    this.autoUpdateEnabled = enabled;
    console.log(`Auto-update ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Force a manual refresh (and trigger immediate cleanup)
   * Useful for testing or immediate data needs
   */
  async forceRefresh(): Promise<BalloonDataPoint[]> {
    console.log('🔄 Manual refresh triggered');

    // Run the hourly update immediately
    await this.runHourlyUpdate();

    return this.getBalloonData();
  }

  /**
   * Trigger immediate update + cleanup (bypasses schedule)
   * Exposed for manual triggers via API
   */
  async triggerImmediateUpdate(): Promise<void> {
    console.log('⚡ Immediate update triggered (manual)');
    await this.runHourlyUpdate();
  }

  /**
   * Get data age in minutes
   */
  getDataAgeMinutes(): number {
    if (!this.lastUpdateTimestamp) return -1;
    const now = new Date();
    const lastUpdate = new Date(this.lastUpdateTimestamp);
    const diffMs = now.getTime() - lastUpdate.getTime();
    return Math.floor(diffMs / (1000 * 60));
  }
}
