/**
 * Map Page Component
 * Windborne Weather Balloon Tracking Application
 * Full-screen map with balloon tracking and trajectory prediction
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import BalloonMap from '../components/BalloonMap';
import ControlPanel from '../components/ControlPanel';
import TimeSlider from '../components/TimeSlider';
import BalloonDetailPanel from '../components/BalloonDetailPanel';
import { useBalloonData, usePreloadBalloonData } from '../hooks/useBalloonData';
import { balloonApi } from '../services/api';
import type { BalloonDataPoint, BalloonTrajectory } from '../types/balloon';

export default function MapPage() {
  const queryClient = useQueryClient();

  // History / Time Slider state - must be defined before useBalloonData
  const [historyOffset, setHistoryOffset] = useState(0); // 0 to -24

  // Convert historyOffset to absolute hour_offset (historyOffset is negative, hour_offset is positive)
  // Always use explicit numeric value to ensure consistent React Query cache keys
  const hourOffset = Math.abs(historyOffset);

  const { balloons, settings, isLoading, error, dataAge } =
    useBalloonData(hourOffset);

  // Preload all 24 hours in background on mount
  const { preloadAllHours, preloadStatus } = usePreloadBalloonData();

  useEffect(() => {
    preloadAllHours();
  }, []); // Run once on mount 

  // Track last known update timestamp to detect backend updates
  const lastKnownTimestamp = useRef<string | null>(null);

  // Poll for backend updates every hour to detect new data
  useEffect(() => {
    const pollInterval = setInterval(async () => {
      // Refetch settings to check for new updates
      await queryClient.invalidateQueries({ queryKey: ['settings'] });

      const currentSettings = queryClient.getQueryData(['settings']) as { lastUpdateTimestamp: string } | undefined;

      if (currentSettings?.lastUpdateTimestamp &&
          currentSettings.lastUpdateTimestamp !== lastKnownTimestamp.current) {
        console.log('🔄 New hourly data detected, refreshing all cached hours...');

        // Invalidate ALL balloon cache entries (hours 0-23)
        // When a new hour arrives, historical data shifts (hour 0 → 1, hour 1 → 2, etc.)
        await queryClient.invalidateQueries({ queryKey: ['balloons'] });

        // Re-preload all 24 hours in the background
        await preloadAllHours();

        // Update the last known timestamp
        lastKnownTimestamp.current = currentSettings.lastUpdateTimestamp;
      }
    }, 60 * 60 * 1000); // Every hour (3600000ms)

    // Initialize last known timestamp
    if (settings?.lastUpdateTimestamp && !lastKnownTimestamp.current) {
      lastKnownTimestamp.current = settings.lastUpdateTimestamp;
    }

    return () => clearInterval(pollInterval);
  }, [queryClient, settings?.lastUpdateTimestamp, preloadAllHours]);

  // Selected balloon state
  const [selectedBalloon, setSelectedBalloon] = useState<BalloonDataPoint | null>(null);
  const [isClosingPanel, setIsClosingPanel] = useState(false);

  // Handle closing with animation
  const handleClosePanel = () => {
    setIsClosingPanel(true);
    setTimeout(() => {
      setSelectedBalloon(null);
      setIsClosingPanel(false);
    }, 300); // Match animation duration
  };

  const handleBalloonClick = async (balloon: BalloonDataPoint, position: { lat: number; lng: number }) => {
    console.log('Selected balloon:', balloon);

    // Fetch full trajectory data for this balloon
    try {
      // Always pass the actual hour offset (0 for current, positive for historical)
      const actualHourOffset = Math.abs(historyOffset);
      const trajectoryData = await balloonApi.getBalloonById(balloon.id, actualHourOffset);

      // Update balloon with full trajectory data
      const balloonWithTrajectory = {
        ...balloon,
        trajectory: trajectoryData.trajectory,
      };

      setSelectedBalloon(balloonWithTrajectory);
    } catch (error) {
      console.error('Failed to fetch balloon trajectory:', error);
      // Still select the balloon even if trajectory fetch fails
      setSelectedBalloon(balloon);
    }

    // Pan map to center balloon in visible area (accounting for detail panel)
    // Detail panel is 700px wide, so offset the center point
    const map = (window as any).leafletMapInstance;
    if (map) {
      const detailPanelWidth = 700; // pixels
      const mapContainer = map.getContainer();
      const mapWidth = mapContainer.offsetWidth;

      // Calculate the center of the visible area (right of detail panel)
      const visibleWidth = mapWidth - detailPanelWidth;
      const targetCenterX = detailPanelWidth + (visibleWidth / 2);

      // Calculate offset in pixels from map center
      const mapCenterX = mapWidth / 2;
      const offsetX = targetCenterX - mapCenterX;

      // Convert pixel offset to lat/lng offset
      const point = map.latLngToContainerPoint([position.lat, position.lng]);
      point.x -= offsetX;
      const targetLatLng = map.containerPointToLatLng(point);

      // Pan to the offset position
      map.panTo(targetLatLng, { animate: true, duration: 0.5 });
    }
  };

  // Get trajectory for selected balloon only
  const trajectories: BalloonTrajectory[] = useMemo(() => {
    if (!selectedBalloon?.trajectory) return [];
    return [selectedBalloon.trajectory];
  }, [selectedBalloon]);

  // Display balloons from API (now includes historical data with proper trajectories)
  const displayedBalloons = useMemo(() => {
    return balloons;
  }, [balloons]);

  return (
    <div className="relative w-full h-screen">
      {/* Error Banner */}
      {error && (
        <div className="absolute top-0 left-0 right-0 bg-red-500 text-white px-4 py-2 text-center z-[2000]">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {/* Loading Overlay - Shows initial data load or preload progress */}
      {(isLoading || preloadStatus.isPreloading) && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg z-[2000] flex items-center gap-3">
          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span>
            {isLoading
              ? 'Loading data...'
              : 'Preloading...'
            }
          </span>
        </div>
      )}

      {/* Map */}
      <BalloonMap
        balloons={displayedBalloons}
        trajectories={trajectories}
        showTrajectories={!!selectedBalloon}
        showPredictions={!!selectedBalloon}
        showWindOverlay={false}
        windAltitude={1.5}
        clusteringEnabled={false}
        selectedBalloonId={selectedBalloon?.id}
        onBalloonClick={handleBalloonClick}
        onMapClick={handleClosePanel}
      />

      {/* Control Panel */}
      <div className="absolute top-4 right-4 bg-white rounded-lg shadow-lg p-4 z-[1000] min-w-[220px] max-h-[90vh] overflow-y-auto">
        {/* Home Button */}
        <div className="flex items-center justify-between mb-4 pb-4 border-b">
          <h2 className="text-lg font-bold text-gray-800">Balloon Tracker</h2>
          <Link
            to="/"
            className="p-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600 hover:text-gray-900"
            title="Back to Home"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
            </svg>
          </Link>
        </div>

        <ControlPanel
          settings={settings}
          balloonCount={displayedBalloons.length}
          dataAge={dataAge}
        />
      </div>

      {/* Time Slider */}
      <TimeSlider
        onTimeChange={setHistoryOffset}
        maxHours={24}
      />

      {/* Balloon Detail Panel */}
      {selectedBalloon && (
        <BalloonDetailPanel
          balloon={selectedBalloon}
          trajectory={selectedBalloon.trajectory}
          onClose={handleClosePanel}
          isClosing={isClosingPanel}
        />
      )}
    </div>
  );
}
