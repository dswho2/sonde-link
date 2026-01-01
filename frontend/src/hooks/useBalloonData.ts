/**
 * Custom hook for managing balloon data with React Query caching
 * OPTIMIZED: Uses React Query for client-side caching (5 min staleTime)
 * This eliminates redundant queries during autoplay (second loop = 0 queries)
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { balloonApi } from '../services/api';

export function useBalloonData(hourOffset?: number) {
  // Fetch balloons with React Query caching
  const {
    data: balloonsData,
    isLoading: isBalloonsLoading,
    error: balloonsError,
  } = useQuery({
    queryKey: ['balloons', hourOffset],
    queryFn: () => balloonApi.getBalloons(hourOffset),
    staleTime: 300000, // 5 minutes (safe since data updates hourly)
  });

  // Fetch settings
  const {
    data: settingsData,
    isLoading: isSettingsLoading,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: () => balloonApi.getSettings(),
    staleTime: 60000, // 1 minute
  });

  return {
    balloons: balloonsData?.balloons || [],
    settings: settingsData || null,
    isLoading: isBalloonsLoading || isSettingsLoading,
    error: balloonsError instanceof Error ? balloonsError.message : null,
    dataAge: balloonsData?.data_age_minutes ?? -1,
  };
}

/**
 * Hook to preload all 24 hours of balloon data in the background
 * Returns preload status for optional UI feedback
 */
export function usePreloadBalloonData() {
  const queryClient = useQueryClient();
  const [preloadStatus, setPreloadStatus] = useState<{
    isPreloading: boolean;
    loadedHours: number;
    totalHours: number;
    errors: number;
  }>({
    isPreloading: false,
    loadedHours: 0,
    totalHours: 24,
    errors: 0,
  });

  const preloadAllHours = useCallback(async () => {
    setPreloadStatus({
      isPreloading: true,
      loadedHours: 0,
      totalHours: 24,
      errors: 0,
    });

    // Prefetch all 24 hours (0-23)
    const hoursToPrefetch = Array.from({ length: 24 }, (_, i) => i);

    // Prefetch all hours in parallel
    const prefetchPromises = hoursToPrefetch.map((hourOffset) =>
      queryClient.prefetchQuery({
        queryKey: ['balloons', hourOffset],
        queryFn: () => balloonApi.getBalloons(hourOffset),
        staleTime: 300000, // 5 minutes (matches useBalloonData)
      })
    );

    // Use allSettled for graceful degradation
    const results = await Promise.allSettled(prefetchPromises);

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    // Log failures for debugging
    if (failed > 0) {
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.error(`Failed to prefetch hour ${hoursToPrefetch[index]}:`, result.reason);
        }
      });
    }

    setPreloadStatus({
      isPreloading: false,
      loadedHours: successful,
      totalHours: 24,
      errors: failed,
    });

    console.log(
      `✅ Preload complete: ${successful}/24 hours cached (${failed} errors)`
    );
  }, [queryClient]);

  return {
    preloadAllHours,
    preloadStatus,
  };
}
