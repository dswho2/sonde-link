/**
 * Balloon Detail Panel Component
 * Mission Control panel showing detailed information about a selected balloon
 */

import { useState, useEffect, useRef } from 'react';
import type { BalloonDataPoint, BalloonTrajectory, ValueCalculationResult } from '../types/balloon';
import { balloonApi } from '../services/api';
import BalloonValueChart from './BalloonValueChart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface BalloonDetailPanelProps {
    balloon: BalloonDataPoint;
    trajectory?: BalloonTrajectory;
    onClose: () => void;
    isClosing: boolean;
}

// Cache for value calculation results (persists across component re-renders)
const valueCache = new Map<string, ValueCalculationResult>();

export default function BalloonDetailPanel({
    balloon,
    trajectory,
    onClose,
    isClosing,
}: BalloonDetailPanelProps) {
    const [valueData, setValueData] = useState<ValueCalculationResult | null>(null);
    const [valueLoading, setValueLoading] = useState(false);
    const [valueError, setValueError] = useState<string | null>(null);
    const historicalPositions = trajectory?.historical_positions || [];
    const previousBalloonIdRef = useRef<string | null>(null);

    // Auto-calculate trajectory analysis when balloon changes or on initial mount
    useEffect(() => {
        // Balloon changed or first mount
        if (previousBalloonIdRef.current !== balloon.id) {
            // Clear current value data
            setValueData(null);
            setValueError(null);
            setValueLoading(false);

            // Check if we have cached data for this balloon
            const cached = valueCache.get(balloon.id);
            if (cached) {
                console.log(`Using cached value data for balloon ${balloon.id}`);
                setValueData(cached);
            } else if (historicalPositions.length >= 2) {
                // Auto-calculate if we have enough data and no cache
                console.log(`Auto-calculating trajectory analysis for balloon ${balloon.id}`);
                handleCalculateValue();
            }

            previousBalloonIdRef.current = balloon.id;
        }
    }, [balloon.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Calculate flight dynamics
    const getFlightDynamics = () => {
        if (historicalPositions.length < 2) return null;

        const sorted = [...historicalPositions].sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const current = sorted[sorted.length - 1];
        const previous = sorted[sorted.length - 2];
        if (!current || !previous) return null;

        // Calculate time difference in seconds
        const timeDiff = (new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime()) / 1000;
        const timeDiffHours = timeDiff / 3600;

        // Vertical rate (m/s)
        const altitudeDiff = current.altitude_km - previous.altitude_km;
        const verticalRate = (altitudeDiff * 1000) / timeDiff; // m/s

        // Horizontal speed (km/h) using Haversine formula
        const toRad = (deg: number) => (deg * Math.PI) / 180;
        const R = 6371; // Earth radius in km
        const dLat = toRad(current.latitude - previous.latitude);
        const dLon = toRad(current.longitude - previous.longitude);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRad(previous.latitude)) * Math.cos(toRad(current.latitude)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c; // km
        const horizontalSpeed = distance / timeDiffHours; // km/h

        // Determine flight phase
        let phase: string;
        let phaseIcon: string;
        let phaseColor: string;

        if (verticalRate > 2) {
            phase = 'Ascending';
            phaseIcon = '🚀';
            phaseColor = 'text-blue-400';
        } else if (verticalRate < -2) {
            phase = 'Descending';
            phaseIcon = '🪂';
            phaseColor = 'text-red-400';
        } else {
            phase = 'Floating';
            phaseIcon = '➡️';
            phaseColor = 'text-yellow-400';
        }

        return {
            verticalRate,
            horizontalSpeed,
            phase,
            phaseIcon,
            phaseColor,
            isRapidChange: Math.abs(verticalRate) > 10, // >10 m/s is rapid
        };
    };

    // Calculate flight profile stats
    const getFlightProfile = () => {
        if (historicalPositions.length === 0) return null;

        const sorted = [...historicalPositions].sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const oldest = sorted[0];
        const newest = sorted[sorted.length - 1];

        // Time tracked
        const timeDiff = new Date(newest.timestamp).getTime() - new Date(oldest.timestamp).getTime();
        const hoursTracked = Math.floor(timeDiff / (1000 * 60 * 60));
        const minutesTracked = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));

        // Max altitude
        const maxAltitude = Math.max(...historicalPositions.map(p => p.altitude_km));
        const minAltitude = Math.min(...historicalPositions.map(p => p.altitude_km));
        const altitudeRange = maxAltitude - minAltitude;

        return {
            hoursTracked,
            minutesTracked,
            maxAltitude,
            minAltitude,
            altitudeRange,
        };
    };

    const flightDynamics = getFlightDynamics();
    const flightProfile = getFlightProfile();

    // Calculate trajectory reliability from value data
    const getTrajectoryReliability = () => {
        if (!valueData) return null;

        const errors = valueData.value_over_time.map(v => v.prediction_error_km);
        const meanError = errors.reduce((sum, e) => sum + e, 0) / errors.length;
        const maxError = Math.max(...errors);
        const currentError = errors[errors.length - 1] || 0;

        // Calculate reliability percentage (inverse of error)
        // Excellent: <5km = 90-100%, Good: 5-10km = 75-90%, Fair: 10-20km = 50-75%, Poor: >20km = <50%
        const reliabilityPercent = Math.max(0, Math.min(100, 100 - (meanError * 4)));

        // Determine status
        let status: 'excellent' | 'good' | 'fair' | 'poor';
        let statusColor: string;
        let statusText: string;

        if (reliabilityPercent >= 85) {
            status = 'excellent';
            statusColor = 'text-green-400';
            statusText = 'EXCELLENT';
        } else if (reliabilityPercent >= 70) {
            status = 'good';
            statusColor = 'text-blue-400';
            statusText = 'GOOD';
        } else if (reliabilityPercent >= 50) {
            status = 'fair';
            statusColor = 'text-yellow-400';
            statusText = 'FAIR';
        } else {
            status = 'poor';
            statusColor = 'text-red-400';
            statusText = 'UNRELIABLE';
        }

        return {
            reliabilityPercent,
            meanError,
            maxError,
            currentError,
            status,
            statusColor,
            statusText,
        };
    };

    const trajectoryReliability = getTrajectoryReliability();

    // Handle value calculation
    const handleCalculateValue = async () => {
        // Check cache first
        const cached = valueCache.get(balloon.id);
        if (cached) {
            console.log(`Using cached value data for balloon ${balloon.id}`);
            setValueData(cached);
            return;
        }

        setValueLoading(true);
        setValueError(null);
        try {
            const result = await balloonApi.calculateValue(balloon.id, {
                hours: 24,
                method: 'hybrid',
            });
            setValueData(result);
            // Store in cache for future use
            valueCache.set(balloon.id, result);
            console.log(`Cached value data for balloon ${balloon.id}`);
        } catch (error) {
            console.error('Failed to calculate value:', error);
            setValueError(error instanceof Error ? error.message : 'Failed to calculate value');
        } finally {
            setValueLoading(false);
        }
    };

    // Format coordinates
    const formatCoord = (val: number, isLat: boolean) => {
        const dir = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
        return `${Math.abs(val).toFixed(4)}° ${dir}`;
    };

    // Prepare altitude chart data for Recharts
    const altitudeChartData = [...historicalPositions]
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) // Oldest first
        .map((pos, _index, array) => {
            // Calculate hours ago from the most recent position
            const newestTime = new Date(array[array.length - 1].timestamp).getTime();
            const posTime = new Date(pos.timestamp).getTime();
            const hoursAgo = Math.round((newestTime - posTime) / (1000 * 60 * 60));

            return {
                hoursAgo: -hoursAgo, // Negative for past times
                altitude: pos.altitude_km,
                label: `T-${hoursAgo}h`,
            };
        });

    // Custom tooltip for altitude chart
    const AltitudeTooltip = ({ active, payload }: any) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            return (
                <div className="bg-slate-800 border border-slate-600 rounded-lg p-2 shadow-lg">
                    <p className="text-xs text-slate-300">{data.label}</p>
                    <p className="text-sm font-bold text-cyan-400">{data.altitude.toFixed(2)} km</p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className={`absolute left-0 top-0 bottom-0 w-[700px] bg-slate-900/95 backdrop-blur-lg shadow-2xl z-[1001] flex flex-col border-r border-slate-700 overflow-hidden ${isClosing ? 'animate-slide-out-left' : 'animate-slide-in-left'}`}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-slate-800 border-b border-slate-700">
                <div className="flex items-center gap-4">
                    <span className="text-3xl">🎈</span>
                    <div>
                        <h2 className="text-xl font-bold text-white">{balloon.id}</h2>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${balloon.status === 'active' ? 'bg-green-500/20 text-green-300' :
                            balloon.status === 'new' ? 'bg-blue-500/20 text-blue-300' :
                                'bg-red-500/20 text-red-300'
                            }`}>
                            {balloon.status.toUpperCase()}
                        </span>
                    </div>
                </div>
                <button
                    onClick={onClose}
                    className="p-2 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>
            </div>

            {/* Content - Two Column Layout */}
            <div className="flex-1 p-6 grid grid-cols-2 gap-6 overflow-y-auto">
                {/* Wide across both columns */}
                <div className="space-y-4 col-span-2">
                    {/* Position Section */}
                    <Section title="Current Position">
                        <div className="grid grid-cols-2 gap-4">
                            <DataRow label="Latitude" value={formatCoord(balloon.latitude, true)} />
                            <DataRow label="Longitude" value={formatCoord(balloon.longitude, false)} />
                            <DataRow label="Altitude" value={`${balloon.altitude_km.toFixed(2)} km`} highlight />
                            <DataRow label="Last Update" value={new Date(balloon.timestamp).toLocaleTimeString()} />
                        </div>
                    </Section>
                </div>

                 {/* left column */}
                <div className="space-y-4">
                    {/* Flight Dynamics Section */}
                    <Section title="Flight Dynamics">
                        {flightDynamics ? (
                            <div className="space-y-3">
                                {/* Flight Phase Badge */}
                                <div className="flex items-center justify-between bg-slate-800 rounded-lg p-3">
                                    <span className="text-slate-400 text-sm">Phase:</span>
                                    <span className={`text-lg font-bold ${flightDynamics.phaseColor}`}>
                                        {flightDynamics.phase}
                                    </span>
                                </div>

                                {/* Velocity Metrics */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="bg-slate-800 rounded-lg p-3">
                                        <p className="text-xs text-slate-400 mb-1">Horizontal Speed</p>
                                        <p className="text-lg font-bold text-cyan-400">
                                            {flightDynamics.horizontalSpeed.toFixed(1)}
                                            <span className="text-xs text-slate-500 ml-1">km/h</span>
                                        </p>
                                        {balloon.direction_deg && (
                                            <p className="text-xs text-slate-500 mt-1">Heading {balloon.direction_deg.toFixed(0)}°</p>
                                        )}
                                    </div>
                                    <div className="bg-slate-800 rounded-lg p-3">
                                        <p className="text-xs text-slate-400 mb-1">Vertical Speed</p>
                                        <p className={`text-lg font-bold ${
                                            flightDynamics.verticalRate > 0 ? 'text-blue-400' :
                                            flightDynamics.verticalRate < 0 ? 'text-red-400' :
                                            'text-yellow-400'
                                        }`}>
                                            {flightDynamics.verticalRate > 0 ? '+' : ''}{flightDynamics.verticalRate.toFixed(1)}
                                            <span className="text-xs text-slate-500 ml-1">m/s</span>
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {flightDynamics.verticalRate > 0 ? '↑' : flightDynamics.verticalRate < 0 ? '↓' : '→'}
                                        </p>
                                    </div>
                                </div>

                                {/* Rapid change alert */}
                                {flightDynamics.isRapidChange && (
                                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 flex items-center gap-2">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                        <span className="text-amber-400 text-xs">Rapid altitude change detected</span>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p className="text-slate-500 text-sm italic">Insufficient data for flight dynamics</p>
                        )}
                    </Section>

                    {/* Flight Profile Section */}
                    <Section title="Flight Profile">
                        {flightProfile ? (
                            <div className="space-y-2">
                                <DataRow
                                    label="Time Tracked"
                                    value={`${flightProfile.hoursTracked}h ${flightProfile.minutesTracked}m`}
                                />
                                <DataRow
                                    label="Max Altitude"
                                    value={`${flightProfile.maxAltitude.toFixed(2)} km`}
                                    highlight
                                />
                                <DataRow
                                    label="Altitude Range"
                                    value={`${flightProfile.minAltitude.toFixed(1)} - ${flightProfile.maxAltitude.toFixed(1)} km`}
                                />
                                <DataRow
                                    label="Data Points"
                                    value={`${historicalPositions.length}`}
                                />
                            </div>
                        ) : (
                            <p className="text-slate-500 text-sm italic">No flight data available</p>
                        )}
                    </Section>
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                    {/* Altitude Over Time Graph */}
                    <Section title="Altitude Over Time">
                        {altitudeChartData.length > 1 ? (
                            <div className="space-y-3">
                                {/* Recharts Line Chart */}
                                <div className="bg-slate-800 rounded-lg p-3">
                                    <ResponsiveContainer width="100%" height={200}>
                                        <LineChart data={altitudeChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                            <XAxis
                                                dataKey="hoursAgo"
                                                stroke="#94a3b8"
                                                tick={{ fontSize: 11, fill: '#94a3b8' }}
                                                tickFormatter={(value) => `${value}h`}
                                            />
                                            <YAxis
                                                stroke="#94a3b8"
                                                tick={{ fontSize: 11, fill: '#94a3b8' }}
                                                tickFormatter={(value) => `${value.toFixed(1)}km`}
                                                domain={['auto', 'auto']}
                                            />
                                            <Tooltip content={<AltitudeTooltip />} />
                                            <Line
                                                type="monotone"
                                                dataKey="altitude"
                                                stroke="#06b6d4"
                                                strokeWidth={2}
                                                dot={{ fill: '#06b6d4', r: 3 }}
                                                activeDot={{ r: 5 }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        ) : (
                            <p className="text-slate-500 text-sm italic">Insufficient data for altitude graph</p>
                        )}
                    </Section>

                    {/* Position History */}
                    <Section title="Position History">
                        {historicalPositions.length > 0 ? (
                            <div className="space-y-2 max-h-48 overflow-y-auto">
                                {(() => {
                                    // Sort by timestamp (newest first)
                                    const sortedPositions = [...historicalPositions]
                                        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                                    // Get the most recent timestamp as reference point
                                    const newestTime = new Date(sortedPositions[0].timestamp).getTime();

                                    // Show all positions (scrollable container handles overflow)
                                    return sortedPositions
                                        .map((pos, i) => {
                                            // Calculate hours difference from newest position
                                            const posTime = new Date(pos.timestamp).getTime();
                                            const hoursDiff = Math.round((newestTime - posTime) / (1000 * 60 * 60));

                                            return (
                                                <div key={i} className="flex items-center justify-between text-xs p-2 bg-slate-800 rounded">
                                                    <span className="text-slate-400 w-12">T-{hoursDiff}h</span>
                                                    <span className="text-slate-300 font-mono">
                                                        {pos.latitude.toFixed(2)}°, {pos.longitude.toFixed(2)}°
                                                    </span>
                                                    <span className="text-cyan-400 w-16 text-right">{pos.altitude_km.toFixed(1)} km</span>
                                                </div>
                                            );
                                        });
                                })()}
                            </div>
                        ) : (
                            <p className="text-slate-500 text-sm italic">No historical data available</p>
                        )}
                    </Section>
                </div>

                <div className='space-y-4 col-span-2'>
                    {/* Trajectory Reliability Section */}
                    <Section title="Trajectory Reliability">
                        {valueLoading && (
                            <div className="flex flex-col items-center justify-center py-8 space-y-3">
                                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full"></div>
                                <p className="text-slate-400 text-sm">Analyzing trajectory...</p>
                                <p className="text-slate-500 text-xs">This may take up to 30 seconds</p>
                            </div>
                        )}

                        {!valueData && !valueLoading && historicalPositions.length < 2 && (
                            <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                                <p className="text-amber-400 text-sm">Insufficient historical data (need at least 2 hours)</p>
                            </div>
                        )}

                        {valueError && (
                            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                                <p className="text-red-400 text-sm">{valueError}</p>
                            </div>
                        )}

                        {trajectoryReliability && valueData && !valueLoading && (
                            <div className="space-y-4">
                                {/* Error Metrics */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-slate-800 rounded-lg p-3 text-center">
                                        <p className="text-xs text-slate-400 mb-1">Mean Error</p>
                                        <p className="text-lg font-bold text-cyan-400">
                                            {trajectoryReliability.meanError.toFixed(1)}
                                            <span className="text-xs text-slate-500 ml-1">km</span>
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {trajectoryReliability.meanError < 5 ? '✓ Excellent' :
                                             trajectoryReliability.meanError < 15 ? '⚠ Fair' : '✗ Poor'}
                                        </p>
                                    </div>
                                    <div className="bg-slate-800 rounded-lg p-3 text-center">
                                        <p className="text-xs text-slate-400 mb-1">Max Error</p>
                                        <p className="text-lg font-bold text-orange-400">
                                            {trajectoryReliability.maxError.toFixed(1)}
                                            <span className="text-xs text-slate-500 ml-1">km</span>
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">
                                            {trajectoryReliability.maxError < 10 ? '✓ Good' :
                                             trajectoryReliability.maxError < 25 ? '⚠ Acceptable' : '✗ High'}
                                        </p>
                                    </div>
                                    <div className="bg-slate-800 rounded-lg p-3 text-center">
                                        <p className="text-xs text-slate-400 mb-1">Current</p>
                                        <p className="text-lg font-bold text-green-400">
                                            {trajectoryReliability.currentError.toFixed(1)}
                                            <span className="text-xs text-slate-500 ml-1">km</span>
                                        </p>
                                        <p className="text-xs text-slate-500 mt-1">Now</p>
                                    </div>
                                </div>

                                {/* Assessment */}
                                <div className={`rounded-lg p-3 border ${
                                    trajectoryReliability.status === 'excellent' ? 'bg-green-500/10 border-green-500/30' :
                                    trajectoryReliability.status === 'good' ? 'bg-blue-500/10 border-blue-500/30' :
                                    trajectoryReliability.status === 'fair' ? 'bg-yellow-500/10 border-yellow-500/30' :
                                    'bg-red-500/10 border-red-500/30'
                                }`}>
                                    <div className="space-y-2">
                                        <p className={`text-sm font-semibold ${trajectoryReliability.statusColor}`}>
                                            {trajectoryReliability.status === 'excellent' && '✓ Model Performance: Excellent'}
                                            {trajectoryReliability.status === 'good' && '✓ Model Performance: Good'}
                                            {trajectoryReliability.status === 'fair' && '⚠ Model Performance: Fair'}
                                            {trajectoryReliability.status === 'poor' && '⚠ Model Performance: Poor'}
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            {trajectoryReliability.status === 'excellent' && 'Wind-based prediction model accurately forecasts this balloon\'s trajectory. Atmospheric conditions match our wind data.'}
                                            {trajectoryReliability.status === 'good' && 'Prediction model performs well for this balloon. Some deviation from wind patterns but generally reliable.'}
                                            {trajectoryReliability.status === 'fair' && 'Moderate prediction error. Balloon experiencing atmospheric conditions not fully captured by our wind model. Use predictions cautiously.'}
                                            {trajectoryReliability.status === 'poor' && 'High prediction error indicates our wind model does not accurately represent this balloon\'s environment. Balloon may be in unusual atmospheric conditions or our model needs improvement.'}
                                        </p>
                                    </div>
                                </div>

                                {/* Detailed Chart */}
                                <div className="mt-2">
                                    <BalloonValueChart valueData={valueData} loading={false} />
                                </div>
                            </div>
                        )}
                    </Section>
                </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-slate-800 border-t border-slate-700 text-center">
                <p className="text-xs text-slate-500">
                    Mission Control • Data updates hourly • {historicalPositions.length} historical points tracked
                </p>
            </div>
        </div>
    );
}

// Helper Components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-slate-800/50 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">{title}</h3>
            {children}
        </div>
    );
}

function DataRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className="flex items-center justify-between py-1">
            <span className="text-slate-400 text-sm">{label}</span>
            <span className={`font-mono text-sm ${highlight ? 'text-cyan-400 font-bold' : 'text-slate-200'}`}>
                {value}
            </span>
        </div>
    );
}

