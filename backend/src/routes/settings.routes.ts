/**
 * Settings API Routes
 * Handle auto-update toggle and manual refresh
 */

import { Router, Request, Response } from 'express';
import { BalloonDataPoint } from '../types/balloon';

// OPTIMIZATION: Use singleton service instances for shared caching
import { windborneService, tracker } from '../services';

const router = Router();

/**
 * GET /api/settings
 * Get current settings (auto-update status, last update time)
 */
router.get('/settings', (req: Request, res: Response) => {
  try {
    const settings = windborneService.getSettings();
    res.json({
      autoUpdateEnabled: settings.autoUpdateEnabled,
      lastUpdateTimestamp: settings.lastUpdateTimestamp,
      dataAgeMinutes: windborneService.getDataAgeMinutes(),
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({
      error: 'Failed to get settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/settings/auto-update
 * Toggle auto-update on/off
 * Body: { enabled: boolean }
 */
router.post('/settings/auto-update', (req: Request, res: Response) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Body must contain "enabled" boolean field',
      });
    }

    windborneService.setAutoUpdate(enabled);

    res.json({
      success: true,
      autoUpdateEnabled: enabled,
      message: `Auto-update ${enabled ? 'enabled' : 'disabled'}`,
    });
  } catch (error) {
    console.error('Error setting auto-update:', error);
    res.status(500).json({
      error: 'Failed to update settings',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/refresh
 * Force manual refresh (catch-up if needed)
 */
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    console.log('Manual refresh requested');
    const rawData = await windborneService.forceRefresh();
    const trackedData = await tracker.processHistoricalData(rawData);
    const currentBalloons = trackedData.filter((b: BalloonDataPoint) => b.hour_offset === 0);

    res.json({
      success: true,
      message: 'Data refreshed successfully',
      updated_at: windborneService.getCurrentTimestamp(),
      balloon_count: currentBalloons.length,
      data_age_minutes: windborneService.getDataAgeMinutes(),
    });
  } catch (error) {
    console.error('Error during manual refresh:', error);
    res.status(500).json({
      error: 'Failed to refresh data',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
