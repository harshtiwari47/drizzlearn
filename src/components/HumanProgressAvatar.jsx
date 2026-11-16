import React from "react";

// Precision vector contour of the learner silhouette facing left
const SILHOUETTE_PATH = "M 94.34 15.0 C 95.56 15.04, 97.51 14.71, 101.66 15.24 C 105.81 15.77, 113.83 17.48, 119.24 18.17 C 124.65 18.86, 130.1 18.86, 134.13 19.39 C 138.16 19.92, 141.21 20.74, 143.41 21.35 C 145.61 21.96, 145.15 21.72, 147.31 23.06 C 149.47 24.4, 153.01 27.45, 156.35 29.4 C 159.69 31.35, 164.89 33.44, 167.33 34.78 C 169.77 36.12, 169.66 36.28, 171.0 37.46 C 172.34 38.64, 173.84 39.91, 175.39 41.86 C 176.94 43.81, 178.8 46.46, 180.27 49.18 C 181.74 51.9, 183.12 55.24, 184.18 58.21 C 185.24 61.18, 185.93 63.58, 186.62 67.0 C 187.31 70.42, 188.01 75.18, 188.33 78.72 C 188.66 82.26, 189.1 84.05, 188.57 88.24 C 188.04 92.43, 186.1 97.77, 185.16 103.87 C 184.22 109.97, 183.78 120.42, 182.96 124.86 C 182.14 129.29, 183.24 125.96, 180.27 130.48 C 177.3 135.0, 168.48 147.73, 165.14 151.96 C 161.8 156.19, 162.81 154.44, 160.25 155.87 C 157.69 157.3, 151.71 159.25, 149.76 160.51 C 147.81 161.77, 148.87 162.3, 148.54 163.44 C 148.21 164.58, 147.84 164.82, 147.8 167.34 C 147.76 169.86, 147.72 174.95, 148.29 178.57 C 148.86 182.19, 149.88 184.84, 151.22 189.07 C 152.56 193.3, 155.21 199.6, 156.35 203.96 C 157.49 208.32, 160.5 212.76, 158.06 215.2 C 155.62 217.64, 147.19 217.06, 141.7 218.61 C 136.21 220.16, 130.76 222.03, 125.1 224.47 C 119.44 226.91, 115.41 228.62, 107.76 233.26 C 100.11 237.9, 85.67 248.11, 79.2 252.3 C 72.73 256.49, 72.61 256.62, 68.95 258.41 C 65.29 260.2, 61.02 261.99, 57.23 263.05 C 53.44 264.11, 47.99 266.06, 46.24 264.76 C 44.49 263.46, 45.3 258.53, 46.73 255.23 C 48.15 251.93, 52.47 248.19, 54.79 244.98 C 57.11 241.77, 58.93 238.72, 60.64 235.95 C 62.35 233.18, 63.25 231.88, 65.04 228.38 C 66.83 224.88, 69.72 219.22, 71.39 214.95 C 73.06 210.68, 74.36 206.52, 75.05 202.74 C 75.74 198.96, 75.82 195.06, 75.54 192.25 C 75.26 189.44, 74.36 187.69, 73.34 185.9 C 72.32 184.11, 73.3 182.4, 69.43 181.5 C 65.57 180.6, 54.62 181.06, 50.15 180.53 C 45.68 180.0, 44.37 179.06, 42.58 178.33 C 40.79 177.6, 40.13 177.15, 39.4 176.13 C 38.67 175.11, 38.38 174.18, 38.18 172.23 C 37.98 170.28, 38.47 166.77, 38.18 164.41 C 37.89 162.05, 37.0 160.72, 36.47 158.07 C 35.94 155.42, 35.13 151.31, 35.01 148.54 C 34.89 145.77, 35.7 142.88, 35.74 141.46 C 35.78 140.04, 35.62 140.53, 35.25 140.0 C 34.88 139.47, 34.8 138.98, 33.54 138.29 C 32.28 137.6, 29.07 136.66, 27.69 135.85 C 26.31 135.04, 25.65 134.59, 25.24 133.41 C 24.83 132.23, 24.91 130.4, 25.24 128.77 C 25.57 127.14, 25.33 127.1, 27.2 123.64 C 29.07 120.18, 34.39 111.72, 36.47 108.02 C 38.54 104.32, 39.08 102.9, 39.65 101.43 C 40.22 99.96, 40.14 100.17, 39.89 99.23 C 39.65 98.29, 38.47 97.19, 38.18 95.81 C 37.89 94.43, 37.89 92.92, 38.18 90.93 C 38.47 88.94, 39.12 86.41, 39.89 83.85 C 40.66 81.29, 43.35 77.95, 42.82 75.55 C 42.29 73.15, 38.43 71.52, 36.72 69.44 C 35.01 67.36, 33.55 65.09, 32.57 63.1 C 31.59 61.11, 31.14 59.47, 30.86 57.48 C 30.58 55.48, 30.7 52.8, 30.86 51.13 C 31.02 49.46, 31.35 48.77, 31.84 47.47 C 32.33 46.17, 32.81 44.91, 33.79 43.32 C 34.77 41.73, 35.87 39.94, 37.7 37.95 C 39.53 35.96, 42.3 33.31, 44.78 31.36 C 47.26 29.41, 50.11 27.66, 52.59 26.23 C 55.07 24.8, 57.43 23.74, 59.67 22.81 C 61.91 21.88, 60.24 21.92, 66.02 20.62 C 71.8 19.32, 89.62 15.94, 94.34 15.0 C 99.06 14.06, 93.12 14.96, 94.34 15.0 Z";

