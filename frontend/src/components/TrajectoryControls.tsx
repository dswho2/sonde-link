/**
 * Trajectory Controls Component
 * Controls for enabling trajectory visualization and prediction settings
 */

interface TrajectoryControlsProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  showHistorical: boolean;
  onShowHistoricalChange: (show: boolean) => void;
  showPredictions: boolean;
  onShowPredictionsChange: (show: boolean) => void;
  showWindOverlay: boolean;
  onShowWindOverlayChange: (show: boolean) => void;
  windAltitude?: number;
  onWindAltitudeChange?: (altitude: number) => void;
  predictionHours: number;
  onPredictionHoursChange: (hours: number) => void;
  balloonLimit: number;
  onBalloonLimitChange: (limit: number) => void;
  isLoading?: boolean;
}

export default function TrajectoryControls({
  enabled,
  onEnabledChange,
  showHistorical,
  onShowHistoricalChange,
  showPredictions,
  onShowPredictionsChange,
  showWindOverlay,
  onShowWindOverlayChange,
  windAltitude = 1.5,
  onWindAltitudeChange,
  predictionHours,
  onPredictionHoursChange,
  balloonLimit,
  onBalloonLimitChange,
  isLoading = false,
}: TrajectoryControlsProps) {
  // Altitude presets with descriptions
  const altitudePresets = [
    { value: 0.01, label: 'Surface', description: '~10m' },
    { value: 0.5, label: 'Low', description: '~500m' },
    { value: 1.5, label: 'Medium', description: '~1.5km (default)' },
    { value: 3.0, label: 'High', description: '~3km' },
    { value: 5.6, label: 'Upper', description: '~5.6km' },
    { value: 9.2, label: 'Jet Stream', description: '~9km' },
    { value: 16.0, label: 'Stratosphere', description: '~16km' },
  ];
  return (
    <div className="mt-4 pt-4 border-t">
      <h3 className="text-sm font-bold text-gray-800 mb-3">
        Trajectory Prediction
        <span className="ml-2 px-2 py-0.5 text-xs bg-amber-100 text-amber-800 rounded">
          Phase 2
        </span>
      </h3>

      {/* Enable Trajectories Toggle */}
      <div className="mb-3">
        <div className="flex items-center justify-between">
          <label htmlFor="enable-trajectories" className="text-sm font-medium text-gray-700">
            Enable Trajectories
          </label>
          <button
            id="enable-trajectories"
            onClick={() => onEnabledChange(!enabled)}
            disabled={isLoading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
              enabled ? 'bg-amber-600' : 'bg-gray-200'
            } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      {enabled && (
        <div className="space-y-3 pl-2 border-l-2 border-amber-200">
          {/* Show Historical Trails */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="show-historical"
              checked={showHistorical}
              onChange={(e) => onShowHistoricalChange(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <label htmlFor="show-historical" className="text-sm text-gray-700 cursor-pointer">
              Historical Trails (24h)
            </label>
          </div>

          {/* Show Predictions */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="show-predictions"
              checked={showPredictions}
              onChange={(e) => onShowPredictionsChange(e.target.checked)}
              className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
            />
            <label htmlFor="show-predictions" className="text-sm text-gray-700 cursor-pointer">
              Predicted Paths
            </label>
          </div>

          {/* Show Wind Overlay */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="show-wind-overlay"
              checked={showWindOverlay}
              onChange={(e) => onShowWindOverlayChange(e.target.checked)}
              className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
            />
            <label htmlFor="show-wind-overlay" className="text-sm text-gray-700 cursor-pointer">
              Wind Data Overlay
            </label>
          </div>

          {/* Wind Altitude Selector */}
          {showWindOverlay && onWindAltitudeChange && (
            <div className="pt-2 pl-4">
              <label className="text-xs font-medium text-gray-700 block mb-2">
                Wind Altitude Layer
              </label>
              <div className="space-y-1">
                {altitudePresets.map((preset) => (
                  <div key={preset.value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      id={`altitude-${preset.value}`}
                      name="wind-altitude"
                      value={preset.value}
                      checked={Math.abs(windAltitude - preset.value) < 0.1}
                      onChange={() => onWindAltitudeChange(preset.value)}
                      className="w-3 h-3 text-green-600 focus:ring-green-500"
                    />
                    <label
                      htmlFor={`altitude-${preset.value}`}
                      className="text-xs text-gray-700 cursor-pointer flex-1"
                    >
                      <span className="font-medium">{preset.label}</span>
                      <span className="text-gray-500 ml-1">{preset.description}</span>
                    </label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2 italic">
                Real-time wind data from Open-Meteo API
              </p>
            </div>
          )}

          {/* Prediction Hours Slider */}
          {showPredictions && (
            <div className="pt-2">
              <label className="text-xs font-medium text-gray-700 block mb-1">
                Prediction Horizon: {predictionHours}h
              </label>
              <input
                type="range"
                min="1"
                max="12"
                value={predictionHours}
                onChange={(e) => onPredictionHoursChange(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-600"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>1h</span>
                <span>12h</span>
              </div>
              <p className="text-xs text-gray-500 mt-2 italic">
                Using Hybrid method: combines wind data + balloon velocity for best accuracy
              </p>
            </div>
          )}

          {/* Balloon Limit */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">
              Balloons to Track: {balloonLimit === 1000 ? 'All' : balloonLimit}
            </label>
            <input
              type="range"
              min="10"
              max="1000"
              step="10"
              value={balloonLimit}
              onChange={(e) => onBalloonLimitChange(parseInt(e.target.value))}
              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>10</span>
              <span>All (1000)</span>
            </div>
          </div>
        </div>
      )}

      {/* Trail Legend (when enabled) */}
      {enabled && (showHistorical || showPredictions) && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <h4 className="text-xs font-semibold text-gray-700 mb-2">Trail Legend</h4>
          <div className="space-y-1.5 text-xs">
            {showHistorical && (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-0.5 bg-blue-500"></div>
                  <span className="text-gray-600">Historical Trail</span>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <div className="w-2 h-2 rounded-full bg-blue-300"></div>
                  <span className="text-gray-500 text-xs">Recent (0-6h ago)</span>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <div className="w-2 h-2 rounded-full bg-blue-100"></div>
                  <span className="text-gray-500 text-xs">Old (18-24h ago)</span>
                </div>
              </>
            )}
            {showPredictions && (
              <>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-0.5 bg-amber-500 border-dashed border-t-2 border-amber-500"></div>
                  <span className="text-gray-600">Predicted Path</span>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  <span className="text-gray-500 text-xs">High confidence (&gt;80%)</span>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <div className="w-2 h-2 rounded-full bg-red-500"></div>
                  <span className="text-gray-500 text-xs">Low confidence (&lt;40%)</span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
