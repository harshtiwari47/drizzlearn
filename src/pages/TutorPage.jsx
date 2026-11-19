import React, { useState, useMemo, useRef, useEffect } from "react";
import { Icon, Panel, EmptyState, parseMarkdownToHtml, prettyDate, collectAllCourseLessons } from "../components/common.jsx";
import { TutorMarkdown } from "../tutor-markdown.jsx";
import { buildTutorThreadId, clearTutorThread, listTutorThreads, loadTutorThread, saveTutorThread } from "../tutor-db.js";

function formatSourceRelevance(value){
  const num=Number(value);
  if(!Number.isFinite(num)||num<=0)return "";
  const pct=num<=1?Math.round(num*100):Math.round(num);
  return `${Math.min(100,pct)}% match`;
}

function getTutorSourceMeta(source){
  const rawType=String(source?.type||"note").toLowerCase();
  if(rawType==="lesson")return {typeLabel:"lesson",icon:"book",destLabel:"Lesson"};
  if(rawType==="flashcard")return {typeLabel:"flashcard",icon:"cards",destLabel:"Flashcards"};
  if(rawType==="practice"||rawType==="attempt")return {typeLabel:"practice",icon:"practice",destLabel:"Progress"};
  if(rawType==="note")return {typeLabel:"note",icon:"notes",destLabel:"Notes"};
  return {typeLabel:rawType||"source",icon:"spark",destLabel:"Workspace"};
}

function createDefaultTutorInteraction(structured){
  if(!structured||typeof structured!=="object")return null;
  if(structured.kind==="quiz")return {selectedAnswers:{},revealedQuestions:{},revealedHints:{}};
  if(structured.kind==="hint")return {revealedHints:1,showSolution:false};
  if(structured.kind==="review")return {showModelAnswer:false};
  return null;
}

