/**
 * Trajectory Layer Component
 * Renders historical trails and predicted trajectories on the map
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { BalloonTrajectory, PredictedPosition, BalloonDataPoint } from '../types/balloon';

interface TrajectoryLayerProps {
  map: L.Map | null;
  trajectories: BalloonTrajectory[];
  showHistorical?: boolean;
  showPredictions?: boolean;
  selectedBalloonId?: string;
}

export default function TrajectoryLayer({
  map,
  trajectories,
  showHistorical = true,
  showPredictions = true,
  selectedBalloonId,
}: TrajectoryLayerProps) {
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;

    // Initialize layer group if not exists
    if (!layerGroupRef.current) {
      layerGroupRef.current = L.layerGroup().addTo(map);
    }

    // Clear existing layers
    layerGroupRef.current.clearLayers();

    // Filter trajectories: if selectedBalloonId is set, only show that one
    const trajsToRender = selectedBalloonId
      ? trajectories.filter(t => t.balloon_id === selectedBalloonId)
      : trajectories;

    // Render trajectories
    trajsToRender.forEach((trajectory) => {
      renderTrajectory(trajectory, layerGroupRef.current!, showHistorical, showPredictions, !!selectedBalloonId);
    });

    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.clearLayers();
      }
    };
  }, [map, trajectories, showHistorical, showPredictions, selectedBalloonId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (layerGroupRef.current) {
        layerGroupRef.current.remove();
        layerGroupRef.current = null;
      }
    };
  }, []);

  return null; // This component doesn't render anything to the DOM
}

/**
 * Render a single balloon trajectory (historical + future + predicted)
 */
function renderTrajectory(
  trajectory: BalloonTrajectory,
  layerGroup: L.LayerGroup,
  showHistorical: boolean,
  showPredictions: boolean,
  isHighlighted: boolean = false
) {
  const { historical_positions, future_positions, predicted_positions } = trajectory;

  // Render historical trail (solid blue line - past positions)
  if (showHistorical && historical_positions.length > 0) {
    renderHistoricalTrail(historical_positions, layerGroup, isHighlighted);
  }

  // Render known future positions (dotted blue line - only when balloon is selected)
  // Only show when isHighlighted (meaning this is the selected balloon)
  if (isHighlighted && future_positions && future_positions.length > 0) {
    renderFutureTrail(future_positions, layerGroup, isHighlighted);
  }

  // Render predicted trajectory (dashed amber line - actual predictions)
  if (showPredictions && predicted_positions.length > 0) {
    // Connect current position to first prediction
    // Find the most recent position (hour_offset = 0 or minimum hour_offset)
    const allKnownPositions = [...historical_positions];
    if (future_positions) {
      allKnownPositions.push(...future_positions);
    }
    const mostRecent = allKnownPositions.reduce((prev, curr) =>
      curr.hour_offset < prev.hour_offset ? curr : prev
    );
    renderPredictedTrail(mostRecent, predicted_positions, layerGroup);
  }
}

/**
 * Render historical trail as a solid colored polyline
 */
function renderHistoricalTrail(
  positions: BalloonDataPoint[],
  layerGroup: L.LayerGroup,
  isHighlighted: boolean = false
) {
  if (positions.length === 0) return;

  // Sort by hour_offset (descending) - oldest to newest
  const sorted = [...positions].sort((a, b) => b.hour_offset - a.hour_offset);

  // Create coordinates array [lat, lng]
  const coordinates: L.LatLngExpression[] = sorted.map((pos) => [pos.latitude, pos.longitude]);

  // Create polyline with gradient effect based on age
  const polyline = L.polyline(coordinates, {
    color: isHighlighted ? '#06b6d4' : '#3b82f6', // Cyan when highlighted, blue otherwise
    weight: isHighlighted ? 5 : 3,
    opacity: isHighlighted ? 1 : 0.7,
    smoothFactor: 1,
  });

  // Add popup showing trail info
  const balloonId = positions[0]?.id || 'Unknown';
  const duration = positions.length;
  polyline.bindPopup(`
    <div class="text-xs">
      <strong>Balloon:</strong> ${balloonId}<br/>
      <strong>Trail Duration:</strong> ${duration} hours<br/>
      <strong>Historical Path</strong>
    </div>
  `);

  polyline.addTo(layerGroup);

  // Add position markers for EVERY position along the trail
  sorted.forEach((pos, index) => {
    // Skip the last position (current position) to avoid overlap with the main balloon marker
    if (index === sorted.length - 1) return;

    const marker = L.circleMarker([pos.latitude, pos.longitude], {
      radius: 4,
      fillColor: getAgeColor(pos.hour_offset),
      color: '#fff',
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.6,
    });

    marker.bindTooltip(`${pos.hour_offset}h ago`, {
      permanent: false,
      direction: 'top',
    });

    marker.addTo(layerGroup);
  });
}

/**
 * Render known future positions as a dotted blue line
 * These are KNOWN positions from later timeframes, not predictions
 * The line should connect from the current position (which is rendered by BalloonMap)
 */
