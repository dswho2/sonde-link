/**
 * Balloon Tracking Service
 * Implements proximity-based tracking with rbush spatial indexing
 * Based on CLAUDE.md algorithm specifications
 */

import RBush from 'rbush';
import { BalloonDataPoint } from '../types/balloon';
import { IDatabase } from './database.factory';

interface BalloonTreeNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  balloon: BalloonDataPoint;
}

const MAX_DISTANCE_KM_PER_HOUR = 300; // Increased from 100km to handle jet stream speeds
const EARTH_RADIUS_KM = 6371;

export class BalloonTracker {
  private nextId = 1;
  private db: IDatabase;
  private trackedBalloons: Map<string, BalloonDataPoint[]> = new Map(); // id -> trajectory history

  // OPTIMIZATION: In-memory cache for processHistoricalData results
  // Keyed by timestamp, reduces DB queries when data hasn't changed
  private processedDataCache: Map<string, BalloonDataPoint[]> = new Map();
  private cacheTimestamp: string | null = null;
  private cacheMaxAge = 600000; // 10 minutes (data updates hourly, so aggressive caching is safe)
  private cacheCreatedAt: number = 0;

  constructor(db?: IDatabase) {
    this.db = db!;
  }

  async initialize() {
    // Initialize nextId from DB to prevent ID reset on restart
    this.nextId = (await this.db.getMaxBalloonId()) + 1;
  }

  /**
   * Reset tracker state (for complete rebuild)
   * Clears all caches and resets ID counter to 1
   */
  resetState(): void {
    console.log('[Tracker] Resetting state...');
    this.nextId = 1;
    this.trackedBalloons.clear();
    this.processedDataCache.clear();
    this.cacheTimestamp = null;
    this.cacheCreatedAt = 0;
    console.log('[Tracker] State reset complete');
  }

  /**
   * Calculate distance between two lat/lon points using Haversine formula
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

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Calculate angular difference between two bearings (0-180 degrees)
   * Handles wraparound (e.g., 350° vs 10° = 20° difference, not 340°)
   */
  private angleDifference(angle1: number, angle2: number): number {
    let diff = Math.abs(angle1 - angle2) % 360;
    if (diff > 180) {
      diff = 360 - diff;
    }
    return diff;
  }

  /**
   * Calculate velocity discontinuity cost for matching a current balloon to a previous one
   * Penalizes matches that would cause unrealistic speed or direction changes
   *
   * @param curr - Current balloon position
   * @param prev - Previous balloon position (candidate match)
   * @returns Cost value (0 = perfect continuity, higher = more discontinuity)
   */
  private calculateVelocityDiscontinuityCost(
    curr: BalloonDataPoint,
    prev: BalloonDataPoint
  ): number {
    // If the previous balloon has no velocity data, we can't assess discontinuity
    // This happens on the first match - give a small penalty to prefer balloons with history
    if (prev.speed_kmh === undefined || prev.direction_deg === undefined) {
      return 10; // Small penalty for no velocity history
    }

    // Calculate what the velocity WOULD be if we match curr to prev
    const impliedVelocity = this.calculateVelocity(prev, curr);

    // 1. Speed discontinuity: penalize large speed changes
    // A balloon shouldn't suddenly change speed by more than ~50%
    const prevSpeed = prev.speed_kmh;
    const newSpeed = impliedVelocity.speed_kmh;

    let speedCost = 0;
    if (prevSpeed > 0) {
      const speedRatio = newSpeed / prevSpeed;
      // Penalize if speed changes by more than 50% (ratio outside 0.5-1.5)
      if (speedRatio < 0.5) {
        // Slowed down too much (e.g., 100 km/h -> 30 km/h)
        speedCost = (0.5 - speedRatio) * 100; // Max ~50 cost
      } else if (speedRatio > 1.5) {
        // Sped up too much (e.g., 100 km/h -> 200 km/h)
        speedCost = (speedRatio - 1.5) * 50; // Scales with how extreme
      }
    } else if (newSpeed > 100) {
      // Previous was stationary but now moving fast - suspicious
      speedCost = 20;
    }

    // 2. Direction discontinuity: penalize sharp turns
    // Stratospheric balloons follow wind patterns - they don't make 90° turns
    const prevDirection = prev.direction_deg;
    const newDirection = impliedVelocity.direction_deg;

    let directionCost = 0;
    // Only penalize direction changes if moving at meaningful speed
    // (direction is meaningless for slow-moving balloons)
    if (prevSpeed > 20 && newSpeed > 20) {
      const angleDiff = this.angleDifference(prevDirection, newDirection);

      // Allow up to 30° change without penalty
      // Penalize increasingly for larger changes
      if (angleDiff > 30) {
        // Quadratic penalty for sharper turns
        directionCost = Math.pow((angleDiff - 30) / 10, 2);
        // Cap at reasonable max
        directionCost = Math.min(directionCost, 100);
      }
    }

    return speedCost + directionCost;
  }

