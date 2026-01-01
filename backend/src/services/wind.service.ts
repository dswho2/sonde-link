/**
 * Wind Data Service using Open-Meteo API
 * Provides upper-air wind data at pressure levels for trajectory prediction
 *
 * Open-Meteo API: https://open-meteo.com/en/docs
 * - Free and open-source
 * - No API key required
 * - Provides wind data at 20 atmospheric pressure levels (up to 22km altitude)
 */

import axios from 'axios';
import { DatabaseService } from './database.service';

const OPEN_METEO_API = 'https://api.open-meteo.com/v1/forecast';

// Pressure levels available in Open-Meteo (in hPa)
// Lower pressure = higher altitude
const PRESSURE_LEVELS = [
  1000, // ~100m
  975,  // ~500m
  950,  // ~800m
  925,  // ~1km
  900,  // ~1.3km
  850,  // ~1.5km
  800,  // ~2km
  700,  // ~3km
  600,  // ~4.2km
  500,  // ~5.6km
  400,  // ~7.2km
  300,  // ~9.2km
  250,  // ~10.4km
  200,  // ~11.8km
  150,  // ~13.6km
  100,  // ~16km
  70,   // ~18km
  50,   // ~20km
  30,   // ~22km
];

export interface WindData {
  latitude: number;
  longitude: number;
  altitude_km: number;
  pressure_hpa: number;
  wind_u_ms: number;  // East-West wind component (m/s)
  wind_v_ms: number;  // North-South wind component (m/s)
  wind_speed_kmh: number;
  wind_direction_deg: number;
  timestamp: string;
}

interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  generationtime_ms: number;
  utc_offset_seconds: number;
  timezone: string;
  timezone_abbreviation: string;
  hourly_units: Record<string, string>;
  hourly: {
    time: string[];
    [key: string]: any; // Pressure level wind components
  };
}

interface CachedWindData {
  data: WindData;
  timestamp: number;
}

export class WindService {
  private db: DatabaseService;
  private readonly CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

  constructor() {
    this.db = new DatabaseService();
  }

  /**
   * Check if cached data is still valid
   */
  private isCacheValid(timestamp: number): boolean {
    return Date.now() - timestamp < this.CACHE_TTL_MS;
  }

  /**
   * Clear expired cache entries
   */
  private cleanCache(): void {
    this.db.clearExpiredWindCache(this.CACHE_TTL_MS);
  }

  /**
   * Convert altitude (km) to approximate pressure level (hPa)
   * Using standard atmosphere approximation
   */
  private altitudeToPressure(altitude_km: number): number {
    // Standard atmosphere: P ≈ P0 * exp(-h/H)
    // P0 = 1013 hPa (sea level), H ≈ 7.4 km (scale height)
    const P0 = 1013.25;
    const H = 7.4;
    const pressure = P0 * Math.exp(-altitude_km / H);

    // Find closest available pressure level
    return PRESSURE_LEVELS.reduce((prev, curr) => {
      return Math.abs(curr - pressure) < Math.abs(prev - pressure) ? curr : prev;
    });
  }

  /**
   * Convert pressure (hPa) to approximate altitude (km)
   */
  private pressureToAltitude(pressure_hpa: number): number {
    const P0 = 1013.25;
    const H = 7.4;
    return -H * Math.log(pressure_hpa / P0);
  }

