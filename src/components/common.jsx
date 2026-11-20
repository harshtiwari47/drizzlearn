import React from "react";
import { buildPath, shouldInterceptNavClick } from "../router.js";

export const LOCAL_STORAGE_KEY = "learnos.local.v2";
export const LEGACY_STORAGE_KEY = "learnos.sample.v1";

export function emptyWorkspace() {
  return {
    courses: [],
    activeCourseId: null,
    goals: [],
    tasks: [],
    notes: [],
    flashcards: [],
    attempts: [],
    settings: {
      fullName: "",
      timezone: (typeof Intl !== "undefined" && Intl.DateTimeFormat?.().resolvedOptions?.().timeZone) || "UTC",
      preferredStudyDays: [],
      sessionMinutes: 120,
      weeklyMinutes: 360,
      notificationPreferences: { study: false, review: false }
    }
  };
}

export function prettyDate(iso){if(!iso)return"";try{return new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});}catch{return iso;}}
export function minuteLabel(mins){if(!mins&&mins!==0)return"";if(mins<60)return`${mins}m`;const h=Math.floor(mins/60);const m=mins%60;return m?`${h}h ${m}m`:`${h}h`;}

export function Icon({name,size=18}){
  const paths={
    home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></>,
    plus:<><path d="M12 5v14M5 12h14"/></>,
    book:<><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
    calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    people:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    notes:<><path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    cards:<><rect x="4" y="5" width="14" height="16" rx="2"/><path d="M8 3h12a2 2 0 0 1 2 2v13M8 10h6M8 14h6"/></>,
    practice:<><path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"/></>,
    progress:<><path d="M4 20V12h4v8M10 20V5h4v15M16 20V2h4v18"/></>,
    tutor:<><rect x="4" y="6" width="16" height="13" rx="4"/><path d="M9 12h.01M15 12h.01M9 16h6M12 2v4"/></>,
    search:<><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,
    clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    play:<path d="m8 5 11 7-11 7z"/>,
    check:<path d="m5 12 4 4L19 6"/>,
    arrow:<><path d="M5 12h14M13 6l6 6-6 6"/></>,
    arrowRight:<><path d="M5 12h14M13 6l6 6-6 6"/></>,
    "arrow-right":<><path d="M5 12h14M13 6l6 6-6 6"/></>,
    arrowLeft:<><path d="M19 12H5M11 6l-6 6 6 6"/></>,
    "arrow-left":<><path d="M19 12H5M11 6l-6 6 6 6"/></>,
    alert:<><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></>,
    chevron:<><path d="m6 9 6 6 6-6"/></>,
    chevronLeft:<><path d="m15 18-6-6 6-6"/></>,
    chevronRight:<><path d="m9 18 6-6-6-6"/></>,
    spark:<path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>,
    edit:<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></>,
    eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
    layout:<><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></>,
    list:<><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></>,
    flame:<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 3z"/>,
    target:<><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></>,
    brain:<><path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v14"/></>,
    trendingUp:<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    award:<><circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/></>,
    zap:<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>,
    bold:<><path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/><path d="M6 12h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6z"/></>,
    italic:<><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></>,
    quote:<><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></>,
    code:<><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></>,
    heading:<><path d="M6 12h12"/><path d="M6 4v16"/><path d="M18 4v16"/></>,
    fileText:<><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></>,
    tag:<><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></>,
    layers:<><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
    link:<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.spark}</svg>;
}

export function PageContextBar({context,go}){
  if(!context)return null;
  const {back,breadcrumbs}=context;
  const navigateItem=(e,item)=>{
    if(!item?.page||!shouldInterceptNavClick(e))return;
    e.preventDefault();
    go(item.page,{params:item.params||{},query:item.query||{}});
  };
  return <div className="page-context-bar">
    {back&&<a href={buildPath(back.page,{params:back.params,query:back.query})} className="page-back-btn" onClick={e=>navigateItem(e,back)}><Icon name="arrowLeft" size={14}/><span>{back.label}</span></a>}
    {breadcrumbs?.length>0&&<nav className="page-breadcrumb" aria-label="Breadcrumb"><ol className="page-breadcrumb-list">{breadcrumbs.map((crumb,idx)=>{
      const isLast=idx===breadcrumbs.length-1||crumb.current;
      return <li key={`${crumb.label}-${idx}`} className="page-breadcrumb-item">
        {idx>0&&<span className="page-breadcrumb-sep" aria-hidden="true"><Icon name="chevronRight" size={12}/></span>}
        {isLast||!crumb.page
          ?<span className="page-breadcrumb-current" aria-current={isLast?"page":undefined} title={crumb.label}>{crumb.label}</span>
          :<a href={buildPath(crumb.page,{params:crumb.params,query:crumb.query})} className="page-breadcrumb-link" title={crumb.label} onClick={e=>navigateItem(e,crumb)}>{crumb.label}</a>}
      </li>;
    })}</ol></nav>}
  </div>;
}