function QuizMessageCard({structured,interaction,onUpdateInteraction}){
  const questions=Array.isArray(structured?.questions)?structured.questions:[];
  const state=interaction&&typeof interaction==="object"?interaction:{};
  const selectedAnswers=state.selectedAnswers&&typeof state.selectedAnswers==="object"?state.selectedAnswers:{};
  const revealedQuestions=state.revealedQuestions&&typeof state.revealedQuestions==="object"?state.revealedQuestions:{};
  const revealedHints=state.revealedHints&&typeof state.revealedHints==="object"?state.revealedHints:{};

  const revealedCount=questions.filter((q,idx)=>Boolean(revealedQuestions[q.id||idx])).length;
  const correctCount=questions.filter((q,idx)=>{
    const qKey=q.id||idx;
    return Boolean(revealedQuestions[qKey])&&Number(selectedAnswers[qKey])===Number(q.answerIndex);
  }).length;
  const allRevealed=questions.length>0&&revealedCount===questions.length;

  const selectOption=(qKey,optIdx)=>{
    onUpdateInteraction(prev=>({
      ...prev,
      selectedAnswers:{...(prev?.selectedAnswers||{}),[qKey]:optIdx},
    }));
  };

  const toggleHint=(qKey)=>{
    onUpdateInteraction(prev=>({
      ...prev,
      revealedHints:{...(prev?.revealedHints||{}),[qKey]:!prev?.revealedHints?.[qKey]},
    }));
  };

  const toggleReveal=(qKey)=>{
    onUpdateInteraction(prev=>({
      ...prev,
      revealedQuestions:{...(prev?.revealedQuestions||{}),[qKey]:!prev?.revealedQuestions?.[qKey]},
    }));
  };

  const toggleRevealAll=()=>{
    onUpdateInteraction(prev=>{
      const next={};
      if(!allRevealed){
        questions.forEach((q,idx)=>{next[q.id||idx]=true;});
      }
      return {...prev,revealedQuestions:next};
    });
  };

  return (
    <div className="tutor-quiz-card">
      <div className="tutor-quiz-head">
        <div className="tutor-quiz-title-wrap">
          <strong className="tutor-quiz-title">{structured.quizTitle||"Quick Check"}</strong>
          {structured.intro&&<TutorMarkdown content={structured.intro} className="tutor-quiz-intro"/>}
        </div>
        <span className="tutor-quiz-score" aria-live="polite">
          {revealedCount>0?`${correctCount}/${revealedCount} correct`:`${questions.length} ${questions.length===1?"question":"questions"}`}
        </span>
      </div>
      <div className="tutor-quiz-list">
        {questions.map((q,qIdx)=>{
          const qKey=q.id||qIdx;
          const selected=selectedAnswers[qKey];
          const hasSelection=selected!==undefined&&selected!==null;
          const isRevealed=Boolean(revealedQuestions[qKey]);
          const isHintOpen=Boolean(revealedHints[qKey]);
          const options=Array.isArray(q.options)?q.options:[];
          return (
            <div key={qKey} className="tutor-quiz-item">
              <div className="tutor-quiz-qhead">
                <span className="tutor-quiz-qnum">Q{qIdx+1}</span>
                <div className="tutor-quiz-question"><TutorMarkdown content={q.question}/></div>
              </div>
              <div className="tutor-quiz-options" role="group" aria-label={`Options for question ${qIdx+1}`}>
                {options.map((opt,optIdx)=>{
                  const isSelected=Number(selected)===optIdx;
                  const isCorrect=isRevealed&&optIdx===Number(q.answerIndex);
                  const isWrong=isRevealed&&isSelected&&optIdx!==Number(q.answerIndex);
                  const classes=[
                    "tutor-quiz-option",
                    isSelected?"selected":"",
                    isCorrect?"is-correct":"",
                    isWrong?"is-wrong":"",
                  ].filter(Boolean).join(" ");
                  return (
                    <button
                      key={optIdx}
                      type="button"
                      className={classes}
                      aria-pressed={isSelected}
                      onClick={()=>{if(!isRevealed)selectOption(qKey,optIdx);}}
                      disabled={isRevealed}
                    >
                      <span className="tutor-quiz-option-letter">{String.fromCharCode(65+optIdx)}</span>
                      <span className="tutor-quiz-option-text">{opt}</span>
                    </button>
                  );
                })}
              </div>
              <div className="tutor-quiz-item-actions">
                {q.hint&&(
                  <button
                    type="button"
                    className="quiet-btn compact"
                    aria-expanded={isHintOpen}
                    onClick={()=>toggleHint(qKey)}
                  >
                    {isHintOpen?"Hide hint":"Hint"}
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-btn compact"
                  aria-expanded={isRevealed}
                  onClick={()=>toggleReveal(qKey)}
                >
                  {isRevealed?"Hide answer":hasSelection?"Check answer":"Reveal answer"}
                </button>
              </div>
              {isHintOpen&&q.hint&&(
                <div className="tutor-quiz-hint">
                  <TutorMarkdown content={q.hint}/>
                </div>
              )}
              {isRevealed&&q.explanation&&(
                <div className={`tutor-quiz-explanation ${hasSelection?(Number(selected)===Number(q.answerIndex)?"correct":"incorrect"):""}`}>
                  <TutorMarkdown content={q.explanation}/>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {questions.length>0&&(
        <div className="tutor-quiz-footer">
          <button type="button" className="tutor-reveal-all-btn" onClick={toggleRevealAll}>
            {allRevealed?"Hide all answers":"Reveal all answers"}
          </button>
        </div>
      )}
    </div>
  );
}

function HintMessageCard({structured,interaction,onUpdateInteraction}){
  const hints=Array.isArray(structured?.hints)?structured.hints:[];
  const state=interaction&&typeof interaction==="object"?interaction:{};
  const totalHints=hints.length;
  const revealedHints=Math.max(1,Math.min(totalHints||1,Number(state.revealedHints||1)));
  const showSolution=Boolean(state.showSolution);

  return (
    <div className="tutor-hint-card">
      {structured.intro&&<TutorMarkdown content={structured.intro} className="tutor-hint-intro"/>}
      <div className="tutor-hint-steps">
        {hints.map((hint,idx)=>{
          const unlocked=idx<revealedHints;
          return (
            <div key={hint.level||idx} className={`tutor-hint-step ${unlocked?"revealed":"locked"}`}>
              <div className="tutor-hint-step-label">{unlocked?(hint.label||`Hint ${idx+1}`):"Locked hint"}</div>
              {unlocked?<TutorMarkdown content={hint.content}/>:<p className="muted-copy">Use “Show next hint” below if you want another nudge.</p>}
            </div>
          );
        })}
      </div>
      <div className="tutor-hint-actions">
        {revealedHints<totalHints&&(
          <button
            type="button"
            className="secondary-btn compact"
            onClick={()=>onUpdateInteraction(prev=>({...prev,revealedHints:Math.min(totalHints,Number(prev?.revealedHints||1)+1)}))}
          >
            {`Show next hint (${revealedHints+1}/${totalHints})`}
          </button>
        )}
        {structured.fullSolution&&(
          <button
            type="button"
            className="quiet-btn compact"
            aria-expanded={showSolution}
            onClick={()=>onUpdateInteraction(prev=>({...prev,showSolution:!prev?.showSolution}))}
          >
            {showSolution?"Hide full solution":"Reveal full solution"}
          </button>
        )}
      </div>
      {showSolution&&structured.fullSolution&&(
        <div className="tutor-hint-solution">
          <span className="tutor-hint-solution-label">Full solution</span>
          <TutorMarkdown content={structured.fullSolution}/>
        </div>
      )}
    </div>
  );
}

function ReviewMessageCard({structured,interaction,onUpdateInteraction}){
  const verdict=structured?.verdict||"partial";
  const verdictLabels={
    strong:"Strong",
    mostly_correct:"Mostly correct",
    partial:"Partial",
    needs_work:"Needs work",
  };
  const strengths=Array.isArray(structured?.strengths)?structured.strengths:[];
  const improvements=Array.isArray(structured?.improvements)?structured.improvements:[];
  const showModelAnswer=Boolean(interaction?.showModelAnswer);

  return (
    <div className="tutor-review-card">
      <div className="tutor-review-head">
        <span className={`tutor-verdict-badge verdict-${verdict}`}>
          {verdictLabels[verdict]||"Partial"}
        </span>
      </div>
      {structured.summary&&<TutorMarkdown content={structured.summary} className="tutor-review-summary"/>}
      {(strengths.length>0||improvements.length>0)&&(
        <div className="tutor-review-sections">
          {strengths.length>0&&(
            <div className="tutor-review-col strengths">
              <h4>Strengths</h4>
              <ul>
                {strengths.map((item,idx)=>(
                  <li key={idx}><TutorMarkdown content={item}/></li>
                ))}
              </ul>
            </div>
          )}
          {improvements.length>0&&(
            <div className="tutor-review-col improvements">
              <h4>Areas to improve</h4>
              <ul>
                {improvements.map((item,idx)=>(
                  <li key={idx}><TutorMarkdown content={item}/></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {structured.nextStep&&(
        <div className="tutor-review-next">
          <strong>Next step</strong>
          <TutorMarkdown content={structured.nextStep}/>
        </div>
      )}
      {structured.modelAnswer&&(
        <div className="tutor-review-solution-wrap">
          <button
            type="button"
            className="quiet-btn compact tutor-review-solution-toggle"
            aria-expanded={showModelAnswer}
            onClick={()=>onUpdateInteraction(prev=>({...prev,showModelAnswer:!prev?.showModelAnswer}))}
          >
            {showModelAnswer?"Hide suggested solution":"View suggested solution"}
          </button>
          {showModelAnswer&&(
            <div className="tutor-review-solution">
              <TutorMarkdown content={structured.modelAnswer}/>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function TutorPage(p){
  const allCourses=useMemo(()=>(p.data?.courses||[]).filter(c=>c.modules?.some(m=>m.lessons?.length)||c.id),[p.data?.courses]);
  const allLessons=useMemo(()=>p.allLessons?.length?p.allLessons:collectAllCourseLessons(allCourses,p.lessons,p.activeCourse),[p.allLessons,allCourses,p.lessons,p.activeCourse]);
  const [selectedCourseId,setSelectedCourseId]=useState(()=>p.routeQuery?.get?.("course")||"all");
  const [selectedLessonId,setSelectedLessonId]=useState(()=>{
    const qCourse=p.routeQuery?.get?.("course");
    if(qCourse){
      return allLessons.find(l=>l.courseId===qCourse)?.id||"";
    }
    return p.activeLesson?.id||allLessons[0]?.id||"";
  });
  const [mode,setMode]=useState("Explain"),[prompt,setPrompt]=useState(""),[attempt,setAttempt]=useState(""),[messages,setMessages]=useState([]),[sending,setSending]=useState(false),[expandedSources,setExpandedSources]=useState({}),[savedThreads,setSavedThreads]=useState([]);
  const loadedThreadRef=useRef(null);

  const visibleLessons=useMemo(()=>selectedCourseId==="all"?allLessons:allLessons.filter(l=>l.courseId===selectedCourseId),[allLessons,selectedCourseId]);
  const currentLesson=useMemo(()=>{
    if(!selectedLessonId)return null;
    return allLessons.find(l=>l.id===selectedLessonId)||(p.activeLesson?.id===selectedLessonId?p.activeLesson:null);
  },[allLessons,selectedLessonId,p.activeLesson]);
  const currentCourse=useMemo(()=>{
    if(currentLesson?.courseId)return allCourses.find(c=>c.id===currentLesson.courseId)||null;
    if(selectedCourseId!=="all")return allCourses.find(c=>c.id===selectedCourseId)||null;
    return p.activeCourse||null;
  },[allCourses,currentLesson?.courseId,selectedCourseId,p.activeCourse]);

  const threadId=buildTutorThreadId(p.user?.id,currentLesson?.id);
  const initials=(p.user?.fullName||"You").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase();

  useEffect(()=>{
    let cancelled=false;
    if(!p.remote){
      loadedThreadRef.current=null;
      setMessages([]);
      setSavedThreads([]);
      setExpandedSources({});
      return ()=>{cancelled=true;};
    }
    (async()=>{
      const [loaded,threads]=await Promise.all([
        loadTutorThread(threadId),
        listTutorThreads(p.user?.id),
      ]);
      if(cancelled)return;
      loadedThreadRef.current=threadId;
      setMessages(Array.isArray(loaded)?loaded:[]);
      setSavedThreads(Array.isArray(threads)?threads:[]);
      setExpandedSources({});
    })();
    return ()=>{cancelled=true;};
  },[p.remote,p.user?.id,threadId]);

  useEffect(()=>{
    if(!p.remote||loadedThreadRef.current!==threadId)return;
    let cancelled=false;
    (async()=>{
      await saveTutorThread(threadId,messages,{lessonTitle:currentLesson?.title||currentCourse?.title||"Workspace"});
      const threads=await listTutorThreads(p.user?.id);
      if(!cancelled)setSavedThreads(Array.isArray(threads)?threads:[]);
    })();
    return ()=>{cancelled=true;};
  },[messages,p.remote,p.user?.id,currentLesson?.title,currentCourse?.title,threadId]);

  async function handleClearChat(){
    await clearTutorThread(threadId);
    setMessages([]);
    setExpandedSources({});
    const threads=await listTutorThreads(p.user?.id);
    setSavedThreads(Array.isArray(threads)?threads:[]);
  }

  function updateMessageInteraction(msgIndex,updater){
    setMessages(prev=>prev.map((msg,idx)=>idx===msgIndex?{...msg,interaction:updater(msg.interaction||{})}:msg));
  }

  async function submitQuestion({question,requestMode,requestAttempt,retryIndex=null}){
    if(!String(question||"").trim()||sending)return;
    if(retryIndex!==null){
      setMessages(m=>m.filter((_,idx)=>idx!==retryIndex));
    }else{
      setMessages(m=>[...m,{id:`u-${Date.now()}`,role:"user",text:question,mode:requestMode,createdAt:Date.now()}]);
      setPrompt("");
    }
    setSending(true);
    const reply=await p.sendTutor({mode:requestMode,prompt:question,attempt:requestAttempt,lessonId:currentLesson?.id??null});
    if(reply&&!reply.error){
      const structured=reply.structured||null;
      setMessages(m=>[...m,{
        id:`a-${Date.now()}`,
        role:"assistant",
        text:typeof reply==="string"?reply:reply.text,
        mode:reply.mode||requestMode,
        structured,
        interaction:createDefaultTutorInteraction(structured),
        sources:Array.isArray(reply.sources)?reply.sources:[],
        source:reply.source||null,
        model:reply.model||null,
        failoverCount:Number(reply.failoverCount||0),
        createdAt:Date.now(),
      }]);
    }else if(reply?.error){
      setMessages(m=>[...m,{
        id:`e-${Date.now()}`,
        role:"assistant",
        isError:true,
        text:reply.error,
        retryPayload:{question,requestMode,requestAttempt},
        createdAt:Date.now(),
      }]);
    }
    setSending(false);
  }

  async function send(e){
    e?.preventDefault();
    await submitQuestion({question:prompt,requestMode:mode,requestAttempt:attempt});
  }

  function navigateToSource(source){
    const meta=getTutorSourceMeta(source);
    const rawId=String(source?.id||"").replace(/^(note|lesson|flashcard|attempt|practice):/i,"");
    if(meta.typeLabel==="note"){p.go("notes");return;}
    if(meta.typeLabel==="flashcard"){p.go("flashcards");return;}
    if(meta.typeLabel==="practice"){p.go("progress");return;}
    if(meta.typeLabel==="lesson"){
      const hasLesson=rawId&&p.data?.courses?.some(c=>c.modules?.some(m=>m.lessons?.some(l=>l.id===rawId)));
      if(hasLesson)p.openLesson(rawId);
      else p.go("lesson");
      return;
    }
    p.go("home");
  }

  function toggleSourcePreview(sourceKey){
    setExpandedSources(prev=>({...prev,[sourceKey]:!prev[sourceKey]}));
  }

  const allLessonIds=useMemo(()=>new Set(allLessons.map(l=>l.id)),[allLessons]);
  const otherSavedThreads=savedThreads.filter(t=>t.threadId!==threadId&&t.messageCount>0&&(!t.lessonId||allLessonIds.has(t.lessonId)));

  const handleTutorCourseChange=(nextCourse)=>{
    setSelectedCourseId(nextCourse);
    const nextList=nextCourse==="all"?allLessons:allLessons.filter(l=>l.courseId===nextCourse);
    if(!nextList.some(l=>l.id===selectedLessonId)){
      const firstId=nextList[0]?.id||"";
      setSelectedLessonId(firstId);
      p.setActiveLessonId?.(firstId||null);
    }
  };
  const handleTutorLessonChange=(nextLessonId)=>{
    setSelectedLessonId(nextLessonId);
    const meta=allLessons.find(l=>l.id===nextLessonId);
    if(meta?.courseId&&selectedCourseId!=="all"&&selectedCourseId!==meta.courseId){
      setSelectedCourseId(meta.courseId);
    }
    p.setActiveLessonId?.(nextLessonId||null);
  };

  return <div className="tutor-layout grid gap-4 items-start">
    <section className="panel tutor-workspace flex flex-col p-4 gap-4">
      <div className="tutor-topline flex items-center justify-between gap-3">
        <div className="tutor-heading-block min-w-0 flex-1">
          <span className="eyebrow tutor-eyebrow">{currentLesson?.courseTitle?`${currentLesson.courseTitle} · ${currentLesson.title}`:(currentLesson?.title||currentCourse?.title||"LEARNING COMPANION")}</span>
          <h2>Work through the idea together.</h2>
        </div>
        <div className="tutor-toolbar-actions flex items-center gap-2.5 flex-shrink-0">
          {p.remote&&messages.length>0&&(
            <>
              <span className="tutor-saved-status">Saved locally</span>
              <button type="button" className="tutor-clear-btn" onClick={handleClearChat}>Clear chat</button>
            </>
          )}
          <span className={`status-pill ${p.remote?"connected":"unavailable"}`}>{p.remote?"Tutor connected":"Sign in required"}</span>
        </div>
      </div>
      {p.remote&&otherSavedThreads.length>0&&(
        <div className="tutor-thread-pills flex flex-wrap items-center gap-1.5" aria-label="Saved lesson conversations">
          <span className="tutor-thread-pills-label">Saved chats:</span>
          {otherSavedThreads.slice(0,4).map(t=>(
            <button
              key={t.threadId}
              type="button"
              className="tutor-thread-pill"
              onClick={()=>handleTutorLessonChange(t.lessonId||"")}
              title={`Switch to ${t.lessonTitle} (${t.messageCount} messages)`}
            >
              <span>{t.lessonTitle}</span>
              <small>{t.messageCount}</small>
            </button>
          ))}
        </div>
      )}
      <div className="tutor-mode-row flex flex-wrap items-center gap-2" role="group" aria-label="Tutor mode">
        {["Explain","Hint","Quiz me","Review my work"].map(option=>(
          <button type="button" className={`cursor-pointer ${mode===option?"selected":""}`} key={option} onClick={()=>setMode(option)}>{option}</button>
        ))}
      </div>
      {p.remote?(
        <div className="chat-history flex flex-col gap-3 overflow-y-auto max-h-[500px]" aria-live="polite">
          {messages.map((m,i)=>{
            const activePreviews=(m.sources||[]).filter((source,sIdx)=>Boolean(expandedSources[`${i}:${sIdx}:${source.id||""}`]));
            return (
              <div key={m.id||i} className={`chat-message flex items-start gap-3 p-3 ${m.role} ${m.isError?"chat-message-error":""}`} role={m.isError?"alert":undefined}>
                <span className="chat-avatar grid place-items-center">
                  {m.role==="assistant"?<img src="/images/drizzlearn-bot.svg" alt="Tutor" className="tutor-avatar-img"/>:initials}
                </span>
                <div className="chat-message-body">
                  <div className="chat-message-header">
                    <small>{m.role==="assistant"?"Drizzlearn Tutor":m.mode||"You"}</small>
                    {m.role==="assistant"&&!m.isError&&(m.model||m.source||m.failoverCount>0)&&(
                      <div className="tutor-message-badges">
                        {(m.model||m.source)&&(
                          <span className="tutor-model-badge" title={`Model: ${m.model||m.source}${m.model&&m.source?` · ${m.source}`:""}`}>
                            {m.model||m.source}
                          </span>
                        )}
                        {Number(m.failoverCount)>0&&(
                          <span className="tutor-failover-badge" title={`Automatically switched after ${m.failoverCount} fallback ${m.failoverCount===1?"attempt":"attempts"}`}>
                            auto-switched{m.failoverCount>1?` ×${m.failoverCount}`:""}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {m.role==="user"?(
                    <p>{m.text}</p>
                  ):m.isError?(
                    <TutorMarkdown content={m.text}/>
                  ):m.structured?.kind==="quiz"?(
                    <QuizMessageCard
                      structured={m.structured}
                      interaction={m.interaction}
                      onUpdateInteraction={(updater)=>updateMessageInteraction(i,updater)}
                    />
                  ):m.structured?.kind==="hint"?(
                    <HintMessageCard
                      structured={m.structured}
                      interaction={m.interaction}
                      onUpdateInteraction={(updater)=>updateMessageInteraction(i,updater)}
                    />
                  ):m.structured?.kind==="review"?(
                    <ReviewMessageCard
                      structured={m.structured}
                      interaction={m.interaction}
                      onUpdateInteraction={(updater)=>updateMessageInteraction(i,updater)}
                    />
                  ):(
                    <TutorMarkdown content={m.text}/>
                  )}
                  {m.isError&&m.retryPayload&&(
                    <div className="tutor-error-actions">
                      <button type="button" className="secondary-btn compact tutor-retry-btn" onClick={()=>submitQuestion({...m.retryPayload,retryIndex:i})}>
                        Try again ↻
                      </button>
                    </div>
                  )}
                  {m.sources?.length>0&&(
                    <div className="tutor-sources-block">
                      <span className="tutor-sources-label">Grounded in your workspace ({m.sources.length})</span>
                      <div className="tutor-source-list flex flex-wrap gap-1.5" aria-label="Sources from your workspace">
                        {m.sources.map((source,sIdx)=>{
                          const meta=getTutorSourceMeta(source);
                          const sourceKey=`${i}:${sIdx}:${source.id||""}`;
                          const previewId=`tutor-source-preview-${i}-${sIdx}`;
                          const isExpanded=Boolean(expandedSources[sourceKey]);
                          const relText=formatSourceRelevance(source.relevance);
                          const snippet=source.excerpt?String(source.excerpt).replace(/\s+/g," ").trim().slice(0,180):"";
                          const tooltip=[
                            `${meta.typeLabel.toUpperCase()}: ${source.title||"Untitled"}`,
                            source.courseTitle?`Course: ${source.courseTitle}`:"",
                            relText?`Relevance: ${relText}`:"",
                            source.matchType?`Match: ${source.matchType}`:"",
                            snippet?`Snippet: ${snippet}`:"",
                          ].filter(Boolean).join(" · ");
                          const hasDetails=Boolean(source.excerpt||source.courseTitle||relText||source.matchType);
                          return (
                            <div key={sourceKey} className={`tutor-source-chip-group ${isExpanded?"expanded":""}`}>
                              <button
                                type="button"
                                className={`tutor-source-chip type-${meta.typeLabel}`}
                                title={tooltip}
                                onClick={()=>navigateToSource(source)}
                              >
                                <Icon name={meta.icon} size={13}/>
                                <span className="tutor-source-type">{meta.typeLabel}</span>
                                <span className="tutor-source-title">{source.title||"Untitled"}</span>
                              </button>
                              {hasDetails&&(
                                <button
                                  type="button"
                                  className="tutor-source-preview-toggle"
                                  aria-expanded={isExpanded}
                                  aria-controls={previewId}
                                  aria-label={`${isExpanded?"Hide":"Preview"} excerpt for ${source.title||meta.typeLabel}`}
                                  title={isExpanded?"Hide snippet":"Preview grounded snippet"}
                                  onClick={()=>toggleSourcePreview(sourceKey)}
                                >
                                  <Icon name="chevron" size={13}/>
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {activePreviews.length>0&&(
                        <div className="tutor-source-preview-list">
                          {m.sources.map((source,sIdx)=>{
                            const sourceKey=`${i}:${sIdx}:${source.id||""}`;
                            if(!expandedSources[sourceKey])return null;
                            const meta=getTutorSourceMeta(source);
                            const previewId=`tutor-source-preview-${i}-${sIdx}`;
                            const relText=formatSourceRelevance(source.relevance);
                            return (
                              <div key={sourceKey} id={previewId} className="tutor-source-preview">
                                <div className="tutor-source-preview-head">
                                  <div className="tutor-source-preview-meta">
                                    <span className={`tutor-source-type badge-${meta.typeLabel}`}>{meta.typeLabel}</span>
                                    <strong>{source.title||"Untitled"}</strong>
                                    {source.courseTitle&&<span className="tutor-source-course">{source.courseTitle}</span>}
                                  </div>
                                  <div className="tutor-source-preview-stats">
                                    {source.matchType&&<span className="tutor-source-match">{source.matchType}</span>}
                                    {relText&&<span className="tutor-source-relevance">{relText}</span>}
                                  </div>
                                </div>
                                {source.excerpt&&<p className="tutor-source-preview-excerpt">{source.excerpt}</p>}
                                <div className="tutor-source-preview-foot">
                                  <button type="button" className="text-button" onClick={()=>navigateToSource(source)}>
                                    Open in {meta.destLabel} ↗
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {sending&&(
            <div className="chat-message assistant flex items-start gap-3 p-3">
              <span className="chat-avatar grid place-items-center"><img src="/images/drizzlearn-bot.svg" alt="Tutor" className="tutor-avatar-img"/></span>
              <div className="chat-message-body"><small>Drizzlearn Tutor</small><p className="typing-copy">Working through your question…</p></div>
            </div>
          )}
        </div>
      ):(
        <div className="chat-history"><EmptyState title="Connect an account to use AI Tutor" body="Sign in to ask questions grounded in your courses and saved notes." action="Sign in" onAction={p.openAccount}/></div>
      )}
      {p.remote&&mode==="Review my work"&&(
        <label className="attempt-context flex flex-col gap-2">Your work to review<textarea value={attempt} onChange={e=>setAttempt(e.target.value)} placeholder="Paste your answer, reasoning or code snippet…"/></label>
      )}
      {p.remote&&(
        <form className="tutor-compose flex items-center gap-2" onSubmit={send}>
          <textarea value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder={mode==="Hint"?"Ask for a hint, not the full answer…":"Ask about your current lesson…"} aria-label="Message the tutor"/>
          <button className="primary-btn" type="submit" disabled={sending||!prompt.trim()}>{sending?<><span className="btn-spinner"/> Sending…</>:<>Send <span>↗</span></>}</button>
        </form>
      )}
    </section>
    <aside className="tutor-context flex flex-col gap-4">
      <Panel title="Current context" icon="book">
        <div className="side-panel-copy flex flex-col gap-3 p-4">
          {allCourses.length>0&&(
            <div className="tutor-context-selectors flex flex-col gap-2">
              <label className="text-xs font-semibold text-learnos-muted flex flex-col gap-1">
                <span>Course</span>
                <select value={selectedCourseId} aria-label="Choose tutor course context" onChange={e=>handleTutorCourseChange(e.target.value)}>
                  <option value="all">All courses ({allLessons.length} topics)</option>
                  {allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-learnos-muted flex flex-col gap-1">
                <span>Topic / Lesson</span>
                <select value={selectedLessonId} aria-label="Choose tutor lesson context" onChange={e=>handleTutorLessonChange(e.target.value)}>
                  <option value="">General workspace / course chat</option>
                  {visibleLessons.map(l=><option key={l.id} value={l.id}>{selectedCourseId==="all"&&allCourses.length>1&&l.courseTitle?`${l.courseTitle} — ${l.title}`:l.title}</option>)}
                </select>
              </label>
            </div>
          )}
          <strong>{currentLesson?.title||currentCourse?.title||"General workspace"}</strong>
          <p>{currentLesson?.objective||currentCourse?.summary||"Select any course or lesson above to focus the AI tutor."}</p>
          {currentLesson?<button type="button" className="text-button" onClick={()=>p.openLesson?p.openLesson(currentLesson.id):p.go("lesson")}>Return to lesson ↗</button>:currentCourse&&<button type="button" className="text-button" onClick={()=>p.go("course",{params:{courseId:currentCourse.id}})}>View course roadmap ↗</button>}
        </div>
      </Panel>
      {p.remote&&(
        <Panel title="Ways to ask" icon="spark">
          <div className="prompt-suggestions flex flex-col gap-2">
            {["Explain this with a small example","Give me one hint to get started","Quiz me on this idea","Review my reasoning"].map((text,i)=>(
              <button type="button" className="cursor-pointer" key={i} onClick={()=>{setPrompt(text);if(i===1)setMode("Hint");if(i===2)setMode("Quiz me");if(i===3)setMode("Review my work");}}>{text} <span>↗</span></button>
            ))}
          </div>
        </Panel>
      )}
    </aside>
  </div>;
}

export function AiEngineRagPanel({remote,request,openAccount,flashToast}){
  const [aiStatus,setAiStatus]=useState(null);
  const [ragStatus,setRagStatus]=useState(null);
  const [engineState,setEngineState]=useState(()=>remote?"loading":"signed_out");
  const [engineError,setEngineError]=useState("");
  const [reindexing,setReindexing]=useState(false);
  const [showAllModels,setShowAllModels]=useState(false);
  const [isNetworkExpanded,setIsNetworkExpanded]=useState(false);
  const [reloadTick,setReloadTick]=useState(0);

  useEffect(()=>{
    if(!remote){
      setEngineState("signed_out");
      setAiStatus(null);
      setRagStatus(null);
      setEngineError("");
      return;
    }
    let cancelled=false;
    const loadTelemetry=async()=>{
      setEngineState("loading");
      setEngineError("");
      try{
        const [aiRes,ragRes]=await Promise.allSettled([request("ai/status"),request("rag/status")]);
        if(cancelled)return;
        const aiOk=aiRes.status==="fulfilled";
        const ragOk=ragRes.status==="fulfilled";
        setAiStatus(aiOk?aiRes.value:null);
        setRagStatus(ragOk?ragRes.value:null);
        if(!aiOk&&!ragOk){
          setEngineState("error");
          setEngineError(aiRes.reason?.message||ragRes.reason?.message||"AI Engine and RAG status are unavailable right now.");
        }else{
          setEngineState("ready");
          if(!aiOk||!ragOk){
            const errMsg=!aiOk?aiRes.reason?.message:ragRes.reason?.message;
            setEngineError(errMsg||"Some telemetry could not be loaded.");
          }
        }
      }catch(error){
        if(!cancelled){
          setEngineState("error");
          setEngineError(error?.message||"Could not load AI Engine status.");
        }
      }
    };
    loadTelemetry();
    return ()=>{cancelled=true;};
  },[remote,request,reloadTick]);

  async function handleReindex(){
    if(!remote||reindexing)return;
    setReindexing(true);
    try{
      const result=await request("rag/reindex",{method:"POST",body:JSON.stringify({})});
      setRagStatus(prev=>({
        ...(prev||{}),
        chunksCount:Number(result.chunksCreated??prev?.chunksCount??0),
        byType:result.byType||prev?.byType||{note:0,lesson:0,flashcard:0,practice:0},
        embeddingMode:result.embeddingMode||prev?.embeddingMode||"hybrid",
        lastIndexedAt:new Date().toISOString(),
      }));
      flashToast(`Knowledge index rebuilt: ${Number(result.chunksCreated??0)} chunks across ${Number(result.indexedDocuments??0)} items.`);
      request("rag/status").then(fresh=>setRagStatus(fresh)).catch(()=>{});
    }catch(error){
      flashToast(error?.message||"Could not rebuild knowledge index.");
    }finally{
      setReindexing(false);
    }
  }

  const statusBadge=!remote
    ?<span className="profile-status-pill">Local</span>
    :engineState==="loading"
      ?<span className="profile-status-pill">Checking…</span>
      :engineState==="error"
        ?<span className="profile-status-pill error">Offline</span>
        :<span className="profile-status-pill connected">Synced</span>;

  const models=Array.isArray(aiStatus?.models)?aiStatus.models:[];
  const visibleModels=showAllModels?models:models.slice(0,4);
  const providers=Array.isArray(aiStatus?.summary?.configuredProviders)?aiStatus.summary.configuredProviders:[];
  const ragCounts={
    notes:Number(ragStatus?.byType?.note??ragStatus?.byType?.notes??0),
    lessons:Number(ragStatus?.byType?.lesson??ragStatus?.byType?.lessons??0),
    flashcards:Number(ragStatus?.byType?.flashcard??ragStatus?.byType?.flashcards??0),
    practice:Number(ragStatus?.byType?.practice??0),
  };

  return (
    <section className="profile-glass-card profile-side-card profile-rag-card ai-rag-panel">
      <div className="profile-card-head flex items-center justify-between">
        <div className="card-head-title">
          <span className="card-head-icon-box teal" aria-hidden="true"><Icon name="spark" size={16}/></span>
          <h3>Knowledge Base</h3>
        </div>
        {statusBadge}
      </div>
      {!remote?(
        <div className="profile-side-card-body flex flex-col gap-3">
          <p className="profile-rag-muted">Sign in to sync your study materials and keep tutor answers tailored to your courses.</p>
          <button type="button" className="profile-action-btn secondary" onClick={openAccount}>Sign in to sync memory ↗</button>
        </div>
      ):engineState==="loading"?(
        <div className="profile-side-card-body">
          <div className="engine-state-box" role="status" aria-busy="true">
            <p>Checking knowledge base &amp; models…</p>
          </div>
        </div>
      ):engineState==="error"?(
        <div className="profile-side-card-body flex flex-col gap-2.5">
          <div className="engine-error-box compact" role="alert">
            <span>{engineError||"Status temporarily unavailable."}</span>
            <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
          </div>
        </div>
      ):(
        <div className="profile-rag-body">
          {engineError&&(
            <div className="engine-error-box compact" role="alert">
              <span>{engineError}</span>
              <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
            </div>
          )}

          <div className="engine-section">
            {ragStatus?(
              <>
                <div className="rag-summary-bar">
                  <span><strong>{Number(ragStatus.chunksCount??0)}</strong> searchable items</span>
                  <small>{ragStatus.lastIndexedAt?`Updated ${prettyDate(ragStatus.lastIndexedAt,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`:"Ready"}</small>
                </div>
                <div className="rag-type-grid" aria-label="Study materials in tutor memory">
                  <div className="rag-type-cell"><strong>{ragCounts.notes}</strong><span>Notes</span></div>
                  <div className="rag-type-cell"><strong>{ragCounts.lessons}</strong><span>Lessons</span></div>
                  <div className="rag-type-cell"><strong>{ragCounts.flashcards}</strong><span>Flashcards</span></div>
                  <div className="rag-type-cell"><strong>{ragCounts.practice}</strong><span>Practice</span></div>
                </div>
                <div className="rag-footer-row flex flex-col items-start gap-1.5">
                  <button
                    type="button"
                    className="rag-reindex-btn"
                    disabled={reindexing}
                    aria-busy={reindexing}
                    onClick={handleReindex}
                  >
                    {reindexing?"Refreshing memory…":"Refresh memory ↻"}
                  </button>
                </div>
              </>
            ):(
              <div className="engine-error-box compact" role="alert">
                <span>Knowledge base status unavailable.</span>
                <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
              </div>
            )}
          </div>

          <div className="profile-rag-divider" />

          <div className="engine-section">
            <div className="engine-section-head">
              <button
                type="button"
                className="engine-collapse-trigger flex items-center gap-2"
                onClick={()=>setIsNetworkExpanded(open=>!open)}
                aria-expanded={isNetworkExpanded}
              >
                <strong>Model Network</strong>
                <span className="engine-collapse-pill">
                  {aiStatus?.summary?.healthyModels ?? models.length} Active
                </span>
                <span className={`engine-chevron ${isNetworkExpanded ? "open" : ""}`} aria-hidden="true">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </span>
              </button>
              <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)} aria-label="Refresh models">Check status ↻</button>
            </div>
            {isNetworkExpanded && (
              <div className="engine-collapsible-content flex flex-col gap-3 pt-1">
                {aiStatus?(
                  <>
                    <div className="engine-summary-grid">
                      <div className="engine-summary-stat">
                        <span>Active</span>
                        <strong>{aiStatus.summary?.healthyModels??0}<small>/{aiStatus.summary?.totalModels??models.length}</small></strong>
                      </div>
                      <div className="engine-summary-stat">
                        <span>Standby</span>
                        <strong>{aiStatus.summary?.coolingDownModels??0}</strong>
                      </div>
                      <div className="engine-summary-stat">
                        <span>Failovers</span>
                        <strong>{aiStatus.summary?.totalSwitches??0}</strong>
                      </div>
                    </div>
                    {providers.length>0&&(
                      <div className="engine-providers-row" aria-label="Configured providers">
                        {providers.map(provider=><span key={provider} className="engine-provider-pill">{provider}</span>)}
                      </div>
                    )}
                    {models.length>0?(
                      <>
                        <ul className="engine-model-list" aria-label="Model status list">
                          {visibleModels.map(m=>{
                            const state=m.status==="open"?"open":m.status==="half_open"?"half_open":"closed";
                            const stateText=state==="open"?"Cooling":state==="half_open"?"Checking":"Active";
                            const latencyText=Number(m.avgLatencyMs)>0?`${Math.round(Number(m.avgLatencyMs))} ms`:"—";
                            return (
                              <li key={`${m.provider}:${m.model}`} className="engine-model-row">
                                <span className={`model-health-dot ${state}`} aria-hidden="true"/>
                                <div className="engine-model-info">
                                  <strong>{m.model}</strong>
                                  <small>{m.provider}{m.tier?` · ${m.tier}`:""}</small>
                                </div>
                                <div className="engine-model-meta">
                                  <span className={`engine-model-status ${state}`}>{stateText}</span>
                                  <span className="engine-model-latency">{latencyText}</span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                        {models.length>4&&(
                          <button
                            type="button"
                            className="text-button engine-toggle-models"
                            aria-expanded={showAllModels}
                            onClick={()=>setShowAllModels(v=>!v)}
                          >
                            {showAllModels?"Show fewer models":`Show all ${models.length} models`}
                          </button>
                        )}
                      </>
                    ):(
                      <p className="profile-rag-muted">No active models reported yet.</p>
                    )}
                  </>
                ):(
                  <div className="engine-error-box compact" role="alert">
                    <span>Model status unavailable.</span>
                    <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

