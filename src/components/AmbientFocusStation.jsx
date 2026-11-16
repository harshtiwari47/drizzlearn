import React, { useState, useEffect, useRef } from 'react';

const TRACKS = [
  {
    id: 'the-deep',
    title: 'The Deep',
    src: '/the-deep.mp3',
    centerLabel: 'THE DEEP',
  },
  {
    id: 'the-kiss-of-spring',
    title: 'The Kiss Of Spring',
    src: '/the-kiss-of-spring.mp3',
    centerLabel: 'THE KISS OF SPRING',
  },
  {
    id: 'close-your-eyes',
    title: 'Close Your Eyes',
    src: '/close-your-eyes.mp3',
    centerLabel: 'CLOSE YOUR EYES',
  },
];

export const AmbientFocusStation = React.memo(function AmbientFocusStation({ onPlayStateChange }) {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  const activeTrack = TRACKS[currentTrackIndex];

  // Notify listeners and window when music play state changes
  useEffect(() => {
    onPlayStateChange?.(isPlaying);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('drizzlearn:music-state', { detail: { isPlaying } }));
    }
  }, [isPlaying, onPlayStateChange]);

  useEffect(() => {
    const audio = new Audio(activeTrack.src);
    audio.loop = true;
    audio.volume = volume;
    audioRef.current = audio;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const handleEnded = () => {
      setIsPlaying(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    if (isPlaying) {
      audio.play().catch((err) => {
        console.warn('Audio play error:', err);
      });
    }

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audioRef.current = null;
    };
  }, [currentTrackIndex]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  const handleTogglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.error('Audio play error:', err);
      });
    }
  };

  const handleSelectTrack = (index) => {
    if (index === currentTrackIndex) {
      handleTogglePlay();
      return;
    }
    setCurrentTime(0);
    setCurrentTrackIndex(index);
  };

  const handleNextTrack = () => {
    setCurrentTime(0);
    setCurrentTrackIndex((prev) => (prev + 1) % TRACKS.length);
  };

  const handlePrevTrack = () => {
    setCurrentTime(0);
    setCurrentTrackIndex((prev) => (prev - 1 + TRACKS.length) % TRACKS.length);
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const formatTime = (secs) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="gramophone-station-card relative flex flex-col p-6 overflow-hidden" aria-label={`Vinyl Player - ${activeTrack.title}`}>
      {/* Background Pink/Cyan Ambient Glow */}
      <div className="gramophone-ambient-aura" aria-hidden="true" />

      {/* Top Header Row */}
      <div className="flex items-center justify-between relative z-10 mb-1">
        <h3 className="text-2xl font-bold text-white tracking-tight">
          {activeTrack.title}
        </h3>

        {/* Start / Pause Button */}
        <button
          type="button"
          onClick={handleTogglePlay}
          className="gramophone-play-btn flex items-center gap-2 px-5 py-2 rounded-full font-bold text-xs uppercase tracking-wider transition-all"
        >
          <span>{isPlaying ? '⏸ Pause' : '▶ Play'}</span>
        </button>
      </div>

      {/* Centerpiece: Tactile Skeuomorphic Turntable Deck */}
      <div className="flex items-center justify-center my-5 relative z-10">
        <div
          onClick={handleTogglePlay}
          className="turntable-hardware-deck relative flex items-center justify-center cursor-pointer group"
          title={isPlaying ? `Click to Pause ${activeTrack.title}` : `Click to Play ${activeTrack.title}`}
        >
          <svg
            className="turntable-deck-svg select-none"
            width="230"
            height="198"
            viewBox="0 0 220 190"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              {/* White Enamel Deck Plinth */}
              <linearGradient id="deckPlinthGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="65%" stopColor="#f1f5f9" />
                <stop offset="100%" stopColor="#cbd5e1" />
              </linearGradient>

              {/* Vinyl Grooves Gloss */}
              <radialGradient id="turntableVinylGrooves" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="6%" stopColor="#1e293b" />
                <stop offset="18%" stopColor="#020617" />
                <stop offset="35%" stopColor="#1e293b" />
                <stop offset="42%" stopColor="#090d16" />
                <stop offset="60%" stopColor="#334155" />
                <stop offset="72%" stopColor="#0f172a" />
                <stop offset="85%" stopColor="#1e293b" />
                <stop offset="100%" stopColor="#020617" />
              </radialGradient>

              {/* Chrome Tonearm Gradient */}
              <linearGradient id="chromeArm" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f8fafc" />
                <stop offset="30%" stopColor="#cbd5e1" />
                <stop offset="60%" stopColor="#64748b" />
                <stop offset="100%" stopColor="#f1f5f9" />
              </linearGradient>

              {/* Chrome Pivot Base */}
              <linearGradient id="chromePivot" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="45%" stopColor="#94a3b8" />
                <stop offset="100%" stopColor="#334155" />
              </linearGradient>

              {/* Pitch Slider Track */}
              <linearGradient id="sliderKnob" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#475569" />
                <stop offset="100%" stopColor="#0f172a" />
              </linearGradient>
            </defs>

            {/* Deck Drop Shadow */}
            <rect x="12" y="14" width="196" height="166" rx="28" fill="rgba(0,0,0,0.4)" filter="blur(8px)" />

            {/* Main Rounded Square Turntable Body (White Enamel Finish) */}
            <rect
              x="10"
              y="10"
              width="200"
              height="170"
              rx="28"
              fill="url(#deckPlinthGrad)"
              stroke="#ffffff"
              strokeWidth="1.5"
            />
            {/* Inner Sub-bevel Highlight */}
            <rect x="12" y="12" width="196" height="166" rx="26" stroke="rgba(255,255,255,0.8)" strokeWidth="1" fill="none" />

            {/* Turntable Platter Well (Circular Indentation) */}
            <circle cx="86" cy="95" r="70" fill="#090d16" stroke="#94a3b8" strokeWidth="1.2" opacity="0.3" />

            {/* Spinning Vinyl Record Group */}
            <g
              className={`turntable-vinyl-spin ${isPlaying ? 'is-spinning' : ''}`}
              style={{ transformOrigin: '86px 95px' }}
            >
              {/* Outer Vinyl Edge */}
              <circle cx="86" cy="95" r="67" fill="#090d16" stroke="#1e293b" strokeWidth="1.5" />
              {/* Vinyl Microgroove Grooves */}
              <circle cx="86" cy="95" r="65" fill="url(#turntableVinylGrooves)" />
              {/* Vinyl Track Ribs */}
              <circle cx="86" cy="95" r="54" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" fill="none" />
              <circle cx="86" cy="95" r="42" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" fill="none" />
              <circle cx="86" cy="95" r="32" stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" fill="none" />

              {/* Center Vinyl Label Sticker (Classic Pure Red) */}
              <circle cx="86" cy="95" r="23" fill="#ef4444" stroke="#ffffff" strokeWidth="0.8" />
              <circle cx="86" cy="95" r="16" fill="none" stroke="rgba(0,0,0,0.15)" strokeWidth="0.8" />

              {/* Tiny Song Title Printed on Vinyl Center Label */}
              <text
                x="86"
                y="92.5"
                fill="#ffffff"
                fontSize={activeTrack.centerLabel.length > 15 ? "3.4" : "4.2"}
                fontWeight="bold"
                textAnchor="middle"
                fontFamily="Space Grotesk, sans-serif"
                letterSpacing="0.3"
              >
                {activeTrack.centerLabel}
              </text>

              {/* Center Metal Spindle */}
              <circle cx="86" cy="95" r="4.5" fill="#e2e8f0" stroke="#334155" strokeWidth="0.8" />
              <circle cx="86" cy="95" r="2" fill="#475569" />
            </g>

            {/* Bottom-Left Pitch / Speed Switch */}
            <g transform="translate(26, 134) rotate(-32)">
              <rect x="0" y="0" width="18" height="3.5" rx="1.5" fill="#334155" />
              <rect x="6" y="-5" width="6" height="13.5" rx="2" fill="url(#sliderKnob)" stroke="#64748b" strokeWidth="0.8" />
            </g>

            {/* Top-Right Tonearm Pivot Housing */}
            <circle cx="172" cy="46" r="14" fill="rgba(0,0,0,0.2)" />
            <rect x="165" y="30" width="14" height="26" rx="7" fill="url(#chromePivot)" stroke="#cbd5e1" strokeWidth="1" />
            <circle cx="172" cy="42" r="6" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="0.8" />

            {/* Resting Arm Rest Catch */}
            <rect x="168" y="146" width="8" height="12" rx="2" fill="#cbd5e1" stroke="#64748b" strokeWidth="0.8" />
            <line x1="168" y1="152" x2="176" y2="152" stroke="#475569" strokeWidth="1" />

            {/* Tonearm & Stylus Needle Group */}
            <g
              className={`turntable-tonearm ${isPlaying ? 'is-engaged' : 'is-rested'}`}
              style={{ transformOrigin: '172px 42px' }}
            >
              {/* Chrome Tonearm Shaft */}
              <path
                d="M 172 42 L 172 120 C 172 136 170 142 168 152"
                stroke="url(#chromeArm)"
                strokeWidth="4"
                strokeLinecap="round"
                fill="none"
                filter="drop-shadow(2px 3px 3px rgba(0,0,0,0.35))"
              />

              {/* Angled Cartridge Headshell & Stylus Needle */}
              <g transform="translate(168, 152) rotate(-22)">
                <rect x="-6" y="-2" width="12" height="18" rx="3" fill="#1e293b" stroke="#475569" strokeWidth="0.8" />
                <line x1="0" y1="16" x2="0" y2="20" stroke="#cbd5e1" strokeWidth="1.5" strokeLinecap="round" />
                {/* Finger lift */}
                <path d="M 6 4 Q 10 3 11 0" stroke="#94a3b8" strokeWidth="1.2" fill="none" />
              </g>
            </g>
          </svg>
        </div>
      </div>

      {/* Music Track Progress Scrub Bar */}
      <div className="flex flex-col gap-2 mb-3 relative z-10">
        <input
          type="range"
          min="0"
          max={duration || 100}
          step="0.5"
          value={currentTime}
          onChange={handleSeek}
          className="gramophone-track-progress w-full cursor-pointer"
          style={{
            background: `linear-gradient(to right, #eab308 0%, #facc15 ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.12) ${(currentTime / (duration || 1)) * 100}%, rgba(255, 255, 255, 0.12) 100%)`
          }}
          aria-label="Track progress seek"
        />
        <div className="flex items-center justify-between text-[11px] font-mono">
          <span className="text-yellow-400 font-semibold">{formatTime(currentTime)}</span>
          <span className="text-slate-400">{formatTime(duration)}</span>
        </div>
      </div>

      {/* Track Selector Bar (Album collection with mini album thumbnails) */}
      <div className="flex items-center justify-between gap-2 mb-3.5 relative z-10">
        <button
          type="button"
          onClick={handlePrevTrack}
          className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs transition-colors shrink-0"
          aria-label="Previous track"
          title="Previous track"
        >
          ⏮
        </button>
        <div className="gramophone-track-scroller flex items-center gap-2 flex-1 overflow-x-auto py-1 px-1">
          {TRACKS.map((t, idx) => {
            const isSelected = idx === currentTrackIndex;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTrack(idx)}
                className={`track-album-chip px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 shrink-0 border cursor-pointer ${
                  isSelected
                    ? 'bg-amber-400/20 border-amber-400/60 text-amber-200'
                    : 'bg-white/5 border-white/10 text-slate-300 hover:text-white hover:bg-white/10'
                }`}
                title={`Play ${t.title}`}
              >
                {/* Mini Album Cover Thumbnail */}
                <div className="album-mini-thumb relative w-[22px] h-[22px] rounded-[5px] overflow-hidden shrink-0 shadow-xs border border-white/20 flex items-center justify-center">
                  <svg className="w-full h-full" viewBox="0 0 24 24" fill="none">
                    <defs>
                      <linearGradient id={`thumbDeep-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#0284c7" />
                        <stop offset="100%" stopColor="#082f49" />
                      </linearGradient>
                      <linearGradient id={`thumbSpring-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#059669" />
                        <stop offset="100%" stopColor="#064e3b" />
                      </linearGradient>
                      <linearGradient id={`thumbEyes-${idx}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#7c3aed" />
                        <stop offset="100%" stopColor="#2e1065" />
                      </linearGradient>
                    </defs>
                    {t.id === 'the-deep' && (
                      <>
                        <rect width="24" height="24" fill={`url(#thumbDeep-${idx})`} />
                        <path d="M2 13 Q7 9 12 13 T22 13" stroke="#7dd3fc" strokeWidth="1.6" strokeLinecap="round" />
                        <path d="M2 17 Q7 13 12 17 T22 17" stroke="#38bdf8" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
                        <circle cx="12" cy="7" r="2.8" fill="#bae6fd" />
                      </>
                    )}
                    {t.id === 'the-kiss-of-spring' && (
                      <>
                        <rect width="24" height="24" fill={`url(#thumbSpring-${idx})`} />
                        <circle cx="12" cy="12" r="5" fill="#f472b6" opacity="0.95" />
                        <circle cx="12" cy="12" r="2.2" fill="#fef08a" />
                        <path d="M12 4v3M12 17v3M4 12h3M17 12h3" stroke="#a7f3d0" strokeWidth="1.4" strokeLinecap="round" />
                      </>
                    )}
                    {t.id === 'close-your-eyes' && (
                      <>
                        <rect width="24" height="24" fill={`url(#thumbEyes-${idx})`} />
                        <path d="M14 6 A5.5 5.5 0 1 1 8.5 17 A6.5 6.5 0 0 0 14 6 Z" fill="#fde047" />
                        <circle cx="17.5" cy="8" r="0.9" fill="#ffffff" />
                        <circle cx="7" cy="6" r="0.8" fill="#ffffff" />
                      </>
                    )}
                  </svg>
                </div>

                <span className="whitespace-nowrap font-semibold tracking-tight">{t.title}</span>

                {isSelected && isPlaying && (
                  <span className="mini-equalizer flex items-end gap-[1.5px] h-2.5 ml-0.5" aria-hidden="true">
                    <span className="eq-bar eq-bar-1" />
                    <span className="eq-bar eq-bar-2" />
                    <span className="eq-bar eq-bar-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={handleNextTrack}
          className="px-2 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white border border-white/10 text-xs transition-colors shrink-0"
          aria-label="Next track"
          title="Next track"
        >
          ⏭
        </button>
      </div>

      {/* Volume Slider Bar (Clean & Minimal) */}
      <div className="flex items-center gap-3 pt-3 border-t border-white/10 relative z-10">
        <span className="text-xs text-slate-300 font-mono">Volume</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="gramophone-slider flex-1 cursor-pointer"
          style={{
            background: `linear-gradient(to right, #eab308 0%, #facc15 ${volume * 100}%, rgba(255, 255, 255, 0.12) ${volume * 100}%, rgba(255, 255, 255, 0.12) 100%)`
          }}
          aria-label="Volume slider"
        />
        <span className="text-xs font-mono text-amber-300 w-9 text-right font-medium">
          {Math.round(volume * 100)}%
        </span>
      </div>
    </div>
  );
});