  /**
   * Fetch wind data for a specific location, altitude, and time (with caching)
   * @param timestamp - ISO string. If provided, fetches wind for that time. If null, uses current time.
   */
  async getWindAtLocation(
    latitude: number,
    longitude: number,
    altitude_km: number,
    timestamp?: string
  ): Promise<WindData | null> {
    const targetDate = timestamp ? new Date(timestamp) : new Date();
    // Round to nearest hour
    targetDate.setMinutes(0, 0, 0);
    const targetTimeMs = targetDate.getTime();

    // Check cache first
    // Note: We might need to include timestamp in cache key or query
    // Our DB schema has `timestamp` column but `getWindCache` currently queries by lat/lon/alt only.
    // It returns a SINGLE row. This is problematic if we cache multiple times for same location.
    // However, the current schema is `PRIMARY KEY (lat, lon, altitude_km)`.
    // It assumes "latest" wind.
    // For historical/time-based wind, we need a better cache or just ignore cache for now to keep it simple.
    // Or, simpler: The current cache is "Current Conditions".
    // If asking for specific time, skip this simple cache or upgrade schema.
    // Plan says "ensure WindService correctly caches".
    // I'll skip cache for non-current-hour requests for this iteration to avoid schema changes.
    // Or efficiently: Open-Meteo returns 24h+ data. We can cache the WHOLE thing?
    // Storage is "data TEXT". We could store the whole array.
    // But `WindData` is a single object.

    // DECISION: For this MVP step, only cache "current" wind. 
    // Historical/Future requests go to API (Open-Meteo is fast).
    // Future improvement: Cache by (lat, lon, alt, time).

    // Check if target is "close enough" to now to use simple cache
    const isNow = Math.abs(Date.now() - targetTimeMs) < 60 * 60 * 1000;

    if (isNow) {
      const cached = this.db.getWindCache(latitude, longitude, altitude_km);
      if (cached && this.isCacheValid(cached.timestamp)) {
        // Check if cached data timestamp matches target (roughly)
        // Actually cached.data.timestamp is the forecast time.
        const cachedTime = new Date(cached.data.timestamp).getTime();
        if (Math.abs(cachedTime - targetTimeMs) < 60 * 60 * 1000) {
          console.log(`Cache hit for ${latitude.toFixed(1)},${longitude.toFixed(1)}`);
          return cached.data;
        }
      }
    }

    // Periodically clean expired cache entries (every 100 requests)
    if (Math.random() < 0.01) {
      this.cleanCache();
    }

    try {
      const pressure = this.altitudeToPressure(altitude_km);

      // Determine parameters based on target time
      // Open-Meteo "forecast_days=1" gives from 00:00 today to 23:00 today.
      // If target is yesterday, we need "past_days".
      // If target is tomorrow, we need more forecast days.

      const now = new Date();
      const diffDays = (targetTimeMs - now.getTime()) / (1000 * 60 * 60 * 24);

      let past_days = 0;
      let forecast_days = 1;

      if (diffDays < 0) {
        past_days = Math.ceil(Math.abs(diffDays)) + 1; // +1 buffer
      } else if (diffDays > 1) {
        forecast_days = Math.ceil(diffDays) + 1;
      }

      // Limit to reasonable bounds
      past_days = Math.min(past_days, 3);
      forecast_days = Math.min(forecast_days, 3);

      // Build API request for wind at this pressure level
      const params = new URLSearchParams({
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        hourly: `wind_speed_${pressure}hPa,wind_direction_${pressure}hPa`,
        forecast_days: forecast_days.toString(),
        past_days: past_days.toString(),
        timezone: 'UTC',
      });

      const response = await axios.get<OpenMeteoResponse>(
        `${OPEN_METEO_API}?${params}`,
        { timeout: 10000 }
      );

      // Extract current hour data
      const windSpeedKey = `wind_speed_${pressure}hPa`;
      const windDirectionKey = `wind_direction_${pressure}hPa`;

      if (!response.data.hourly[windSpeedKey] || !response.data.hourly[windDirectionKey]) {
        console.error(`Wind data not available for ${pressure}hPa`);
        return null;
      }

      // Find the index matching targetTime
      // times are ISO strings "2023-10-27T10:00"
      const times = response.data.hourly.time;
      let matchIndex = -1;

      // Open-Meteo returns standard ISO? No, usually "YYYY-MM-DDThh:mm".
      // We need to compare carefully.
      // Convert target to ISO string prefix "YYYY-MM-DDThh:00"
      // Simplest is to loop and compare timestamps

      let minDiff = Infinity;

      for (let i = 0; i < times.length; i++) {
        // Open-Meteo time is local or UTC? We requested 'UTC'.
        // format: 2023-10-27T10:00
        const t = new Date(times[i] + 'Z').getTime(); // Add Z for UTC
        const diff = Math.abs(t - targetTimeMs);
        if (diff < minDiff) {
          minDiff = diff;
          matchIndex = i;
        }
      }

      if (matchIndex === -1 || minDiff > 90 * 60 * 1000) {
        console.warn(`No matching wind data found for ${targetDate.toISOString()} (closest diff: ${minDiff / 1000 / 60}m)`);
        return null;
      }

      const wind_speed_kmh = response.data.hourly[windSpeedKey][matchIndex];
      const windDirection_deg = response.data.hourly[windDirectionKey][matchIndex];
      const actualTimestamp = response.data.hourly.time[matchIndex] + 'Z';

      // Convert wind speed/direction to U/V components
      const windSpeed_ms = wind_speed_kmh / 3.6;
      const direction_rad = (windDirection_deg * Math.PI) / 180;

      // Wind direction is "from" direction, so we need to reverse it for vector
      const wind_u_ms = -windSpeed_ms * Math.sin(direction_rad);
      const wind_v_ms = -windSpeed_ms * Math.cos(direction_rad);

      const windData: WindData = {
        latitude,
        longitude,
        altitude_km,
        pressure_hpa: pressure,
        wind_u_ms,
        wind_v_ms,
        wind_speed_kmh,
        wind_direction_deg: windDirection_deg,
        timestamp: actualTimestamp,
      };

      // Only cache if it is "current" data (to fit schema limitations)
      if (isNow) {
        this.db.setWindCache(windData);
        console.log(`Cache miss - fetched and cached ${latitude},${longitude}`);
      }

      return windData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`Failed to fetch wind data:`, error.message);
      } else {
        console.error(`Unexpected error fetching wind data:`, error);
      }
      return null;
    }
  }

  /**
   * Fetch wind data for multiple locations using Open-Meteo's batch API
   * Open-Meteo supports up to 1000 locations in a single request!
   * Format: &latitude=47.1,49.7&longitude=8.6,9.4
   *
   * @param locations - Array of locations with optional timestamp for historical data
   */
  async getWindAtMultipleLocations(
    locations: Array<{ latitude: number; longitude: number; altitude_km: number; timestamp?: string }>
  ): Promise<Map<string, WindData>> {
    const windDataMap = new Map<string, WindData>();

    if (locations.length === 0) {
      return windDataMap;
    }

    // Group locations by PRESSURE LEVEL ONLY (not timestamp)
    // This allows batching all timestamps together into a single request using past_days
    interface LocationGroup {
      pressure: number;
      locations: typeof locations;
      minTimestamp: string | null;
      maxTimestamp: string | null;
    }

    const locationGroups = new Map<number, LocationGroup>();

    locations.forEach((loc) => {
      const pressure = this.altitudeToPressure(loc.altitude_km);
      const timestamp = loc.timestamp || null;

      // Round timestamp to nearest hour
      let roundedTimestamp = timestamp;
      if (timestamp) {
        const date = new Date(timestamp);
        date.setMinutes(0, 0, 0);
        roundedTimestamp = date.toISOString();
      }

      if (!locationGroups.has(pressure)) {
        locationGroups.set(pressure, {
          pressure,
          locations: [],
          minTimestamp: roundedTimestamp,
          maxTimestamp: roundedTimestamp,
        });
      }

      const group = locationGroups.get(pressure)!;
      group.locations.push(loc);

      // Track time range for this pressure group
      if (roundedTimestamp) {
        if (!group.minTimestamp || roundedTimestamp < group.minTimestamp) {
          group.minTimestamp = roundedTimestamp;
        }
        if (!group.maxTimestamp || roundedTimestamp > group.maxTimestamp) {
          group.maxTimestamp = roundedTimestamp;
        }
      }
    });

    console.log(`Fetching wind data for ${locations.length} locations across ${locationGroups.size} pressure groups`);

    // Process each pressure group
    for (const group of locationGroups.values()) {
      const { pressure, minTimestamp, maxTimestamp, locations: locs } = group;

      // Open-Meteo supports up to 1000 locations per request
      // URL length limits (usually 8KB for most servers):
      // Each location adds ~20 chars: "lat,lon," = ~15-20 chars
      // 500 locations × 20 chars = ~10KB, which might be tight
      // 300 locations × 20 chars = ~6KB (safe for most servers)
      const BATCH_SIZE = 300; // Increased from 50 to reduce API calls
      const totalBatches = Math.ceil(locs.length / BATCH_SIZE);

      // Determine past_days and forecast_days based on time range
      // Use the OLDEST timestamp to calculate past_days, which will cover the entire range
      let past_days = 0;
      let forecast_days = 1;

      if (minTimestamp) {
        const now = new Date();
        const oldestTime = new Date(minTimestamp);
        const newestTime = maxTimestamp ? new Date(maxTimestamp) : oldestTime;

        // Calculate based on oldest timestamp
        const diffDaysOldest = (oldestTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        const diffDaysNewest = (newestTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

        if (diffDaysNewest < 0) {
          // All historical data - use oldest time to determine how far back
          past_days = Math.ceil(Math.abs(diffDaysOldest)) + 1;
        } else if (diffDaysOldest > 1) {
          // All future forecast
          forecast_days = Math.ceil(diffDaysNewest) + 1;
        } else {
          // Mixed - spans current time
          past_days = diffDaysOldest < 0 ? Math.ceil(Math.abs(diffDaysOldest)) + 1 : 0;
          forecast_days = diffDaysNewest > 0 ? Math.ceil(diffDaysNewest) + 1 : 1;
        }

        // Limit to reasonable bounds (Open-Meteo limits)
        past_days = Math.min(past_days, 3);
        forecast_days = Math.min(forecast_days, 3);

        console.log(`📅 Time range: ${minTimestamp} to ${maxTimestamp || minTimestamp} (past_days=${past_days}, forecast_days=${forecast_days})`);
      }

      for (let i = 0; i < locs.length; i += BATCH_SIZE) {
        const batch = locs.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;

        // Build comma-separated lat/lon lists
        const latitudes = batch.map(loc => loc.latitude.toFixed(2)).join(',');
        const longitudes = batch.map(loc => loc.longitude.toFixed(2)).join(',');

        try {
          const params = new URLSearchParams({
            latitude: latitudes,
            longitude: longitudes,
            hourly: `wind_speed_${pressure}hPa,wind_direction_${pressure}hPa`,
            forecast_days: forecast_days.toString(),
            past_days: past_days.toString(),
            timezone: 'UTC',
            format: 'json', // Explicitly request JSON format
          });

          console.log(`📍 Batch ${batchNum}/${totalBatches}: Requesting ${batch.length} locations at ${pressure}hPa from Open-Meteo...`);

          const response = await axios.get<any>(
            `${OPEN_METEO_API}?${params}`,
            {
              timeout: 30000, // Longer timeout for batch requests
              headers: {
                'Accept': 'application/json'
              }
            }
          );

          // Response is an array when multiple locations are requested
          const results = Array.isArray(response.data) ? response.data : [response.data];

          results.forEach((data, index) => {
            if (!data.hourly) return;

            const windSpeedKey = `wind_speed_${pressure}hPa`;
            const windDirectionKey = `wind_direction_${pressure}hPa`;

            if (!data.hourly[windSpeedKey] || !data.hourly[windDirectionKey]) {
              return;
            }

            const loc = batch[index];

            // If a specific timestamp was requested for this location, find the matching hour in the response
            let hourIndex = 0;
            if (loc.timestamp) {
              // Round to nearest hour
              const locDate = new Date(loc.timestamp);
              locDate.setMinutes(0, 0, 0);
              const targetTime = locDate.getTime();
              const times = data.hourly.time;

              let minDiff = Infinity;
              for (let j = 0; j < times.length; j++) {
                const timeStr = times[j] + (times[j].endsWith('Z') ? '' : 'Z');
                const t = new Date(timeStr).getTime();
                const diff = Math.abs(t - targetTime);
                if (diff < minDiff) {
                  minDiff = diff;
                  hourIndex = j;
                }
              }

              // If no close match found (> 90 minutes difference), skip this location
              if (minDiff > 90 * 60 * 1000) {
                console.warn(`No matching wind data for ${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)} at ${loc.timestamp}`);
                return;
              }
            }

            const wind_speed_kmh = data.hourly[windSpeedKey][hourIndex];
            const windDirection_deg = data.hourly[windDirectionKey][hourIndex];
            const timestamp = data.hourly.time[hourIndex] + (data.hourly.time[hourIndex].endsWith('Z') ? '' : 'Z');

            if (wind_speed_kmh == null || windDirection_deg == null) {
              return;
            }

            // Convert to U/V components
            const windSpeed_ms = wind_speed_kmh / 3.6;
            const direction_rad = (windDirection_deg * Math.PI) / 180;
            const wind_u_ms = -windSpeed_ms * Math.sin(direction_rad);
            const wind_v_ms = -windSpeed_ms * Math.cos(direction_rad);

            // Build key with timestamp if provided
            const key = loc.timestamp
              ? `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)},${loc.altitude_km.toFixed(1)},${loc.timestamp}`
              : `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)},${loc.altitude_km.toFixed(1)}`;

            windDataMap.set(key, {
              latitude: loc.latitude,
              longitude: loc.longitude,
              altitude_km: loc.altitude_km,
              pressure_hpa: pressure,
              wind_u_ms,
              wind_v_ms,
              wind_speed_kmh,
              wind_direction_deg: windDirection_deg,
              timestamp,
            });
          });

          console.log(`   ✓ Successfully fetched ${results.length} locations`);

          // Add delay between batches to avoid rate limits
          if (i + BATCH_SIZE < locs.length) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between batches
          }
        } catch (error) {
          if (axios.isAxiosError(error)) {
            if (error.response?.status === 429) {
              console.error(`⚠️  Rate limit (429) hit - waiting 10 seconds before retry...`);
              // Wait longer when we hit rate limit, then retry this batch
              await new Promise(resolve => setTimeout(resolve, 10000));

              // Don't retry for now - just log and continue
              console.error(`   Skipping batch due to rate limit`);
            } else {
              console.error(`❌ Failed to fetch batch wind data: ${error.message}`);
              console.error(`   Status: ${error.response?.status}, URL length: ${error.config?.url?.length || 'unknown'}`);
            }
          } else {
            console.error(`❌ Unexpected error fetching batch wind data:`, error);
          }
        }
      }
    }

    console.log(`Successfully fetched wind data for ${windDataMap.size}/${locations.length} locations`);
    return windDataMap;
  }

  /**
   * Get available pressure levels and their approximate altitudes
   */
  getPressureLevels(): Array<{ pressure_hpa: number; altitude_km: number }> {
    return PRESSURE_LEVELS.map((pressure) => ({
      pressure_hpa: pressure,
      altitude_km: this.pressureToAltitude(pressure),
    }));
  }

  /**
   * Get cache statistics (useful for monitoring)
   */
  getCacheStats(): { size: number; validEntries: number; expiredEntries: number } {
    // Not implemented fully for DB yet
    return {
      size: 0,
      validEntries: 0,
      expiredEntries: 0,
    };
  }

  /**
   * Clear all cached wind data (useful for testing or forced refresh)
   */
  clearCache(): void {
    this.db.clearExpiredWindCache(0); // Clear everything
    console.log('Wind data cache cleared');
  }
}
