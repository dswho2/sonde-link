/**
 * Balloon Map Component
 * Displays weather balloons on a Leaflet map with clustering
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import type { BalloonDataPoint, BalloonTrajectory } from '../types/balloon';
import TrajectoryLayer from './TrajectoryLayer';
import WindOverlay from './WindOverlay';

interface BalloonMapProps {
  balloons: BalloonDataPoint[];
  trajectories?: BalloonTrajectory[];
  showTrajectories?: boolean;
  showPredictions?: boolean;
  showWindOverlay?: boolean;
  windAltitude?: number;
  clusteringEnabled?: boolean;
  selectedBalloonId?: string;
  onBalloonClick?: (balloon: BalloonDataPoint, position: { lat: number; lng: number }) => void;
  onMapClick?: () => void;
}

export default function BalloonMap({
  balloons,
  trajectories = [],
  showTrajectories = false,
  showPredictions = false,
  showWindOverlay = false,
  windAltitude = 1.5,
  clusteringEnabled = true,
  selectedBalloonId,
  onBalloonClick,
  onMapClick,
}: BalloonMapProps) {
  const mapRef = useRef<L.Map | null>(null);
  const markerClusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const directMarkersRef = useRef<L.LayerGroup | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapRef.current) {
      const map = L.map('map', {
        center: [20, 0],
        zoom: 2,
        minZoom: 2,
        maxZoom: 18,
        // Allow horizontal wrapping but prevent vertical scrolling to grey area
        worldCopyJump: true, // Jump to nearest world copy when panning
        maxBoundsViscosity: 0.8, // Soft boundary for vertical bounds only
      });

      // Set vertical-only bounds to prevent grey area
      // Using a custom approach: update bounds on move to constrain latitude only
      map.on('drag', () => {
        const center = map.getCenter();
        if (center.lat > 85) {
          map.panTo([85, center.lng], { animate: false });
        } else if (center.lat < -85) {
          map.panTo([-85, center.lng], { animate: false });
        }
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        // Allow tiles to wrap horizontally
      }).addTo(map);

      // Add click handler to close detail panel when clicking on the map
      map.on('click', (e) => {
        // Don't close detail panel if this was a marker click
        if (!(e as any).isMarkerClick && onMapClick) {
          onMapClick();
        }
      });

      // Store map instance globally for access in MapPage
      (window as any).leafletMapInstance = map;

      mapRef.current = map;

      // Initialize marker cluster group
      markerClusterRef.current = L.markerClusterGroup({
        maxClusterRadius: 80,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
      });

      map.addLayer(markerClusterRef.current);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerClusterRef.current = null;
      }
    };
  }, []);

  // Update markers when balloons or clustering setting changes
  useEffect(() => {
    if (!mapRef.current) return;

    console.log(`BalloonMap: Received ${balloons.length} balloons, clustering=${clusteringEnabled}`);

    // Initialize directMarkersRef if needed
    if (!directMarkersRef.current) {
      directMarkersRef.current = L.layerGroup();
    }

    // Clear existing markers from both layers
    markerClusterRef.current?.clearLayers();
    directMarkersRef.current.clearLayers();

    // Remove both from map first
    if (mapRef.current.hasLayer(markerClusterRef.current!)) {
      mapRef.current.removeLayer(markerClusterRef.current!);
    }
    if (mapRef.current.hasLayer(directMarkersRef.current)) {
      mapRef.current.removeLayer(directMarkersRef.current);
    }

    // Choose which layer to use
    const targetLayer = clusteringEnabled ? markerClusterRef.current! : directMarkersRef.current;
    targetLayer.addTo(mapRef.current);

    // Add new markers with wrapped copies
    balloons.forEach((balloon) => {
      const { latitude, longitude, altitude_km, id } = balloon;

      // Create markers at original position and wrapped copies
      // This allows balloons to appear on all world copies when scrolling horizontally
      const longitudeOffsets = [-360, 0, 360];

      longitudeOffsets.forEach((offset) => {
        const wrappedLongitude = longitude + offset;

        // Color based on altitude
        const color = getAltitudeColor(altitude_km);

        const marker = L.circleMarker([latitude, wrappedLongitude], {
          radius: 6,
          fillColor: color,
          color: '#fff',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8,
        });

        // Popup content (simplified - just balloon ID)
        const popupContent = `
          <div class="balloon-popup" style="text-align: center; padding: 4px 8px;">
            <h3 style="font-weight: bold; font-size: 14px; margin: 0; color: #1e3a5f;">${id}</h3>
          </div>
        `;

        // Bind popup to marker
        marker.bindPopup(popupContent, {
          maxWidth: 250,
          autoClose: true,
          closeOnClick: true
        });

        // Click opens detail panel AND popup
        marker.on('click', (e) => {
          // Mark this as a marker click to prevent map click handler from closing detail panel
          (e as any).isMarkerClick = true;

          // Explicitly open the popup
          marker.openPopup();

          // Trigger detail panel with position
          if (onBalloonClick) {
            onBalloonClick(balloon, { lat: latitude, lng: wrappedLongitude });
          }
        });

        targetLayer.addLayer(marker);
      });
    });

    console.log(`BalloonMap: Rendered ${balloons.length * 3} markers (clustering=${clusteringEnabled})`);
  }, [balloons, clusteringEnabled]); // Removed onBalloonClick from dependencies to prevent re-rendering when detail panel opens

  return (
    <>
      <div id="map" className="w-full h-full" />
      <TrajectoryLayer
        map={mapRef.current}
        trajectories={trajectories}
        showHistorical={showTrajectories}
        showPredictions={showPredictions}
        selectedBalloonId={selectedBalloonId}
      />
      <WindOverlay
        map={mapRef.current}
        enabled={showWindOverlay}
        altitude={windAltitude}
      />
    </>
  );
}

/**
 * Get color based on altitude (0-50km range)
 */
export function getAltitudeColor(altitude_km: number): string {
  if (altitude_km < 5) return '#9ecae1'; // low
  if (altitude_km < 10) return '#6baed6'; // medium-low
  if (altitude_km < 15) return '#4292c6'; // medium
  if (altitude_km < 20) return '#2171b5'; // medium-high
  return '#084594'; // high
}