function renderFutureTrail(
  positions: BalloonDataPoint[],
  layerGroup: L.LayerGroup,
  isHighlighted: boolean = false
) {
  if (positions.length === 0) return;

  // Sort by hour_offset (descending) - current to future
  // Lower hour_offset = more recent = closer to "now" in the future
  const sorted = [...positions].sort((a, b) => b.hour_offset - a.hour_offset);

  // Create coordinates array [lat, lng]
  const coordinates: L.LatLngExpression[] = sorted.map((pos) => [pos.latitude, pos.longitude]);

  // Create dotted polyline (same blue as historical, but dotted)
  const polyline = L.polyline(coordinates, {
    color: isHighlighted ? '#06b6d4' : '#3b82f6', // Same blue as historical trail
    weight: isHighlighted ? 5 : 3,
    opacity: isHighlighted ? 1 : 0.7,
    dashArray: '5, 10', // Dotted pattern (shorter dashes than predictions)
    smoothFactor: 1,
  });

  // Add popup showing trail info
  const balloonId = positions[0]?.id || 'Unknown';
  polyline.bindPopup(`
    <div class="text-xs">
      <strong>Balloon:</strong> ${balloonId}<br/>
      <strong>Known Future Path</strong><br/>
      <strong>Duration:</strong> ${positions.length} hours<br/>
      <em>Actual data from later timeframe</em>
    </div>
  `);

  polyline.addTo(layerGroup);

  // Add position markers for EVERY position along the future trail
  // The first position is the current/reference position
  const referenceHourOffset = sorted[0]?.hour_offset || 0;

  sorted.forEach((pos, index) => {
    // Skip the first position (current position) to avoid overlap with the main balloon marker
    if (index === 0) return;

    const marker = L.circleMarker([pos.latitude, pos.longitude], {
      radius: 4,
      fillColor: '#3b82f6', // Blue for known future
      color: '#fff',
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.6,
    });

    // Calculate hours ahead from the reference point (current selected timeframe)
    // If reference is hour_offset=5 and this position is hour_offset=3, then it's T+2
    const hoursAhead = referenceHourOffset - pos.hour_offset;
    marker.bindTooltip(`T+${hoursAhead}h`, {
      permanent: false,
      direction: 'top',
    });

    marker.addTo(layerGroup);
  });
}

/**
 * Render predicted trajectory as a dashed line
 */
function renderPredictedTrail(
  startPosition: BalloonDataPoint,
  predictions: PredictedPosition[],
  layerGroup: L.LayerGroup
) {
  // Build coordinates: start from current position
  const coordinates: L.LatLngExpression[] = [
    [startPosition.latitude, startPosition.longitude] as L.LatLngTuple,
    ...predictions.map((pred) => [pred.latitude, pred.longitude] as L.LatLngTuple),
  ];

  // Create dashed polyline for predictions
  const polyline = L.polyline(coordinates, {
    color: '#f59e0b', // Amber for predictions
    weight: 3,
    opacity: 0.8,
    dashArray: '10, 10', // Dashed pattern
    smoothFactor: 1,
  });

  // Add popup showing prediction info
  const method = predictions[0]?.method || 'unknown';
  const avgConfidence =
    predictions.reduce((sum, p) => sum + p.confidence, 0) / predictions.length;

  polyline.bindPopup(`
    <div class="text-xs">
      <strong>Predicted Path</strong><br/>
      <strong>Method:</strong> ${method}<br/>
      <strong>Horizon:</strong> ${predictions.length} hours<br/>
      <strong>Avg Confidence:</strong> ${(avgConfidence * 100).toFixed(0)}%
    </div>
  `);

  polyline.addTo(layerGroup);

  // Add markers for predicted positions with confidence indicators
  predictions.forEach((pred, index) => {
    const hoursAhead = index + 1;

    // Marker size decreases with confidence
    const radius = 3 + pred.confidence * 3; // 3-6 pixels

    const marker = L.circleMarker([pred.latitude, pred.longitude], {
      radius,
      fillColor: getPredictionColor(pred.confidence),
      color: '#fff',
      weight: 1,
      opacity: 0.8,
      fillOpacity: 0.7,
    });

    marker.bindTooltip(
      `+${hoursAhead}h (${(pred.confidence * 100).toFixed(0)}% confidence)`,
      {
        permanent: false,
        direction: 'top',
      }
    );

    marker.addTo(layerGroup);
  });
}

/**
 * Get color based on how old the position is (hour_offset)
 */
function getAgeColor(hourOffset: number): string {
  // Gradient from recent (bright blue) to old (dark blue)
  if (hourOffset === 0) return '#3b82f6'; // Current - bright blue
  if (hourOffset < 6) return '#60a5fa'; // Recent - medium blue
  if (hourOffset < 12) return '#93c5fd'; // Medium - light blue
  if (hourOffset < 18) return '#bfdbfe'; // Old - very light blue
  return '#dbeafe'; // Very old - pale blue
}

/**
 * Get color based on prediction confidence
 */
function getPredictionColor(confidence: number): string {
  // Gradient from high confidence (green) to low confidence (red)
  if (confidence > 0.8) return '#10b981'; // High - green
  if (confidence > 0.6) return '#fbbf24'; // Medium - yellow
  if (confidence > 0.4) return '#f97316'; // Low - orange
  return '#ef4444'; // Very low - red
}
