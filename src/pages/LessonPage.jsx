import React, { useState, useEffect, useRef } from "react";
import { Icon, Panel, EmptyState, minuteLabel, parseMarkdownToHtml } from "../components/common.jsx";
import { TutorMarkdown } from "../tutor-markdown.jsx";

const LESSON_DEPTH_STORAGE_KEY = "learnos.lesson_depth.v1";

export function readStoredDepths(lessonId) {
  if (!lessonId || typeof window === "undefined" || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(LESSON_DEPTH_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object" && parsed[lessonId]) || {};
  } catch {
    return {};
  }
}

export function writeStoredDepth(lessonId, depthKey, content) {
  if (!lessonId || !depthKey || typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(LESSON_DEPTH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed[lessonId]) parsed[lessonId] = {};
    parsed[lessonId][depthKey] = content;
    localStorage.setItem(LESSON_DEPTH_STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
}

export function clearStoredDepth(lessonId, depthKey) {
  if (!lessonId || !depthKey || typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(LESSON_DEPTH_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed[lessonId]) {
      delete parsed[lessonId][depthKey];
      localStorage.setItem(LESSON_DEPTH_STORAGE_KEY, JSON.stringify(parsed));
    }
  } catch {}
}

export function LessonPage(p){
  const lesson=p.activeLesson;
  const [selected,setSelected]=useState(null),[feedback,setFeedback]=useState(null),[saving,setSaving]=useState(false);
  const [depth,setDepth]=useState("standard");
  const [tailored,setTailored]=useState(()=>readStoredDepths(lesson?.id));
  const [loadingDepth,setLoadingDepth]=useState(false);

  useEffect(()=>{
    setSelected(null);
    setFeedback(null);
    setDepth("standard");
    setTailored(readStoredDepths(lesson?.id));
    setLoadingDepth(false);
  },[lesson?.id]);

  if(!lesson)return <EmptyState title="Choose a lesson to begin" body="Open a course roadmap or choose a task from today’s plan." action="View courses" onAction={()=>p.go("courses")}/>;
  const checkpoint=lesson.checkpoint||{};
  const paragraphs=String(lesson.content_markdown||lesson.content||"Start with the objective, then connect the key idea to a small example. Check your understanding before moving on.").split(/\n\n+/);
  const all=p.lessons;const at=all.findIndex(l=>l.id===lesson.id);const previous=all[at-1],next=all[at+1];
  const answer=async()=>{if(selected===null)return;p.setActiveLessonId(lesson.id);setSaving(true);const result=await p.submitCheckpoint(selected);setFeedback(result);setSaving(false);};

  const handleDepthChange=async(newDepth,force=false)=>{
    setDepth(newDepth);
    if(newDepth==="standard")return;

    const stored=readStoredDepths(lesson.id);
    const existingContent=!force?(tailored[newDepth]||stored[newDepth]):null;
    if(existingContent){
      if(!tailored[newDepth]){
        setTailored(prev=>({...prev,[newDepth]:existingContent}));
      }
      return;
    }

    if(force){
      clearStoredDepth(lesson.id,newDepth);
      setTailored(prev=>{
        const next={...prev};
        delete next[newDepth];
        return next;
      });
    }

    const courseTitle=p.activeCourse?.title||"";
    if(p.remote){
      setLoadingDepth(true);
      const promptText=newDepth==="simpler"
        ?`Explain "${lesson.title}" (${lesson.objective}) from the course "${courseTitle}" in simpler terms using a natural, human everyday analogy (such as everyday conversations, cooking, storytelling, or daily habits). Break down the core intuition so it is easy to visualize and grasp immediately. Match the natural communicative nature of ${courseTitle}, do NOT use mechanical, computer, or programming analogies, and do NOT include lesson IDs, topic IDs, or bracketed codes.`
        :`Provide an in-depth, thorough breakdown of "${lesson.title}" (${lesson.objective}) from the course "${courseTitle}". Explore core concepts, subtle nuances, common misconceptions or pitfalls, and practical real-world applications. Ensure your explanation is fully completed, tailored to the subject domain of ${courseTitle}, contains zero computer/programming code or system architecture analogies, and does NOT include lesson IDs, topic IDs, or bracketed codes.`;

      try{
        const reply=await p.sendTutor({
          mode:"Explain",
          prompt:promptText,
          lessonId:lesson.id,
          courseId:p.activeCourse?.id,
        });
        const text=typeof reply==="string"?reply:reply?.text;
        if(text){
          setTailored(prev=>({...prev,[newDepth]:text}));
          writeStoredDepth(lesson.id,newDepth,text);
        }
      }catch(err){
        p.flashToast?.(err?.message||"Could not generate explanation.");
      }finally{
        setLoadingDepth(false);
      }
    }else{
      const localAnalogy=newDepth==="simpler"
        ?`Intuitive Analogy for ${lesson.title}:\nThink of this concept like an everyday routine within ${courseTitle}: ${lesson.objective}. Before worrying about intricate rules, imagine the natural flow and why each element connects logically to the next.`
        :`Deep Dive into ${lesson.title}:\nExploring ${lesson.objective} in depth: Notice how the core principles coordinate, what edge cases or subtleties arise in real-world application, and how this bridges to advanced fluency in ${courseTitle}.`;
      setTailored(prev=>({...prev,[newDepth]:localAnalogy}));
      writeStoredDepth(lesson.id,newDepth,localAnalogy);
    }
  };

  return <div className="lesson-layout grid gap-4 items-start"><article className="lesson-reading panel flex flex-col"><div className="lesson-toolbar flex items-center justify-between p-3.5 border-b border-learnos-line"><button className="quiet-action" onClick={()=>p.go("course")}>← Course roadmap</button><span className="text-sm font-semibold text-learnos-muted uppercase tracking-wider">{lesson.moduleTitle}</span><button className="quiet-action" onClick={()=>p.go("tutor")}>Ask tutor ↗</button></div><div className="lesson-content flex flex-col p-6 gap-5"><div className="lesson-meta flex items-center justify-between text-sm text-learnos-muted"><span><Icon name="clock" size={14}/>{minuteLabel(lesson.estimated_minutes||25)}</span><span>Lesson {at+1} of {all.length}</span></div><h2>{lesson.title}</h2><div className="lesson-objective flex flex-col gap-1 p-3.5 rounded-lg bg-learnos-bg/60 border border-learnos-line"><span>LEARNING OBJECTIVE</span><p>{lesson.objective}</p></div><div className="explanation-depth-bar flex items-center justify-between gap-3 p-2.5 rounded-lg bg-learnos-surface border border-learnos-line"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-learnos-muted uppercase tracking-wider">Depth:</span><div className="depth-selector flex flex-wrap items-center gap-1.5" role="group" aria-label="Explanation depth">{[["standard","Standard"],["simpler","Simpler (with analogy)"],["deep","Deep dive"]].map(([key,label])=><button key={key} type="button" aria-pressed={depth===key} className={`cursor-pointer text-sm px-2.5 py-1 rounded transition-colors ${depth===key?"selected font-bold text-learnos-purple bg-learnos-purple/15 border border-learnos-purple/40":"text-learnos-muted hover:text-learnos-text"}`} onClick={()=>handleDepthChange(key)}>{label}</button>)}</div></div>{depth!=="standard"&&<button type="button" className="text-button text-sm" disabled={loadingDepth} onClick={()=>handleDepthChange(depth,true)}>Regenerate ↻</button>}</div>{lesson.prerequisites?.length>0&&<div className="prereq-row flex flex-wrap items-center gap-2"><strong>Before you start</strong>{lesson.prerequisites.map((item,i)=><span key={i}>{item}</span>)}</div>}{depth==="simpler"?(loadingDepth?<div className="depth-loading p-4 rounded-xl border border-learnos-line flex items-center gap-2 text-sm text-learnos-muted"><Icon name="spark" size={16}/><span>Consulting AI tutor for an intuitive analogy and simpler breakdown…</span></div>:<div className="reading-copy flex flex-col gap-3 text-sm leading-relaxed mt-2"><div className="flex items-center gap-2 text-learnos-purple font-semibold text-sm mb-1"><Icon name="spark" size={17}/><span>Simpler explanation (with analogy)</span></div><TutorMarkdown content={tailored.simpler||""}/></div>):depth==="deep"?(loadingDepth?<div className="depth-loading p-4 rounded-xl border border-learnos-line flex items-center gap-2 text-sm text-learnos-muted"><Icon name="spark" size={16}/><span>Consulting AI tutor for deep dive and edge cases…</span></div>:<div className="reading-copy flex flex-col gap-3 text-sm leading-relaxed mt-2"><div className="flex items-center gap-2 text-learnos-lime font-semibold text-sm mb-1"><Icon name="spark" size={17}/><span>Deep dive breakdown & edge cases</span></div><TutorMarkdown content={tailored.deep||""}/></div>):(<div className="reading-copy flex flex-col gap-4 leading-relaxed mt-2"><TutorMarkdown content={lesson.content_markdown||lesson.content||paragraphs.join("\n\n")}/></div>)}{(lesson.worked_example||lesson.workedExample)&&<section className="worked-example flex flex-col gap-2 p-4 rounded-xl border border-learnos-line"><div><Icon name="spark" size={17}/>Worked example</div><p>{lesson.worked_example||lesson.workedExample}</p></section>}<div className="lesson-checkpoint flex flex-col gap-3 p-5 rounded-xl border border-learnos-line"><span className="eyebrow">CHECK YOUR UNDERSTANDING</span><h3>{checkpoint.question||"Explain the main idea in your own words."}</h3>{checkpoint.options?.length?<div className="answer-options flex flex-col gap-2">{checkpoint.options.map((option,i)=><button key={i} className={`answer-option ${selected===i?"selected":""} ${feedback&&i===checkpoint.answerIndex?"answer-correct":""}`} onClick={()=>{setSelected(i);setFeedback(null);}}><span>{String.fromCharCode(65+i)}</span>{option}</button>)}</div>:<textarea className="free-answer" value={selected||""} onChange={e=>setSelected(e.target.value)} placeholder="Write your explanation…"/>}{feedback&&<div className={`feedback-box flex flex-col gap-1 p-3.5 rounded-lg ${feedback.correct?"correct":"incorrect"}`} role="status"><strong>{feedback.correct?"Checkpoint passed":"Try that idea again"}</strong><p>{feedback.explanation}</p></div>}<div className="checkpoint-actions flex items-center justify-between gap-3 mt-2"><p className="text-sm text-learnos-muted">Submitting records an attempt. The task is complete when the checkpoint is passed.</p><button className="primary-btn" disabled={selected===null||saving} onClick={answer}>{saving?<><span className="btn-spinner"/> Checking…</>:feedback?.correct?"Passed ✓":"Submit answer"}</button></div></div><div className="lesson-bottom-nav flex items-center justify-between pt-4 border-t border-learnos-line"><button className="quiet-action" disabled={!previous} onClick={()=>p.openLesson(previous.id)}>← {previous?.title||"Previous"}</button><button className="quiet-action" disabled={!next} onClick={()=>p.openLesson(next.id)}>{next?.title||"Next lesson"} →</button></div></div></article>
    <aside className="lesson-rail flex flex-col gap-4"><Panel title="Lesson tools" icon="spark"><div className="quick-tool-list flex flex-col gap-1.5 p-2"><button onClick={()=>p.draftNote(lesson.id)}><Icon name="notes"/>Draft lesson notes <span>↗</span></button><button onClick={()=>p.addFlashcard({front:`What is the key idea in “${lesson.title}”?`,back:lesson.objective,lessonId:lesson.id,courseId:p.activeCourse?.id})}><Icon name="cards"/>Make a flashcard <span>↗</span></button><button onClick={()=>p.go("tutor")}><Icon name="tutor"/>Ask the tutor <span>↗</span></button></div></Panel><Panel title="In this course" icon="book"><div className="lesson-course-nav flex flex-col gap-3 p-3">{p.activeCourse?.modules?.map((m,i)=><div key={m.id||i} className="flex flex-col gap-1"><strong>{m.title}</strong>{m.lessons?.map(l=><button className={`text-left text-sm p-1.5 rounded transition-colors ${l.id===lesson.id?"active font-bold text-learnos-purple bg-learnos-purple/10":"text-learnos-muted hover:text-learnos-text"}`} key={l.id} onClick={()=>p.openLesson(l.id)}>{l.title}</button>)}</div>)}</div></Panel><div className="lesson-evidence-note flex items-start gap-3 p-3.5 panel"><Icon name="check"/><div><strong>Progress tracks two things</strong><p className="text-sm text-learnos-muted">Finished sessions and submitted understanding evidence are kept separately.</p><button className="text-button" onClick={()=>p.go("progress")}>View your evidence ↗</button></div></div></aside></div>;
}

