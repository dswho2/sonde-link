import React, { useState, useEffect } from 'react';

interface TimeSliderProps {
    onTimeChange: (hourOffset: number) => void;
    maxHours: number;
}

export const TimeSlider: React.FC<TimeSliderProps> = ({ onTimeChange, maxHours = 24 }) => {
    // value represents "hours ago" (positive number). 0 = now.
    // maxHours is 24, but data is from 0 to 23 (current hour counts as hour 0)
    const actualMaxHours = maxHours - 1; // 23 hours back from current
    const [value, setValue] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    useEffect(() => {
        let interval: any;
        if (isPlaying) {
            interval = setInterval(() => {
                setValue((prev) => {
                    // Count down from actualMaxHours to 0, then loop back
                    if (prev <= 0) {
                        // Loop back to start instead of stopping
                        return actualMaxHours;
                    }
                    return prev - 1;
                });
            }, 150); // Speed: ~6-7 hours per second
        }
        return () => clearInterval(interval);
    }, [isPlaying, actualMaxHours]);

    // Notify parent
    useEffect(() => {
        // Parent expects negative offset (-24 to 0) for history
        onTimeChange(-value);
    }, [value, onTimeChange]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        setValue(val);
    };

    return (
        <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-white/90 backdrop-blur p-4 rounded-xl shadow-xl flex flex-col items-center gap-2 z-[1000] min-w-[300px]">
            <div className="flex items-center gap-4 w-full">
                <button
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-full p-2 w-10 h-10 flex items-center justify-center transition-colors shadow-sm"
                    onClick={() => {
                        if (value <= 0 && !isPlaying) {
                            // If at the end and not playing, reset to start when play is pressed
                            setValue(actualMaxHours);
                        }
                        setIsPlaying(!isPlaying);
                    }}
                >
                    {isPlaying ? (
                        // Pause Icon
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                            <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                        </svg>
                    ) : (
                        // Play Icon
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-1">
                            <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                        </svg>
                    )}
                </button>

                <div className="flex-1 flex flex-col pt-1">
                    <input
                        type="range"
                        min="0"
                        max={actualMaxHours}
                        step="1"
                        value={value}
                        onChange={handleChange}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                        style={{ direction: 'rtl' }}
                    />
                    <div className="flex justify-between text-xs text-gray-500 font-medium px-1 mt-1">
                        <span>T-{actualMaxHours}h</span>
                        <span>Now</span>
                    </div>
                </div>
            </div>

            <div className="text-sm font-semibold text-gray-700">
                {value === 0 ? 'Live Data' : `Historical View: T-${value} hours`}
            </div>
        </div>
    );
};

export default TimeSlider;