  /**
   * Calculate speed and direction from two consecutive balloon positions
   */
  private calculateVelocity(
    prev: BalloonDataPoint,
    curr: BalloonDataPoint
  ): { speed_kmh: number; direction_deg: number } {
    const distance = this.calculateDistance(
      prev.latitude,
      prev.longitude,
      curr.latitude,
      curr.longitude
    );

    const timeDiffHours =
      (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) /
      (1000 * 60 * 60);

    const speed_kmh = timeDiffHours > 0 ? distance / timeDiffHours : 0;

    // Calculate bearing/direction
    const dLon = this.toRadians(curr.longitude - prev.longitude);
    const lat1 = this.toRadians(prev.latitude);
    const lat2 = this.toRadians(curr.latitude);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let direction_deg = (Math.atan2(y, x) * 180) / Math.PI;
    direction_deg = (direction_deg + 360) % 360; // Normalize to 0-360

    return { speed_kmh, direction_deg };
  }

  /**
   * Track balloons across time using spatial indexing
   * @param currentData - Balloons at time t
   * @param previousData - Balloons at time t-1
   * @returns Updated current data with tracked IDs and velocities
   */
  trackBalloons(
    currentData: BalloonDataPoint[],
    previousData: BalloonDataPoint[]
  ): BalloonDataPoint[] {
    if (previousData.length === 0) {
      // First hour - assign new IDs
      console.log(`[Tracker] First hour - assigning ${currentData.length} new IDs starting from ${this.nextId}`);
      return currentData.map((balloon) => ({
        ...balloon,
        id: `balloon_${String(this.nextId++).padStart(4, '0')}`,
        status: 'new' as const,
        confidence: 1.0,
      }));
    }

    const timestamp = currentData[0]?.timestamp || 'unknown';
    console.log(`[Tracker] Matching ${currentData.length} current balloons (${timestamp}) against ${previousData.length} previous balloons`);

    // Build R-tree spatial index for previous balloons
    const tree = new RBush<BalloonTreeNode>();
    const prevNodes: BalloonTreeNode[] = previousData.map((balloon) => ({
      minX: balloon.longitude,
      minY: balloon.latitude,
      maxX: balloon.longitude,
      maxY: balloon.latitude,
      balloon,
    }));
    tree.load(prevNodes);

    const tracked: BalloonDataPoint[] = [];
    const matchedPrevIds = new Set<string>();

    // Try to match each current balloon with previous balloons
    for (const curr of currentData) {
      // Search in a bounding box around the current balloon
      // Approximate: 1 degree ≈ 111 km, so search within ~2 degrees
      const searchRadius = (MAX_DISTANCE_KM_PER_HOUR * 1.5) / 111;

      const candidates = tree.search({
        minX: curr.longitude - searchRadius,
        minY: curr.latitude - searchRadius,
        maxX: curr.longitude + searchRadius,
        maxY: curr.latitude + searchRadius,
      });

      if (candidates.length === 0) {
        // No nearby balloons - this is a new balloon
        tracked.push({
          ...curr,
          id: `balloon_${String(this.nextId++).padStart(4, '0')}`,
          status: 'new' as const,
          confidence: 0.5, // Lower confidence for new balloons
        });
        continue;
      }

      // Find best match among candidates
      let bestMatch: BalloonTreeNode | null = null;
      let bestScore = Infinity;

      for (const candidate of candidates) {
        if (matchedPrevIds.has(candidate.balloon.id)) {
          continue; // Already matched
        }

        const distance = this.calculateDistance(
          curr.latitude,
          curr.longitude,
          candidate.balloon.latitude,
          candidate.balloon.longitude
        );

        if (distance > MAX_DISTANCE_KM_PER_HOUR) {
          continue; // Too far to be the same balloon
        }

        // Calculate altitude change
        const altChange = Math.abs(curr.altitude_km - candidate.balloon.altitude_km);

        // Improved Scoring: Use velocity to predict where candidate SHOULD be
        let predictedLat = candidate.balloon.latitude;
        let predictedLon = candidate.balloon.longitude;

        if (candidate.balloon.speed_kmh && candidate.balloon.direction_deg) {
          // Simple projection: 1 hour movement
          // We could use trajectory service here but that creates circular dependency
          // Just use simple approximation is enough for matching
          const distKm = candidate.balloon.speed_kmh;
          const rad = candidate.balloon.direction_deg * (Math.PI / 180);
          const latRad = candidate.balloon.latitude * (Math.PI / 180);

          // dLat = (dist * cos(heading)) / R
          // dLon = (dist * sin(heading)) / (R * cos(lat))
          const dLat = (distKm * Math.cos(rad)) / EARTH_RADIUS_KM;
          const dLon = (distKm * Math.sin(rad)) / (EARTH_RADIUS_KM * Math.cos(latRad));

          predictedLat += dLat * (180 / Math.PI);
          predictedLon += dLon * (180 / Math.PI);
        }

        const predictedDist = this.calculateDistance(
          curr.latitude,
          curr.longitude,
          predictedLat,
          predictedLon
        );

        // Calculate velocity discontinuity cost
        // This penalizes matches that would cause unrealistic speed/direction changes
        const velocityDiscontinuityCost = this.calculateVelocityDiscontinuityCost(
          curr,
          candidate.balloon
        );

        // Score combines:
        // 1. Distance from predicted position (primary factor)
        // 2. Altitude change penalty (avoid jumping between atmospheric layers)
        // 3. Velocity discontinuity penalty (maintain trajectory smoothness)
        const score = predictedDist + altChange * 10 + velocityDiscontinuityCost;

        if (score < bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }

      if (bestMatch) {
        // Found a match
        matchedPrevIds.add(bestMatch.balloon.id);

        const velocity = this.calculateVelocity(bestMatch.balloon, curr);
        const confidence = Math.max(
          0.5,
          1.0 - bestScore / MAX_DISTANCE_KM_PER_HOUR
        ); // Closer = higher confidence

        tracked.push({
          ...curr,
          id: bestMatch.balloon.id,
          speed_kmh: velocity.speed_kmh,
          direction_deg: velocity.direction_deg,
          confidence,
          status: 'active' as const,
        });
      } else {
        // No match found - new balloon
        tracked.push({
          ...curr,
          id: `balloon_${String(this.nextId++).padStart(4, '0')}`,
          status: 'new' as const,
          confidence: 0.5,
        });
      }
    }

    // Mark balloons that disappeared as 'lost'
    const lostBalloons: BalloonDataPoint[] = previousData
      .filter((prev) => !matchedPrevIds.has(prev.id))
      .map((balloon) => ({
        ...balloon,
        status: 'lost' as const,
        confidence: 0.3,
      }));

    console.log(
      `Tracking: ${tracked.length} tracked, ${lostBalloons.length} lost, ${tracked.filter((b) => b.status === 'new').length
      } new`
    );

    this.db.saveTrackedBalloons(tracked); // Persist tracking results

    return tracked;
  }

  /**
   * Process all historical data to assign consistent IDs across time
   * OPTIMIZED: Uses in-memory cache to avoid reprocessing when data hasn't changed
   */
  async processHistoricalData(allData: BalloonDataPoint[]): Promise<BalloonDataPoint[]> {
    // Get current timestamp to use as cache key
    const currentTimestamp = allData[0]?.timestamp || new Date().toISOString();
    const now = Date.now();

    // Check if cache is valid and fresh
    const cacheAge = now - this.cacheCreatedAt;
    const cacheValid =
      this.cacheTimestamp === currentTimestamp &&
      this.processedDataCache.size > 0 &&
      cacheAge < this.cacheMaxAge;

    if (cacheValid) {
      console.log(`Returning cached processed data (age: ${Math.round(cacheAge / 1000)}s, ${this.processedDataCache.size} hours cached)`);
      return Array.from(this.processedDataCache.values()).flat();
    }

    // Cache miss - process data
    console.log(`Cache miss - processing historical data (timestamp: ${currentTimestamp})`);

    // Group by hour_offset
    const byHour = new Map<number, BalloonDataPoint[]>();

    for (const balloon of allData) {
      const hour = balloon.hour_offset;
      if (!byHour.has(hour)) {
        byHour.set(hour, []);
      }
      byHour.get(hour)!.push(balloon);
    }

    // Process from oldest to newest (hour 23 -> hour 0)
    const sortedHours = Array.from(byHour.keys()).sort((a, b) => b - a);

    let previousHourData: BalloonDataPoint[] = [];
    const processedData: BalloonDataPoint[] = [];

    for (const hour of sortedHours) {
      const currentHourData = byHour.get(hour)!;

      // Check if we already interpreted this hour in DB
      const timestamp = currentHourData[0].timestamp;
      const existingTracking = await this.db.getTrackedBalloonsAtTimestamp(timestamp);

      let tracked: BalloonDataPoint[];

      if (existingTracking && existingTracking.length > 0) {
        console.log(`Loaded ${existingTracking.length} balloons from DB for ${timestamp}`);

        // CRITICAL FIX: Recalculate hour_offset based on current time
        // The stored hour_offset is stale and relative to when it was saved
        const currentTime = new Date(currentTimestamp);
        const balloonTime = new Date(timestamp);
        const hoursDiff = Math.round((currentTime.getTime() - balloonTime.getTime()) / (1000 * 60 * 60));

        tracked = existingTracking.map((b: BalloonDataPoint) => ({
          ...b,
          hour_offset: hoursDiff
        }));

        // Ensure nextId is ahead of any loaded IDs (handle restart continuity)
        const maxId = existingTracking.reduce((max: number, b: BalloonDataPoint) => {
          const numId = parseInt(b.id.replace('balloon_', ''));
          return isNaN(numId) ? max : Math.max(max, numId);
        }, 0);
        if (maxId >= this.nextId) {
          this.nextId = maxId + 1;
        }
      } else {
        console.log(`Processing NEW hour ${timestamp} with ${previousHourData.length} previous balloons`);
        if (previousHourData.length > 0) {
          const samplePrevIds = previousHourData.slice(0, 3).map(b => b.id).join(', ');
          console.log(`  Sample previous balloon IDs: ${samplePrevIds}`);
        }
        tracked = this.trackBalloons(currentHourData, previousHourData);
        // trackBalloons now saves to DB
      }

      processedData.push(...tracked);
      previousHourData = tracked;

      // Store in cache by hour for future retrieval
      this.processedDataCache.set(`hour_${hour}`, tracked);
    }

    console.log(
      `Processed ${processedData.length} balloons with ${this.nextId - 1} unique IDs`
    );

    // Update cache metadata
    this.cacheTimestamp = currentTimestamp;
    this.cacheCreatedAt = Date.now();

    return processedData;
  }

  /**
   * Get balloons at a specific timestamp from database
   */
  async getBalloonsAtTimestamp(timestamp: string): Promise<BalloonDataPoint[]> {
    const balloons = await this.db.getTrackedBalloonsAtTimestamp(timestamp);

    // Recalculate hour_offset based on current time
    const currentTime = new Date();
    const balloonTime = new Date(timestamp);
    const hoursDiff = Math.round((currentTime.getTime() - balloonTime.getTime()) / (1000 * 60 * 60));

    return balloons.map((b: BalloonDataPoint) => ({
      ...b,
      hour_offset: hoursDiff
    }));
  }

  /**
   * Get trajectory for a specific balloon directly from database
   * OPTIMIZED: Loads only ~24 records instead of calling processHistoricalData (24,000 records)
   */
  async getBalloonTrajectoryFromDB(balloonId: string): Promise<BalloonDataPoint[]> {
    const positions = await this.db.getBalloonTrajectory(balloonId);

    // Recalculate hour_offset based on current time
    const currentTime = new Date();
    return positions.map((p: BalloonDataPoint) => {
      const balloonTime = new Date(p.timestamp);
      const hoursDiff = Math.round((currentTime.getTime() - balloonTime.getTime()) / (1000 * 60 * 60));
      return { ...p, hour_offset: hoursDiff };
    });
  }

  /**
   * Get trajectory for a specific balloon (from already-loaded data)
   * NOTE: Prefer getBalloonTrajectoryFromDB() for better performance
   */
  getBalloonTrajectory(
    allData: BalloonDataPoint[],
    balloonId: string
  ): BalloonDataPoint[] {
    return allData
      .filter((b) => b.id === balloonId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Oldest first
  }

  /**
   * Get all unique balloon IDs
   */
  getUniqueBalloonIds(allData: BalloonDataPoint[]): string[] {
    return [...new Set(allData.map((b) => b.id))];
  }
}
