/**
 * Home Page Component
 * Landing page with project information and navigation to the map
 */

import { Link } from 'react-router-dom';
import mapGif from '../assets/map.gif';
import analysisGif from '../assets/analysis.gif';
import detailsGif from '../assets/details.gif';

export default function HomePage() {
    const scrollToSection = (id: string) => {
        const element = document.getElementById(id);
        if (element) {
            const offset = 80; // Account for sticky nav height
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - offset;
            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800">
            {/* Sticky Navigation */}
            <nav className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700">
                <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
                    <button
                        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                        className="text-xl font-bold text-white hover:text-blue-300 transition-colors"
                    >
                        SondeLink
                    </button>
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => scrollToSection('features')}
                            className="text-sm text-slate-300 hover:text-white transition-colors"
                        >
                            Features
                        </button>
                        <button
                            onClick={() => scrollToSection('demos')}
                            className="text-sm text-slate-300 hover:text-white transition-colors"
                        >
                            Demos
                        </button>
                        <button
                            onClick={() => scrollToSection('technical')}
                            className="text-sm text-slate-300 hover:text-white transition-colors"
                        >
                            Technical
                        </button>
                        <button
                            onClick={() => scrollToSection('design')}
                            className="text-sm text-slate-300 hover:text-white transition-colors"
                        >
                            Design & Future
                        </button>
                        <button
                            onClick={() => scrollToSection('tech-stack')}
                            className="text-sm text-slate-300 hover:text-white transition-colors"
                        >
                            Tech Stack
                        </button>
                        <Link
                            to="/map"
                            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-full font-medium transition-all hover:shadow-lg hover:shadow-blue-500/30"
                        >
                            View Map →
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <header className="relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%20100%20100%22%3E%3Ccircle%20cx%3D%2250%22%20cy%3D%2250%22%20r%3D%221%22%20fill%3D%22%23ffffff10%22%2F%3E%3C%2Fsvg%3E')] opacity-30"></div>

                <div className="relative z-10 max-w-6xl mx-auto px-8 py-20 text-center">
                    <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 leading-tight">
                        Weather Balloon 
                        <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">
                            Mission Control
                        </span>
                    </h1>
                    <p className="text-xl text-blue-100/80 max-w-2xl mx-auto mb-10">
                        Track and predict the movement of WindBorne's global weather balloon constellation in real-time.
                    </p>
                    <Link
                        to="/map"
                        className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white px-8 py-4 rounded-full text-lg font-semibold transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-1"
                    >
                        <span>Explore the Map</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </Link>
                </div>
            </header>

            {/* Features Section */}
            <section id="features" className="py-20 px-8 bg-slate-900/50">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-3xl font-bold text-white text-center mb-12">Key Features</h2>
                    <div className="grid md:grid-cols-3 gap-8">
                        <FeatureCard
                            title="Real-Time Tracking"
                            description="Live positions of 1,000+ weather balloons updated hourly from the Windborne API, with persistent tracking IDs across the last 24 hour data."
                        />
                        <FeatureCard
                            title="24-Hour History"
                            description="Interactive time slider to replay historical balloon positions. Scrub through the past 24 hours to see movement patterns."
                        />
                        <FeatureCard
                            title="Trajectory Prediction"
                            description="Predict future balloon positions using hybrid algorithms combining historical velocity and wind data from Open-Meteo."
                        />
                    </div>
                </div>
            </section>

            {/* Feature Demos Section */}
            <section id="demos" className="py-20 px-8">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-3xl font-bold text-white text-center mb-12">See It in Action</h2>
                    <div className="space-y-16">
                        <DemoCard
                            gif={mapGif}
                            title="Interactive 24-Hour Playback"
                            description="Drag the time slider to scrub through the past 24 hours of balloon positions. Watch the entire constellation shift as weather patterns push balloons across continents. The slider updates all 1,000+ balloon markers in real-time."
                            reverse={false}
                        />
                        <DemoCard
                            gif={detailsGif}
                            title="Balloon Detail Panel"
                            description="Click any balloon to see its full stats: current altitude, coordinates, velocity, and trajectory predictions. The panel shows where the balloon has been and where it's likely headed based on wind patterns and historical movement."
                            reverse={true}
                        />
                        <DemoCard
                            gif={analysisGif}
                            title="Accuracy Analysis"
                            description="Compare predicted vs actual balloon positions over time. The chart visualizes prediction error to show how well the hybrid algorithm (combining velocity-based and wind-based forecasting) performs. Lower values mean more accurate predictions."
                            reverse={false}
                        />
                    </div>
                </div>
            </section>

            {/* Technical Approach Section */}
            <section id="technical" className="py-20 px-8">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-bold text-white text-center mb-12">Technical Approach</h2>

                    <div className="space-y-12">
                        <TechSection
                            title="Tracking Algorithm"
                            content="Balloons are tracked across hourly snapshots using an R-tree spatial index for efficient proximity matching. Velocity-based position prediction, combined with distance and altitude scoring, maintains balloon identity between snapshots. IDs persist in SQLite to maintain consistency across server restarts."
                        />

                        <TechSection
                            title="Persistent Storage"
                            content="SQLite with better-sqlite3 provides zero-dependency persistence, with an adapter pattern enabling straightforward migration to PostgreSQL if needed. Composite keys (balloon_id, timestamp) ensure data integrity, while wind data caching minimizes external API calls."
                        />

                        <TechSection
                            title="Wind Integration"
                            content="Open-Meteo's free atmospheric API provides wind vectors at multiple pressure levels. Altitude-to-pressure conversion enables accurate wind data retrieval for trajectory prediction, which combines velocity-based and wind-based forecasting for improved accuracy."
                        />

                        <TechSection
                            title="Map Visualization"
                            content="Leaflet with marker clustering handles 1,000+ balloons with smooth performance. World wrapping enables infinite horizontal scrolling, with toggleable clustering and altitude-based color coding for visual data segmentation."
                        />

                        <TechSection
                            title="Performance"
                            content="Client-side position interpolation using React's useMemo enables smooth time slider scrubbing without additional API requests. Backend caching of API responses and database connection pooling maintain fast response times."
                        />
                    </div>
                </div>
            </section>

            {/* Design Choices & Future Work Section */}
            <section id="design" className="py-20 px-8 bg-slate-900/50">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-bold text-white text-center mb-12">Design Choices & Future Work</h2>

                    <div className="space-y-8">
                        <div className="bg-slate-800/50 rounded-2xl p-8 space-y-6">
                            <h3 className="text-xl font-semibold text-blue-300 mb-4">Key Design Decisions</h3>
                            <ChoiceItem
                                question="Why React over Vue or Angular?"
                                answer="React's lightweight nature and useMemo/useCallback hooks make it ideal for performance-critical map rendering with frequent position updates. The component model maps cleanly to map features (markers, trajectories, panels). Vue would work fine too, but React's ecosystem has better Leaflet integration. Angular's heavier framework would be overkill for this use case."
                            />
                            <ChoiceItem
                                question="Why Leaflet instead of Mapbox or Google Maps?"
                                answer="Leaflet is open-source with no API costs or rate limits, crucial for a prototype that might get heavy traffic. It handles 1,000+ markers well with clustering, supports world wrapping natively, and has a cleaner API for custom overlays. Mapbox has better aesthetics but isn't necessary when the focus is on data visualization rather than base map beauty."
                            />
                            <ChoiceItem
                                question="Why not use WebSockets for real-time updates?"
                                answer="The Windborne API updates hourly, making WebSockets overkill. Polling with configurable refresh intervals keeps the architecture simple while matching the data cadence. For sub-minute updates, WebSockets or Server-Sent Events would make more sense."
                            />
                            <ChoiceItem
                                question="How does balloon tracking handle data gaps and jumps?"
                                answer="The algorithm uses a 300km matching threshold (accounting for jet stream velocities of ~250 km/h). Balloons beyond this threshold are marked as lost and reassigned new IDs. This balances tracking continuity with the reality that balloons do burst, fall, or temporarily drop from the feed."
                            />
                        </div>

                        <div className="bg-slate-800/50 rounded-2xl p-8 space-y-6">
                            <h3 className="text-xl font-semibold text-blue-300 mb-4">Potential Enhancements</h3>
                            <ChoiceItem
                                question="Tawhiri API Integration"
                                answer="Tawhiri provides high-resolution wind predictions specifically designed for balloon trajectory forecasting. Integrating it would significantly improve path prediction accuracy compared to Open-Meteo's general atmospheric data, especially for high-altitude balloons in complex wind regimes."
                            />
                            <ChoiceItem
                                question="SondeHub API v2 Integration"
                                answer="SondeHub aggregates real-time radiosonde (weather balloon) data from global amateur radio networks. Cross-referencing Windborne positions with SondeHub telemetry could validate tracking accuracy, detect anomalies, and potentially source actual atmospheric measurements (temperature, pressure, humidity) for richer visualization."
                            />
                            <ChoiceItem
                                question="Telemetry Data Visualization"
                                answer="If actual sensor data were available (temperature, pressure, humidity profiles), the app could display vertical atmospheric profiles, detect fronts and jet streams, and show how balloon trajectories correlate with weather phenomena. Time-series charts could reveal measurement quality and sensor drift over balloon lifetime."
                            />
                            <ChoiceItem
                                question="Predictive Flight Path Optimization"
                                answer="With historical flight data and wind patterns, machine learning could predict optimal launch times and locations for target destinations. This would be valuable for mission planning, whether for weather data collection or point-to-point navigation experiments."
                            />
                            <ChoiceItem
                                question="OSSE for Data Assimilation Impact"
                                answer="An Observing System Simulation Experiment could quantify how Windborne's balloon observations improve weather forecast accuracy. By simulating the impact of different balloon constellation configurations on numerical weather prediction models, this would demonstrate the value of strategic balloon placement and help optimize future deployment strategies."
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* Tech Stack */}
            <section id="tech-stack" className="py-20 px-8">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="text-3xl font-bold text-white mb-8">Tech Stack</h2>
                    <div className="flex flex-wrap justify-center gap-4">
                        {['React', 'TypeScript', 'Vite', 'Tailwind CSS', 'Node.js', 'Express', 'SQLite', 'Leaflet', 'Open-Meteo API'].map((tech) => (
                            <span key={tech} className="px-4 py-2 bg-slate-800 rounded-full text-blue-300 text-sm font-medium">
                                {tech}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* Footer CTA */}
            <footer className="py-16 px-8 text-center border-t border-slate-700">
                <h3 className="text-2xl font-bold text-white mb-4">Ready to explore?</h3>
                <p className="text-blue-100/70 mb-8">Check out the live map and see where the balloons are right now.</p>
                <Link
                    to="/map"
                    className="inline-flex items-center gap-2 bg-white text-slate-900 px-8 py-4 rounded-full text-lg font-semibold hover:bg-blue-100 transition-colors"
                >
                    Launch Map Viewer
                </Link>
                <p className="mt-12 text-sm text-slate-500">
                    Built for Windborne Systems Web Development Challenge
                </p>
            </footer>
        </div>
    );
}

function FeatureCard({ icon, title, description }: { icon?: string; title: string; description: string }) {
    return (
        <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-6 hover:border-blue-500/50 transition-colors">
            {icon && <span className="text-4xl mb-4 block">{icon}</span>}
            <h3 className="text-xl font-semibold text-white mb-2">{title}</h3>
            <p className="text-slate-400 text-sm leading-relaxed">{description}</p>
        </div>
    );
}

function TechSection({ title, content }: { title: string; content: string }) {
    return (
        <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6">
            <h3 className="text-xl font-semibold text-white mb-3">{title}</h3>
            <p className="text-slate-300 leading-relaxed">{content}</p>
        </div>
    );
}

function ChoiceItem({ question, answer }: { question: string; answer: string }) {
    return (
        <div className="border-b border-slate-700 pb-6 last:border-0 last:pb-0">
            <h4 className="font-semibold text-blue-300 mb-2">{question}</h4>
            <p className="text-slate-400 text-sm leading-relaxed">{answer}</p>
        </div>
    );
}

function DemoCard({ gif, title, description, reverse }: { gif: string; title: string; description: string; reverse: boolean }) {
    return (
        <div className={`flex flex-col ${reverse ? 'md:flex-row-reverse' : 'md:flex-row'} gap-8 items-center`}>
            <div className="flex-1">
                <img
                    src={gif}
                    alt={title}
                    className="rounded-xl shadow-2xl border border-slate-700"
                />
            </div>
            <div className="flex-1">
                <h3 className="text-2xl font-bold text-white mb-4">{title}</h3>
                <p className="text-slate-300 leading-relaxed">{description}</p>
            </div>
        </div>
    );
}
