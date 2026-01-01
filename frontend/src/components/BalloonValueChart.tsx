/**
 * Balloon Value Chart Component
 * Displays prediction accuracy over time as a line chart
 */

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ValueCalculationResult } from '../types/balloon';

interface BalloonValueChartProps {
  valueData: ValueCalculationResult;
  loading?: boolean;
}

export default function BalloonValueChart({ valueData, loading = false }: BalloonValueChartProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  // Prepare chart data
  const chartData = valueData.value_over_time.map((point) => ({
    hour: point.hour,
    error: parseFloat(point.prediction_error_km.toFixed(2)),
    timestamp: new Date(point.actual_position.timestamp).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  }));

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-300 rounded shadow-lg">
          <p className="text-sm font-semibold">{data.timestamp}</p>
          <p className="text-sm text-red-600">
            Error: <span className="font-bold">{data.error} km</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* Chart */}
      <div className="bg-white p-4 rounded-lg border border-gray-200">
        <h4 className="text-sm font-semibold text-gray-700 mb-3">
          Prediction Accuracy Over Time
        </h4>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
            <XAxis
              dataKey="hour"
              label={{ value: 'Hours Ago', position: 'insideBottom', offset: -5 }}
              tick={{ fontSize: 12 }}
            />
            <YAxis
              label={{ value: 'Error (km)', angle: -90, position: 'insideLeft' }}
              tick={{ fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey="error"
              stroke="#dc2626"
              strokeWidth={2}
              dot={{ fill: '#dc2626', r: 4 }}
              activeDot={{ r: 6 }}
              name="Prediction Error"
            />
          </LineChart>
        </ResponsiveContainer>

        {/* Info Text */}
        <p className="text-xs text-gray-500 mt-3">
          This chart shows how accurately the {valueData.method} prediction method forecasted the balloon's
          position over the last {valueData.hours_calculated} hours. Lower values indicate better predictions.
        </p>
      </div>
    </div>
  );
}
