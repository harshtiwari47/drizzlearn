import React, { useState, useMemo, useCallback } from 'react';

export const DiaryTodoSection = React.memo(function DiaryTodoSection({ data, updateData }) {
  const [diaryInput, setDiaryInput] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // all, pending, completed

  const tasks = data?.tasks || [];

  const handleToggleTask = useCallback((taskId) => {
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
  }, [updateData]);

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

  const handleDeleteTask = useCallback((taskId, e) => {
    e.stopPropagation();
    if (!updateData) return;
    updateData(current => ({
      ...current,
      tasks: (current.tasks || []).filter(t => t.id !== taskId)
    }));
  }, [updateData]);

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (activeFilter === 'pending') return t.status !== 'completed';
      if (activeFilter === 'completed') return t.status === 'completed';
      return true;
    });
  }, [tasks, activeFilter]);

  const pendingCount = useMemo(() => tasks.filter(t => t.status !== 'completed').length, [tasks]);
  const completedCount = useMemo(() => tasks.filter(t => t.status === 'completed').length, [tasks]);

  const todayStr = useMemo(() => new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }), []);

  return (
    <section className="diary-section-wrapper w-full mb-6" aria-label="Personal Learning Diary & Task Planner">
      {/* Outer Notebook Container Card */}
      <div className="diary-notebook-card relative flex overflow-hidden rounded-[20px] bg-[#0c1017] border border-white/[0.08] shadow-2xl">
        {/* Left Crimson Leather Spine */}
        <div className="diary-folio-spine absolute top-0 bottom-0 left-0 w-[38px] bg-gradient-to-r from-[#5c111a] via-[#881324] to-[#450a12] rounded-l-[20px] z-10" aria-hidden="true">
          {/* Vertical Leather Stitching */}
          <div className="absolute top-4 bottom-4 left-[8px] w-[1px] border-l-[1.5px] border-dashed border-red-200/40" />
        </div>

        {/* 6 Realistic Solid Silver Ring Binding Coils (Reduced count with generous spacing) */}
        <div className="diary-spine-wire-strip absolute top-7 bottom-7 left-[26px] w-[24px] flex flex-col justify-between items-center z-20 pointer-events-none" aria-hidden="true">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="diary-ring-coil" />
          ))}
        </div>

        {/* Main Dark Paper Content Area (Generous pl-[72px] to clear the rings cleanly) */}
        <div className="diary-paper-content flex-1 flex flex-col pl-[72px] pr-6 pt-5 pb-5 min-h-[440px] z-10">
          {/* Top Header Row */}
          <div className="diary-header-row flex flex-wrap items-center justify-between gap-4 mb-4">
            <div className="diary-title-group flex flex-col">
              {/* Badge: Red Square + DAILY JOURNAL | Date */}
              <div className="diary-badge-row flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-[2px] bg-red-600 inline-block shrink-0 shadow-xs shadow-red-500/50" />
                <span className="text-xs font-bold tracking-wider text-slate-200 uppercase font-mono">
                  DAILY JOURNAL
                </span>
                <span className="text-slate-600 text-xs font-mono">|</span>
                <span className="text-xs font-mono text-slate-400 font-medium">
                  {todayStr}
                </span>
              </div>
              <h3 className="diary-main-heading text-xl font-bold text-white tracking-tight">
                Study Journal & Action List
              </h3>
            </div>

            {/* Filter Tabs */}
            <div className="diary-filter-tabs flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveFilter('all')}
                className={`diary-filter-btn px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeFilter === 'all'
                    ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                    : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                }`}
              >
                All <span className="text-[11px] font-mono opacity-90">{tasks.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('pending')}
                className={`diary-filter-btn px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeFilter === 'pending'
                    ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                    : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                }`}
              >
                Remaining <span className="text-[11px] font-mono opacity-90">{pendingCount}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter('completed')}
                className={`diary-filter-btn px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeFilter === 'completed'
                    ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                    : 'bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-slate-200 hover:bg-white/[0.08]'
                }`}
              >
                Done <span className="text-[11px] font-mono opacity-90">{completedCount}</span>
              </button>
            </div>
          </div>

          {/* Input Row with Pencil Icon and Solid Red '+ Add Line' Button */}
          <div className="diary-input-wrap mb-4">
            <form onSubmit={handleAddTask} className="diary-input-form flex items-center gap-3">
              <div className="diary-input-box flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08] focus-within:border-white/20 focus-within:bg-white/[0.05] transition-all">
                <svg className="w-4 h-4 text-slate-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
                <input
                  type="text"
                  placeholder="Write a task, concept revision, or lesson goal..."
                  value={diaryInput}
                  onChange={(e) => setDiaryInput(e.target.value)}
                  className="diary-text-input flex-1 bg-transparent text-white placeholder:text-slate-500 text-sm font-sans focus:outline-none outline-none border-none ring-0 shadow-none"
                />
              </div>
              <button
                type="submit"
                disabled={!diaryInput.trim()}
                className="diary-add-btn px-5 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:hover:bg-red-600 text-white font-medium text-sm transition-all shadow-md shadow-red-600/25 shrink-0 flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed active:scale-[0.98]"
              >
                <span>+</span> Add Line
              </button>
            </form>
          </div>

          {/* Ruled Lines Content Arena */}
          <div className="diary-lines-content-arena flex-1 overflow-y-auto max-h-[360px] custom-diary-scroll pr-3">
            {filteredTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <div className="w-10 h-10 rounded-full bg-slate-800/80 flex items-center justify-center text-white mb-2 text-lg font-serif">
                  ✍
                </div>
                <p className="text-sm text-white font-medium">No diary entries in this view.</p>
                <p className="text-xs text-slate-500 mt-0.5">Add your daily study milestones or reflection notes above.</p>
              </div>
            ) : (
              <ul className="flex flex-col m-0 p-0 list-none divide-y divide-white/[0.06]">
                {filteredTasks.map((t, idx) => {
                  const isDone = t.status === 'completed';
                  return (
                    <li
                      key={t.id}
                      onClick={() => handleToggleTask(t.id)}
                      className={`diary-item-line flex items-center justify-between gap-4 py-3 cursor-pointer group transition-colors hover:bg-white/[0.02] ${
                        isDone ? 'opacity-50' : ''
                      }`}
                    >
                      <div className="flex items-center gap-3.5 flex-1 min-w-0">
                        {/* Checkbox */}
                        <div
                          className={`w-[18px] h-[18px] rounded-[5px] flex items-center justify-center shrink-0 transition-all ${
                            isDone
                              ? 'bg-red-600 text-white shadow-xs'
                              : 'border-[1.5px] border-slate-500 group-hover:border-slate-300 bg-transparent'
                          }`}
                        >
                          {isDone && (
                            <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>

                        {/* Line Number */}
                        <span className="font-mono text-xs text-slate-400 font-medium select-none w-5 shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>

                        {/* Vertical Rule Divider */}
                        <span className="text-slate-700 select-none text-xs">|</span>

                        {/* Task Entry Text */}
                        <span className={`diary-entry-text flex-1 truncate text-sm select-none ${
                          isDone
                            ? 'line-through text-slate-400 font-normal italic'
                            : 'text-slate-100 font-medium'
                        }`}>
                          {t.title}
                        </span>
                      </div>

                      {/* Remove Line Cross */}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteTask(t.id, e)}
                        className="diary-remove-line-btn shrink-0 w-6 h-6 mr-3.5 flex items-center justify-center rounded text-slate-500 hover:text-slate-300 transition-colors"
                        title="Remove diary note"
                        aria-label="Remove diary note"
                      >
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
        </div>
      </div>
    </section>
  );
});
