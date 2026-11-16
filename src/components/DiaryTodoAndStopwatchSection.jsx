import React, { useState, useEffect, useRef } from 'react';

// Diary Todo & Mechanical Stopwatch Bottom Section
export function DiaryTodoAndStopwatchSection({ data, updateData }) {
  // --- DIARY TODO STATE ---
  const [diaryInput, setDiaryInput] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // all, pending, completed

  const tasks = data?.tasks || [];

  const handleToggleTask = (taskId) => {
    if (!updateData) return;
    updateData(current => ({
      ...current,
      tasks: (current.tasks || []).map(t => {
        if (t.id === taskId) {
          const isDone = t.status === 'completed';
          return {
            ...t,
            status: isDone ? 'pending' : 'completed',
            completed_at: isDone ? null : new Date().toISOString()
          };
        }
        return t;
      })
    }));
  };

  const handleAddTask = (e) => {
    e.preventDefault();
    const text = diaryInput.trim();
    if (!text || !updateData) return;

    const newTask = {
      id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      title: text,
      status: 'pending',
      created_at: new Date().toISOString(),
      scheduled_at: new Date().toISOString()
    };

    updateData(current => ({
      ...current,
      tasks: [newTask, ...(current.tasks || [])]
    }));
    setDiaryInput('');
  };

  const handleDeleteTask = (taskId, e) => {
    e.stopPropagation();
    if (!updateData) return;
    updateData(current => ({
      ...current,
      tasks: (current.tasks || []).filter(t => t.id !== taskId)
    }));
  };

  const filteredTasks = tasks.filter(t => {
    if (activeFilter === 'pending') return t.status !== 'completed';
    if (activeFilter === 'completed') return t.status === 'completed';
    return true;
  });

  const pendingCount = tasks.filter(t => t.status !== 'completed').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;

  // --- MECHANICAL STOPWATCH STATE ---
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [laps, setLaps] = useState([]);
  const timerRef = useRef(null);
  const lastTimeRef = useRef(null);

  useEffect(() => {
    if (isRunning) {
      lastTimeRef.current = performance.now();
      timerRef.current = requestAnimationFrame(function tick(now) {
        const delta = now - lastTimeRef.current;
        lastTimeRef.current = now;
        setElapsedMs(prev => prev + delta);
        timerRef.current = requestAnimationFrame(tick);
      });
    } else {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    }
    return () => {
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    };
  }, [isRunning]);

  const toggleStartPause = () => {
    setIsRunning(r => !r);
  };

  const handleReset = () => {
    setIsRunning(false);
    setElapsedMs(0);
    setLaps([]);
  };

  const handleLap = () => {
    if (elapsedMs === 0) return;
    setLaps(prev => [elapsedMs, ...prev.slice(0, 4)]);
  };

  // Format time: MM:SS .cs (centiseconds)
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((elapsedMs % 1000) / 10);

  const pad = (n, len = 2) => String(n).padStart(len, '0');

  // Needle angle for analog visual dial: 60 seconds per full 360-deg rotation
  const needleDeg = ((elapsedMs % 60000) / 60000) * 360;
  // Subdial 30-min hand
  const subdialDeg = ((elapsedMs % 1800000) / 1800000) * 360;

  return (
    <section className="diary-stopwatch-section grid gap-6 mt-8" aria-label="Study Diary & Mechanical Chronograph">
      {/* LEFT: Diary Page Todo */}
      <div className="diary-page-container relative">
        {/* Leather Notebook Backing Edge Shadow */}
        <div className="diary-leather-spine" aria-hidden="true" />

        {/* Notebook Wire / Binder Rings */}
        <div className="diary-binder-strip" aria-hidden="true">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="diary-binder-unit">
              <div className="diary-binder-hole" />
              <div className="diary-binder-coil" />
            </div>
          ))}
        </div>

        {/* Paper Surface */}
        <div className="diary-paper-sheet flex flex-col relative overflow-hidden">
          {/* Authentic Header Margin Rule & Double Header Lines */}
          <div className="diary-header-container px-7 pt-6 pb-4 relative z-10">
            {/* Subtle Top Metadata */}
            <div className="flex items-center justify-between pb-2">
              <div className="diary-date-stamp flex items-center gap-2">
                <span className="diary-memo-badge">DAILY MEMO</span>
                <span className="diary-date-text">
                  {new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>

              {/* Refined Filter Tabs */}
              <div className="diary-filter-group flex items-center gap-1">
                <button
                  type="button"
                  className={`diary-filter-pill ${activeFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('all')}
                >
                  All <span>{tasks.length}</span>
                </button>
                <button
                  type="button"
                  className={`diary-filter-pill ${activeFilter === 'pending' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('pending')}
                >
                  Open <span>{pendingCount}</span>
                </button>
                <button
                  type="button"
                  className={`diary-filter-pill ${activeFilter === 'completed' ? 'active' : ''}`}
                  onClick={() => setActiveFilter('completed')}
                >
                  Done <span>{completedCount}</span>
                </button>
              </div>
            </div>

            {/* Diary Title */}
            <div className="flex items-center justify-between mt-1">
              <h3 className="diary-title font-bold text-2xl tracking-tight text-slate-900 flex items-center gap-2.5">
                Today's Diary Tasks
                <span className="diary-entry-count text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900">
                  {pendingCount} pending
                </span>
              </h3>
            </div>

            {/* In-Line Add Task with clean pen input */}
            <form onSubmit={handleAddTask} className="diary-add-form flex items-center gap-3 mt-4">
              <div className="diary-pen-icon" aria-hidden="true">
                <svg className="w-4 h-4 text-amber-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9"/>
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                </svg>
              </div>
              <input
                type="text"
                placeholder="Write a study objective or quick task..."
                value={diaryInput}
                onChange={(e) => setDiaryInput(e.target.value)}
                className="diary-input flex-1 bg-transparent text-slate-900 placeholder:text-slate-400 focus:outline-none font-medium text-sm"
              />
              <button
                type="submit"
                disabled={!diaryInput.trim()}
                className="diary-add-btn flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-md transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                <span>+</span> Add Line
              </button>
            </form>
          </div>

          {/* Double Separator Header Line */}
          <div className="diary-double-rule" aria-hidden="true" />

          {/* Ruled Notebook Lines Area with Task List */}
          <div className="diary-tasks-body flex-1 overflow-y-auto px-7 relative z-10 custom-diary-scrollbar">
            {filteredTasks.length === 0 ? (
              <div className="diary-empty-lines flex flex-col items-center justify-center py-16 text-slate-400 text-sm">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 mb-2 font-serif text-lg">
                  ✎
                </div>
                <span className="font-medium text-slate-600">No tasks logged in this view</span>
                <span className="text-xs text-slate-400 mt-1">Jot down a quick study goal on the line above</span>
              </div>
            ) : (
              <ul className="diary-task-list flex flex-col">
                {filteredTasks.map((t) => {
                  const isDone = t.status === 'completed';
                  return (
                    <li
                      key={t.id}
                      onClick={() => handleToggleTask(t.id)}
                      className={`diary-task-row flex items-center justify-between gap-3.5 cursor-pointer group ${
                        isDone ? 'is-completed' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3.5 flex-1 min-w-0">
                        {/* Custom Hand-Drawn Notebook Checkbox */}
                        <div
                          className={`diary-checkbox flex items-center justify-center w-[18px] h-[18px] rounded transition-all ${
                            isDone
                              ? 'bg-emerald-600 border border-emerald-700 text-white shadow-xs'
                              : 'border-2 border-amber-500/70 hover:border-amber-700 bg-amber-50/60'
                          }`}
                        >
                          {isDone && (
                            <svg className="w-3 h-3 fill-current" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <span className={`diary-task-text flex-1 truncate text-[14px] select-none ${isDone ? 'line-through text-slate-400 font-normal' : 'text-slate-800 font-medium'}`}>
                          {t.title}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteTask(t.id, e)}
                        className="diary-delete-btn opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 transition-opacity rounded hover:bg-amber-100"
                        title="Delete task"
                        aria-label="Delete task"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Diary Subtle Footer Page Counter & Shadow */}
          <div className="diary-footer-strip flex items-center justify-between px-7 py-3 text-[11px] font-mono text-amber-800/60 border-t border-amber-200/50">
            <span>DRIZZLEARN STUDY COMPANION</span>
            <span>PAGE • {pad(new Date().getDate())}</span>
          </div>
        </div>
      </div>

      {/* RIGHT: Mechanical Stopwatch */}
      <div className="stopwatch-container relative flex flex-col items-center justify-center p-6">
        {/* Stopwatch Outer Mechanical Body */}
        <div className="mechanical-stopwatch relative flex flex-col items-center">
          {/* Top Mechanical Knurled Crown Pusher */}
          <div className="stopwatch-crown flex flex-col items-center relative">
            {/* Top Hanging Ring */}
            <div className="stopwatch-hanging-ring" />
            {/* Main Push Button */}
            <button
              type="button"
              onClick={toggleStartPause}
              title={isRunning ? "Press to Pause" : "Press to Start"}
              className={`stopwatch-pusher-btn ${isRunning ? 'is-pressed' : ''}`}
              aria-label="Start or pause stopwatch"
            />
            {/* Crown Base Shaft */}
            <div className="stopwatch-crown-neck" />
          </div>

          {/* Left Lap / Split Pusher at 10 o'clock */}
          <button
            type="button"
            onClick={handleLap}
            disabled={!isRunning}
            title="Lap split"
            className="stopwatch-side-pusher left-pusher"
            aria-label="Record lap"
          >
            <span className="pusher-label">LAP</span>
          </button>

          {/* Right Reset Pusher at 2 o'clock */}
          <button
            type="button"
            onClick={handleReset}
            title="Reset stopwatch"
            className="stopwatch-side-pusher right-pusher"
            aria-label="Reset stopwatch"
          >
            <span className="pusher-label">RESET</span>
          </button>

          {/* Main Circular Chronograph Case (Metallic Bezel & Dial) */}
          <div className="stopwatch-bezel-case relative flex items-center justify-center">
            {/* Brushed Metal Bezel Ring */}
            <div className="stopwatch-outer-ring" />

            {/* Inner Dial Face */}
            <div className="stopwatch-dial-face relative flex flex-col items-center justify-center overflow-hidden">
              {/* Dial Face Ticks (SVG 60-second calibrated markings) */}
              <svg className="stopwatch-ticks-canvas absolute inset-0 w-full h-full" viewBox="0 0 280 280">
                {/* 60 second tick marks */}
                {[...Array(60)].map((_, i) => {
                  const isMajor = i % 5 === 0;
                  const angle = (i * 6) * (Math.PI / 180);
                  const rOuter = 130;
                  const rInner = isMajor ? 116 : 123;
                  const x1 = 140 + rOuter * Math.sin(angle);
                  const y1 = 140 - rOuter * Math.cos(angle);
                  const x2 = 140 + rInner * Math.sin(angle);
                  const y2 = 140 - rInner * Math.cos(angle);
                  return (
                    <g key={i}>
                      <line
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                        stroke={isMajor ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.25)'}
                        strokeWidth={isMajor ? 2.5 : 1.2}
                        strokeLinecap="round"
                      />
                      {isMajor && (
                        <text
                          x={140 + 104 * Math.sin(angle)}
                          y={140 - 104 * Math.cos(angle) + 4}
                          fill="rgba(255,255,255,0.75)"
                          fontSize="9.5"
                          fontWeight="700"
                          fontFamily="Space Grotesk, monospace"
                          textAnchor="middle"
                        >
                          {i === 0 ? '60' : i}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Sub-Dial (30-Minute Counter) */}
              <div className="stopwatch-subdial relative flex items-center justify-center">
                <span className="subdial-label font-mono text-[8px] text-slate-400 absolute top-1">MIN</span>
                <div
                  className="subdial-needle"
                  style={{ transform: `rotate(${subdialDeg}deg)` }}
                />
                <div className="subdial-center-pin" />
              </div>

              {/* High-Precision Digital Time LCD Display */}
              <div className="stopwatch-lcd-display flex items-baseline gap-1 px-3 py-1 rounded bg-black/60 border border-emerald-500/30 text-emerald-400 font-mono tracking-wider shadow-inner z-10 mt-6">
                <span className="text-xl font-bold">{pad(minutes)}:{pad(seconds)}</span>
                <span className="text-xs text-emerald-400/70">.{pad(centiseconds)}</span>
              </div>

              {/* Brand Typography */}
              <div className="stopwatch-branding flex flex-col items-center mt-1 z-10">
                <span className="text-[9px] font-bold tracking-widest text-slate-400 font-mono uppercase">DRIZZLEARN</span>
                <span className="text-[7px] tracking-wider text-slate-500 font-mono">1/100 SEC CHRONO</span>
              </div>

              {/* Analog Main Needle */}
              <div
                className="stopwatch-main-needle"
                style={{ transform: `rotate(${needleDeg}deg)` }}
              >
                <div className="needle-head" />
                <div className="needle-tail" />
              </div>

              {/* Center Metal Axis Pin */}
              <div className="stopwatch-center-pin z-20" />
            </div>
          </div>

          {/* Interactive Mechanical Action Controls Row */}
          <div className="stopwatch-action-bar flex items-center gap-3 mt-4">
            <button
              type="button"
              onClick={toggleStartPause}
              className={`stopwatch-ctrl-btn ${isRunning ? 'btn-pause' : 'btn-start'}`}
            >
              {isRunning ? 'PAUSE' : 'START'}
            </button>
            <button
              type="button"
              onClick={handleLap}
              disabled={!isRunning}
              className="stopwatch-ctrl-btn btn-lap"
            >
              LAP
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="stopwatch-ctrl-btn btn-reset"
            >
              RESET
            </button>
          </div>

          {/* Laps List below stopwatch */}
          {laps.length > 0 && (
            <div className="stopwatch-laps-list flex items-center gap-2 mt-3 overflow-x-auto max-w-[280px] py-1 text-[11px] font-mono text-slate-400">
              {laps.map((lapMs, idx) => {
                const lapSec = Math.floor(lapMs / 1000);
                const lapMin = Math.floor(lapSec / 60);
                const s = lapSec % 60;
                const cs = Math.floor((lapMs % 1000) / 10);
                return (
                  <span key={idx} className="lap-tag px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 whitespace-nowrap">
                    #{laps.length - idx}: {pad(lapMin)}:{pad(s)}.{pad(cs)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
