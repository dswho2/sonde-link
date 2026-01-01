/**
 * Singleton Service Instances
 *
 * OPTIMIZATION: Create single shared instances of services across all routes
 * This enables sharing of in-memory caches (balloonHistory, processedDataCache)
 *
 * Before: Each route created new instances -> no cache sharing
 * After: All routes use same instances -> shared cache, reduced DB queries
 */

import { WindborneService } from './windborne.service';
import { BalloonTracker } from './tracker.service';
import { createDatabase } from './database.factory';

// Initialize database (SQLite or Postgres based on env vars)
export const db = createDatabase();

// Initialize tracker
export const tracker = new BalloonTracker(db);

// Initialize tracker's nextId from database
tracker.initialize().catch(err => {
  console.error('Failed to initialize tracker:', err);
});

// Initialize windborne service with injected dependencies
export const windborneService = new WindborneService(db, tracker);
