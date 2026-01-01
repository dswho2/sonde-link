/**
 * Custom hook for fetching and managing trajectory data
 */

import { useState, useEffect, useCallback } from 'react';
import { balloonApi } from '../services/api';
import type { BalloonTrajectory, TrajectoryOptions, PredictionMethod } from '../types/balloon';

interface UseTrajectoryDataOptions {
  enabled?: boolean;
  limit?: number;
  predictionHours?: number;
  predictionMethod?: PredictionMethod;
  refreshInterval?: number; // in milliseconds
}

export function useTrajectoryData(options: UseTrajectoryDataOptions = {}) {
  const {
    enabled = false,
    limit = 10,
    predictionHours = 3,
    predictionMethod = 'hybrid',
    refreshInterval = 60000, // 1 minute default
  } = options;

  const [trajectories, setTrajectories] = useState<BalloonTrajectory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchTrajectories = useCallback(async () => {
    if (!enabled) {
      setTrajectories([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const trajectoryOptions: TrajectoryOptions = {
        hours: predictionHours,
        method: predictionMethod,
        limit,
      };

      const response = await balloonApi.getMultipleTrajectories(trajectoryOptions);

      // Extract trajectory objects from the response
      const trajData = response.trajectories.map((t) => t.trajectory);

      setTrajectories(trajData);
      setLastUpdated(new Date());
      console.log(`Fetched ${trajData.length} trajectories`);
    } catch (err) {
      console.error('Error fetching trajectories:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch trajectories'));
      setTrajectories([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, limit, predictionHours, predictionMethod]);

  // Initial fetch
  useEffect(() => {
    fetchTrajectories();
  }, [fetchTrajectories]);

  // Auto-refresh at interval
  useEffect(() => {
    if (!enabled || !refreshInterval) return;

    const intervalId = setInterval(() => {
      fetchTrajectories();
    }, refreshInterval);

    return () => clearInterval(intervalId);
  }, [enabled, refreshInterval, fetchTrajectories]);

  return {
    trajectories,
    loading,
    error,
    lastUpdated,
    refetch: fetchTrajectories,
  };
}

/**
 * Hook for fetching a single balloon trajectory
 */
export function useBalloonTrajectory(
  balloonId: string | null,
  options: Omit<UseTrajectoryDataOptions, 'limit'> = {}
) {
  const {
    enabled = false,
    predictionHours = 3,
    predictionMethod = 'hybrid',
  } = options;

  const [trajectory, setTrajectory] = useState<BalloonTrajectory | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchTrajectory = useCallback(async () => {
    if (!enabled || !balloonId) {
      setTrajectory(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const trajectoryOptions: TrajectoryOptions = {
        hours: predictionHours,
        method: predictionMethod,
      };

      const response = await balloonApi.getTrajectory(balloonId, trajectoryOptions);
      setTrajectory(response.trajectory);
      console.log(`Fetched trajectory for balloon ${balloonId}`);
    } catch (err) {
      console.error(`Error fetching trajectory for ${balloonId}:`, err);
      setError(err instanceof Error ? err : new Error('Failed to fetch trajectory'));
      setTrajectory(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, balloonId, predictionHours, predictionMethod]);

  useEffect(() => {
    fetchTrajectory();
  }, [fetchTrajectory]);

  return {
    trajectory,
    loading,
    error,
    refetch: fetchTrajectory,
  };
}