export function pendingTasksCount(data){return data.tasks.filter(t=>t.status!=="completed").length;}
export function FeatureCard({featured,icon,title,detail,action}){return <button className={`feature-card flex items-center gap-3.5 p-4 text-left cursor-pointer transition-all ${featured?"featured":""}`} type="button" onClick={action}><span className="feature-icon grid place-items-center"><Icon name={icon}/></span><span className="flex flex-col gap-0.5 min-w-0"><strong>{title}</strong><small className="leading-snug">{detail}</small></span></button>}
export function Stat({icon,value,label}){return <div className="stat flex flex-col items-center justify-center p-3 text-center gap-1"><span className="stat-icon"><Icon name={icon}/></span><strong className="tabular-nums tracking-tight">{value}</strong><small className="leading-tight text-learnos-muted">{label}</small></div>}
export function Panel({title,icon,children,action}){return <section className="panel flex flex-col"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name={icon||"spark"}/>{title}</div>{action}</div>{children}</section>}

export function EmptyState({title,body,action,onAction,illustration}){return <div className="empty-state flex flex-col items-center justify-center text-center p-8">{illustration?<div className="empty-illustration-wrap mb-3"><img src={illustration} alt="" className="empty-illustration-img" loading="lazy"/></div>:<span className="empty-orb grid place-items-center mb-3"><Icon name="spark" size={24}/></span>}<h2>{title}</h2><p className="max-w-md mb-4">{body}</p>{action&&<button className="primary-btn" onClick={onAction}>{action} ↗</button>}</div>}

export function collectAllCourseLessons(courses=[],fallbackLessons=[],fallbackCourse=null){
  const courseList=Array.isArray(courses)?courses:[];
  if(courseList.length>0){
    return courseList.flatMap((course,cIdx)=>
      (course.modules||[]).flatMap((mod,mIdx)=>
        (mod.lessons||[]).map((lesson,lIdx)=>({
          ...lesson,
          courseId:course.id,
          courseTitle:course.title||`Course ${cIdx+1}`,
          courseStatus:course.status,
          moduleId:mod.id,
          moduleTitle:mod.title||`Module ${mIdx+1}`,
          moduleIndex:mIdx,
          lessonIndex:lIdx,
        }))
      )
    );
  }
  return (Array.isArray(fallbackLessons)?fallbackLessons:[]).map((lesson,lIdx)=>({
    ...lesson,
    courseId:lesson.courseId||fallbackCourse?.id||"",
    courseTitle:lesson.courseTitle||fallbackCourse?.title||"",
    moduleTitle:lesson.moduleTitle||"Module",
    lessonIndex:lIdx,
  }));
}

export const courseCovers=["/images/course-cover-ai.svg","/images/course-cover-systems.svg","/images/course-cover-math.svg","/images/course-cover-design.svg"];

export function parseMarkdownToHtml(text){
  if(!text)return "";
  const lines=String(text).split("\n");
  let inCode=false,codeBuf=[];
  let inUl=false,inOl=false;
  const out=[];
  const closeLists=()=>{
    if(inUl){out.push("</ul>");inUl=false;}
    if(inOl){out.push("</ol>");inOl=false;}
  };
  const inline=(str)=>{
    let s=str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    s=s.replace(/`([^`]+)`/g,"<code>$1</code>");
    s=s.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
    s=s.replace(/__([^_]+)__/g,"<strong>$1</strong>");
    s=s.replace(/\*([^*]+)\*/g,"<em>$1</em>");
    s=s.replace(/_([^_]+)_/g,"<em>$1</em>");
    s=s.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  };
  for(const line of lines){
    const trimmed=line.trim();
    if(trimmed.startsWith("```")){
      closeLists();
      if(inCode){
        out.push('<pre class="md-codeblock"><code>'+codeBuf.join("\n")+'</code></pre>');
        codeBuf=[];inCode=false;
      }else{
        inCode=true;
      }
      continue;
    }
    if(inCode){
      codeBuf.push(line.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"));
      continue;
    }
    if(!trimmed){
      closeLists();
      continue;
    }
    if(trimmed.startsWith("### ")){
      closeLists();
      out.push("<h3>"+inline(trimmed.slice(4))+"</h3>");
    }else if(trimmed.startsWith("## ")){
      closeLists();
      out.push("<h2>"+inline(trimmed.slice(3))+"</h2>");
    }else if(trimmed.startsWith("# ")){
      closeLists();
      out.push("<h1>"+inline(trimmed.slice(2))+"</h1>");
    }else if(trimmed.startsWith("> ")){
      closeLists();
      out.push("<blockquote>"+inline(trimmed.slice(2))+"</blockquote>");
    }else if(/^[-*]\s+/.test(trimmed)){
      if(inOl){out.push("</ol>");inOl=false;}
      if(!inUl){out.push("<ul>");inUl=true;}
      out.push("<li>"+inline(trimmed.replace(/^[-*]\s+/,""))+"</li>");
    }else if(/^\d+\.\s+/.test(trimmed)){
      if(inUl){out.push("</ul>");inUl=false;}
      if(!inOl){out.push("<ol>");inOl=true;}
      out.push("<li>"+inline(trimmed.replace(/^\d+\.\s+/,""))+"</li>");
    }else{
      closeLists();
      out.push("<p>"+inline(trimmed)+"</p>");
    }
  }
  closeLists();
  if(inCode){
    out.push('<pre class="md-codeblock"><code>'+codeBuf.join("\n")+'</code></pre>');
  }
  return out.join("");
}

