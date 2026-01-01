/**
 * Wind Overlay Component
 * Displays wind data with subtle heat map background and extending flow lines
 * Lines extend from a fixed point following wind direction, similar to earth.nullschool.net
 *
 * Now fetches real wind data from Open-Meteo API via backend
 */

import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';

interface WindOverlayProps {
  map: L.Map | null;
  enabled: boolean;
  altitude?: number; // Altitude in km (default: 1.5km)
}

interface WindDataPoint {
  lat: number;
  lng: number;
  u: number; // East-west wind component (m/s)
  v: number; // North-south wind component (m/s)
  speed: number; // Wind speed (km/h)
}

interface BackendWindData {
  latitude: number;
  longitude: number;
  altitude_km: number;
  pressure_hpa: number;
  wind_u_ms: number;
  wind_v_ms: number;
  wind_speed_kmh: number;
  wind_direction_deg: number;
  timestamp: string;
}

interface TrailPoint {
  lat: number;
  lng: number;
  x: number;
  y: number;
}

interface Particle {
  startLat: number; // Fixed start position
  startLng: number;
  startX: number;
  startY: number;
  trail: TrailPoint[];
  age: number;
  maxAge: number;
  growthPhase: number;
  currentLat: number; // Current head position
  currentLng: number;
  speed: number;
}