export function HumanProgressAvatar({ progress = 0 }) {
  const percent = Math.max(0, Math.min(100, Number(progress) || 0));
  // Total vertical span: crown Y=14 to collar base Y=266 = 252px
  const fillHeight = 252 * (percent / 100);
  const waterlineY = 266 - fillHeight;
  const tooltipY = Math.min(252, Math.max(28, waterlineY));

  // Determine front X for the tooltip pointer at current waterline
  // Approximate front contour position across height
  let frontX = 46;
  if (percent >= 80) frontX = 80;
  else if (percent >= 60) frontX = 40;
  else if (percent >= 35) frontX = 30;
  else if (percent >= 15) frontX = 65;
  else frontX = 46;

  const tooltipX = Math.max(-25, frontX - 52);

  return (
    <div
      className="human-progress-container relative flex items-center justify-center flex-shrink-0"
      aria-label={`Course progress: ${percent}%`}
    >
      <svg
        className="human-progress-svg"
        viewBox="-28 0 230 280"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="avatarObsidianGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#102a38" />
            <stop offset="40%" stopColor="#0a1d27" />
            <stop offset="100%" stopColor="#040e14" />
          </linearGradient>

          <linearGradient id="avatarEnergyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a5f3fc" />
            <stop offset="20%" stopColor="#38bdf8" />
            <stop offset="65%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#083344" />
          </linearGradient>

          <linearGradient id="avatarMeniscusGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0)" />
            <stop offset="20%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="80%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0)" />
          </linearGradient>

          <filter id="avatarGlowFilter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <filter id="avatarTooltipShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.6)" />
          </filter>

          <clipPath id="avatarFillClip">
            <rect x="-30" y={waterlineY} width="240" height={fillHeight + 40} />
          </clipPath>
        </defs>

        {/* 1. Translucent base sculpted silhouette */}
        <g className="bust-base-layer">
          <path
            d={SILHOUETTE_PATH}
            fill="url(#avatarObsidianGrad)"
            stroke="rgba(56, 189, 248, 0.45)"
            strokeWidth="1.8"
            className="bust-silhouette-base"
          />
        </g>

        {/* 2. Active Liquid Molten Progress Fill */}
        {percent > 0 && (
          <g className="bust-active-layer" clipPath="url(#avatarFillClip)">
            <path
              d={SILHOUETTE_PATH}
              fill="url(#avatarEnergyGrad)"
              stroke="#a5f3fc"
              strokeWidth="2.2"
              filter="url(#avatarGlowFilter)"
            />
          </g>
        )}

        {/* 3. Meniscus Beam at Current Progress Waterline */}
        {percent > 0 && percent < 100 && (
          <g className="bust-meniscus-group" aria-hidden="true" clipPath="url(#avatarFillClip)">
            <line
              x1="20"
              y1={waterlineY}
              x2="195"
              y2={waterlineY}
              stroke="url(#avatarMeniscusGrad)"
              strokeWidth="3"
              filter="url(#avatarGlowFilter)"
            />
          </g>
        )}

        {/* 4. Permanent Tooltip Badge with Arrow Pointer */}
        <g className="human-permanent-tooltip" transform={`translate(${tooltipX}, ${tooltipY - 13})`}>
          <rect
            x="0"
            y="0"
            width="46"
            height="26"
            rx="6"
            fill="rgba(8, 26, 36, 0.94)"
            stroke="#38bdf8"
            strokeWidth="1.4"
            filter="url(#avatarTooltipShadow)"
          />
          <polygon
            points="46,8 52,13 46,18"
            fill="rgba(8, 26, 36, 0.94)"
            stroke="#38bdf8"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <text
            x="23"
            y="17.5"
            textAnchor="middle"
            fill="#ffffff"
            fontFamily="var(--font-display, 'Space Grotesk', sans-serif)"
            fontSize="13"
            fontWeight="800"
            letterSpacing="-0.02em"
          >
            {percent}%
          </text>
        </g>
      </svg>
    </div>
  );
}

export default HumanProgressAvatar;
