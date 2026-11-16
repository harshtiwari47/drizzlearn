import React, { useEffect, useRef, useState } from 'react';

export const SnowfallOverlay = React.memo(function SnowfallOverlay({ active: propActive }) {
  const [isActive, setIsActive] = useState(Boolean(propActive));
  const canvasRef = useRef(null);
  const activeRef = useRef(isActive);

  activeRef.current = isActive;

  useEffect(() => {
    if (propActive !== undefined) {
      setIsActive(Boolean(propActive));
    }
  }, [propActive]);

  useEffect(() => {
    const handleMusicState = (e) => {
      if (e?.detail?.isPlaying !== undefined) {
        setIsActive(Boolean(e.detail.isPlaying));
      }
    };
    window.addEventListener('drizzlearn:music-state', handleMusicState);
    return () => window.removeEventListener('drizzlearn:music-state', handleMusicState);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    // Subtle, elegant ambient snowfall (20 to 40 flakes)
    const flakeCount = Math.min(40, Math.max(20, Math.floor((width * height) / 32000)));

    const flakes = Array.from({ length: flakeCount }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() < 0.15 
        ? Math.random() * 2.2 + 2.5 
        : Math.random() < 0.5 
          ? Math.random() * 1.4 + 1.4 
          : Math.random() * 1.0 + 0.6,
      speedY: 0,
      baseSpeedY: 0,
      swayAngle: Math.random() * Math.PI * 2,
      swaySpeed: Math.random() * 0.02 + 0.008,
      swayRadius: Math.random() * 1.2 + 0.4,
      opacity: 0,
      glow: false,
    }));

    flakes.forEach((f) => {
      f.baseSpeedY = f.radius * 0.45 + Math.random() * 0.6 + 0.4;
      f.opacity = f.radius > 2.5 ? 0.85 : f.radius > 1.4 ? 0.6 : 0.35;
      f.glow = f.radius > 2.2;
    });

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize, { passive: true });

    let lastTime = performance.now();

    const render = (time) => {
      if (!activeRef.current) {
        ctx.clearRect(0, 0, width, height);
        // Do not request next animation frame when inactive to save CPU / battery
        animationFrameId = null;
        return;
      }

      if (document.hidden) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const delta = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      const globalWind = Math.sin(time * 0.0004) * 0.35 + 0.15;

      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];

        f.swayAngle += f.swaySpeed;
        const currentSway = Math.sin(f.swayAngle) * f.swayRadius;

        f.x += (currentSway + globalWind) * (f.radius * 0.4 + 0.6);
        f.y += f.baseSpeedY * (delta * 60);

        if (f.y > height + 10) {
          f.y = -10;
          f.x = Math.random() * width;
        }
        if (f.x > width + 15) {
          f.x = -10;
        } else if (f.x < -15) {
          f.x = width + 10;
        }

        ctx.beginPath();
        ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);

        if (f.glow) {
          ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
          ctx.shadowBlur = 6;
          ctx.fillStyle = `rgba(255, 255, 255, ${f.opacity})`;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = `rgba(240, 248, 255, ${f.opacity})`;
          ctx.fill();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isActive]);

  return (
    <div
      className={`snow-overlay-container fixed inset-0 pointer-events-none z-40 overflow-hidden transition-opacity duration-1000 ease-in-out ${
        isActive ? 'opacity-100' : 'opacity-0'
      }`}
      aria-hidden="true"
    >
      {/* Top Atmospheric Frost Gradient & Shimmer */}
      <div className="absolute top-0 left-0 right-0 h-44 bg-gradient-to-b from-white/[0.04] via-sky-400/[0.015] to-transparent pointer-events-none" />

      {/* Snowfall Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full block pointer-events-none"
      />
    </div>
  );
});
