import React, { useState, useMemo } from "react";
import { Icon, Panel, EmptyState } from "../components/common.jsx";

function ProgressPage(p){
  const [courseFilter,setCourseFilter]=useState(()=>p.routeQuery?.get?.("course")||"all");
  const allCourses=p.data?.courses||[];
  const allLessons=useMemo(()=>p.allLessons?.length?p.allLessons:collectAllCourseLessons(allCourses,p.lessons,p.activeCourse),[p.allLessons,allCourses,p.lessons,p.activeCourse]);
  const lessonCourseMap=useMemo(()=>{
    const map=new Map();
    allLessons.forEach(l=>{if(l.id&&l.courseId)map.set(l.id,l.courseId);});
    return map;
  },[allLessons]);
  const scopedTasks=useMemo(()=>courseFilter==="all"?p.data.tasks:p.data.tasks.filter(t=>t.course_id===courseFilter),[p.data.tasks,courseFilter]);
  const scopedAttempts=useMemo(()=>courseFilter==="all"?p.data.attempts:p.data.attempts.filter(a=>(a.course_id||lessonCourseMap.get(a.lesson_id))===courseFilter),[p.data.attempts,courseFilter,lessonCourseMap]);

  const done=scopedTasks.filter(t=>t.status==="completed").length,total=scopedTasks.length,passed=scopedAttempts.filter(a=>Number(a.score)>=70).length,concepts=[...new Set(scopedAttempts.filter(a=>Number(a.score)>=70).map(a=>a.concept))];
  const byWeek=Array.from({length:6},(_,i)=>{const date=new Date();date.setDate(date.getDate()-((5-i)*7));const week=date.toLocaleDateString(undefined,{month:"short",day:"numeric"});const matches=scopedTasks.filter(t=>{const d=new Date(t.scheduled_at||0);const diff=(date-d)/(1000*60*60*24);return diff>=0&&diff<7;});return {week,value:matches.filter(t=>t.status==="completed").length,total:matches.length};});

  // Rich User Behavior & Learning Telemetry Metrics
  const metrics=useMemo(()=>calculateLearnerMetrics(p.data,p.data?.settings||{}),[p.data]);

  return <div className="progress-dashboard flex flex-col gap-5">
    {/* Behavioral KPIs Overview */}
    <div className="progress-kpi-grid grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* 1. Daily Active Streak */}
      <div className="panel progress-kpi-card flex flex-col justify-between p-3.5 gap-2">
        <div className="flex items-center justify-between">
          <span className="quiet-label text-[11px]">DAILY STREAK</span>
          <span className="kpi-icon-badge streak-badge" aria-hidden="true">🔥</span>
        </div>
        <div>
          <div className="kpi-value text-2xl font-bold flex items-baseline gap-1.5">
            <span>{metrics.streak.streakDays}</span>
            <span className="text-sm font-normal text-learnos-muted">day{metrics.streak.streakDays===1?"":"s"}</span>
          </div>
          <p className="kpi-caption text-xs text-learnos-muted-2 mt-0.5">
            {metrics.streak.activeToday?"Active today · Streak sustained":metrics.streak.streakDays>0?"Practice today to maintain streak":"Start your learning streak"}
          </p>
        </div>
      </div>

      {/* 2. Weekly Study Velocity */}
      <div className="panel progress-kpi-card flex flex-col justify-between p-3.5 gap-2">
        <div className="flex items-center justify-between">
          <span className="quiet-label text-[11px]">WEEKLY COMMITMENT</span>
          <span className="kpi-icon-badge target-badge" aria-hidden="true">⏱️</span>
        </div>
        <div>
          <div className="kpi-value text-2xl font-bold flex items-baseline gap-1.5">
            <span>{metrics.studyTime.weeklyMinutesSpent}</span>
            <span className="text-sm font-normal text-learnos-muted">/ {metrics.studyTime.weeklyGoalMinutes}m</span>
          </div>
          <div className="kpi-bar-wrap w-full bg-learnos-line/30 h-1.5 rounded-full overflow-hidden mt-1.5">
            <div className="kpi-bar-fill h-full transition-all" style={{width:`${metrics.studyTime.weeklyGoalPct}%`}}/>
          </div>
          <p className="kpi-caption text-xs text-learnos-muted-2 mt-1">
            {metrics.studyTime.weeklyGoalPct}% achieved · {metrics.studyTime.remainingMinutes>0?`${metrics.studyTime.remainingMinutes}m remaining`:"Goal reached! 🎉"}
          </p>
        </div>
      </div>

      {/* 3. Spaced Retention Rate */}
      <div className="panel progress-kpi-card flex flex-col justify-between p-3.5 gap-2">
        <div className="flex items-center justify-between">
          <span className="quiet-label text-[11px]">RETENTION RATE</span>
          <span className="kpi-icon-badge retention-badge" aria-hidden="true">🧠</span>
        </div>
        <div>
          <div className="kpi-value text-2xl font-bold flex items-baseline gap-1.5">
            <span>{metrics.retention.retentionRate}%</span>
            <span className="text-sm font-normal text-learnos-muted">recall score</span>
          </div>
          <p className="kpi-caption text-xs text-learnos-muted-2 mt-0.5">
            {metrics.retention.masteredCards} cards mastered · {metrics.retention.totalCardReviews} reviews logged
          </p>
        </div>
      </div>

      {/* 4. Practice Accuracy */}
      <div className="panel progress-kpi-card flex flex-col justify-between p-3.5 gap-2">
        <div className="flex items-center justify-between">
          <span className="quiet-label text-[11px]">PRACTICE ACCURACY</span>
          <span className="kpi-icon-badge accuracy-badge" aria-hidden="true">🎯</span>
        </div>
        <div>
          <div className="kpi-value text-2xl font-bold flex items-baseline gap-1.5">
            <span>{metrics.practice.passRate}%</span>
            <span className="text-sm font-normal text-learnos-muted">pass rate</span>
          </div>
          <p className="kpi-caption text-xs text-learnos-muted-2 mt-0.5">
            {metrics.practice.passedAttempts} of {metrics.practice.totalAttempts} attempts passed (≥70%)
          </p>
        </div>
      </div>
    </div>

    {/* Main 2-Column Grid */}
    <div className="progress-page-grid grid gap-4 items-start">
      {/* Left Column: Study Activity & 7-Day Rhythm */}
      <div className="flex flex-col gap-4">
        <section className="panel progress-overview flex flex-col p-4 gap-4">
          <div className="panel-head flex items-center justify-between gap-2 flex-wrap">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="progress"/>Study activity
            </div>
            <div className="flex items-center gap-2.5 flex-wrap">
              {allCourses.length>0?<select value={courseFilter} onChange={e=>setCourseFilter(e.target.value)} aria-label="Filter progress by course" className="tool-course-select text-xs rounded-lg px-2.5 py-1.5 bg-learnos-bg/70 border border-learnos-line text-learnos-text"><option value="all">All courses ({allCourses.length})</option>{allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select>:<span className="muted-copy text-sm">Based on sessions in your plan</span>}
            </div>
          </div>
          <div className="progress-hero flex items-center gap-4">
            <div className="progress-donut grid place-items-center" style={{"--progress":`${total?done/total*100:0}%`}}>
              <strong>{total?Math.round(done/total*100):0}%</strong>
              <span>complete</span>
            </div>
            <div>
              <h2>{done} of {total} sessions done</h2>
              <p>Task completion describes the work you finished. It is not a mastery score.</p>
            </div>
          </div>
          <div className="progress-bars flex items-end justify-between gap-2 h-36 pt-4">
            {byWeek.map((item,i)=><div className="progress-bar-col flex flex-col items-center gap-1.5 flex-1" key={i}><div className="progress-bar-wrap w-full"><div className="progress-bar-fill" style={{height:`${item.total?Math.max(9,item.value/item.total*100):4}%`}} title={`${item.value} of ${item.total} sessions`}/></div><span>{item.week}</span></div>)}
          </div>
          <div className="chart-legend flex items-center gap-4 text-sm">
            <span><i/>Completed sessions</span><span><i className="planned-dot"/>Planned sessions</span>
          </div>
        </section>

        {/* 7-Day Learning Rhythm & Modality Breakdown */}
        <section className="panel learning-rhythm-panel flex flex-col p-4 gap-3.5">
          <div className="panel-head flex items-center justify-between">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="spark"/>7-Day Learning Rhythm
            </div>
            <span className="text-xs text-learnos-muted-2">Activity by day</span>
          </div>
          <div className="rhythm-bars flex items-end justify-between gap-2 h-20 pt-2">
            {metrics.rhythm.map((d,i)=>(
              <div key={i} className={`rhythm-bar-col flex flex-col items-center gap-1 flex-1 ${d.isToday?"is-today":""}`}>
                <div className="rhythm-bar-wrap w-full flex items-end justify-center h-14 rounded overflow-hidden">
                  <div
                    className={`rhythm-bar-fill w-full rounded ${d.active?"active":""}`}
                    style={{height:`${d.eventsCount?Math.max(14,Math.min(100,d.eventsCount*22)):6}%`}}
                    title={`${d.dayName} (${d.label}): ${d.eventsCount} actions, ~${d.minutes}m`}
                  />
                </div>
                <span className="rhythm-day-label text-[11px] text-learnos-muted-2">{d.dayName}</span>
              </div>
            ))}
          </div>

          <div className="modality-section pt-3 border-t border-learnos-line/30">
            <div className="flex items-center justify-between text-xs text-learnos-muted mb-2">
              <span>Learning Modality Distribution</span>
              <span className="text-learnos-muted-2">Share of activity</span>
            </div>
            <div className="modality-pills flex flex-wrap gap-2 text-xs">
              <span className="modality-pill">📚 Roadmap {metrics.modalityShares.roadmap}%</span>
              <span className="modality-pill">⚡ Practice {metrics.modalityShares.practice}%</span>
              <span className="modality-pill">🃏 Flashcards {metrics.modalityShares.flashcards}%</span>
              <span className="modality-pill">🤖 AI Tutor {metrics.modalityShares.tutor}%</span>
              <span className="modality-pill">📝 Notes {metrics.modalityShares.notes}%</span>
            </div>
          </div>
        </section>

        {/* Memory & Practice Summary */}
        <section className="panel retention-insights flex flex-col p-4 gap-3">
          <div className="panel-head flex items-center justify-between">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="cards"/>Memory & Review Progress
            </div>
            <button type="button" className="text-button text-xs" onClick={()=>p.go("flashcards")}>Flashcards ↗</button>
          </div>
          <div className="grid grid-cols-3 gap-2.5 text-xs">
            <div className="insight-box p-2.5 rounded-lg border border-learnos-line/40 bg-learnos-surface/40 flex flex-col gap-1">
              <span className="text-learnos-muted-2 text-[11px]">Mastered</span>
              <strong className="text-base text-learnos-text">{metrics.retention.masteredCards}</strong>
            </div>
            <div className="insight-box p-2.5 rounded-lg border border-learnos-line/40 bg-learnos-surface/40 flex flex-col gap-1">
              <span className="text-learnos-muted-2 text-[11px]">Learning</span>
              <strong className="text-base text-learnos-text">{metrics.retention.learningCards}</strong>
            </div>
            <div className="insight-box p-2.5 rounded-lg border border-learnos-line/40 bg-learnos-surface/40 flex flex-col gap-1">
              <span className="text-learnos-muted-2 text-[11px]">Tutor Queries</span>
              <strong className="text-base text-learnos-text">{metrics.tutor.totalInteractions}</strong>
            </div>
          </div>
        </section>
      </div>

      {/* Right Column: Renamed Card & By Course Table */}
      <div className="flex flex-col gap-4">
        {/* Renamed Card: Concept Mastery & Practice Activity */}
        <section className="panel evidence-overview flex flex-col p-4 gap-4">
          <div className="panel-head flex items-center justify-between">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="check"/>Concept Mastery & Practice Activity
            </div>
          </div>
          <div className="evidence-summary grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><strong>{passed}</strong><span>checkpoint passes</span></div>
            <div><strong>{concepts.length}</strong><span>concepts mastered</span></div>
            <div><strong>{scopedAttempts.length}</strong><span>attempts recorded</span></div>
            <div><strong>{scopedAttempts.length?Math.round(passed/scopedAttempts.length*100):0}%</strong><span>mastery rate</span></div>
          </div>
          <EvidenceList attempts={scopedAttempts} pageSize={5} showControls={true}/>
        </section>

        {/* Course Progress Table */}
        <section className="panel course-progress-table flex flex-col p-4 gap-3">
          <div className="panel-head flex items-center justify-between">
            <div className="panel-title flex items-center gap-2.5">
              <Icon name="book"/>By course
            </div>
            {courseFilter!=="all"&&<button type="button" className="text-button text-xs" onClick={()=>setCourseFilter("all")}>Show all courses</button>}
          </div>
          {allCourses.map(c=>{
            const tasks=p.data.tasks.filter(t=>t.course_id===c.id),complete=tasks.filter(t=>t.status==="completed").length;
            const isSelected=courseFilter===c.id;
            return <button type="button" className={`course-progress-line flex items-center justify-between gap-3 p-2 w-full text-left cursor-pointer ${isSelected?"selected":""}`} key={c.id} onClick={()=>setCourseFilter(isSelected?"all":c.id)} aria-pressed={isSelected}>
              <div>
                <strong>{c.title}</strong>
                <small>{complete} completed of {tasks.length} scheduled tasks</small>
              </div>
              <div className="progress-track flex-1 overflow-hidden">
                <div className="progress-fill" style={{width:`${tasks.length?complete/tasks.length*100:0}%`}}/>
              </div>
              <span>{tasks.length?Math.round(complete/tasks.length*100):0}%</span>
            </button>;
          })}
          {!allCourses.length&&<p className="muted-copy padded">Approve a plan to see course progress.</p>}
        </section>
      </div>
    </div>
  </div>;
}

export { ProgressPage };