export default function WindOverlay({ map, enabled, altitude = 1.5 }: WindOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const windFieldRef = useRef<Map<string, WindDataPoint>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!map || !enabled) {
      cleanup();
      return;
    }

    initializeWindOverlay();

    // Update on map movements
    const handleMove = () => {
      if (canvasRef.current && map) {
        const size = map.getSize();
        canvasRef.current.width = size.x;
        canvasRef.current.height = size.y;

        // Update all positions on pan
        updateAllPositions();
      }
    };

    // No need to refetch on move/zoom since we have global data
    // Just update particle positions to match new viewport
    map.on('move', handleMove);
    map.on('zoomend', () => {
      // Just reset particles, don't refetch wind data
      resetParticles();
    });

    return () => {
      map.off('move', handleMove);
      cleanup();
    };
  }, [map, enabled]);

  // Refetch wind data when altitude changes
  useEffect(() => {
    if (map && enabled && windFieldRef.current.size > 0) {
      // Clear cache and refetch with new altitude
      setLastFetchTime(0);
      generateWindField();
    }
  }, [altitude]);

  const cleanup = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (canvasRef.current) {
      canvasRef.current.remove();
      canvasRef.current = null;
    }
    particlesRef.current = [];
    windFieldRef.current.clear();
  };

  const initializeWindOverlay = () => {
    if (!map) return;

    // Create canvas overlay
    const canvas = document.createElement('canvas');
    canvas.className = 'wind-overlay-canvas';
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '400';

    const mapContainer = map.getContainer();
    mapContainer.appendChild(canvas);
    canvasRef.current = canvas;

    // Generate wind field and particles
    generateWindField();
    initializeParticles();
    animate();
  };

  const generateWindField = async () => {
    if (!map) return;

    // Prevent fetching too frequently (cache for 1 hour)
    const now = Date.now();
    if (now - lastFetchTime < 60 * 60 * 1000 && windFieldRef.current.size > 0) {
      console.log('Using cached global wind data');
      return;
    }

    // ALWAYS fetch global wind field (not viewport-based)
    // This prevents constant refetching on pan/zoom
    const latMin = -85;
    const latMax = 85;
    const lngMin = -180;
    const lngMax = 180;

    // Use a coarse grid to minimize API calls and avoid rate limits
    // 15° grid = 12 lat × 24 lng = 288 points (only ~6 batches of 50)
    const gridSize = 15;
    const totalPoints = Math.ceil((latMax - latMin) / gridSize) * Math.ceil((lngMax - lngMin) / gridSize);

    console.log(`🌍 Fetching global wind field with ${gridSize}° grid (${totalPoints} points)`);

    // Fetch wind data from backend
    await fetchWindFieldFromBackend(latMin, latMax, lngMin, lngMax, gridSize);
  };

  const fetchWindFieldFromBackend = async (
    latMin: number,
    latMax: number,
    lngMin: number,
    lngMax: number,
    gridSize: number
  ) => {
    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    setIsLoading(true);

    try {
      const params = new URLSearchParams({
        latMin: latMin.toFixed(2),
        latMax: latMax.toFixed(2),
        lngMin: lngMin.toFixed(2),
        lngMax: lngMax.toFixed(2),
        gridSize: gridSize.toFixed(2),
        altitude: altitude.toFixed(2),
      });

      const totalPoints = Math.ceil(((latMax - latMin) / gridSize) * ((lngMax - lngMin) / gridSize));
      console.log(`🌍 Fetching GLOBAL wind field: ${totalPoints} points with ${gridSize}° grid at ${altitude}km altitude`);

      const url = `/api/trajectory/wind-field?${params}`;

      const response = await fetch(url, {
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let errorMessage = `Failed to fetch wind field: ${response.status} ${response.statusText}`;

        if (contentType?.includes('application/json')) {
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
          } catch (e) {
            console.error('Failed to parse error JSON:', e);
          }
        } else {
          // Not JSON - likely HTML error page
          const text = await response.text();
          console.error('Received non-JSON response (first 500 chars):', text.substring(0, 500));
          errorMessage = `Server returned HTML instead of JSON. Status: ${response.status}. Check backend logs.`;
        }

        throw new Error(errorMessage);
      }

      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        const text = await response.text();
        console.error('Expected JSON but got content-type:', contentType);
        console.error('Response body (first 500 chars):', text.substring(0, 500));
        throw new Error('Server returned non-JSON response. Check backend logs.');
      }

      const data = await response.json();

      // Convert backend format to our WindDataPoint format
      windFieldRef.current.clear();

      data.data.forEach((windData: BackendWindData) => {
        const key = `${Math.round(windData.latitude / gridSize)},${Math.round(windData.longitude / gridSize)}`;
        windFieldRef.current.set(key, {
          lat: windData.latitude,
          lng: windData.longitude,
          u: windData.wind_u_ms,
          v: windData.wind_v_ms,
          speed: windData.wind_speed_kmh,
        });
      });

      setLastFetchTime(Date.now());
      console.log(`✅ Loaded ${windFieldRef.current.size} global wind data points at ${altitude}km altitude`);

      // Reinitialize particles with new wind field
      resetParticles();
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.log('Wind field fetch aborted');
      } else {
        console.error('Error fetching wind field:', error);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const initializeParticles = () => {
    if (!canvasRef.current || !map) return;

    const canvas = canvasRef.current;
    // MANY more particles for dense visualization like reference image
    const baseParticles = Math.floor((canvas.width * canvas.height) / 2000);
    const numParticles = Math.min(100000, baseParticles); // Increased to 100K for ultra-dense streaks

    particlesRef.current = [];

    // Density-based spawning: spawn more particles in high-wind areas
    const bounds = map.getBounds();
    const attempts = numParticles * 3; // Try more times to get density-weighted distribution
    let spawned = 0;

    for (let i = 0; i < attempts && spawned < numParticles; i++) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const latLng = map.containerPointToLatLng([x, y]);

      // Get wind speed at this location
      const wind = getWindAtLatLng(latLng.lat, latLng.lng);
      const windSpeed = wind ? wind.speed : 0;

      // Probability increases with wind speed (normalize to ~100 km/h max for common speeds)
      const spawnProbability = Math.min(0.9, 0.2 + (windSpeed / 150));

      if (Math.random() < spawnProbability) {
        particlesRef.current.push(createParticleAt(x, y, latLng.lat, latLng.lng));
        spawned++;
      }
    }

    // Fill remaining with uniform distribution if density-based didn't spawn enough
    while (particlesRef.current.length < numParticles) {
      particlesRef.current.push(createParticle());
    }
  };

  const resetParticles = () => {
    particlesRef.current = [];
    initializeParticles();
  };

  const createParticleAt = (x: number, y: number, lat: number, lng: number): Particle => {
    return {
      startLat: lat,
      startLng: lng,
      startX: x,
      startY: y,
      trail: [],
      age: Math.floor(Math.random() * 500), // Stagger spawns more
      maxAge: 3000 + Math.floor(Math.random() * 2000), // VERY long lifetime (3000-5000 frames = 50-83s)
      growthPhase: 1500 + Math.floor(Math.random() * 1000), // VERY long growth (1500-2500 frames = 25-42s)
      currentLat: lat,
      currentLng: lng,
      speed: 0,
    };
  };

  const createParticle = (): Particle => {
    if (!canvasRef.current || !map) {
      return {
        startLat: 0,
        startLng: 0,
        startX: 0,
        startY: 0,
        trail: [],
        age: 0,
        maxAge: 1200,
        growthPhase: 600,
        currentLat: 0,
        currentLng: 0,
        speed: 0,
      };
    }

    const canvas = canvasRef.current;
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const latLng = map.containerPointToLatLng([x, y]);

    return createParticleAt(x, y, latLng.lat, latLng.lng);
  };

  const getWindAtLatLng = (lat: number, lng: number): { u: number; v: number; speed: number } | null => {
    if (!map) return null;

    const zoom = map.getZoom();
    const gridSize = zoom <= 2 ? 5 : zoom <= 4 ? 4 : zoom <= 6 ? 3 : 2;

    const latIdx = Math.round(lat / gridSize);
    const lngIdx = Math.round(lng / gridSize);
    const key = `${latIdx},${lngIdx}`;

    const windData = windFieldRef.current.get(key);
    if (!windData) {
      // Try bilinear interpolation if exact point not found
      return interpolateWind(lat, lng, gridSize);
    }

    return { u: windData.u, v: windData.v, speed: windData.speed };
  };

  // Bilinear interpolation for smoother wind field
  const interpolateWind = (lat: number, lng: number, gridSize: number): { u: number; v: number; speed: number } | null => {
    // Find 4 surrounding grid points
    const lat0 = Math.floor(lat / gridSize) * gridSize;
    const lat1 = lat0 + gridSize;
    const lng0 = Math.floor(lng / gridSize) * gridSize;
    const lng1 = lng0 + gridSize;

    const winds = [
      windFieldRef.current.get(`${Math.round(lat0 / gridSize)},${Math.round(lng0 / gridSize)}`),
      windFieldRef.current.get(`${Math.round(lat0 / gridSize)},${Math.round(lng1 / gridSize)}`),
      windFieldRef.current.get(`${Math.round(lat1 / gridSize)},${Math.round(lng0 / gridSize)}`),
      windFieldRef.current.get(`${Math.round(lat1 / gridSize)},${Math.round(lng1 / gridSize)}`),
    ];

    // If any surrounding points are missing, return null
    if (winds.some((w) => !w)) return null;

    // Bilinear interpolation weights
    const wx = (lng - lng0) / gridSize;
    const wy = (lat - lat0) / gridSize;

    const u =
      winds[0]!.u * (1 - wx) * (1 - wy) +
      winds[1]!.u * wx * (1 - wy) +
      winds[2]!.u * (1 - wx) * wy +
      winds[3]!.u * wx * wy;

    const v =
      winds[0]!.v * (1 - wx) * (1 - wy) +
      winds[1]!.v * wx * (1 - wy) +
      winds[2]!.v * (1 - wx) * wy +
      winds[3]!.v * wx * wy;

    const speed = Math.sqrt(u * u + v * v) * 3.6; // Convert m/s to km/h

    return { u, v, speed };
  };

  const updateAllPositions = () => {
    if (!map) return;

    particlesRef.current.forEach((particle) => {
      // Update start position
      const startPoint = map.latLngToContainerPoint([particle.startLat, particle.startLng]);
      particle.startX = startPoint.x;
      particle.startY = startPoint.y;

      // Update all trail points
      particle.trail.forEach((point) => {
        const screenPoint = map.latLngToContainerPoint([point.lat, point.lng]);
        point.x = screenPoint.x;
        point.y = screenPoint.y;
      });
    });
  };

  const animate = () => {
    if (!canvasRef.current || !map) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw heat map background first
    drawHeatMap(ctx, canvas);

    // Draw particles on top
    drawParticles(ctx, canvas);

    animationFrameRef.current = requestAnimationFrame(animate);
  };

  const drawHeatMap = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    if (!map) return;

    const zoom = map.getZoom();

    // HUGE radius for ultra-smooth blending with coarse 15° grid
    // Need massive overlap to blend only 288 points smoothly across the globe
    const baseRadius = zoom <= 2 ? 800 : zoom <= 4 ? 600 : zoom <= 6 ? 450 : 350;

    // Use additive blending for smoother color mixing
    ctx.globalCompositeOperation = 'lighter';

    windFieldRef.current.forEach((windData) => {
      const point = map.latLngToContainerPoint([windData.lat, windData.lng]);

      // Skip if outside canvas with huge padding (since radius is large)
      if (point.x < -baseRadius || point.x > canvas.width + baseRadius ||
          point.y < -baseRadius || point.y > canvas.height + baseRadius) {
        return;
      }

      const color = getWindSpeedColorRGB(windData.speed);
      // Very subtle alpha for ultra-smooth blending
      const baseAlpha = Math.min(windData.speed / 150, 0.08);

      // Draw HUGE gradient with very smooth falloff
      const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, baseRadius);
      gradient.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${baseAlpha})`);
      gradient.addColorStop(0.15, `rgba(${color.r}, ${color.g}, ${color.b}, ${baseAlpha * 0.9})`);
      gradient.addColorStop(0.35, `rgba(${color.r}, ${color.g}, ${color.b}, ${baseAlpha * 0.6})`);
      gradient.addColorStop(0.6, `rgba(${color.r}, ${color.g}, ${color.b}, ${baseAlpha * 0.3})`);
      gradient.addColorStop(0.8, `rgba(${color.r}, ${color.g}, ${color.b}, ${baseAlpha * 0.08})`);
      gradient.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);

      ctx.fillStyle = gradient;
      ctx.fillRect(point.x - baseRadius, point.y - baseRadius, baseRadius * 2, baseRadius * 2);
    });

    // Apply blur for ultimate smoothness (like reference image)
    ctx.filter = 'blur(3px)';
    ctx.drawImage(canvas, 0, 0);
    ctx.filter = 'none';

    // Reset composite operation for particles
    ctx.globalCompositeOperation = 'source-over';
  };

  const drawParticles = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    if (!map) return;

    const zoom = map.getZoom();

    // Zoom-based scaling: ULTRA long streaks to match reference image
    const zoomScale = zoom <= 2 ? 5.0 : zoom <= 4 ? 4.0 : zoom <= 6 ? 3.5 : 3.0;
    const lineWidth = 1.5 * zoomScale;
    const maxTrailLength = Math.floor(600 * zoomScale); // ULTRA long trails for flowing effect

    particlesRef.current.forEach((particle, index) => {
      // Only extend the line if still growing
      if (particle.age < particle.growthPhase) {
        const wind = getWindAtLatLng(particle.currentLat, particle.currentLng);

        if (wind) {
          // Move the head forward - sample more frequently for smoother curves
          const speedFactor = 0.15; // Slower step for more detail
          const dlat = (wind.v * speedFactor * 0.001);
          const dlng = (wind.u * speedFactor * 0.001) / Math.cos(particle.currentLat * Math.PI / 180);

          particle.currentLat += dlat;
          particle.currentLng += dlng;
          particle.speed = wind.speed;

          const point = map.latLngToContainerPoint([particle.currentLat, particle.currentLng]);

          // Add point to trail
          particle.trail.push({
            lat: particle.currentLat,
            lng: particle.currentLng,
            x: point.x,
            y: point.y,
          });

          // Limit trail length based on zoom
          if (particle.trail.length > maxTrailLength) {
            particle.trail.shift();
          }
        }
      }

      particle.age++;

      // Reset particle if too old or out of bounds
      if (particle.age > particle.maxAge ||
          (particle.trail.length > 0 &&
           (particle.trail[particle.trail.length - 1].x < -100 ||
            particle.trail[particle.trail.length - 1].x > canvas.width + 100 ||
            particle.trail[particle.trail.length - 1].y < -100 ||
            particle.trail[particle.trail.length - 1].y > canvas.height + 100))) {
        particlesRef.current[index] = createParticle();
        return;
      }

      // Draw the line from start point through trail
      if (particle.trail.length > 1) {
        const color = getWindSpeedColorRGB(particle.speed);

        // Calculate alpha based on lifecycle
        let alpha: number;
        if (particle.age < 150) {
          // Fade in (longer fade for longer lifetime)
          alpha = particle.age / 150;
        } else if (particle.age > particle.maxAge - 400) {
          // Fade out (longer fade for longer lifetime)
          alpha = (particle.maxAge - particle.age) / 400;
        } else {
          alpha = 1;
        }

        // Brightness based on speed - brighter for faster winds
        const brightness = Math.min(1.5, 0.8 + (particle.speed / 60));

        // Draw the complete line with zoom-scaled width - MORE VISIBLE
        ctx.strokeStyle = `rgba(${color.r * brightness}, ${color.g * brightness}, ${color.b * brightness}, ${alpha * 0.7})`;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        ctx.moveTo(particle.startX, particle.startY);

        // Draw smooth curve through all points
        for (let i = 0; i < particle.trail.length - 1; i++) {
          const xc = (particle.trail[i].x + particle.trail[i + 1].x) / 2;
          const yc = (particle.trail[i].y + particle.trail[i + 1].y) / 2;
          ctx.quadraticCurveTo(particle.trail[i].x, particle.trail[i].y, xc, yc);
        }

        // Draw to the last point
        if (particle.trail.length > 0) {
          const lastIdx = particle.trail.length - 1;
          ctx.lineTo(particle.trail[lastIdx].x, particle.trail[lastIdx].y);
        }

        ctx.stroke();
      }
    });
  };

  return null;
}

/**
 * Get RGB color components based on wind speed
 */
function getWindSpeedColorRGB(speed: number): { r: number; g: number; b: number } {
  if (speed < 15) {
    const t = speed / 15;
    return {
      r: Math.floor(30 + t * 30),
      g: Math.floor(60 + t * 100),
      b: Math.floor(180 + t * 75),
    };
  } else if (speed < 35) {
    const t = (speed - 15) / 20;
    return {
      r: Math.floor(60 + t * 20),
      g: Math.floor(160 + t * 95),
      b: Math.floor(255 - t * 105),
    };
  } else if (speed < 60) {
    const t = (speed - 35) / 25;
    return {
      r: Math.floor(80 - t * 30),
      g: Math.floor(255 - t * 35),
      b: Math.floor(150 - t * 100),
    };
  } else if (speed < 85) {
    const t = (speed - 60) / 25;
    return {
      r: Math.floor(50 + t * 200),
      g: Math.floor(220 + t * 35),
      b: Math.floor(50 - t * 50),
    };
  } else if (speed < 110) {
    const t = (speed - 85) / 25;
    return {
      r: 250,
      g: Math.floor(255 - t * 80),
      b: 0,
    };
  } else {
    const t = Math.min((speed - 110) / 40, 1);
    return {
      r: 250,
      g: Math.floor(175 - t * 175),
      b: 0,
    };
  }
}
