/**
 * API Service for Windborne Backend
 */

import axios from 'axios';
import type {
  BalloonResponse,
  Settings,
  HealthResponse,
  TrajectoryResponse,
  MultipleTrajectoryResponse,
  TrajectoryOptions,
  HistoryItem,
  ValueCalculationResult
} from '../types/balloon';

// In production (Vercel), use relative /api path which gets rewritten to backend
// In development, use localhost:3000
const API_BASE_URL = import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? '/api' : 'http://localhost:3000/api');

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const balloonApi = {
  /**
   * Get all current balloons
   * @param hourOffset - Optional hour offset (0=current, 1=1hr ago, etc.)
   */
  async getBalloons(hourOffset?: number): Promise<BalloonResponse> {
    const params = hourOffset !== undefined ? { hour_offset: hourOffset } : {};
    const response = await api.get<BalloonResponse>('/balloons', { params });
    return response.data;
  },

  /**
   * Get historical data for slider replay
   */
  async getHistory(): Promise<HistoryItem[]> {
    const response = await api.get<HistoryItem[]>('/balloons/history');
    return response.data;
  },

  /**
   * Get specific balloon trajectory with full past/future positions
   * @param id - Balloon ID
   * @param hourOffset - Reference hour offset for past/future split (0 for current, positive for historical)
   */
  async getBalloonById(id: string, hourOffset: number) {
    const response = await api.get(`/balloons/${id}`, {
      params: { hour_offset: hourOffset }
    });
    return response.data;
  },

  /**
   * Get all trajectories
   */
  async getAllTrajectories() {
    const response = await api.get('/balloons/trajectories');
    return response.data;
  },

  /**
   * Get health status
   */
  async getHealth(): Promise<HealthResponse> {
    const response = await api.get<HealthResponse>('/health');
    return response.data;
  },

  /**
   * Get current settings
   */
  async getSettings(): Promise<Settings> {
    const response = await api.get<Settings>('/settings');
    return response.data;
  },

  /**
   * Toggle auto-update
   */
  async setAutoUpdate(enabled: boolean) {
    const response = await api.post('/settings/auto-update', { enabled });
    return response.data;
  },

  /**
   * Force manual refresh
   */
  async refresh() {
    const response = await api.post('/refresh');
    return response.data;
  },

  /**
   * Get trajectory prediction for a specific balloon
   */
  async getTrajectory(
    balloonId: string,
    options: TrajectoryOptions = {}
  ): Promise<TrajectoryResponse> {
    const { hours = 3, method = 'hybrid' } = options;
    const response = await api.get<TrajectoryResponse>(`/trajectory/${balloonId}`, {
      params: { hours, method },
    });
    return response.data;
  },

  /**
   * Get trajectory predictions for multiple balloons
   */
  async getMultipleTrajectories(
    options: TrajectoryOptions = {}
  ): Promise<MultipleTrajectoryResponse> {
    const { hours = 3, method = 'hybrid', limit = 10 } = options;
    const response = await api.get<MultipleTrajectoryResponse>('/trajectory', {
      params: { hours, method, limit },
    });
    return response.data;
  },

  /**
   * Calculate value score for a specific balloon
   */
  async calculateValue(
    balloonId: string,
    options?: { hours?: number; method?: 'persistence' | 'wind' | 'hybrid' }
  ): Promise<ValueCalculationResult> {
    const params = new URLSearchParams();
    if (options?.hours) params.append('hours', options.hours.toString());
    if (options?.method) params.append('method', options.method);

    const response = await api.get<ValueCalculationResult>(
      `/balloons/${balloonId}/value?${params}`
    );

    return response.data;
  },
};

export default api;
