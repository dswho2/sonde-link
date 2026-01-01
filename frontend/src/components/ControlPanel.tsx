/**
 * Control Panel Component
 * Data freshness indicators and balloon statistics
 */

import type { Settings } from '../types/balloon';
import { getAltitudeColor } from './BalloonMap';

interface ControlPanelProps {
  settings: Settings | null;
  balloonCount: number;
  dataAge: number;
}

export default function ControlPanel({
  settings,
  balloonCount,
  dataAge,
}: ControlPanelProps) {

  const getDataFreshnessStatus = () => {
    if (dataAge < 0) return { text: 'No data', color: 'text-gray-500' };
    if (dataAge > 90) return { text: 'Very stale', color: 'text-red-600' };
    if (dataAge > 65) return { text: 'Stale', color: 'text-orange-600' };
    return { text: 'Fresh', color: 'text-green-600' };
  };

  const freshnessStatus = getDataFreshnessStatus();

  return (
    <>
      {/* Statistics */}
      <div className="mb-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Active Balloons:</span>
          <span className="font-semibold text-gray-900">{balloonCount}</span>
        </div>

        <div className="flex justify-between items-center">
          <span className="text-gray-600">Data Age:</span>
          <div className="text-right">
            <span className="font-semibold text-gray-900">
              {dataAge >= 0 ? `${dataAge} min` : 'N/A'}
            </span>
            <span className={`ml-2 text-xs ${freshnessStatus.color}`}>
              {freshnessStatus.text}
            </span>
          </div>
        </div>

        {settings?.lastUpdateTimestamp && (
          <div className="text-xs text-gray-500 pt-1 border-t">
            Last update: {new Date(settings.lastUpdateTimestamp).toLocaleTimeString()}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-4 border-t">
        <h3 className="text-xs font-semibold text-gray-700 mb-2">Altitude Legend</h3>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getAltitudeColor(0) }}></div>
            <span className="text-gray-600">0-5 km (Low)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getAltitudeColor(5) }}></div>
            <span className="text-gray-600">5-10 km</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getAltitudeColor(10) }}></div>
            <span className="text-gray-600">10-15 km</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getAltitudeColor(15) }}></div>
            <span className="text-gray-600">15-20 km</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getAltitudeColor(20) }}></div>
            <span className="text-gray-600">20+ km (High)</span>
          </div>
        </div>
      </div>
    </>
  );
}
