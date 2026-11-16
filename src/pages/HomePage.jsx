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
    <section className="dashboard-grid grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      {/* Left Column Stack */}
      <div className="left-stack flex flex-col gap-6">
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
          <div className="panel-head flex items-center justify-between">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="spark"/>Learning roadmap
            </div>
            <div className="flex items-center gap-2">
              <button className="quiet-btn grid place-items-center" aria-label="Open full roadmap" onClick={()=>go("course")}>↗</button>
            </div>
          </div>
          {activeCourse?(
            <div className="futuristic-map-arena relative overflow-visible">
              <div className="futuristic-map-grid-bg" aria-hidden="true" />
              <div className="futuristic-conduit-glow" aria-hidden="true" />

              <svg className="futuristic-map-svg-canvas" viewBox="0 0 700 240" fill="none" preserveAspectRatio="none" aria-hidden="true">
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
                <path d="M 60 180 C 130 190, 160 80, 220 95 C 280 110, 310 180, 370 170 C 430 160, 470 60, 530 85 C 570 100, 610 50, 640 45" stroke="rgba(108, 207, 246, 0.12)" strokeWidth="8" strokeLinecap="round" />
                <path className="cyber-main-path" d="M 60 180 C 130 190, 160 80, 220 95 C 280 110, 310 180, 370 170 C 430 160, 470 60, 530 85 C 570 100, 610 50, 640 45" stroke="url(#cyberPathGrad)" strokeWidth="3" strokeDasharray="6 4" filter="url(#conduitGlow)" strokeLinecap="round" />
              </svg>

              <div className="futuristic-nodes-layer">
                {activeCourse.modules.slice(0,5).map((m,i)=>{
                  const complete=isModuleDone(m);
                  const isActive=i===activeModuleIndex;
                  const targetLesson=m.lessons?.find(l=>!isLessonDone(l.id))||m.lessons?.[0];
                  const islandThemes = ["island-emerald","island-cyan","island-sapphire","island-violet","island-magenta"];
                  const islandTheme = islandThemes[i % islandThemes.length];

                  return (
                    <div key={m.id||i} className={`futuristic-island-anchor node-pos-${i+1}`}>
                      <div 
                        className={`futuristic-island-block ${islandTheme} ${complete?"is-complete":isActive?"is-active":"is-locked"}`}
                        tabIndex={0}
                        role="button"
                        aria-label={`Level ${i+1}: ${m.title}`}
                        onClick={()=>targetLesson&&openLesson(targetLesson.id)}
                      >
                        <div className="island-platform-base">
                          <span className="platform-crystal" />
                          <div className="platform-core grid place-items-center relative">
                            {complete ? <span className="platform-star">★</span> : isActive ? <span className="platform-play">▶</span> : <span className="platform-lock">🔒</span>}
                            {isActive && <span className="platform-radar-ring" />}
                          </div>
                          <span className="island-level-pill">LVL {i+1}</span>
                        </div>
                        <div className="island-label-box">
                          <strong className="island-title">{m.title.length > 14 ? m.title.slice(0, 13) + "…" : m.title}</strong>
                          <span className="island-sub">
                            {complete ? "Mastered ✓" : isActive ? "Current level" : `Level ${i+1}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ):(
            <div className="panel-empty flex flex-col items-center justify-center p-6 text-center">Create a goal to see your course roadmap.</div>
          )}
        </section>

        {/* Learning Diary nested in left-stack directly below Roadmap */}
        <DiaryTodoSection data={data} updateData={p.updateData} />
      </div>

      {/* Right Column Stack */}
      <div className="right-stack flex flex-col gap-6">
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
