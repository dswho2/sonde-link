import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import 'leaflet/dist/leaflet.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import './index.css'
import App from './App.tsx'

// Create React Query client with optimized cache settings
// Data updates hourly, so we can cache aggressively (5 minutes)
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 300000, // 5 minutes - safe since balloon data updates hourly
      gcTime: 600000, // 10 minutes - keep in cache for this long
      refetchOnWindowFocus: false, // Don't refetch when user returns to tab
      retry: 2, // Retry failed requests twice
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
