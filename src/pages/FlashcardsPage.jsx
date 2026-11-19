import React, { useState, useEffect, useMemo } from "react";
import { Icon, Panel, EmptyState, prettyDate, collectAllCourseLessons } from "../components/common.jsx";
import { previewFlashcardIntervals } from "../srs.js";
import { TutorMarkdown } from "../tutor-markdown.jsx";
import { FlashcardPortalModal } from "../flashcard-portal.jsx";

function FlashcardsPage(p){
  const [index,setIndex]=useState(0),[revealed,setRevealed]=useState(false),[showHint,setShowHint]=useState(false);
  const [filterCourse,setFilterCourse]=useState(()=>p.routeQuery?.get?.("course")||"all");
  const [portalState,setPortalState]=useState({open:false,mode:"manual",editingCard:null});
  const [confirmDeleteId,setConfirmDeleteId]=useState(null),[deletingId,setDeletingId]=useState(null);
  const [ratingCard,setRatingCard]=useState(false);

  const allCourses=p.data?.courses||[];
  const allLessons=useMemo(()=>p.allLessons?.length?p.allLessons:collectAllCourseLessons(allCourses,p.lessons,p.activeCourse),[p.allLessons,allCourses,p.lessons,p.activeCourse]);
  const allLessonsMap=useMemo(()=>{
    const map=new Map();
    allLessons.forEach(l=>map.set(l.id,l));
    return map;
  },[allLessons]);

  const resolveCardCourseId=(card)=>{
    const cLessonId=card?.lesson_id||card?.lessonId;
    const meta=cLessonId?allLessonsMap.get(cLessonId):null;
    return meta?.courseId||card?.course_id||card?.courseId||"";
  };
  const matchesCourse=(card)=>{
    if(filterCourse==="all")return true;
    const cId=resolveCardCourseId(card);
    if(filterCourse==="unlinked")return !cId&&!(card?.lesson_id||card?.lessonId);
    return cId===filterCourse;
  };

  const allInScope=(p.data.flashcards||[]).filter(matchesCourse);
  const due=p.dueCards.filter(matchesCourse);
  const dueLater=allInScope.filter(c=>c.due_at&&new Date(c.due_at)>new Date());
  const savedInScope=allInScope.length;
  const card=due[index%Math.max(due.length,1)];

  useEffect(()=>{
    setShowHint(false);
    setConfirmDeleteId(null);
  },[card?.id]);

  const rating=async(value)=>{
    if(!card||ratingCard)return;
    setRatingCard(true);
    try{
      await p.rateCard(card,value);
      setRevealed(false);
      setShowHint(false);
      setIndex(0);
    }finally{
      setRatingCard(false);
    }
  };

  const handleSavePortalCard=async(payload)=>{
    if(payload.id){
      await p.updateFlashcard?.(payload.id,payload);
    }else{
      await p.addFlashcard?.(payload);
    }
  };

  const handleDeleteCard=async(cardId)=>{
    if(!cardId||deletingId)return;
    setDeletingId(cardId);
    try{
      await p.deleteFlashcard?.(cardId);
      setConfirmDeleteId(null);
      setRevealed(false);
      setShowHint(false);
      setIndex(0);
    }catch(error){
      p.flashToast?.(error?.message||"Could not delete flashcard.");
    }finally{
      setDeletingId(null);
    }
  };

  const openPortal=(mode="manual",editingCard=null)=>{
    setPortalState({open:true,mode,editingCard});
  };

  const cardLessonId=card?.lesson_id||card?.lessonId;
  const cardCourseId=card?.course_id||card?.courseId;
  const targetLesson=allLessonsMap.get(cardLessonId)||(cardCourseId?allLessons.find(l=>l.courseId===cardCourseId||l.course_id===cardCourseId):null);
  const targetCourse=allCourses.find(c=>c.id===(targetLesson?.courseId||cardCourseId));
  const targetLessonId=cardLessonId||targetLesson?.id;
  const intervalLabels=card?previewFlashcardIntervals(card):{Again:"10m",Hard:"12h",Good:"1d",Easy:"4d"};
  const isLeech=Number(card?.lapses||0)>=6;
  const initialPortalCourse=filterCourse!=="all"&&filterCourse!=="unlinked"?filterCourse:"";

  const jumpToCard=(target)=>{
    if(!target?.id)return;
    const dueIdx=due.findIndex(x=>x.id===target.id);
    if(dueIdx>=0){
      setIndex(dueIdx);
      setRevealed(false);
      setShowHint(false);
      return;
    }
    setFilterCourse("all");
    const globalDueIdx=p.dueCards.findIndex(x=>x.id===target.id);
    if(globalDueIdx>=0)setIndex(globalDueIdx);
    setRevealed(false);
    setShowHint(false);
  };

  return <div className="flashcards-workspace flex flex-col gap-6">
    <div className="flashcards-layout grid gap-4 items-start">
      <section className="flash-main flex flex-col gap-4">
        <div className="review-progress-row flex items-center justify-between gap-3 flex-wrap">
          <div>
            <span className="eyebrow">SPACED REVIEW</span>
            <h2>{due.length?`${due.length} cards due`:"You’re all caught up"}</h2>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            {allCourses.length>0&&(
              <select value={filterCourse} onChange={e=>{setFilterCourse(e.target.value);setIndex(0);setRevealed(false);setShowHint(false);}} aria-label="Filter flashcards by course" className="tool-course-select text-xs rounded-lg px-2.5 py-1.5 bg-learnos-bg/70 border border-learnos-line text-learnos-text">
                <option value="all">All courses ({p.data.flashcards.length})</option>
                {allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
                <option value="unlinked">Personal / Unlinked</option>
              </select>
            )}
            <span className="review-index">{due.length?`${Math.min(index+1,due.length)} / ${due.length}`:"✓"}</span>
          </div>
        </div>

        {due.length?<>
          <div
            className={`flashcard-face flex flex-col items-center justify-center p-8 text-center cursor-pointer ${revealed?"revealed":""}`}
            role="button"
            tabIndex={0}
            aria-label={revealed?"Show question":"Reveal answer"}
            onClick={()=>setRevealed(!revealed)}
            onKeyDown={e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setRevealed(!revealed);}}}
          >
            <div className="flashcard-face-top">
              <span className="flashcard-label">{revealed?"ANSWER":"QUESTION"}</span>
              <div className="flashcard-badges">
                {card.origin==="ai_generated"&&<span className="fc-badge-ai">AI✦</span>}
                {card.card_type&&card.card_type!=="qa"&&<span className="fc-badge-type">{card.card_type}</span>}
                {isLeech&&<span className="fc-badge-leech" title="Frequently missed — consider editing or simplifying this card">Needs rewrite</span>}
              </div>
            </div>

            <div className="flashcard-rich-body">
              <TutorMarkdown content={revealed?card.back:card.front} className="fc-card-markdown"/>
            </div>

            {!revealed&&card.hint&&(
              <div className="flashcard-hint-block" onClick={e=>e.stopPropagation()}>
                <button type="button" className="text-button text-xs" onClick={()=>setShowHint(s=>!s)}>
                  {showHint?"Hide hint":"Show hint"}
                </button>
                {showHint&&<div className="flashcard-hint-box"><TutorMarkdown content={card.hint}/></div>}
              </div>
            )}

            <span className="flashcard-hint">{revealed?"Rate how accurately you recalled the answer":"Tap card or press Enter to reveal answer"}</span>
          </div>

          <div className="flashcard-meta-bar flex items-center justify-between gap-3 flex-wrap">
            {(targetLessonId||cardCourseId||targetCourse)?(
              <button
                type="button"
                className="flashcard-source-link"
                onClick={()=>{if(targetLessonId)p.openLesson(targetLessonId);else if(targetCourse?.id)p.go("course",{params:{courseId:targetCourse.id}});else p.go("course");}}
              >
                <span className="flashcard-source-prefix">Review lesson:</span>
                <span className="flashcard-source-title">{targetCourse?.title?`${targetCourse.title} · `:""}{targetLesson?.title||card.lesson_title||targetCourse?.title||"Source lesson"}</span>
                <span className="flashcard-source-arrow" aria-hidden="true">↗</span>
              </button>
            ):<span className="fc-personal-tag">Personal card</span>}

            <div className="flashcard-card-actions flex items-center gap-2">
              <button type="button" className="quiet-btn compact flex items-center gap-1.5" onClick={()=>openPortal("manual",card)} title="Edit card"><Icon name="edit" size={13}/> Edit</button>
              {confirmDeleteId===card.id?(
                <div className="flex items-center gap-1.5">
                  <button type="button" className="danger-btn compact" disabled={deletingId===card.id} onClick={()=>handleDeleteCard(card.id)}>{deletingId===card.id?"Deleting…":"Confirm"}</button>
                  <button type="button" className="quiet-btn compact" onClick={()=>setConfirmDeleteId(null)}>Cancel</button>
                </div>
              ):(
                <button type="button" className="quiet-btn danger compact flex items-center gap-1.5" onClick={()=>setConfirmDeleteId(card.id)} title="Delete card"><Icon name="trash" size={13}/> Delete</button>
              )}
            </div>
          </div>

          {revealed?(
            <div className="rating-row grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button type="button" disabled={ratingCard} onClick={()=>rating("Again")}><strong>Again</strong><small>{intervalLabels.Again}</small></button>
              <button type="button" disabled={ratingCard} onClick={()=>rating("Hard")}><strong>Hard</strong><small>{intervalLabels.Hard}</small></button>
              <button type="button" disabled={ratingCard} onClick={()=>rating("Good")}><strong>Good</strong><small>{intervalLabels.Good}</small></button>
              <button type="button" disabled={ratingCard} onClick={()=>rating("Easy")}><strong>Easy</strong><small>{intervalLabels.Easy}</small></button>
            </div>
          ):(
            <div className="flashcard-controls flex items-center justify-between gap-3 w-full">
              <button type="button" className="secondary-btn fc-manage-deck-btn" onClick={()=>openPortal("deck",null)}>Manage deck ({(p.data.flashcards||[]).length})</button>
              <button type="button" className="primary-btn" onClick={()=>setRevealed(true)}>Reveal answer <span>↗</span></button>
            </div>
          )}
        </>:<>
          <EmptyState title="No cards due right now" body={filterCourse==="all"?"You’re all caught up. Generate AI flashcards from any topic or create your own custom card.":"No cards are due in this course filter right now."} action="Add a card" onAction={()=>openPortal("manual",null)}/>
          <div className="fc-empty-ai-row flex justify-center gap-2.5 flex-wrap">
            <button type="button" className="secondary-btn" onClick={()=>openPortal("ai",null)}>Generate with AI ✦</button>
            {(p.data.flashcards||[]).length>0&&<button type="button" className="quiet-btn fc-manage-deck-btn" onClick={()=>openPortal("deck",null)}>Manage deck ({(p.data.flashcards||[]).length})</button>}
          </div>
        </>}
      </section>

      <aside className="flash-aside flex flex-col gap-4">
        {/* 1. "Your Deck" Card — Black & Charcoal with Dim Silver Sheen */}
        <section className="fc-silver-card fc-deck-card">
          <div className="fc-card-head">
            <div className="fc-card-title-group">
              <div className="fc-card-icon-box">
                <Icon name="cards" size={15} />
              </div>
              <h3 className="fc-card-title">Your Deck</h3>
            </div>
            <span className="fc-card-badge-silver">Spaced Repetition</span>
          </div>

          <div className="fc-card-body">
            {/* Metric Showcase */}
            <div className="fc-metric-showcase">
              <div className="fc-metric-number">{savedInScope}</div>
              <div className="fc-metric-info">
                <span className="fc-metric-label">Cards saved</span>
                <span className="fc-metric-sub">{due.length} due today</span>
              </div>
            </div>

            <p className="fc-card-description">
              Adaptive spaced repetition surfaces each question right before you forget it, locking concepts into long-term recall.
            </p>

            {/* Action Buttons */}
            <div className="fc-card-actions">
              <button
                type="button"
                className="fc-btn-silver-ai"
                onClick={() => openPortal("ai", null)}
              >
                <span>Generate with AI</span>
                <span className="fc-btn-spark">✦</span>
              </button>
              <button
                type="button"
                className="fc-btn-charcoal"
                onClick={() => openPortal("manual", null)}
              >
                <Icon name="plus" size={13} />
                <span>Create a flashcard</span>
              </button>
              {(p.data.flashcards || []).length > 0 && (
                <button
                  type="button"
                  className="fc-btn-silver-outline"
                  onClick={() => openPortal("deck", null)}
                >
                  Manage deck ({p.data.flashcards.length})
                </button>
              )}
            </div>
          </div>
        </section>

        {/* 2. "Due Later" Card — Black & Charcoal with Dim Silver Sheen */}
        <section className="fc-silver-card fc-due-card">
          <div className="fc-card-head">
            <div className="fc-card-title-group">
              <div className="fc-card-icon-box">
                <Icon name="clock" size={15} />
              </div>
              <h3 className="fc-card-title">Due Later</h3>
            </div>
            <span className="fc-card-badge-dim">{dueLater.length} scheduled</span>
          </div>

          <div className="fc-card-body">
            {dueLater.length > 0 ? (
              <div className="fc-due-list">
                {dueLater.slice(0, 5).map(c => (
                  <div key={c.id} className="fc-due-item">
                    <span className="fc-due-dot" />
                    <span className="fc-due-front" title={c.front}>{c.front}</span>
                    <span className="fc-due-date">{prettyDate(c.due_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="fc-empty-schedule-box">
                <div className="fc-empty-icon-ring">
                  <Icon name="clock" size={16} />
                </div>
                <strong className="fc-empty-title">No upcoming cards scheduled</strong>
                <p className="fc-empty-desc">
                  Cards you rate as Hard, Good, or Easy will appear here with their next review date.
                </p>
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>

    <FlashcardPortalModal
      open={portalState.open}
      initialMode={portalState.mode}
      editingCard={portalState.editingCard}
      currentCard={card||null}
      flashcards={p.data.flashcards||[]}
      initialCourseId={initialPortalCourse}
      initialCourseFilter={filterCourse}
      allCourses={allCourses}
      allLessons={allLessons}
      notes={p.data?.notes||[]}
      remote={p.remote}
      request={p.request}
      onClose={()=>setPortalState({open:false,mode:"manual",editingCard:null})}
      onSaveCard={handleSavePortalCard}
      onSaveGeneratedBatch={p.addFlashcardsBatch}
      onDeleteCard={handleDeleteCard}
      onJumpToCard={jumpToCard}
      onOpenAccount={p.openAccount}
      flashToast={p.flashToast}
    />
  </div>;
}

export { FlashcardsPage };