export function mergeStreamProgress(prev, frame, fallback = "Crafting your customized course…") {
  const rawPercent = Number(frame?.percent);
  const nextPercent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, Math.round(rawPercent))) : (prev?.percent ?? 5);
  return {
    stage: frame?.stage || prev?.stage || "initializing",
    percent: Math.max(prev?.percent ?? 0, nextPercent),
    message: frame?.message || prev?.message || fallback,
    model: frame?.model ?? prev?.model ?? "",
    provider: frame?.provider ?? prev?.provider ?? "",
    goalId: frame?.goalId ?? prev?.goalId ?? null,
    error: frame?.error ?? prev?.error ?? null,
  };
}

export function GenerationProgressCard({
  progress,
  fallbackMessage = "Crafting your customized course…",
  ariaLabel = "Course generation progress",
  note = "",
  onRetry = null,
  onDismiss = null,
}) {
  const rawPercent = Number(progress?.percent);
  const percent = Number.isFinite(rawPercent) ? Math.max(0, Math.min(100, Math.round(rawPercent))) : 0;
  const isError = progress?.stage === "error" || Boolean(progress?.error);
  const message = isError
    ? (progress?.message || `Generation paused at ${percent}%`)
    : (progress?.message || fallbackMessage);
  const model = progress?.model;
  const provider = progress?.provider;
  const errorMessage = progress?.error;

  return (
    <div
      className={`course-generation-progress flex flex-col gap-3 p-4 rounded-xl border transition-all ${
        isError
          ? "generation-progress-paused border-rose-500/40 bg-rose-950/25 shadow-lg shadow-rose-950/20"
          : "border-learnos-purple/40 bg-learnos-purple/10"
      }`}
      role="status"
      aria-live="polite"
    >
      <div className="generation-progress-header flex items-center justify-between gap-2 flex-wrap">
        <span
          className={`generation-progress-label flex items-center gap-2 font-semibold text-sm ${
            isError ? "text-rose-300" : "text-learnos-lavender"
          }`}
        >
          <Icon name={isError ? "alert" : "spark"} size={18} />
          <span>{message}</span>
        </span>
        <div className="generation-progress-meta flex items-center gap-2 flex-wrap">
          {model && (
            <span
              className={`generation-model-badge ${isError ? "border-rose-500/30 text-rose-300" : ""}`}
              title={provider ? `${provider} · ${model}` : model}
              aria-label={`Active model: ${model}`}
            >
              {model}
            </span>
          )}
          <span
            className={`generation-stage-pill generation-percent-pill ${
              isError ? "border-rose-500/40 bg-rose-500/10 text-rose-300" : ""
            }`}
          >
            {percent}%
          </span>
        </div>
      </div>
      <div
        className="generation-progress-track w-full h-2 rounded-full bg-learnos-surface overflow-hidden"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`generation-progress-bar h-full rounded-full transition-all duration-300 ${
            isError
              ? "bg-gradient-to-r from-amber-500 to-rose-500"
              : "bg-gradient-to-r from-learnos-purple to-learnos-lime"
          }`}
          style={{ width: `${Math.max(4, percent)}%` }}
        />
      </div>
      {isError && errorMessage && (
        <div className="generation-error-detail text-xs text-rose-200/90 leading-relaxed bg-black/40 p-2.5 rounded-lg border border-rose-500/25">
          <strong className="text-rose-300">Status note:</strong> {errorMessage}
        </div>
      )}
      {isError && (onRetry || onDismiss) && (
        <div className="generation-error-actions flex items-center gap-2 pt-1">
          {onRetry && (
            <button
              type="button"
              className="generation-action-btn generation-retry-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs font-semibold border border-rose-500/40 transition-colors"
              onClick={onRetry}
            >
              <span>Resume Generation ↻</span>
            </button>
          )}
          {onDismiss && (
            <button
              type="button"
              className="generation-action-btn generation-dismiss-btn px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium border border-white/10 transition-colors"
              onClick={onDismiss}
            >
              <span>Clear & Start Over</span>
            </button>
          )}
        </div>
      )}
      {note && !isError && <p className="generation-routing-note text-sm text-learnos-muted">{note}</p>}
    </div>
  );
}
