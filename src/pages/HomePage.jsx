import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { Icon, Panel, EmptyState, FeatureCard, Stat, pendingTasksCount } from "../components/common.jsx";
import { AmbientFocusStation } from "../components/AmbientFocusStation.jsx";
import { DiaryTodoSection } from "../components/DiaryTodoSection.jsx";
import { HumanProgressAvatar } from "../components/HumanProgressAvatar.jsx";

export { HumanProgressAvatar };

function PlayingCardsReviewSection({ dueCards, go }) {
  const [shuffleIndex, setShuffleIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setShuffleIndex(prev => (prev + 1) % 3);
    }, 3400);
    return () => clearInterval(timer);
  }, []);

  const cardList = useMemo(() => {
    const fallbackCards = [
      { id: "c1", front: "[Array Map, Filter, and Reduce]\nWhich array method returns a brand-new array?", back: "Array.prototype.map()" },
      { id: "c2", front: "Modal Verbs: Nuance\nExpressing possibility, deduction & necessity", back: "Must, Might, Could, Should" },
      { id: "c3", front: "Conditional Inversion\nHad I known vs If I had known", back: "Inverted auxiliary conditional" }
    ];
    return [
      dueCards[0] || fallbackCards[0],
      dueCards[1] || fallbackCards[1],
      dueCards[2] || fallbackCards[2]
    ];
  }, [dueCards]);

  return (
    <section className="panel review-panel review-playing-cards-panel flex flex-col relative" id="review-due">
      <div className="panel-head flex items-center justify-between">
        <div className="panel-title flex items-center gap-2.5">
          <Icon name="cards" />Review due
        </div>
        <span className="due-count">{dueCards.length || 78}</span>
      </div>

      <div className="playing-cards-showcase-wrap flex flex-col md:flex-row items-center justify-between gap-5 p-5">
        {/* Animated Minimal Flashcards Trio (Fanned & Shuffling) */}
        <div className="playing-cards-deck-stage relative flex items-center justify-center flex-shrink-0" aria-hidden="true">
          <div className="playing-cards-table-glow" />
          <div className="playing-cards-fan-container relative">
            {cardList.map((card, idx) => {
              const slot = (idx + shuffleIndex) % 3;
              const slotClass = slot === 0 ? "card-slot-left" : slot === 1 ? "card-slot-center" : "card-slot-right";

              return (
                <div
                  key={card.id || idx}
                  className={`playing-card-item ${slotClass} flex flex-col justify-between`}
                  onClick={() => go("flashcards")}
                >
                  {/* Clean minimal flashcard top bar (no card numbers) */}
                  <div className="flashcard-top-bar flex items-center justify-end w-full">
                    <span className="flashcard-mini-spark">✦</span>
                  </div>

                  {/* Clean central flashcard prompt */}
                  <div className="flashcard-center-content flex flex-col items-center justify-center text-center">
                    <strong className="flashcard-prompt-text">
                      {card.front.length > 44 ? card.front.slice(0, 42) + "…" : card.front}
                    </strong>
                  </div>

                  {/* Clean bottom action hint */}
                  <div className="flashcard-bottom-bar flex items-center justify-center w-full">
                    <span className="flashcard-flip-pill">TAP TO FLIP</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action & Details info */}
        <div className="review-meta-action flex flex-col flex-1 gap-2 min-w-0">
          <strong className="review-headline">Keep key ideas fresh.</strong>
          <p className="text-sm text-learnos-muted review-desc-clamp">
            About {Math.max(1, Math.round((dueCards.length || 78) * 0.6))} minutes of active spaced retrieval.
          </p>
          <div className="flex items-center gap-3 mt-1.5">
            <button className="continue-btn continue-btn-glow" onClick={() => go("flashcards")}>
              Start review ↗
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export { PlayingCardsReviewSection };

const Home = React.memo(function Home(p){
  const {data,activeCourse,lessons,dueCards,nextTask,stats,progressPercent,go,openLesson,setModal,header}=p;
  const [hoveredTool,setHoveredTool]=useState(null);
  const [timelinePeriod,setTimelinePeriod]=useState("week");
  const done=data.tasks.filter(t=>t.status==="completed").length,plannedToday=data.tasks.filter(t=>new Date(t.scheduled_at||0).toDateString()===new Date().toDateString());
  const weekDays=Array.from({length:7},(_,i)=>{const date=new Date();const day=(date.getDay()+6)%7;date.setDate(date.getDate()-day+i);return date;});
  const checkpointsPassed=data.attempts.filter(a=>Number(a.score)>=70).length;

  const isLessonDone=useCallback((lessonId)=>{
    const task=data.tasks.find(t=>t.lesson_id===lessonId);
    const passed=data.attempts.some(a=>a.lesson_id===lessonId&&Number(a.score)>=70);
    return task?.status==="completed"||passed;
  },[data.tasks,data.attempts]);

  const isModuleDone=useCallback((m)=>{
    const list=m.lessons||[];
    return list.length>0&&list.every(l=>isLessonDone(l.id));
  },[isLessonDone]);

  const activeModuleIndex=useMemo(()=>{
    if(!activeCourse?.modules?.length)return 0;
    if(nextTask?.lesson_id){
      const idx=activeCourse.modules.findIndex(m=>m.lessons?.some(l=>l.id===nextTask.lesson_id));
      if(idx!==-1)return idx;
    }
    const firstIncomplete=activeCourse.modules.findIndex(m=>!isModuleDone(m));
    return firstIncomplete!==-1?firstIncomplete:0;
  },[activeCourse,nextTask,isModuleDone]);

  const roadmapScrollRef = useRef(null);
  const [roadmapView, setRoadmapView] = useState("auto");
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Normalize roadmap blocks so whether a course has 1 module or multiple modules,
  // each step along the learning path is rendered as an interactive block!
  const totalLessonsInCourse = useMemo(() => {
    return (activeCourse?.modules || []).reduce((acc, m) => acc + (m.lessons?.length || 0), 0);
  }, [activeCourse]);

  const roadmapBlocks = useMemo(() => {
    if (!activeCourse) return [];
    const modules = activeCourse.modules || [];
    if (!modules.length) return [];

    // If view is explicitly lessons, or if the course has 1 module with lessons, expand all lessons as sequential blocks!
    const showLessons = roadmapView === "lessons" || (modules.length === 1 && (modules[0]?.lessons?.length || 0) > 0);

    if (showLessons) {
      const allLessons = modules.flatMap((m, mIdx) => 
        (m.lessons || []).map((l, lIdx) => ({
          id: l.id,
          title: l.title,
          moduleTitle: m.title,
          objective: l.objective || m.objective || "Master this core concept",
          estimatedMinutes: l.estimated_minutes || 25,
          isDone: isLessonDone(l.id),
          targetLessonId: l.id,
          moduleIndex: mIdx,
          lessonIndex: lIdx,
          type: "lesson"
        }))
      );
      return allLessons.map((item, idx) => ({
        ...item,
        levelNumber: idx + 1,
        subtitle: item.moduleTitle ? `${item.moduleTitle} • Lvl ${idx + 1}` : `Level ${idx + 1}`
      }));
    }

    // Default for multiple modules: show each module as a major milestone block
    return modules.map((m, mIdx) => {
      const isDone = isModuleDone(m);
      const targetLesson = m.lessons?.find(l => !isLessonDone(l.id)) || m.lessons?.[0];
      return {
        id: m.id || `mod-${mIdx}`,
        title: m.title,
        subtitle: `${m.lessons?.length || 0} lessons`,
        objective: m.objective || "Complete all lessons in this stage",
        estimatedMinutes: m.estimatedMinutes || (m.lessons?.length || 1) * 25,
        isDone,
        targetLessonId: targetLesson?.id,
        levelNumber: mIdx + 1,
        type: "module",
        lessonsCount: m.lessons?.length || 0
      };
    });
  }, [activeCourse, roadmapView, isLessonDone, isModuleDone]);

  const activeBlockIndex = useMemo(() => {
    if (!roadmapBlocks.length) return 0;
    if (nextTask?.lesson_id) {
      const idx = roadmapBlocks.findIndex(b => b.targetLessonId === nextTask.lesson_id || b.id === nextTask.lesson_id);
      if (idx !== -1) return idx;
    }
    const firstIncomplete = roadmapBlocks.findIndex(b => !b.isDone);
    return firstIncomplete !== -1 ? firstIncomplete : 0;
  }, [roadmapBlocks, nextTask]);

  const completedBlocksCount = useMemo(() => {
    return roadmapBlocks.filter(b => b.isDone).length;
  }, [roadmapBlocks]);

  const blockSpacing = 165;
  const startX = 85;
  const endPadding = 90;
  const totalBlocks = roadmapBlocks.length;
  const totalTrackWidth = useMemo(() => {
    return Math.max(720, startX + Math.max(0, totalBlocks - 1) * blockSpacing + endPadding);
  }, [totalBlocks, startX, blockSpacing, endPadding]);

  const updateScrollButtons = useCallback(() => {
    const el = roadmapScrollRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 12);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 12);
  }, []);

  const scrollRoadmapBy = (offset) => {
    if (roadmapScrollRef.current) {
      roadmapScrollRef.current.scrollBy({ left: offset, behavior: "smooth" });
    }
  };

  const centerOnActiveBlock = useCallback(() => {
    if (roadmapScrollRef.current && roadmapBlocks.length > 0) {
      const activeX = startX + activeBlockIndex * blockSpacing;
      const containerWidth = roadmapScrollRef.current.clientWidth || 700;
      roadmapScrollRef.current.scrollTo({
        left: Math.max(0, activeX - containerWidth / 2),
        behavior: "smooth"
      });
    }
  }, [activeBlockIndex, roadmapBlocks.length, startX, blockSpacing]);

  useEffect(() => {
    centerOnActiveBlock();
  }, [centerOnActiveBlock]);

  useEffect(() => {
    const el = roadmapScrollRef.current;
    if (!el) return;
    updateScrollButtons();
    const handleResize = () => updateScrollButtons();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateScrollButtons, totalTrackWidth]);

  // Dynamic vector conduit curve generation
  const { mainPathD, glowPathD } = useMemo(() => {
    if (totalBlocks === 0) return { mainPathD: "", glowPathD: "" };
    
    if (totalBlocks === 1) {
      const x0 = startX;
      const y0 = 250;
      const d = `M ${Math.max(20, x0 - 60)} ${y0} C ${x0 - 25} ${y0}, ${x0 - 25} ${y0}, ${x0} ${y0} C ${x0 + 40} ${y0}, ${x0 + 80} 160, ${x0 + 150} 140`;
      return { mainPathD: d, glowPathD: d };
    }

    let d = `M ${Math.max(20, startX - 60)} 250`;
    d += ` C ${startX - 30} 250, ${startX - 30} 250, ${startX} 250`;

    for (let i = 0; i < totalBlocks - 1; i++) {
      const xCurr = startX + i * blockSpacing;
      const yCurr = i % 2 === 0 ? 250 : 95;
      const xNext = startX + (i + 1) * blockSpacing;
      const yNext = (i + 1) % 2 === 0 ? 250 : 95;
      const dx = xNext - xCurr;
      const cp1x = xCurr + dx * 0.45;
      const cp1y = yCurr;
      const cp2x = xNext - dx * 0.45;
      const cp2y = yNext;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${xNext} ${yNext}`;
    }

    const lastX = startX + (totalBlocks - 1) * blockSpacing;
    const lastY = (totalBlocks - 1) % 2 === 0 ? 250 : 95;
    const exitX = Math.min(totalTrackWidth - 20, lastX + 90);
    d += ` C ${lastX + 40} ${lastY}, ${exitX - 25} ${lastY}, ${exitX} ${lastY}`;

    return { mainPathD: d, glowPathD: d };
  }, [totalBlocks, startX, blockSpacing, totalTrackWidth]);

  return <>
    {/* Combined Header and Hero Interactive Group */}
    <div className={`hero-header-combined-group relative ${hoveredTool ? `glow-${hoveredTool}` : "glow-initial"}`}>
      {/* Dynamic Ambient Background Glow Elements */}
      <div className="combined-stage-ambient-wrap" aria-hidden="true">
        <div className="combined-stage-glow glow-input-focus" />
        <div className="combined-stage-glow glow-card-roadmap" />
        <div className="combined-stage-glow glow-card-flashcards" />
        <div className="combined-stage-glow glow-card-notes" />
        <div className="combined-stage-glow glow-card-practice" />
        <div className="combined-stage-radial-overlay" />
      </div>

      {header}

      {/* Hero Interactive Stage with Edge Decors, Search Bar, and 4 Modern Square Tool Cards */}
      <div className="hero-interactive-stage relative">
        {/* Left Edge: 3D Layered Cyber Grimoire */}
        <div className="stage-edge-decor stage-edge-left" aria-hidden="true" onClick={()=>go("courses")} title="Browse learning materials">
          <div className="hero-book-wrapper">
            <div className="hero-book-shadow" />
            <div className="hero-book-spine" />
            <div className="hero-book-body">
              <div className="hero-book-gilded-pages" />
              <div className="hero-book-front grid place-items-center">
                <div className="hero-book-insignia grid place-items-center">
                  <span className="hero-book-gem">✦</span>
                </div>
                <span className="hero-book-ribbon" />
              </div>
            </div>
            <div className="hero-book-glow" />
          </div>
        </div>

        {/* Right Edge: Cute AI Companion Robot with Visor */}
        <div className="stage-edge-decor stage-edge-right" aria-hidden="true" onClick={()=>go("tutor")} title="Ask AI tutor">
          <div className="hero-bot-wrapper">
            <div className="hero-bot-antenna">
              <span className="antenna-stem" />
              <span className="antenna-orb" />
            </div>
            <div className="hero-bot-body">
              <div className="hero-bot-visor grid place-items-center">
                <div className="hero-bot-face-screen flex items-center justify-center gap-2.5">
                  <span className="bot-eye-curve left">◠</span>
                  <span className="bot-blush" />
                  <span className="bot-eye-curve right">◠</span>
                </div>
              </div>
              <span className="bot-ear-pod left" />
              <span className="bot-ear-pod right" />
              <div className="bot-chassis-collar" />
            </div>
            <div className="hero-bot-glow" />
          </div>
        </div>

        {/* Hero Headline & Generator Row */}
        <section className="hero flex flex-col items-center text-center gap-6 mb-7" id="generator">
          <h1 className="hero-headline text-4xl sm:text-5xl font-extrabold tracking-tight">
            What do you want to <span className="text-primary-gradient">learn?</span>
          </h1>
          <form
            className="generate-row flex items-center gap-2.5 max-w-2xl w-full"
            onSubmit={e=>{
              e.preventDefault();
              const value=new FormData(e.currentTarget).get("topic");
              sessionStorage.setItem("learnos.goal.prefill",String(value||""));
              p.setModalState?.(null);
              go("goal");
            }}
          >
            <div className="generate-input-box flex items-center gap-2 flex-1 min-w-0">
              <span className="spark pl-3" aria-hidden="true">✦</span>
              <input
                name="topic"
                defaultValue=""
                aria-label="Topic to learn"
                placeholder="Enter a topic or skill (e.g. Python for AI, Spanish, Astrophysics)..."
                className="generate-input flex-1"
              />
            </div>
            <button className="primary-btn flex items-center gap-1.5" type="submit" disabled={p.busy}>
              {p.busy?<><span className="btn-spinner"/> Generating…</>:<>Generate course <span>↗</span></>}
            </button>
          </form>
        </section>

        {/* 4 Square Frosted Glass Learning Tool Cards */}
        <section className="learning-tools-strip flex justify-center w-full mb-8 relative" aria-label="Learning tools">
          <div className="square-tools-grid relative z-10">
            <a
              href="#/course"
              className="square-card square-card-roadmap"
              onMouseEnter={()=>setHoveredTool("roadmap")}
              onMouseLeave={()=>setHoveredTool(null)}
              onFocus={()=>setHoveredTool("roadmap")}
              onBlur={()=>setHoveredTool(null)}
              onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("course");}}
            >
              <div className="square-card-bg-shape" />
              <div className="square-card-top">
                <span className="square-card-icon grid place-items-center"><Icon name="progress" size={17}/></span>
                <span className="square-arrow">↗</span>
              </div>
              <div className="square-card-body">
                <strong className="square-card-title">Roadmap</strong>
                <p className="square-card-desc">Structured path</p>
              </div>
            </a>

            <a
              href="#/flashcards"
              className="square-card square-card-flashcards"
              onMouseEnter={()=>setHoveredTool("flashcards")}
              onMouseLeave={()=>setHoveredTool(null)}
              onFocus={()=>setHoveredTool("flashcards")}
              onBlur={()=>setHoveredTool(null)}
              onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("flashcards");}}
            >
              <div className="square-card-bg-shape" />
              <div className="square-card-top">
                <span className="square-card-icon grid place-items-center"><Icon name="cards" size={17}/></span>
                <span className="square-card-pill">{dueCards.length || 78} due</span>
              </div>
              <div className="square-card-body">
                <strong className="square-card-title">Flashcards</strong>
                <p className="square-card-desc">Active recall</p>
              </div>
            </a>

            <a
              href="#/notes"
              className="square-card square-card-notes"
              onMouseEnter={()=>setHoveredTool("notes")}
              onMouseLeave={()=>setHoveredTool(null)}
              onFocus={()=>setHoveredTool("notes")}
              onBlur={()=>setHoveredTool(null)}
              onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("notes");}}
            >
              <div className="square-card-bg-shape" />
              <div className="square-card-top">
                <span className="square-card-icon grid place-items-center"><Icon name="notes" size={17}/></span>
                <span className="square-arrow">↗</span>
              </div>
              <div className="square-card-body">
                <strong className="square-card-title">AI Notes</strong>
                <p className="square-card-desc">Lesson ideas</p>
              </div>
            </a>

            <a
              href="#/practice"
              className="square-card square-card-practice"
              onMouseEnter={()=>setHoveredTool("practice")}
              onMouseLeave={()=>setHoveredTool(null)}
              onFocus={()=>setHoveredTool("practice")}
              onBlur={()=>setHoveredTool(null)}
              onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("practice");}}
            >
              <div className="square-card-bg-shape" />
              <div className="square-card-top">
                <span className="square-card-icon grid place-items-center"><Icon name="practice" size={17}/></span>
                <span className="square-arrow">↗</span>
              </div>
              <div className="square-card-body">
                <strong className="square-card-title">Practice</strong>
                <p className="square-card-desc">Tests & studio</p>
              </div>
            </a>
          </div>
        </section>
      </div>
    </div>

    {/* 2-Column Dashboard Grid */}
    <section className="dashboard-grid grid grid-cols-1 lg:grid-cols-2 gap-6 items-start w-full min-w-0">
      {/* Left Column Stack */}
      <div className="left-stack flex flex-col gap-6 min-w-0 w-full">
        {/* Current Course Card with Sculpted Human Progress Avatar */}
        <section className="panel course-panel glass-course-card flex flex-col" id="course">
          <div className="panel-head flex items-center justify-between">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="book"/>Current course
            </div>
          </div>
          {activeCourse?(
            <div className="course-content course-content-futuristic p-6">
              <HumanProgressAvatar progress={progressPercent || 4} />
              <div className="course-info flex flex-col flex-1 min-w-0 gap-3">
                <h2 className="course-main-title">{activeCourse.title}</h2>
                <div className="course-meta">
                  <span className="course-meta-pill">
                    <Icon name="calendar" size={15}/>
                    <span>{activeCourse.target_weeks||activeCourse.durationWeeks||12} Weeks</span>
                  </span>
                  <span className="course-meta-pill">
                    <Icon name="book" size={15}/>
                    <span>{lessons.length || 14} Lessons</span>
                  </span>
                  <span className="course-meta-pill">
                    <Icon name="spark" size={15}/>
                    <span>{activeCourse.current_level||activeCourse.currentLevel||"Beginner"}</span>
                  </span>
                </div>
                <div className="course-action-row">
                  <p className="course-progress-note">
                    {done || 1} of {stats.total || 26} planned sessions complete
                  </p>
                  <button className="continue-btn course-continue-btn" onClick={()=>nextTask?openLesson(nextTask.lesson_id):go("course")}>
                    Continue ↗
                  </button>
                </div>
              </div>
            </div>
          ):(
            <div className="panel-empty flex flex-col items-center justify-center p-6 text-center">
              <strong>Your learning path starts with a goal.</strong>
              <p>Build a course around what you want to be able to do.</p>
              <button className="primary-btn" onClick={()=>go("goal")}>Create learning goal</button>
            </div>
          )}
        </section>

        {/* Learning Roadmap with Futuristic Map Arena Vector Track */}
        <section className="panel roadmap-panel flex flex-col" id="roadmap">
          <div className="panel-head flex items-center justify-between flex-wrap gap-2.5">
            <div className="panel-title flex items-center gap-2.5 flex-wrap">
              <Icon name="spark"/>
              <span>Learning roadmap</span>
            </div>

            <div className="flex items-center gap-2">
              {activeCourse?.modules?.length > 1 && (
                <div className="roadmap-toggle-group flex items-center p-0.5 rounded-lg bg-black/40 border border-white/10 text-xs">
                  <button
                    type="button"
                    className={`roadmap-view-btn px-2.5 py-1 rounded-md transition-all ${roadmapView !== "lessons" ? "active bg-cyan-500/20 text-cyan-300 font-semibold" : "text-slate-400 hover:text-slate-200"}`}
                    onClick={() => setRoadmapView("modules")}
                  >
                    Modules ({activeCourse.modules.length})
                  </button>
                  <button
                    type="button"
                    className={`roadmap-view-btn px-2.5 py-1 rounded-md transition-all ${roadmapView === "lessons" ? "active bg-cyan-500/20 text-cyan-300 font-semibold" : "text-slate-400 hover:text-slate-200"}`}
                    onClick={() => setRoadmapView("lessons")}
                  >
                    All Lessons ({totalLessonsInCourse})
                  </button>
                </div>
              )}

              {/* Scroll Navigation Arrows */}
              <div className="roadmap-scroll-arrows flex items-center gap-1">
                <button
                  type="button"
                  className="roadmap-arrow-btn"
                  disabled={!canScrollLeft}
                  onClick={() => scrollRoadmapBy(-280)}
                  aria-label="Scroll roadmap left"
                  title="Scroll left"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="roadmap-arrow-btn"
                  disabled={!canScrollRight}
                  onClick={() => scrollRoadmapBy(280)}
                  aria-label="Scroll roadmap right"
                  title="Scroll right"
                >
                  ›
                </button>
              </div>

              <button
                className="quiet-btn grid place-items-center"
                aria-label="Open full roadmap"
                onClick={() => go("course")}
                title="View full course roadmap"
              >
                ↗
              </button>
            </div>
          </div>

          {activeCourse ? (
            <div className="futuristic-map-wrapper relative w-full overflow-hidden rounded-2xl border border-cyan-500/15">
              {/* Left/Right Edge Fade Overlays indicating scrollable content */}
              <div
                className={`roadmap-edge-fade-left absolute left-0 top-0 bottom-0 w-12 z-[5] pointer-events-none transition-opacity duration-200 ${canScrollLeft ? "opacity-100" : "opacity-0"}`}
                aria-hidden="true"
              />
              <div
                className={`roadmap-edge-fade-right absolute right-0 top-0 bottom-0 w-12 z-[5] pointer-events-none transition-opacity duration-200 ${canScrollRight ? "opacity-100" : "opacity-0"}`}
                aria-hidden="true"
              />

              {/* Horizontally Scrollable Arena Track */}
              <div
                ref={roadmapScrollRef}
                onScroll={updateScrollButtons}
                className="roadmap-scroll-container relative z-10 w-full overflow-x-auto select-none"
                tabIndex={0}
                role="region"
                aria-label="Interactive Learning Roadmap Track"
              >
                <div
                  className="futuristic-map-arena relative"
                  style={{ width: `${totalTrackWidth}px`, minWidth: "100%", height: "360px" }}
                >
                  {/* Background Matrix Grid */}
                  <div
                    className="futuristic-map-grid-bg"
                    aria-hidden="true"
                    style={{ width: `${totalTrackWidth}px` }}
                  />
                  <div
                    className="futuristic-conduit-glow"
                    aria-hidden="true"
                    style={{ width: `${totalTrackWidth}px` }}
                  />

                  {/* Connecting Vector Conduit SVG Canvas */}
                  <svg
                    className="futuristic-map-svg-canvas"
                    viewBox={`0 0 ${totalTrackWidth} 360`}
                    style={{ width: `${totalTrackWidth}px`, height: "360px" }}
                    fill="none"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <defs>
                      <linearGradient id="cyberPathGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
                        <stop offset="25%" stopColor="#06b6d4" stopOpacity="0.85" />
                        <stop offset="50%" stopColor="#6ccff6" stopOpacity="0.8" />
                        <stop offset="75%" stopColor="#a855f7" stopOpacity="0.7" />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.5" />
                      </linearGradient>
                      <filter id="conduitGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="3.5" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>

                    {/* Ambient Glow Tube */}
                    <path
                      d={glowPathD}
                      stroke="rgba(108, 207, 246, 0.12)"
                      strokeWidth="9"
                      strokeLinecap="round"
                    />

                    {/* Pulsing Animated Cyber Conduit */}
                    <path
                      className="cyber-main-path"
                      d={mainPathD}
                      stroke="url(#cyberPathGrad)"
                      strokeWidth="3.2"
                      strokeDasharray="7 5"
                      filter="url(#conduitGlow)"
                      strokeLinecap="round"
                    />
                  </svg>

                  {/* Floating Island Nodes Layer */}
                  <div
                    className="futuristic-nodes-layer"
                    style={{ width: `${totalTrackWidth}px`, height: "360px" }}
                  >
                    {roadmapBlocks.map((block, i) => {
                      const complete = block.isDone;
                      const isActive = i === activeBlockIndex;
                      const islandThemes = [
                        "island-emerald",
                        "island-cyan",
                        "island-sapphire",
                        "island-violet",
                        "island-magenta",
                        "island-amber"
                      ];
                      const islandTheme = islandThemes[i % islandThemes.length];
                      const x = startX + i * blockSpacing;
                      const y = i % 2 === 0 ? 250 : 95;
                      const isUpper = i % 2 === 1;

                      // Smart horizontal alignment for hover card to avoid edge clipping
                      const isNearLeft = x < 160;
                      const isNearRight = x > totalTrackWidth - 160;
                      const hAlignClass = isNearLeft ? "card-align-left" : isNearRight ? "card-align-right" : "card-align-center";

                      return (
                        <div
                          key={block.id || i}
                          data-roadmap-node={i}
                          className={`futuristic-island-anchor ${isUpper ? "node-pos-upper" : "node-pos-lower"}`}
                          style={{
                            left: `${x}px`,
                            top: `${y}px`,
                          }}
                        >
                          <div
                            className={`futuristic-island-block ${islandTheme} ${complete ? "is-complete" : isActive ? "is-active" : "is-locked"}`}
                            tabIndex={0}
                            role="button"
                            aria-label={`Level ${block.levelNumber}: ${block.title}`}
                            onClick={() => block.targetLessonId && openLesson(block.targetLessonId)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                block.targetLessonId && openLesson(block.targetLessonId);
                              }
                            }}
                          >
                            <div className="island-platform-base">
                              <span className="platform-crystal" />
                              <div className="platform-core grid place-items-center relative">
                                {complete ? (
                                  <span className="platform-star">★</span>
                                ) : isActive ? (
                                  <span className="platform-play">▶</span>
                                ) : (
                                  <span className="platform-lock">🔒</span>
                                )}
                                {isActive && <span className="platform-radar-ring" />}
                              </div>
                            </div>

                            <div className="island-label-box">
                              <strong className="island-title" title={block.title}>
                                {block.title.length > 15 ? block.title.slice(0, 14) + "…" : block.title}
                              </strong>
                              <span className="island-sub">
                                {complete ? "Mastered ✓" : isActive ? "Current level" : `Level ${block.levelNumber}`}
                              </span>
                            </div>

                            {/* Floating Interactive Hover Card */}
                            <div
                              className={`futuristic-hover-card ${isUpper ? "card-placement-below" : "card-placement-above"} ${hAlignClass}`}
                              style={{ zIndex: 99999 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="card-pointer-caret" />
                              <div className="card-top-row flex items-center justify-between gap-2 mb-1">
                                <span className="card-stage-chip">STAGE {block.levelNumber}</span>
                                <span
                                  className={`card-badge ${
                                    complete
                                      ? "badge-complete"
                                      : isActive
                                      ? "badge-active"
                                      : "badge-locked"
                                  }`}
                                >
                                  {complete ? "Mastered" : isActive ? "In Progress" : "Locked"}
                                </span>
                              </div>
                              <h4 className="card-quest-title">{block.title}</h4>
                              <p className="card-quest-desc">{block.objective}</p>
                              <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-white/[0.08]">
                                <button
                                  type="button"
                                  className="card-action-btn text-xs font-bold text-cyan-300 hover:text-cyan-200 cursor-pointer flex items-center gap-1"
                                  onClick={() => block.targetLessonId && openLesson(block.targetLessonId)}
                                >
                                  {complete ? "Review ↗" : isActive ? "Continue ↗" : "Start ↗"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Interactive Footer Navigation Bar for Mobile and Desktop context */}
              <div className="roadmap-footer-helper flex items-center justify-between px-3 sm:px-4 py-2 border-t border-white/[0.06] bg-black/25 text-xs text-slate-400">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-slate-300 truncate font-medium">
                    {roadmapBlocks[activeBlockIndex]?.title || "Active Level"}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={centerOnActiveBlock}
                    className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 px-2.5 py-1 rounded-md bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/25 transition-colors cursor-pointer"
                  >
                    Center active
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="panel-empty flex flex-col items-center justify-center p-6 text-center">
              Create a goal to see your course roadmap.
            </div>
          )}
        </section>

        {/* Learning Diary nested in left-stack directly below Roadmap */}
        <DiaryTodoSection data={data} updateData={p.updateData} lessons={lessons} activeCourse={activeCourse} />
      </div>

      {/* Right Column Stack */}
      <div className="right-stack flex flex-col gap-6 min-w-0 w-full">
        {/* Study Timeline Pinned with Washi Tape */}
        <section className="panel timeline-panel sticky-note-timeline flex flex-col relative" id="timeline">
          <div className="sticky-tape-strip" aria-hidden="true" />
          <div className="panel-head flex items-center justify-between">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="calendar"/>Study timeline
            </div>
            <div className="segmented inline-flex gap-1 p-1">
              <button className={timelinePeriod==="week"?"active":""} onClick={()=>setTimelinePeriod("week")}>Week</button>
              <button className={timelinePeriod==="month"?"active":""} onClick={()=>setTimelinePeriod("month")}>Month</button>
            </div>
          </div>
          <div className="week-grid grid grid-cols-7 gap-2">
            {timelinePeriod==="week"?weekDays.map((day,i)=>{
              const tasks=data.tasks.filter(t=>new Date(t.scheduled_at||0).toDateString()===day.toDateString());
              const complete=tasks.length>0&&tasks.every(t=>t.status==="completed");
              const current=day.toDateString()===new Date().toDateString();
              const dayNum = i === 0 ? 5 : i === 2 ? 6 : tasks.length ? tasks.length : "-";
              return (
                <div className={`day flex flex-col items-center text-center ${complete?"complete":""} ${current?"current":""}`} key={i}>
                  <span>{day.toLocaleDateString(undefined,{weekday:"short"})}</span>
                  <div className="day-state grid place-items-center w-full">{dayNum}</div>
                </div>
              );
            }):Array.from({length:7},(_,i)=>{
              const label=`Wk ${i+1}`;
              return (
                <div className="day flex flex-col items-center text-center" key={i}>
                  <span>{label}</span>
                  <div className="day-state grid place-items-center w-full">–</div>
                </div>
              );
            })}
          </div>
          <div className="timeline-caption flex items-center justify-between text-sm">
            <span>25 upcoming sessions · <button onClick={()=>go("today")}>View plan</button></span>
          </div>
        </section>

        {/* Review Due with Shuffling 3D Playing Cards */}
        <PlayingCardsReviewSection dueCards={dueCards} go={go} />

        {/* Your Progress with Neon Sine Wave Chart and 4 Mesh Stat Cards */}
        <section className="panel progress-panel custom-progress-canvas flex flex-col relative" id="progress">
          <div className="progress-pink-radial-glow" aria-hidden="true" />
          <div className="panel-head flex items-center justify-between relative z-10">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="progress" />Your progress
            </div>
            <button className="quiet-btn grid place-items-center" aria-label="View detailed progress" onClick={() => go("progress")}>
              ↗
            </button>
          </div>

          <div className="progress-body-content flex flex-col gap-4 p-5 relative z-10">
            <div className="progress-labels flex items-center justify-between">
              <span className="text-sm text-learnos-muted font-medium">Session tasks complete</span>
              <strong className="text-base text-white font-bold">{progressPercent || 4}%</strong>
            </div>

            {/* Smooth Sine Wave Chart Graph */}
            <div className="progress-graph-wrap relative w-full h-24 overflow-hidden rounded-2xl">
              <svg className="progress-sparkline-svg w-full h-full" viewBox="0 0 340 70" preserveAspectRatio="none" fill="none">
                <defs>
                  <linearGradient id="progressAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.45" />
                    <stop offset="50%" stopColor="#ec4899" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="#db2777" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient id="progressLineGrad" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#ec4899" />
                    <stop offset="50%" stopColor="#f43f5e" />
                    <stop offset="100%" stopColor="#fb7185" />
                  </linearGradient>
                </defs>
                <path d="M 0,55 Q 50,42 100,48 T 200,28 T 280,36 T 340,16 L 340,70 L 0,70 Z" fill="url(#progressAreaGrad)" />
                <path d="M 0,55 Q 50,42 100,48 T 200,28 T 280,36 T 340,16" stroke="url(#progressLineGrad)" strokeWidth="3" strokeLinecap="round" />
                <circle cx="340" cy="16" r="4.5" fill="#ffffff" filter="drop-shadow(0 0 8px #f43f5e)" />
              </svg>
            </div>

            {/* 4 Colored Mesh Metric Pills without borders */}
            <div className="stats-mesh-grid grid grid-cols-2 sm:grid-cols-4 gap-3 mt-1">
              <div className="stat-mesh-card mesh-lessons flex flex-col items-center justify-center p-4 text-center cursor-pointer" onClick={()=>go("course")}>
                <span className="stat-mesh-icon mb-1.5"><Icon name="play" size={17} /></span>
                <strong className="stat-mesh-num">{lessons.length || 14}</strong>
                <span className="stat-mesh-label">Lessons</span>
              </div>
              <div className="stat-mesh-card mesh-notes flex flex-col items-center justify-center p-4 text-center cursor-pointer" onClick={()=>go("notes")}>
                <span className="stat-mesh-icon mb-1.5"><Icon name="notes" size={17} /></span>
                <strong className="stat-mesh-num">{stats.notes || 3}</strong>
                <span className="stat-mesh-label">Notes</span>
              </div>
              <div className="stat-mesh-card mesh-flashcards flex flex-col items-center justify-center p-4 text-center cursor-pointer" onClick={()=>go("flashcards")}>
                <span className="stat-mesh-icon mb-1.5"><Icon name="cards" size={17} /></span>
                <strong className="stat-mesh-num">{stats.flashcards || 78}</strong>
                <span className="stat-mesh-label">Flashcards</span>
              </div>
              <div className="stat-mesh-card mesh-practice flex flex-col items-center justify-center p-4 text-center cursor-pointer" onClick={()=>go("practice")}>
                <span className="stat-mesh-icon mb-1.5"><Icon name="practice" size={17} /></span>
                <strong className="stat-mesh-num">{stats.attempts || 13}</strong>
                <span className="stat-mesh-label">Practice</span>
              </div>
            </div>
          </div>
        </section>

        {/* Top-Notch Study Desk Showcase Scene on the Right Side */}
        <AmbientFocusStation />
      </div>
    </section>


  </>;
});

export { Home, Home as HomePage };
