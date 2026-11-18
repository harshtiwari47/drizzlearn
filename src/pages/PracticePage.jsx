import React, { useState, useMemo, useDeferredValue, useEffect, useCallback, useRef } from "react";
import { Icon, Panel, EmptyState, prettyDate, collectAllCourseLessons } from "../components/common.jsx";
import { buildPracticeSetKey, listLessonPracticeModes, loadPracticeSet, savePracticeSet } from "../practice-db.js";
import { recordBehavior } from "../behavior-tracking.js";
import { PracticeStudioRunner } from "../practice-exercises.jsx";

const PRACTICE_MODES = [
  { id: "fill_blank", label: "Fill in the Blanks", hint: "Complete key ideas using a word bank" },
  { id: "quiz", label: "Quiz", hint: "Applied multiple-choice questions" },
  { id: "order", label: "Correct Order", hint: "Sequence steps in logical order" },
  { id: "word_scramble", label: "Word Builder", hint: "Unscramble core lesson terminology" },
  { id: "mixed", label: "Quick Mix", hint: "One drill of each interactive type" },
  { id: "checkpoint", label: "Topic Checkpoint", hint: "Lesson-end understanding check" },
];

function PracticePage(p){
  const allCourses=useMemo(()=>(p.data?.courses||[]).filter(c=>c.modules?.some(m=>m.lessons?.length)),[p.data?.courses]);
  const allLessons=useMemo(()=>p.allLessons?.length?p.allLessons:collectAllCourseLessons(p.data?.courses,p.lessons,p.activeCourse),[p.allLessons,p.data?.courses,p.lessons,p.activeCourse]);
  const [courseFilter,setCourseFilter]=useState(()=>p.routeQuery?.get?.("course")||"all");
  const visibleLessons=useMemo(()=>courseFilter==="all"?allLessons:allLessons.filter(l=>l.courseId===courseFilter),[allLessons,courseFilter]);
  const [lessonId,setLessonId]=useState(()=>{
    const paramLessonId=p.routeParams?.lessonId;
    if(paramLessonId&&allLessons.some(l=>l.id===paramLessonId))return paramLessonId;
    const initialList=courseFilter==="all"?allLessons:allLessons.filter(l=>l.courseId===courseFilter);
    return initialList.find(l=>l.id===p.activeLesson?.id)?.id||initialList[0]?.id||"";
  });
  const [mode,setMode]=useState("mixed");
  const [answer,setAnswer]=useState("");
  const [result,setResult]=useState(null);
  const [customPrompt]=useState("");
  const [studioSet,setStudioSet]=useState(null);
  const [studioStatus,setStudioStatus]=useState(()=>{
    const firstLesson=allLessons.find(l=>l.id===lessonId);
    const firstMode=PRACTICE_MODES.find(m=>m.id==="mixed");
    return firstLesson?{kind:"idle",message:`Select Generate ${firstMode.label} to create fresh drills for ${firstLesson.title}.`}:{kind:"idle",message:""};
  });
  const [cachedModes,setCachedModes]=useState([]);
  const [generatingKey,setGeneratingKey]=useState(null);
  const generatingKeyRef=useRef(null);

  useEffect(()=>{
    const paramLessonId=p.routeParams?.lessonId;
    if(paramLessonId&&allLessons.some(l=>l.id===paramLessonId)){
      const target=allLessons.find(l=>l.id===paramLessonId);
      if(courseFilter!=="all"&&target?.courseId&&target.courseId!==courseFilter){
        setCourseFilter(target.courseId);
      }
      if(paramLessonId!==lessonId){
        setLessonId(paramLessonId);
        setResult(null);
      }
      return;
    }
    if((!lessonId||!visibleLessons.some(l=>l.id===lessonId))&&visibleLessons[0]?.id){
      setLessonId(visibleLessons[0].id);
    }
  },[lessonId,allLessons,visibleLessons,courseFilter,p.routeParams?.lessonId]);

  const userId=p.user?.id||"anon";
  const lesson=allLessons.find(l=>l.id===lessonId),checkpoint=lesson?.checkpoint;
  const activeModeMeta=PRACTICE_MODES.find(m=>m.id===mode)||PRACTICE_MODES[4];
  const activeKey=lesson&&mode!=="checkpoint"?buildPracticeSetKey(userId,lesson.id,mode):"";

  const refreshCachedModes=useCallback(async()=>{
    if(!lesson?.id){setCachedModes([]);return;}
    const list=await listLessonPracticeModes(userId,lesson.id);
    setCachedModes(list);
  },[userId,lesson?.id]);

  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      await refreshCachedModes();
      if(!lesson||mode==="checkpoint"){
        if(!cancelled){setStudioSet(null);setStudioStatus({kind:"idle",message:""});}
        return;
      }
      const key=buildPracticeSetKey(userId,lesson.id,mode);
      const cached=await loadPracticeSet(key);
      if(cancelled)return;
      if(generatingKeyRef.current===key){
        setStudioStatus({kind:"loading",message:`Generating ${activeModeMeta.label} exercises for ${lesson.title}…`});
        return;
      }
      if(cached?.exercises?.length){
        setStudioSet(cached);
        setStudioStatus({kind:"cached",message:`Loaded from cache — ${cached.exercises.length} exercises ready`});
      }else{
        setStudioSet(null);
        setStudioStatus({kind:"idle",message:`Select Generate ${activeModeMeta.label} to create fresh drills for ${lesson.title}.`});
      }
    })();
    return()=>{cancelled=true;};
  },[userId,lesson?.id,mode,activeModeMeta.label,refreshCachedModes]);

  async function generateExercises(isRegenerate=false){
    if(!lesson||mode==="checkpoint")return;
    if(!p.remote){
      setStudioStatus({kind:"error",message:"Sign in to generate AI practice exercises for this lesson."});
      return;
    }
    const targetKey=buildPracticeSetKey(userId,lesson.id,mode);
    if(generatingKeyRef.current)return;
    generatingKeyRef.current=targetKey;
    setGeneratingKey(targetKey);
    setStudioStatus({kind:"loading",message:`Generating ${activeModeMeta.label} exercises for ${lesson.title}…`});

    const excludeQuestions=isRegenerate&&Array.isArray(studioSet?.exercises)
      ?studioSet.exercises.map(ex=>ex.prompt).filter(Boolean)
      :[];

    try{
      const response=await p.request("practice/generate",{
        method:"POST",
        body:JSON.stringify({lessonId:lesson.id,mode,excludeQuestions}),
      });
      const exercises=Array.isArray(response?.exercises)?response.exercises:[];
      if(!exercises.length){
        throw new Error("The AI did not return any valid practice exercises. Retry generation.");
      }
      const payload={
        userId,
        lessonId:lesson.id,
        mode,
        lessonTitle:lesson.title,
        exercises,
        source:response.source||null,
        model:response.model||null,
        failoverCount:Number(response.failoverCount||0),
        progress:{activeIndex:0,resultsById:{},statesById:{},savedAttemptIds:{}},
      };
      await savePracticeSet(targetKey,payload);
      await refreshCachedModes();
      const latest=await loadPracticeSet(targetKey);
      if(buildPracticeSetKey(userId,lesson.id,mode)===targetKey){
        setStudioSet(latest||payload);
        setStudioStatus({kind:"loaded",message:`Content loaded — ${exercises.length} exercises ready`});
      }
    }catch(error){
      const msg=error?.message||"Could not generate practice exercises. Retry when ready.";
      setStudioStatus({kind:"error",message:msg});
      p.flashToast(msg);
    }finally{
      generatingKeyRef.current=null;
      setGeneratingKey(null);
    }
  }

  async function handlePersistProgress(nextProgress){
    if(!lesson||mode==="checkpoint"||!studioSet)return;
    const key=buildPracticeSetKey(userId,lesson.id,mode);
    const updated={...studioSet,userId,lessonId:lesson.id,mode,lessonTitle:lesson.title,progress:nextProgress};
    setStudioSet(updated);
    await savePracticeSet(key,updated);
    await refreshCachedModes();
  }

  async function handleRecordAttempt({exercise,correct,score,answer:submittedAnswer,explanation}){
    if(!lesson)return false;
    try{
      if(p.remote){
        await p.request("practice",{
          method:"POST",
          body:JSON.stringify({
            lessonId:lesson.id,
            exerciseType:exercise.type,
            concept:lesson.title,
            prompt:exercise.prompt,
            answer:submittedAnswer||exercise.type,
            correct,
            score,
            explanation,
          }),
        });
      }
      p.updateData(d=>({
        ...d,
        attempts:[
          {
            id:`a-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
            lesson_id:lesson.id,
            concept:lesson.title,
            score,
            result:{exerciseType:exercise.type,correct,explanation},
            created_at:new Date().toISOString(),
          },
          ...d.attempts,
        ],
      }));
      recordBehavior("practice_drill",{
        lessonId:lesson.id,
        concept:lesson.title,
        score,
        passed:Boolean(correct),
        exerciseType:exercise.type,
      });
      return true;
    }catch(error){
      p.flashToast(error?.message||"Could not save practice attempt.");
      return false;
    }
  }

  async function submit(index){
    const value=checkpoint?.options?.[index]||answer;
    if(!value.trim())return p.flashToast("Write an answer before saving the attempt.");
    try{
      if(p.remote)await p.request("practice",{method:"POST",body:JSON.stringify({lessonId,concept:lesson?.title,prompt:checkpoint?.question||customPrompt||lesson?.objective,answer:value,selectedIndex:index})});
      const correct=checkpoint?Number(index)===Number(checkpoint.answerIndex):null;
      if(p.remote&&correct){const task=p.data.tasks.find(t=>t.lesson_id===lessonId&&t.status!=="completed");if(task)await p.request(`tasks/${task.id}/complete`,{method:"POST",body:JSON.stringify({actualMinutes:task.estimated_minutes})});}
      setResult({correct,text:correct===null?"Your response is saved as evidence. Ask the tutor to review your reasoning.":correct?checkpoint.explanation||"That answer shows the key idea.":"Review the lesson and try again. Your attempt is kept."});
      p.updateData(d=>({...d,attempts:[{id:`a-${Date.now()}`,lesson_id:lessonId,concept:lesson?.title,score:correct===null?null:correct?100:0,created_at:new Date().toISOString()},...d.attempts],tasks:d.tasks.map(t=>t.lesson_id===lessonId&&correct?{...t,status:"completed",completed_at:new Date().toISOString()}:t)}));
      recordBehavior("checkpoint_attempt",{
        lessonId,
        concept:lesson?.title,
        score:correct===null?null:correct?100:0,
        passed:Boolean(correct),
      });
      if(p.remote)await p.refreshRemote();
    }catch(error){p.flashToast(error.message);}
  }

  const cachedModeSet=new Set(cachedModes.map(m=>m.mode));
  const isGeneratingCurrent=Boolean(generatingKey&&activeKey&&generatingKey===activeKey);
  const scopedAttempts=useMemo(()=>{
    const attempts=p.data?.attempts||[];
    if(courseFilter==="all")return attempts;
    const courseLessonIds=new Set(visibleLessons.map(l=>l.id));
    return attempts.filter(a=>a.course_id===courseFilter||(a.lesson_id&&courseLessonIds.has(a.lesson_id)));
  },[p.data?.attempts,courseFilter,visibleLessons]);

  const lessonGroups=useMemo(()=>{
    const groups=[];
    const byKey=new Map();
    visibleLessons.forEach(item=>{
      const groupTitle=courseFilter==="all"&&allCourses.length>1&&item.courseTitle
        ?`${item.courseTitle}${item.moduleTitle?` · ${item.moduleTitle}`:""}`
        :item.moduleTitle||"";
      if(!byKey.has(groupTitle)){
        const bucket=[];
        byKey.set(groupTitle,bucket);
        groups.push([groupTitle,bucket]);
      }
      byKey.get(groupTitle).push(item);
    });
    return groups;
  },[visibleLessons,courseFilter,allCourses.length]);

  const handleCourseFilterChange=(nextCourse)=>{
    setCourseFilter(nextCourse);
    setResult(null);
    const nextVisible=nextCourse==="all"?allLessons:allLessons.filter(l=>l.courseId===nextCourse);
    if(!nextVisible.some(l=>l.id===lessonId)){
      setLessonId(nextVisible[0]?.id||"");
    }
  };

  return <div className="practice-layout grid gap-4 items-start"><section className="panel practice-work flex flex-col p-4 gap-4"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="practice"/>Practice Studio</div><span className="status-pill">UNDERSTANDING EVIDENCE</span></div><div className="practice-body flex flex-col gap-3"><div className={`practice-selectors grid gap-3 ${allCourses.length>0?"sm:grid-cols-2":"grid-cols-1"}`}>{allCourses.length>0&&<label>Course<select value={courseFilter} aria-label="Filter practice topics by course" onChange={e=>handleCourseFilterChange(e.target.value)}><option value="all">All courses ({allLessons.length} topics)</option>{allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}</select></label>}<label>Choose a lesson<select value={lessonId} aria-label="Choose a lesson" onChange={e=>{setLessonId(e.target.value);setResult(null);}}>{lessonGroups.every(([label])=>!label)?visibleLessons.map(l=><option key={l.id} value={l.id}>{l.title}</option>):lessonGroups.map(([label,items])=>label?<optgroup key={label} label={label}>{items.map(l=><option key={l.id} value={l.id}>{l.title}</option>)}</optgroup>:items.map(l=><option key={l.id} value={l.id}>{l.title}</option>))}</select></label></div>{lesson?<>
    <div className="practice-mode-tabs flex flex-wrap gap-2" role="tablist" aria-label="Practice exercise modes">
      {PRACTICE_MODES.map(item=>{
        const isActive=mode===item.id;
        const hasCache=item.id!=="checkpoint"&&cachedModeSet.has(item.id);
        return <button key={item.id} type="button" role="tab" aria-selected={isActive} title={hasCache?`${item.label} (cached locally)`:item.label} className={`practice-mode-tab ${isActive?"selected":""}`.trim()} onClick={()=>{setMode(item.id);setResult(null);}}><span>{item.label}</span>{hasCache&&<span className="cached-dot" aria-label="Cached"/>}</button>;
      })}
    </div>

    {mode==="checkpoint"?<>
      <span className="eyebrow">{lesson.moduleTitle}</span>
      <h2>{checkpoint?.question||lesson.objective}</h2>
      {checkpoint?.options?.length?<div className="answer-options flex flex-col gap-2">{checkpoint.options.map((choice,i)=><button key={i} className="answer-option flex items-center gap-3 p-3 text-left cursor-pointer" onClick={()=>submit(i)}><span>{String.fromCharCode(65+i)}</span>{choice}</button>)}</div>:<><label>Your answer<textarea value={answer} onChange={e=>setAnswer(e.target.value)} placeholder="Explain your reasoning…"/></label><button className="primary-btn" onClick={()=>submit(-1)}>Save practice evidence</button></>}
      {result&&<div className={`feedback-box ${result.correct===true?"correct":result.correct===false?"incorrect":""}`} role="status"><strong>{result.correct===true?"Correct":result.correct===false?"Not yet":"Attempt saved"}</strong><p>{result.text}</p></div>}
      <p className="muted-copy">An attempt is kept even when you revisit the lesson. Task completion is tracked separately.</p>
    </>:<>
      <div className="practice-studio-bar flex flex-wrap items-center justify-between gap-3">
        <div className="practice-studio-meta">
          <span className="eyebrow">{lesson.courseTitle?`${lesson.courseTitle} · ${lesson.moduleTitle||"Lesson"}`:(lesson.moduleTitle||"PRACTICE STUDIO")}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {studioSet?.exercises?.length>0&&<span className="status-pill">Cached locally</span>}
          <button type="button" className="primary-btn" disabled={Boolean(generatingKey)} onClick={()=>generateExercises(Boolean(studioSet?.exercises?.length))}>
            {isGeneratingCurrent?<><span className="btn-spinner"/> Generating…</>:studioSet?.exercises?.length?`Regenerate ${activeModeMeta.label}`:`Generate ${activeModeMeta.label}`}
          </button>
        </div>
      </div>

      {studioStatus.message&&(
        <div className={`practice-status-banner is-${studioStatus.kind}`} role="status" aria-live="polite">
          <span>{studioStatus.message}</span>
          {studioStatus.kind==="error"&&(!p.remote
            ?<button type="button" className="quiet-btn compact" onClick={()=>p.openAccount()}>Sign in</button>
            :<button type="button" className="quiet-btn compact" disabled={Boolean(generatingKey)} onClick={()=>generateExercises(Boolean(studioSet?.exercises?.length))}>Retry</button>)}
        </div>
      )}

      {!isGeneratingCurrent&&studioSet?.exercises?.length>0&&(
        <PracticeStudioRunner
          exercises={studioSet.exercises}
          mode={mode}
          lesson={lesson}
          initialProgress={studioSet.progress}
          onPersistProgress={handlePersistProgress}
          onRecordAttempt={handleRecordAttempt}
        />
      )}
    </>}
  </>:<EmptyState title="Choose a lesson first" body="Open a course to see its practice checkpoints." action="Browse courses" onAction={()=>p.go("courses")}/>}</div></section><aside className="practice-aside flex flex-col gap-4"><Panel title="Recent evidence" icon="progress"><EvidenceList attempts={scopedAttempts.slice(0,6)}/></Panel><Panel title="More practice" icon="tutor"><div className="side-panel-copy flex flex-col gap-2 p-4"><p>Ask the tutor for a hint, a new quiz question, or feedback on your approach.</p><button className="text-button" onClick={()=>p.go("tutor")}>Open AI Tutor ↗</button></div></Panel></aside></div>;
}

export function EvidenceList({
  attempts = [],
  pageSize = 0,
  showControls = false,
  emptyMessage = "Your checkpoint and practice evidence will appear here."
}){
  const [page,setPage]=useState(1);
  const [statusFilter,setStatusFilter]=useState("all");
  const [searchQuery,setSearchQuery]=useState("");

  if(!attempts.length){
    return <p className="muted-copy padded">{emptyMessage}</p>;
  }

  // If no pagination/controls requested (e.g. PracticePage aside panel), render plain list
  if(!pageSize&&!showControls){
    return (
      <div className="evidence-list">
        {attempts.map((a,i)=>(
          <div className="evidence-item" key={a.id||i}>
            <span className={`evidence-dot ${Number(a.score)>=70?"good":""}`}/>
            <div>
              <strong>{a.concept||"Practice attempt"}</strong>
              <small>
                {a.score==null?"Response saved":Number(a.score)>=70?"Checkpoint passed":"Attempt saved"} · {prettyDate(a.created_at,{month:"short",day:"numeric"})}
              </small>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const passedCount=attempts.filter(a=>a.score!=null&&Number(a.score)>=70).length;
  const reviewCount=attempts.filter(a=>a.score!=null&&Number(a.score)<70).length;

  const filtered=attempts.filter(a=>{
    if(statusFilter==="passed"){
      if(a.score==null||Number(a.score)<70)return false;
    }else if(statusFilter==="review"){
      if(a.score==null||Number(a.score)>=70)return false;
    }
    if(searchQuery.trim()){
      const q=searchQuery.toLowerCase();
      const matchConcept=(a.concept||"").toLowerCase().includes(q);
      const matchType=(a.result?.exerciseType||"").toLowerCase().includes(q);
      if(!matchConcept&&!matchType)return false;
    }
    return true;
  });

  const actualPageSize=pageSize>0?pageSize:5;
  const totalPages=Math.max(1,Math.ceil(filtered.length/actualPageSize));
  const currentPage=Math.min(page,totalPages);
  const startIdx=(currentPage-1)*actualPageSize;
  const endIdx=Math.min(startIdx+actualPageSize,filtered.length);
  const visible=filtered.slice(startIdx,endIdx);

  const resetFilters=()=>{
    setStatusFilter("all");
    setSearchQuery("");
    setPage(1);
  };

  return (
    <div className="evidence-paginated-container flex flex-col gap-2.5">
      <div className="evidence-toolbar flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
        <div className="evidence-filter-pills flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Filter activity status">
          <button
            type="button"
            className={`evidence-filter-pill ${statusFilter==="all"?"active":""}`}
            onClick={()=>{setStatusFilter("all");setPage(1);}}
          >
            All ({attempts.length})
          </button>
          <button
            type="button"
            className={`evidence-filter-pill ${statusFilter==="passed"?"active":""}`}
            onClick={()=>{setStatusFilter("passed");setPage(1);}}
          >
            Passed ({passedCount})
          </button>
          <button
            type="button"
            className={`evidence-filter-pill ${statusFilter==="review"?"active":""}`}
            onClick={()=>{setStatusFilter("review");setPage(1);}}
          >
            Needs review ({reviewCount})
          </button>
        </div>
        <div className="evidence-search-wrap">
          <input
            type="search"
            value={searchQuery}
            onChange={e=>{setSearchQuery(e.target.value);setPage(1);}}
            placeholder="Filter concept…"
            aria-label="Filter practice activity by concept"
            className="evidence-search-input text-xs"
          />
        </div>
      </div>

      {visible.length>0?(
        <div className="evidence-list paginated">
          {visible.map((a,i)=>{
            const isGood=a.score!=null&&Number(a.score)>=70;
            const isReview=a.score!=null&&Number(a.score)<70;
            const exType=a.result?.exerciseType;
            const typeLabel=exType?exType.replace(/_/g," "):null;
            return (
              <div className="evidence-item flex items-center justify-between gap-3" key={a.id||`${startIdx+i}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className={`evidence-dot ${isGood?"good":""}`} aria-hidden="true"/>
                  <div className="min-w-0">
                    <strong className="block truncate">{a.concept||"Practice attempt"}</strong>
                    <small className="flex items-center gap-1.5 text-learnos-muted-2 flex-wrap">
                      <span>{a.score==null?"Response saved":isGood?"Checkpoint passed":"Needs review"}</span>
                      {typeLabel&&<span className="evidence-type-chip">{typeLabel}</span>}
                      <span>· {prettyDate(a.created_at,{month:"short",day:"numeric"})}</span>
                    </small>
                  </div>
                </div>
                {a.score!=null&&(
                  <span className={`evidence-score-pill ${isGood?"good":isReview?"review":""}`}>
                    {a.score}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ):(
        <div className="evidence-empty-filter p-4 text-center text-sm muted-copy flex flex-col items-center gap-2">
          <span>No activity matched the selected filter.</span>
          <button type="button" className="text-button text-xs" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      )}

      {filtered.length>actualPageSize&&(
        <div className="evidence-pagination flex items-center justify-between px-2 pt-2 border-t border-learnos-line/40 text-xs text-learnos-muted">
          <span>
            Showing {startIdx+1}–{endIdx} of {filtered.length} attempts
          </span>
          <div className="evidence-page-buttons flex items-center gap-2">
            <button
              type="button"
              className="evidence-page-btn"
              disabled={currentPage<=1}
              onClick={()=>setPage(p=>Math.max(1,p-1))}
              aria-label="Previous page of practice activity"
            >
              Previous
            </button>
            <span className="page-indicator">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              className="evidence-page-btn"
              disabled={currentPage>=totalPages}
              onClick={()=>setPage(p=>Math.min(totalPages,p+1))}
              aria-label="Next page of practice activity"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { PracticePage };
