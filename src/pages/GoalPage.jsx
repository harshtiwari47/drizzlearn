import React, { useRef, useState } from "react";
import { Icon, Panel, GenerationProgressCard } from "../components/common.jsx";

function readGoalDraft(){try{return JSON.parse(sessionStorage.getItem("learnos.goal.draft")||"{}");}catch{return {};}}

export { readGoalDraft };

function GoalPage(p){
  const formRef=useRef(null);
  const [topic,setTopic]=useState(()=>sessionStorage.getItem("learnos.goal.prefill")||readGoalDraft().topic||"");
  const [outcome,setOutcome]=useState(()=>readGoalDraft().desiredOutcome||"");
  const [level,setLevel]=useState("Beginner"),[purpose,setPurpose]=useState("Personal learning"),[weekly,setWeekly]=useState(p.data.settings.weeklyMinutes||360),[weeks,setWeeks]=useState(8),[date,setDate]=useState("");
  const runSubmit=async()=>{
    sessionStorage.removeItem("learnos.goal.prefill");
    await p.submitGoal({topic,desiredOutcome:outcome,currentLevel:level,purpose,weeklyMinutes:Number(weekly),targetWeeks:Number(weeks),targetDate:date||null});
  };
  const submit=async(e)=>{e.preventDefault();await runSubmit();};
  const retryGeneration=()=>{
    if(formRef.current?.requestSubmit){formRef.current.requestSubmit();}
    else{runSubmit();}
  };

  return <div className="goal-builder-layout grid gap-4 items-start">
    <form ref={formRef} className="panel goal-form flex flex-col p-4 gap-4" onSubmit={submit}>
      <div className="panel-head flex items-center justify-between">
        <div className="panel-title flex items-center gap-2.5"><Icon name="spark"/>Your learning goal</div>
        <span className="quiet-label text-sm font-semibold">01 / 02</span>
      </div>
      <div className="goal-form-body flex flex-col gap-4">
        <label>What do you want to learn?<input value={topic} onChange={e=>setTopic(e.target.value)} required minLength={2} maxLength={120} placeholder="A subject or capability"/></label>
        <label>What do you want to be able to do?<textarea value={outcome} onChange={e=>setOutcome(e.target.value)} required minLength={8} placeholder="Describe a practical outcome you can demonstrate…"/><small>A clear outcome helps the plan choose useful lessons and practice.</small></label>
        <div className="form-grid-two grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label>Current level<select value={level} onChange={e=>setLevel(e.target.value)}><option>Beginner</option><option>Some experience</option><option>Intermediate</option><option>Advanced</option></select></label>
          <label>Purpose<select value={purpose} onChange={e=>setPurpose(e.target.value)}><option>Personal learning</option><option>School or university</option><option>Work project</option><option>Career transition</option><option>Other</option></select></label>
        </div>
        <div className="form-section flex flex-col gap-3 pt-3 border-t border-learnos-line">
          <div className="section-heading-row flex items-center justify-between">
            <div>
              <h3>Make the plan realistic</h3>
              <p className="text-sm text-learnos-muted">Your course proposal will show the expected weekly effort.</p>
            </div>
          </div>
          <div className="form-grid-two grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label>Hours each week<select value={weekly} onChange={e=>setWeekly(Number(e.target.value))}><option value="180">3 hours</option><option value="360">6 hours</option><option value="600">10 hours</option><option value="900">15 hours</option><option value="1200">20 hours</option></select></label>
            <label>Target duration<select value={weeks} onChange={e=>setWeeks(Number(e.target.value))}><option value="4">4 weeks</option><option value="8">8 weeks</option><option value="10">10 weeks</option><option value="12">12 weeks</option><option value="16">16 weeks</option></select></label>
          </div>
          <label className="date-field">
            <span className="date-label-row flex items-center gap-1.5"><span>Target date</span><span className="optional text-sm text-learnos-muted font-normal">(Optional)</span></span>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} onClick={e=>{try{e.target.showPicker?.();}catch(_){}}} min={new Date().toISOString().slice(0,10)}/>
          </label>
        </div>
        {p.busy&&(
          <GenerationProgressCard
            progress={p.generationProgress}
            fallbackMessage="Crafting your customized course…"
            ariaLabel="Course generation progress"
            note="Building your lessons, worked examples, and practice checks."
          />
        )}
        {p.generationError&&!p.busy&&(
          <div className="course-generation-error p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm flex items-start gap-3" role="alert">
            <span className="course-generation-error-icon"><Icon name="alert" size={18}/></span>
            <div className="flex-1 min-w-0">
              <strong>Course generation paused:</strong> {p.generationError}
            </div>
            <div className="course-generation-error-actions flex items-center gap-2.5 shrink-0">
              <button type="button" className="secondary-btn compact goal-retry-btn" onClick={retryGeneration}>Try generating again ↻</button>
              <button type="button" className="quiet-action goal-dismiss-btn" onClick={()=>p.setGenerationError("")}>Dismiss</button>
            </div>
          </div>
        )}
        <div className="goal-submit-row flex items-center justify-between gap-3 pt-3 border-t border-learnos-line">
          <p className="flex items-center gap-2 text-sm"><Icon name="clock" size={18}/> Your study budget: <strong>{Math.round(Number(weekly)/60)} hours / week</strong></p>
          <button type="submit" className="primary-btn" disabled={p.busy||!topic||!outcome}>{p.busy?<><span className="btn-spinner"/> Building your plan…</>:p.remote?"Generate course proposal ↗":"Sign in to generate plan ↗"}</button>
        </div>
      </div>
    </form>
    <aside className="goal-side flex flex-col gap-4"><Panel title="What happens next" icon="spark"><div className="step-list flex flex-col gap-3"><div><span>1</span><section><strong>We draft the path</strong><p>Modules and lessons are shaped around your outcome.</p></section></div><div><span>2</span><section><strong>You review it</strong><p>Edit the proposal and check it against your weekly time.</p></section></div><div><span>3</span><section><strong>You approve to begin</strong><p>Only approved courses add sessions to your plan.</p></section></div></div></Panel><Panel title="Define a useful outcome" icon="check"><div className="side-panel-copy flex flex-col gap-2 p-4"><p>Describe what you want to do, the scope of the task, and what would show you can do it independently.</p></div></Panel></aside>
  </div>;
}

export { GoalPage };
