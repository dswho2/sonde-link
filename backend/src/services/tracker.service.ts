/**
 * Balloon Tracking Service
 * Implements optimal bipartite matching with Hungarian algorithm
 * Uses velocity continuity to prevent balloon identity swaps
 */

import RBush from 'rbush';
import munkres from 'munkres-js';
import { BalloonDataPoint } from '../types/balloon';
import { IDatabase } from './database.factory';

interface BalloonTreeNode {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  balloon: BalloonDataPoint;
}

const MAX_DISTANCE_KM_PER_HOUR = 600; // Hard limit - extreme polar vortex/jet stream speeds
const TYPICAL_DISTANCE_KM_PER_HOUR = 150; // Typical balloon drift speed for scoring normalization
const MAX_ALTITUDE_DELTA_KM = 10; // Hard gate: balloons can't change altitude by more than 10km/hour
const MAX_DIRECTION_CHANGE_DEG = 45; // Hard gate: balloons follow smooth curves, max 45° change per hour
const EARTH_RADIUS_KM = 6371;

// Scoring weights for normalized cost components (should sum to ~1.0)
// Direction is the PRIMARY factor - balloons follow predictable curved paths
const SCORING_WEIGHTS = {
  distance: 0.15,   // How far from predicted position (quadratic scaling)
  direction: 0.55,  // How much direction changed (dominant factor)
  speed: 0.10,      // How much speed changed
  altitude: 0.20,   // How much altitude changed
};

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
   * Calculate averaged velocity from up to 3 historical positions
   * Uses weighted average: more recent positions have higher weight
   * Returns null if not enough history
   */
  private calculateAveragedVelocity(
    history: BalloonDataPoint[]
  ): { speed_kmh: number; direction_deg: number } | null {
    if (history.length < 2) {
      return null;
    }

    // Sort history by timestamp (oldest first)
    const sorted = [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    // Calculate velocity vectors for each consecutive pair
    const velocities: { speed: number; dirRad: number; weight: number }[] = [];

    for (let i = 1; i < sorted.length; i++) {
      const vel = this.calculateVelocity(sorted[i - 1], sorted[i]);
      // More recent = higher weight (weights: 1, 2, 3 for positions 0-1, 1-2, 2-3)
      const weight = i;
      velocities.push({
        speed: vel.speed_kmh,
        dirRad: vel.direction_deg * (Math.PI / 180),
        weight
      });
    }

    if (velocities.length === 0) {
      return null;
    }

    // Weighted average of speed
    let totalWeight = 0;
    let weightedSpeed = 0;
    let weightedX = 0; // cos component for circular mean
    let weightedY = 0; // sin component for circular mean

    for (const v of velocities) {
      weightedSpeed += v.speed * v.weight;
      weightedX += Math.cos(v.dirRad) * v.weight;
      weightedY += Math.sin(v.dirRad) * v.weight;
      totalWeight += v.weight;
    }

    const avgSpeed = weightedSpeed / totalWeight;
    // Circular mean for direction (handles wraparound correctly)
    let avgDirection = Math.atan2(weightedY, weightedX) * (180 / Math.PI);
    avgDirection = (avgDirection + 360) % 360;

    return { speed_kmh: avgSpeed, direction_deg: avgDirection };
  }

  /**
   * Calculate the matching score between a current balloon and a previous balloon
   * Lower scores indicate better matches
   *
   * Uses normalized scoring with weighted components:
   * - Distance from predicted position (35%)
   * - Direction change (30%)
   * - Speed change (15%)
   * - Altitude change (20%)
   *
   * @param curr - Current balloon position to match
   * @param prev - Previous balloon position (most recent)
   * @param history - Optional array of up to 3 most recent positions for this balloon (including prev)
   * @param debug - Enable debug logging
   */
  private calculateMatchScore(
    curr: BalloonDataPoint,
    prev: BalloonDataPoint,
    history: BalloonDataPoint[] = [],
    debug: boolean = false
  ): number {
    const distance = this.calculateDistance(
      curr.latitude,
      curr.longitude,
      prev.latitude,
      prev.longitude
    );

    // HARD GATE 1: Distance - reject if too far horizontally
    if (distance > MAX_DISTANCE_KM_PER_HOUR) {
      return Infinity;
    }

    // HARD GATE 2: Altitude - reject impossible vertical jumps
    const altitudeDelta = Math.abs(curr.altitude_km - prev.altitude_km);
    if (altitudeDelta > MAX_ALTITUDE_DELTA_KM) {
      return Infinity;
    }

    // Get velocity - prefer averaged velocity from history if available
    let avgVelocity: { speed_kmh: number; direction_deg: number } | null = null;

    if (history.length >= 2) {
      // Use up to last 3 positions for averaged velocity
      avgVelocity = this.calculateAveragedVelocity(history.slice(-3));
    }

    // Fall back to stored velocity on prev if no history available
    const velocity = avgVelocity || (prev.speed_kmh && prev.direction_deg ?
      { speed_kmh: prev.speed_kmh, direction_deg: prev.direction_deg } : null);

    // Predict where the balloon SHOULD be based on velocity
    let predictedLat = prev.latitude;
    let predictedLon = prev.longitude;
    let hasPrediction = false;

    if (velocity && velocity.speed_kmh > 0) {
      hasPrediction = true;
      const distKm = velocity.speed_kmh; // Distance traveled in 1 hour
      const rad = velocity.direction_deg * (Math.PI / 180);
      const latRad = prev.latitude * (Math.PI / 180);

      // Standard bearing: 0° = North, 90° = East
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

    // Calculate the direction from prev to curr
    const impliedVelocity = this.calculateVelocity(prev, curr);

    // HARD GATE 3: Direction - reject extreme direction changes when we have velocity data
    // Balloons follow smooth curved paths; 90°+ changes in one hour indicate wrong match
    let directionChange = 0;
    if (hasPrediction && velocity!.speed_kmh > 10) {
      directionChange = this.angleDifference(velocity!.direction_deg, impliedVelocity.direction_deg);
      if (directionChange > MAX_DIRECTION_CHANGE_DEG) {
        return Infinity;
      }
    }

    // NORMALIZED SCORING STRATEGY:
    // Each component is normalized to 0-1 range, then weighted
    // This makes tuning easier and scoring more predictable

    // 1. Distance score (0-1): How far from predicted/actual position
    // Uses quadratic scaling based on typical speed, so:
    //   - Close matches (< typical) get low scores
    //   - Far matches get progressively higher scores
    //   - Very far matches (approaching max) get scores near 1.0
    // Examples with TYPICAL=150km: 75km->0.25, 150km->1.0, 300km->4.0 (clamped to 1)
    const effectiveDist = hasPrediction ? predictedDist : distance;
    const distanceScore = Math.min(1, Math.pow(effectiveDist / TYPICAL_DISTANCE_KM_PER_HOUR, 2));

    // 2. Direction score (0-1): How much did the heading change
    // Uses cubic scaling - direction is the most important factor for balloon tracking
    // With MAX_DIRECTION_CHANGE_DEG = 45:
    //   15° -> 0.037, 22.5° -> 0.125, 30° -> 0.30, 45° -> 1.0
    let directionScore = 0;
    if (hasPrediction && velocity!.speed_kmh > 10) {
      directionScore = Math.pow(directionChange / MAX_DIRECTION_CHANGE_DEG, 3);
    }

    // 3. Speed score (0-1): How much did the speed change (log scale for ratio)
    let speedScore = 0;
    if (hasPrediction && velocity!.speed_kmh > 10) {
      const speedRatio = impliedVelocity.speed_kmh / velocity!.speed_kmh;
      // Log scale: ratio of 0.5 or 2.0 gives ~0.7, ratio of 0.25 or 4.0 gives ~1.4 (clamped)
      speedScore = Math.min(1, Math.abs(Math.log(speedRatio)) / Math.log(4));
    }

    // 4. Altitude score (0-1): Normalized altitude change with quadratic scaling
    // Small changes are tolerated, large changes penalized more heavily
    const altitudeScore = Math.pow(altitudeDelta / MAX_ALTITUDE_DELTA_KM, 2);

    // Weighted combination
    const normalizedCost =
      SCORING_WEIGHTS.distance * distanceScore +
      SCORING_WEIGHTS.direction * directionScore +
      SCORING_WEIGHTS.speed * speedScore +
      SCORING_WEIGHTS.altitude * altitudeScore;

    // Scale to range comparable with MAX_ACCEPTABLE_COST for threshold checks
    // normalizedCost is 0-1, multiply by 100 to get 0-100 range
    const score = normalizedCost * 100;

    if (debug) {
      console.log(`[Score] ${prev.id} -> curr: dist=${distance.toFixed(1)}km, ` +
        `predictedDist=${predictedDist.toFixed(1)}km (hasPred=${hasPrediction}, histLen=${history.length}), ` +
        `scores=[dist=${distanceScore.toFixed(2)}, dir=${directionScore.toFixed(2)}, ` +
        `spd=${speedScore.toFixed(2)}, alt=${altitudeScore.toFixed(2)}], ` +
        `TOTAL=${score.toFixed(1)}`);
    }

    return score;
  }

  /**
   * Track balloons using a fast two-phase approach:
   * Phase 1: Greedy matching for unambiguous cases (single candidate or clear best match)
   * Phase 2: Hungarian algorithm only for conflicting balloons
   *
   * This is much faster than full Hungarian (O(k³) where k << n) while still
   * resolving swap conflicts properly.
   *
   * @param currentData - Balloon positions at current timestamp
   * @param previousData - Balloon positions at previous timestamp (1 hour ago)
   * @param historyByBalloonId - Optional map of balloon ID -> last 3 positions for better velocity estimation
   */
  trackBalloons(
    currentData: BalloonDataPoint[],
    previousData: BalloonDataPoint[],
    historyByBalloonId: Map<string, BalloonDataPoint[]> = new Map()
  ): BalloonDataPoint[] {
    // Maximum cost threshold - reject matches above this (likely wrong balloon)
    // With normalized scoring (0-100 range), 70 represents a reasonable match
    const MAX_ACCEPTABLE_COST = 70;

    // Stricter threshold for greedy matching (must be clearly good match)
    const GREEDY_COST_THRESHOLD = 30;

    // Maximum altitude delta for greedy matching (stricter than hard gate)
    const GREEDY_ALTITUDE_THRESHOLD = 5;

    if (previousData.length === 0) {
      console.log(`[Tracker] First hour - assigning ${currentData.length} new IDs starting from ${this.nextId}`);
      return currentData.map((balloon) => ({
        ...balloon,
        id: `balloon_${String(this.nextId++).padStart(4, '0')}`,
        status: 'new' as const,
        confidence: 1.0,
      }));
    }

    const timestamp = currentData[0]?.timestamp || 'unknown';
    const startTime = Date.now();

    // Build R-tree for efficient spatial queries
    const tree = new RBush<BalloonTreeNode>();
    const prevNodes: BalloonTreeNode[] = previousData.map((balloon) => ({
      minX: balloon.longitude,
      minY: balloon.latitude,
      maxX: balloon.longitude,
      maxY: balloon.latitude,
      balloon,
    }));
    tree.load(prevNodes);

    const searchRadius = (MAX_DISTANCE_KM_PER_HOUR * 1.5) / 111;

    // Build candidate lists for each current balloon
    type CandidateMatch = { prevIdx: number; prev: BalloonDataPoint; cost: number };
    const candidatesPerCurrent: Map<number, CandidateMatch[]> = new Map();
    const prevIndexMap = new Map<string, number>();
    previousData.forEach((b, i) => prevIndexMap.set(b.id, i));

    for (let currIdx = 0; currIdx < currentData.length; currIdx++) {
      const curr = currentData[currIdx];
      const nearby = tree.search({
        minX: curr.longitude - searchRadius,
        minY: curr.latitude - searchRadius,
        maxX: curr.longitude + searchRadius,
        maxY: curr.latitude + searchRadius,
      });

      const candidates: CandidateMatch[] = [];
      for (const node of nearby) {
        // Get history for this balloon (up to last 3 positions)
        const history = historyByBalloonId.get(node.balloon.id) || [];
        const cost = this.calculateMatchScore(curr, node.balloon, history);
        if (cost < Infinity && cost <= MAX_ACCEPTABLE_COST) {
          const prevIdx = prevIndexMap.get(node.balloon.id)!;
          candidates.push({ prevIdx, prev: node.balloon, cost });
        }
      }
      // Sort by cost (best first)
      candidates.sort((a, b) => a.cost - b.cost);
      candidatesPerCurrent.set(currIdx, candidates);
    }

    // PHASE 1: Greedy matching for unambiguous cases
    const tracked: BalloonDataPoint[] = [];
    const matchedPrevIds = new Set<string>();
    const matchedCurrIndices = new Set<number>();
    const conflictingCurrIndices: number[] = [];

    // BIDIRECTIONAL CONFLICT DETECTION:
    // 1. Track which previous balloons are wanted by multiple current positions
    // 2. Track which current positions are wanted by multiple previous balloons
    // If either is true, defer to Hungarian to resolve optimally

    // Forward: which previous balloons are wanted by multiple currents?
    const prevIdDemand = new Map<string, number>();
    for (let currIdx = 0; currIdx < currentData.length; currIdx++) {
      const candidates = candidatesPerCurrent.get(currIdx) || [];
      if (candidates.length > 0) {
        const bestPrevId = candidates[0].prev.id;
        prevIdDemand.set(bestPrevId, (prevIdDemand.get(bestPrevId) || 0) + 1);
      }
    }

    // Reverse: which current positions are viable for multiple previous balloons?
    // Build a map of currIdx -> set of previous balloons that have this curr in their top candidates
    const currIdxDemand = new Map<number, Set<string>>();
    for (let currIdx = 0; currIdx < currentData.length; currIdx++) {
      const candidates = candidatesPerCurrent.get(currIdx) || [];
      // For each previous balloon that could match to this current position
      for (const candidate of candidates) {
        // Check if this previous balloon's best match is this current position
        // We need to check ALL currents to see which ones this prev balloon could go to
        if (!currIdxDemand.has(currIdx)) {
          currIdxDemand.set(currIdx, new Set());
        }
        currIdxDemand.get(currIdx)!.add(candidate.prev.id);
      }
    }

    // Identify contested current positions (multiple previous balloons could reasonably match)
    const contestedCurrIndices = new Set<number>();
    for (const [currIdx, prevIds] of currIdxDemand) {
      // If more than one previous balloon has this current in their candidates with similar costs
      if (prevIds.size > 1) {
        const candidates = candidatesPerCurrent.get(currIdx) || [];
        if (candidates.length >= 2) {
          // Check if top candidates have similar costs (within 2x of each other)
          const bestCost = candidates[0].cost;
          const competingCount = candidates.filter(c => c.cost < bestCost * 2 && c.cost < 50).length;
          if (competingCount > 1) {
            contestedCurrIndices.add(currIdx);
          }
        }
      }
    }

    // First pass: match balloons that have only one good candidate
    // or whose best candidate is much better than second-best
    for (let currIdx = 0; currIdx < currentData.length; currIdx++) {
      const candidates = candidatesPerCurrent.get(currIdx) || [];
      const curr = currentData[currIdx];

      if (candidates.length === 0) {
        // No candidates - will be marked as new
        continue;
      }

      const best = candidates[0];
      const altDelta = Math.abs(curr.altitude_km - best.prev.altitude_km);

      // Check if multiple currents want this previous balloon - if so, defer to Hungarian
      if (prevIdDemand.get(best.prev.id)! > 1) {
        conflictingCurrIndices.push(currIdx);
        continue;
      }

      // Check if this current position is contested by multiple previous balloons
      if (contestedCurrIndices.has(currIdx)) {
        conflictingCurrIndices.push(currIdx);
        continue;
      }

      if (candidates.length === 1) {
        // Only one candidate - apply strict criteria for greedy acceptance
        if (!matchedPrevIds.has(best.prev.id) &&
            altDelta < GREEDY_ALTITUDE_THRESHOLD &&
            best.cost < GREEDY_COST_THRESHOLD) {
          // Unambiguous, good match
          this.addMatch(tracked, currentData[currIdx], best.prev, best.cost, matchedCurrIndices, matchedPrevIds, currIdx);
        } else {
          // Doesn't meet strict criteria - defer to phase 2
          conflictingCurrIndices.push(currIdx);
        }
      } else {
        // Multiple candidates - check if best is clearly better
        const secondBest = candidates[1];

        // "Clearly better" = best cost is less than half of second-best
        // AND best cost is reasonably low AND altitude is reasonable
        if (best.cost < GREEDY_COST_THRESHOLD &&
            best.cost < secondBest.cost * 0.5 &&
            altDelta < GREEDY_ALTITUDE_THRESHOLD &&
            !matchedPrevIds.has(best.prev.id)) {
          this.addMatch(tracked, currentData[currIdx], best.prev, best.cost, matchedCurrIndices, matchedPrevIds, currIdx);
        } else {
          // Ambiguous - defer to phase 2
          conflictingCurrIndices.push(currIdx);
        }
      }
    }

    // PHASE 2: Hungarian algorithm for conflicting balloons only
    if (conflictingCurrIndices.length > 0) {
      // For each conflicting current balloon, get its remaining valid candidates
      // (candidates that haven't been matched in Phase 1)
      const conflictCandidates: Map<number, CandidateMatch[]> = new Map();
      const allUnmatchedPrevIndices = new Set<number>();

      for (const currIdx of conflictingCurrIndices) {
        const originalCandidates = candidatesPerCurrent.get(currIdx) || [];
        // Filter to only unmatched previous balloons
        const remainingCandidates = originalCandidates.filter(c => !matchedPrevIds.has(c.prev.id));
        conflictCandidates.set(currIdx, remainingCandidates);
        for (const c of remainingCandidates) {
          allUnmatchedPrevIndices.add(c.prevIdx);
        }
      }

      const unmatchedPrevIndices = Array.from(allUnmatchedPrevIndices);

      if (unmatchedPrevIndices.length > 0 && conflictingCurrIndices.length > 0) {
        // Build small cost matrix for conflicts only
        // Use pre-computed costs from candidate lists
        const k = Math.max(conflictingCurrIndices.length, unmatchedPrevIndices.length);
        const INFINITY_COST = 1e9;
        const costMatrix: number[][] = [];

        // Create a lookup for prevIdx -> matrix column
        const prevIdxToCol = new Map<number, number>();
        unmatchedPrevIndices.forEach((prevIdx, col) => prevIdxToCol.set(prevIdx, col));

        for (let i = 0; i < k; i++) {
          const row: number[] = new Array(k).fill(INFINITY_COST);

          if (i < conflictingCurrIndices.length) {
            const currIdx = conflictingCurrIndices[i];
            const candidates = conflictCandidates.get(currIdx) || [];

            for (const candidate of candidates) {
              const col = prevIdxToCol.get(candidate.prevIdx);
              if (col !== undefined) {
                row[col] = candidate.cost; // Use pre-computed cost
              }
            }
          }

          costMatrix.push(row);
        }

        // Run Hungarian on the small conflict matrix
        const assignments = munkres(costMatrix);

        for (const [i, j] of assignments) {
          if (i >= conflictingCurrIndices.length || j >= unmatchedPrevIndices.length) {
            continue;
          }

          const cost = costMatrix[i][j];
          if (cost >= INFINITY_COST) {
            continue;
          }

          const currIdx = conflictingCurrIndices[i];
          const prevIdx = unmatchedPrevIndices[j];

          this.addMatch(
            tracked,
            currentData[currIdx],
            previousData[prevIdx],
            cost,
            matchedCurrIndices,
            matchedPrevIds,
            currIdx
          );
        }
      }
    }

    // Assign new IDs to remaining unmatched current balloons
    for (let i = 0; i < currentData.length; i++) {
      if (!matchedCurrIndices.has(i)) {
        tracked.push({
          ...currentData[i],
          id: `balloon_${String(this.nextId++).padStart(4, '0')}`,
          status: 'new' as const,
          confidence: 0.5,
        });
      }
    }

    const lostCount = previousData.filter(prev => !matchedPrevIds.has(prev.id)).length;
    const elapsed = Date.now() - startTime;

    console.log(
      `[Tracker] ${timestamp}: ${tracked.filter(b => b.status === 'active').length} matched, ` +
      `${tracked.filter(b => b.status === 'new').length} new, ${lostCount} lost ` +
      `(${conflictingCurrIndices.length} conflicts resolved via Hungarian) [${elapsed}ms]`
    );

    this.db.saveTrackedBalloons(tracked);
    return tracked;
  }

  /**
   * Helper to add a match and record velocity
   */
  private addMatch(
    tracked: BalloonDataPoint[],
    curr: BalloonDataPoint,
    prev: BalloonDataPoint,
    cost: number,
    matchedCurrIndices: Set<number>,
    matchedPrevIds: Set<string>,
    currIdx: number
  ): void {
    matchedCurrIndices.add(currIdx);
    matchedPrevIds.add(prev.id);

    const velocity = this.calculateVelocity(prev, curr);

    // Confidence based on physical plausibility using exponential decay
    // cost is 0-100 (normalized), so cost/100 gives 0-1 range
    // Low cost -> high confidence, high cost -> low confidence
    // exp(-0) = 1.0, exp(-2) ≈ 0.14, floored at 0.3
    const normalizedCost = cost / 100;
    const confidence = Math.max(0.3, Math.exp(-normalizedCost * 2));

    // Log significant direction changes (for debugging)
    if (prev.speed_kmh && prev.direction_deg && velocity.speed_kmh > 20) {
      const dirChange = this.angleDifference(prev.direction_deg, velocity.direction_deg);
      if (dirChange > 60) {
        const dist = this.calculateDistance(prev.latitude, prev.longitude, curr.latitude, curr.longitude);
        console.log(`[Tracker WARNING] Balloon ${prev.id} changed direction by ${dirChange.toFixed(0)}° ` +
          `(${prev.direction_deg.toFixed(0)}° -> ${velocity.direction_deg.toFixed(0)}°), ` +
          `speed: ${prev.speed_kmh.toFixed(0)} -> ${velocity.speed_kmh.toFixed(0)} km/h, ` +
          `dist=${dist.toFixed(0)}km, cost=${cost.toFixed(1)}`);
        console.log(`  prev: (${prev.latitude.toFixed(2)}, ${prev.longitude.toFixed(2)}) alt=${prev.altitude_km.toFixed(1)}km`);
        console.log(`  curr: (${curr.latitude.toFixed(2)}, ${curr.longitude.toFixed(2)}) alt=${curr.altitude_km.toFixed(1)}km`);
      }
    }

    tracked.push({
      ...curr,
      id: prev.id,
      speed_kmh: velocity.speed_kmh,
      direction_deg: velocity.direction_deg,
      confidence,
      status: 'active' as const,
    });
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

    // Track history for each balloon (up to last 3 positions) for better velocity estimation
    const historyByBalloonId = new Map<string, BalloonDataPoint[]>();

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
        tracked = this.trackBalloons(currentHourData, previousHourData, historyByBalloonId);
        // trackBalloons now saves to DB
      }

      // Update history for each tracked balloon (keep last 3 positions)
      for (const balloon of tracked) {
        const history = historyByBalloonId.get(balloon.id) || [];
        history.push(balloon);
        // Keep only the last 3 positions
        if (history.length > 3) {
          history.shift();
        }
        historyByBalloonId.set(balloon.id, history);
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
