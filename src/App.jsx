import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TutorMarkdown } from "./tutor-markdown.jsx";
import {
  buildTutorThreadId,
  clearTutorThread,
  listTutorThreads,
  loadTutorThread,
  saveTutorThread,
} from "./tutor-db.js";
import {
  buildPracticeSetKey,
  listLessonPracticeModes,
  loadPracticeSet,
  savePracticeSet,
} from "./practice-db.js";
import { PracticeStudioRunner } from "./practice-exercises.jsx";

const navItems = [
  ["home","Home","home"],["courses","My Courses","book"],["today","Today’s Plan","calendar"],
  ["study-together","Study Together","people"],
  ["notes","Notes","notes"],["flashcards","Flashcards","cards"],["practice","Practice","practice"],
  ["progress","Progress","progress"],["tutor","AI Tutor","tutor"],
];
const primaryNavItems=navItems.slice(0,4),toolNavItems=navItems.slice(4);

const LOCAL_STORAGE_KEY="learnos.local.v2";
const LEGACY_STORAGE_KEY="learnos.sample.v1";
const legacySeedNoteIds=new Set(["n1","n2","n3","n4","n5","n6"]);
const legacySeedFlashcardId=/^f(?:[1-9]|[12]\d|3[12])$/;

function emptyWorkspace(){
  return {courses:[],activeCourseId:null,goals:[],tasks:[],notes:[],flashcards:[],attempts:[],settings:{fullName:"",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",preferredStudyDays:[],sessionMinutes:120,weeklyMinutes:360,notificationPreferences:{study:false,review:false}}};
}
function sanitizeStoredWorkspace(raw,{legacy=false}={}){
  const empty=emptyWorkspace(),stored=raw&&typeof raw==="object"?raw:{};
  const courses=Array.isArray(stored.courses)?stored.courses:[];
  const generatedFallbackIds=new Set(courses.filter(course=>course?.id?.startsWith("local-")&&course.modules?.some(module=>String(module.id||"").startsWith("proposal-m")||module.lessons?.some(lesson=>String(lesson.id||"").startsWith("proposal-l")))).map(course=>course.id));
  const removedCourseIds=new Set([...generatedFallbackIds,...courses.filter(course=>course?.id==="sample-course").map(course=>course.id)]);
  const cleanCourses=courses.filter(course=>!removedCourseIds.has(course?.id));
  const notes=(Array.isArray(stored.notes)?stored.notes:[]).filter(note=>!legacySeedNoteIds.has(note?.id));
  const flashcards=(Array.isArray(stored.flashcards)?stored.flashcards:[]).filter(card=>!legacySeedFlashcardId.test(card?.id||""));
  const tasks=(Array.isArray(stored.tasks)?stored.tasks:[]).filter(task=>{
    if(removedCourseIds.has(task?.course_id))return false;
    return !/^task-(?:done-\d+|next|review|upcoming-\d+)$/.test(task?.id||"");
  });
  const goals=(Array.isArray(stored.goals)?stored.goals:[]).filter(goal=>goal?.id!=="sample-goal");
  const attempts=(Array.isArray(stored.attempts)?stored.attempts:[]).filter(attempt=>!String(attempt?.id||"").startsWith("sample-attempt-"));
  const settings={...empty.settings,...(stored.settings&&typeof stored.settings==="object"?stored.settings:{})};
  if(legacy&&settings.fullName==="Harsh Tiwari")settings.fullName="";
  return {...empty,...stored,courses:cleanCourses,activeCourseId:cleanCourses.some(course=>course.id===stored.activeCourseId)?stored.activeCourseId:cleanCourses.find(course=>course.status==="active")?.id||null,goals,tasks,notes,flashcards,attempts,settings};
}
const loadCachedRemote = () => {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem("learnos.remote_cache");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};
const loadSaved=()=>{
  try{
    if(typeof localStorage==="undefined")return emptyWorkspace();
    const cached=loadCachedRemote();
    if(cached?.data){
      return sanitizeStoredWorkspace(cached.data,{legacy:false});
    }
    const current=localStorage.getItem(LOCAL_STORAGE_KEY);
    const legacy=!current,raw=JSON.parse(current||localStorage.getItem(LEGACY_STORAGE_KEY)||"null");
    const clean=sanitizeStoredWorkspace(raw,{legacy});
    localStorage.setItem(LOCAL_STORAGE_KEY,JSON.stringify(clean));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    return clean;
  }catch{return emptyWorkspace();}
};
const loadCachedUser=()=>{
  try{
    return loadCachedRemote()?.user||null;
  }catch{return null;}
};
const initialPage=()=>typeof window==="undefined"?"home":window.location.hash.replace(/^#\/?/,"").split("?")[0]||"home";
const initialLoginMode=()=>typeof window!=="undefined"&&window.location.hash.replace(/^#\/?/,"").split("?")[0]==="signup"?"signup":"login";
function buildApiError(data,fallback="That request could not be completed."){
  const payload=data?.error&&typeof data.error==="object"?data.error:data;
  const message=payload?.message||(typeof data?.error==="string"?data.error:"")||fallback;
  const error=new Error(message);
  if(payload?.code)error.code=payload.code;
  if(payload?.details!==undefined)error.details=payload.details;
  return error;
}
function mergeStreamProgress(prev,frame,fallback="Crafting your customized course…"){
  const rawPercent=Number(frame?.percent);
  const nextPercent=Number.isFinite(rawPercent)?Math.max(0,Math.min(100,Math.round(rawPercent))):(prev?.percent??5);
  return {
    stage:frame?.stage||prev?.stage||"initializing",
    percent:Math.max(prev?.percent??0,nextPercent),
    message:frame?.message||prev?.message||fallback,
    model:frame?.model??prev?.model??"",
    provider:frame?.provider??prev?.provider??"",
  };
}
function processNdjsonLine(rawLine,onProgress){
  const trimmed=String(rawLine||"").trim();
  if(!trimmed)return null;
  if(trimmed.startsWith("<")){
    throw new Error("Drizzlearn API functions are not available in this preview. Run `npm run dev:vercel` or deploy to Vercel.");
  }
  let frame;
  try{frame=JSON.parse(trimmed);}catch{return null;}
  if(!frame||typeof frame!=="object")return null;
  if(frame.type==="heartbeat")return null;
  if(frame.type==="progress"){onProgress?.(frame);return null;}
  if(frame.type==="error")throw buildApiError(frame);
  if(frame.type==="complete")return frame.course?{course:frame.course}:frame;
  if(!frame.type&&frame.error)throw buildApiError(frame);
  if(!frame.type&&frame.course)return {course:frame.course};
  return null;
}
let activeRequestCount=0;
const activeRequestListeners=new Set();
function notifyActiveRequests(){
  activeRequestListeners.forEach(fn=>{try{fn(activeRequestCount);}catch(_){}});
}
async function request(path, options={}){
  activeRequestCount++;
  notifyActiveRequests();
  try{
    const response=await fetch(`/api/${path}`,{credentials:"include",headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
    const data=await response.json().catch(()=>null);
    if(!data||typeof data!=="object")throw new Error("Drizzlearn API functions are not available in this preview. Run `npm run dev:vercel` or deploy to Vercel.");
    if(!response.ok)throw buildApiError(data);
    return data;
  }finally{
    activeRequestCount=Math.max(0,activeRequestCount-1);
    notifyActiveRequests();
  }
}
async function requestStream(path, options={}, onProgress){
  activeRequestCount++;
  notifyActiveRequests();
  try{
    const {headers={},onProgress:optProgress,...fetchOptions}=options||{};
  const progressHandler=typeof onProgress==="function"?onProgress:optProgress;
  const response=await fetch(`/api/${path}`,{
    credentials:"include",
    headers:{"Content-Type":"application/json","Accept":"application/x-ndjson",...headers},
    ...fetchOptions,
  });
  const contentType=(response.headers.get("content-type")||"").toLowerCase();
  const isNdjson=contentType.includes("ndjson");

  if(!response.ok&&!isNdjson){
    const data=await response.json().catch(()=>null);
    if(data&&typeof data==="object")throw buildApiError(data);
    if(response.status===404||contentType.includes("html")){
      throw new Error("Drizzlearn API functions are not available in this preview. Run `npm run dev:vercel` or deploy to Vercel.");
    }
    throw new Error(`That request could not be completed (HTTP ${response.status}).`);
  }
  if(contentType.includes("text/html")){
    throw new Error("Drizzlearn API functions are not available in this preview. Run `npm run dev:vercel` or deploy to Vercel.");
  }
  if(!isNdjson&&(contentType.includes("application/json")||!response.body?.getReader)){
    const data=await response.json().catch(()=>null);
    if(!data||typeof data!=="object"){
      throw new Error("Drizzlearn API functions are not available in this preview. Run `npm run dev:vercel` or deploy to Vercel.");
    }
    if(data.error)throw buildApiError(data);
    if(data.type==="complete"&&data.course)return {course:data.course};
    if(data.course)return data;
    throw new Error("Unexpected response while generating your course.");
  }

  let completed=null;
  if(!response.body?.getReader){
    const text=await response.text();
    for(const line of text.split("\n")){
      const result=processNdjsonLine(line,progressHandler);
      if(result){completed=result;break;}
    }
  }else{
    const reader=response.body.getReader();
    const decoder=new TextDecoder();
    let buffer="";
    let streamDone=false;
    try{
      while(true){
        const {value,done}=await reader.read();
        if(done){streamDone=true;break;}
        buffer+=decoder.decode(value,{stream:true});
        const lines=buffer.split("\n");
        buffer=lines.pop()??"";
        for(const line of lines){
          const result=processNdjsonLine(line,progressHandler);
          if(result){completed=result;break;}
        }
        if(completed)break;
      }
      if(!completed){
        buffer+=decoder.decode();
        if(buffer.trim()){
          const result=processNdjsonLine(buffer,progressHandler);
          if(result)completed=result;
        }
      }
      if(completed&&!streamDone){
        await reader.cancel().catch(()=>{});
      }
    }catch(error){
      await reader.cancel().catch(()=>{});
      throw error;
    }finally{
      try{reader.releaseLock();}catch{}
    }
  }

  if(!response.ok&&!completed){
    throw new Error(`That request could not be completed (HTTP ${response.status}).`);
  }
  if(!completed?.course){
    const error=new Error("The stream ended before the course draft was finished. Please try again.");
    error.code="STREAM_INCOMPLETE";
    error.details={retryable:true};
    throw error;
  }
  return completed;
}finally{
  activeRequestCount=Math.max(0,activeRequestCount-1);
  notifyActiveRequests();
}
}
const prettyDate=(value,opts={weekday:"short",month:"short",day:"numeric"})=>value?new Intl.DateTimeFormat(undefined,opts).format(new Date(value)):"Not scheduled";
const minuteLabel=(n)=>`${Number(n)||0} min`;

function Icon({name,size=18}){
  const paths={home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></>,plus:<><path d="M12 5v14M5 12h14"/></>,book:<><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,people:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,notes:<><path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,cards:<><rect x="4" y="5" width="14" height="16" rx="2"/><path d="M8 3h12a2 2 0 0 1 2 2v13M8 10h6M8 14h6"/></>,practice:<><path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"/></>,progress:<><path d="M4 20V12h4v8M10 20V5h4v15M16 20V2h4v18"/></>,tutor:<><rect x="4" y="6" width="16" height="13" rx="4"/><path d="M9 12h.01M15 12h.01M9 16h6M12 2v4"/></>,search:<><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,play:<path d="m8 5 11 7-11 7z"/>,check:<path d="m5 12 4 4L19 6"/>,arrow:<><path d="M5 12h14M13 6l6 6-6 6"/></>,alert:<><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></>,chevron:<><path d="m6 9 6 6 6-6"/></>,chevronLeft:<><path d="m15 18-6-6 6-6"/></>,chevronRight:<><path d="m9 18 6-6-6-6"/></>,spark:<path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>};
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.spark}</svg>;
}

export default function App(){
  const [data,setData]=useState(loadSaved),[user,setUser]=useState(loadCachedUser),[remote,setRemote]=useState(()=>Boolean(loadCachedUser())),[page,setPage]=useState(initialPage),[toast,setToast]=useState(""),[busy,setBusy]=useState(false),[queryText,setQueryText]=useState(""),[searchResults,setSearchResults]=useState(null),[modal,setModal]=useState(null),[activeLessonId,setActiveLessonId]=useState(null),[proposal,setProposal]=useState(null),[courseFilter,setCourseFilter]=useState("all"),[mobileMoreOpen,setMobileMoreOpen]=useState(false),[generatingCourseId,setGeneratingCourseId]=useState(null);
  const [loginMode,setLoginMode]=useState(initialLoginMode),[authError,setAuthError]=useState(""),[authMessage,setAuthMessage]=useState(""),[returnPage,setReturnPage]=useState("home");
  const [generationProgress,setGenerationProgress]=useState(null);
  const [generationError,setGenerationError]=useState("");
  const [deletingCourseId,setDeletingCourseId]=useState(null);
  const [deleteCourseError,setDeleteCourseError]=useState("");
  const [activeRequests,setActiveRequests]=useState(0);
  const [syncing,setSyncing]=useState(false);
  const [authBusy,setAuthBusy]=useState(false);
  useEffect(()=>{
    const listener=(count)=>setActiveRequests(count);
    activeRequestListeners.add(listener);
    return ()=>{activeRequestListeners.delete(listener);};
  },[]);
  const flashToast=useCallback((message,duration=4500)=>{setToast(message);window.clearTimeout(window.__learnosToast);window.__learnosToast=window.setTimeout(()=>setToast(""),duration);},[]);
  const updateData=useCallback((updater)=>setData(current=>{const next=typeof updater==="function"?updater(current):updater;if(!remote){localStorage.setItem(LOCAL_STORAGE_KEY,JSON.stringify(next));localStorage.removeItem(LEGACY_STORAGE_KEY);}return next;}),[remote]);
  const refreshRemote=useCallback(async(profile=user)=>{
    setSyncing(true);
    try{
      const [coursesResult,goalsResult,tasksResult,notesResult,cardsResult,progressResult]=await Promise.all([
        request("courses").then(r=>({ok:true,courses:r?.courses||[]})).catch(()=>({ok:false,courses:[]})),
        request("goals").catch(()=>({goals:[]})),
        request("tasks").catch(()=>({tasks:[]})),
        request("notes").catch(()=>({notes:[]})),
        request("flashcards").catch(()=>({flashcards:[]})),
        request("progress").catch(()=>({attempts:[]}))
      ]);
      const courses=await Promise.all(
        (coursesResult?.courses||[]).map(async(row)=>{
          try{
            const detail=await request(`courses/${row.id}`);
            return {...detail.course,modules:(detail.modules||[]).map(m=>({...m,lessons:m.lessons||[]})),durationWeeks:detail.course.target_weeks||8};
          }catch(_){
            return {...row,modules:row.modules||[],durationWeeks:row.target_weeks||8};
          }
        })
      );
      const active=courses.find(c=>c.status==="active");
      setData(current=>{
        const nextCourses=coursesResult.ok?courses:current.courses;
        const keepCurrentActive=coursesResult.ok?nextCourses.some(c=>c.id===current.activeCourseId):Boolean(current.activeCourseId);
        const nextActiveCourseId=keepCurrentActive?current.activeCourseId:(active?.id||nextCourses[0]?.id||null);
        const next={...current,courses:nextCourses,activeCourseId:nextActiveCourseId,goals:goalsResult?.goals||current.goals,tasks:tasksResult?.tasks||current.tasks,notes:notesResult?.notes||current.notes,flashcards:cardsResult?.flashcards||current.flashcards,attempts:progressResult?.attempts||current.attempts,settings:{...current.settings,fullName:profile?.fullName||current.settings.fullName,timezone:profile?.timezone||current.settings.timezone,preferredStudyDays:profile?.preferredStudyDays||current.settings.preferredStudyDays,sessionMinutes:profile?.sessionMinutes||current.settings.sessionMinutes,weeklyMinutes:profile?.weeklyMinutes||current.settings.weeklyMinutes}};
        try{
          if(profile||user){
            localStorage.setItem("learnos.remote_cache",JSON.stringify({user:profile||user,data:next}));
          }
        }catch(_){}
        return next;
      });
    }catch(err){console.warn("refreshRemote failed:",err);}
    finally{setSyncing(false);}
  },[user]);
  useEffect(()=>{
    if(!generatingCourseId)return;
    const timer=setTimeout(async()=>{
      if(remote){
        try{await refreshRemote();}catch(_){}
      }
      setGeneratingCourseId(null);
      flashToast("Study materials ready: notes, flashcards & roadmap created.");
    },3200);
    return ()=>clearTimeout(timer);
  },[generatingCourseId,remote,refreshRemote,flashToast]);
  useEffect(()=>{const onHash=()=>{const raw=location.hash.replace(/^#\/?/,"");const p=raw.split("?")[0];if(p){if(p==="signup")setLoginMode("signup");else if(p==="login"||p==="auth")setLoginMode("login");setPage(p);}};window.addEventListener("hashchange",onHash);onHash();return()=>window.removeEventListener("hashchange",onHash);},[]);
  useEffect(()=>{if(!mobileMoreOpen)return;const close=e=>{if(e.key==="Escape")setMobileMoreOpen(false);};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[mobileMoreOpen]);
  useEffect(()=>{
    let mounted=true;
    setSyncing(true);
    request("auth/me").then(async result=>{
      if(!mounted)return;
      setUser(result.user);
      setRemote(true);
      await refreshRemote(result.user);
    }).catch(()=>{
      if(mounted){
        try{localStorage.removeItem("learnos.remote_cache");}catch(_){}
        setUser(null);
        setRemote(false);
      }
    }).finally(()=>{
      if(mounted)setSyncing(false);
    });
    return ()=>{mounted=false;};
  },[]);
  const go=useCallback((next)=>{setPage(next);if(next!=="search")setSearchResults(null);location.hash=`/${next}`;window.scrollTo({top:0,behavior:"instant"});},[]);
  const activeCourse=useMemo(()=>data.courses.find(c=>c.id===data.activeCourseId)||data.courses.find(c=>c.status==="active")||data.courses[0]||null,[data]);
  const lessons=useMemo(()=>activeCourse?.modules?.flatMap(m=>m.lessons.map(l=>({...l,moduleTitle:m.title})))||[],[activeCourse]);
  const activeLesson=useMemo(()=>lessons.find(l=>l.id===activeLessonId)||lessons.find(l=>l.id===data.tasks.find(t=>t.status!=="completed")?.lesson_id)||lessons[0]||null,[lessons,activeLessonId,data.tasks]);
  const dueCards=data.flashcards.filter(c=>!c.due_at||new Date(c.due_at)<=new Date());
  const completedTasks=data.tasks.filter(t=>t.status==="completed").length;
  const totalTasks=data.tasks.length||0;
  const progressPercent=totalTasks?Math.round(completedTasks/totalTasks*100):0;
  const pendingTasks=data.tasks.filter(t=>t.status!=="completed");
  const nextTask=pendingTasks.sort((a,b)=>new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0))[0];
  const stats={notes:data.notes.length,flashcards:data.flashcards.length,attempts:data.attempts.length,completed:completedTasks,total:totalTasks};

  const openLesson=(id)=>{const target=data.courses.find(c=>c.modules?.some(m=>m.lessons?.some(l=>l.id===id)));if(target)updateData(current=>({...current,activeCourseId:target.id}));setActiveLessonId(id);go("lesson");};
  const persistRemote=async()=>{if(remote)await refreshRemote();};
  const submitGoal=async(form)=>{
    if(!remote){sessionStorage.setItem("learnos.goal.draft",JSON.stringify(form));flashToast("Your goal is saved. Sign in to generate a course plan.");openAccount();return;}
    setBusy(true);
    setGenerationError("");
    setGenerationProgress({stage:"initializing",percent:5,message:"Saving goal & starting curriculum synthesis…",model:"",provider:""});
    try{
      const created=await request("goals",{method:"POST",body:JSON.stringify(form)});
      const result=await requestStream(`goals/${created.goal.id}/proposal?stream=1`,{method:"POST",body:JSON.stringify({})},(frame)=>{
        setGenerationProgress(prev=>mergeStreamProgress(prev,frame,"Crafting your customized course…"));
      });
      setProposal(result.course);
      sessionStorage.removeItem("learnos.goal.draft");
      sessionStorage.removeItem("learnos.goal.prefill");
      go("proposal");
    }catch(error){
      const msg=error?.message||"Course generation could not be completed.";
      setGenerationError(msg);
      flashToast(msg, 7000);
    }finally{
      setBusy(false);
      setGenerationProgress(null);
    }
  };
  const approveProposal=async(acceptOverload=false,courseOverride=null)=>{
    const courseToApprove=courseOverride||proposal;if(!courseToApprove)return;
    if(!remote){openAccount();return;}
    setBusy(true);try{
      await request(`courses/${courseToApprove.id}/approve`,{method:"POST",body:JSON.stringify({acceptOverload})});
      try{
        const detail=await request(`courses/${courseToApprove.id}`);
        const hydratedCourse={...detail.course,modules:(detail.modules||[]).map(m=>({...m,lessons:m.lessons||[]})),durationWeeks:detail.course.target_weeks||8,status:"active"};
        updateData(d=>({
          ...d,
          activeCourseId:courseToApprove.id,
          courses:[hydratedCourse,...d.courses.filter(c=>c.id!==courseToApprove.id)]
        }));
      }catch(_){}
      await refreshRemote();
      setData(current=>({...current,activeCourseId:courseToApprove.id}));
      setProposal(null);
      setGeneratingCourseId(courseToApprove.id);
      flashToast("Course approved! Generating roadmap, study notes & flashcards in background...");
      go("course");
    }catch(error){if(error.code==="PLAN_OVER_BUDGET"){setModal({type:"overload",details:error.details});}else flashToast(error.message);}finally{setBusy(false);}
  };
  const submitCheckpoint=async(answerIndex)=>{
    if(!activeLesson)return;const correct=Number(answerIndex)===Number(activeLesson.checkpoint?.answerIndex);
    try{
      if(remote)await request("practice",{method:"POST",body:JSON.stringify({lessonId:activeLesson.id,concept:activeLesson.title,prompt:activeLesson.checkpoint?.question,answer:activeLesson.checkpoint?.options?.[answerIndex]||"",selectedIndex:Number(answerIndex)})});
      if(remote&&correct){const task=data.tasks.find(t=>t.lesson_id===activeLesson.id&&t.status!=="completed");if(task)await request(`tasks/${task.id}/complete`,{method:"POST",body:JSON.stringify({actualMinutes:task.estimated_minutes})});}
      updateData(current=>{const attempts=[{id:`a-${Date.now()}`,lesson_id:activeLesson.id,concept:activeLesson.title,score:correct?100:0,created_at:new Date().toISOString()},...current.attempts];const tasks=current.tasks.map(t=>t.lesson_id===activeLesson.id&&correct?{...t,status:"completed",completed_at:new Date().toISOString()}:t);return {...current,attempts,tasks};});
      if(correct){flashToast("Checkpoint passed. Understanding evidence saved.");if(remote)await refreshRemote();}else flashToast("Not quite. Review the explanation and try again.");
      return {correct,explanation:activeLesson.checkpoint?.explanation||"Review the lesson objective and try again."};
    }catch(error){flashToast(error.message);return {correct:false,explanation:"Your answer could not be saved. Try again when you are connected."};}
  };
  const saveNote=async(note)=>{
    try{if(remote){const result=note.id?await request(`notes/${note.id}`,{method:"PUT",body:JSON.stringify(note)}):await request("notes",{method:"POST",body:JSON.stringify(note)});const saved=result.note;updateData(c=>({...c,notes:[saved,...c.notes.filter(n=>n.id!==saved.id)]}));}
      else {const saved={...note,id:note.id||`n-${Date.now()}`,origin:note.origin||"learner",updated_at:new Date().toISOString()};updateData(c=>({...c,notes:[saved,...c.notes.filter(n=>n.id!==saved.id)]}));}
      setModal(null);flashToast("Note saved.");
    }catch(error){flashToast(error.message);}
  };
  const draftNote=async(lessonId)=>{const lesson=data.courses.flatMap(c=>c.modules||[]).flatMap(m=>m.lessons||[]).find(l=>l.id===lessonId);if(!lesson)return flashToast("Open a lesson before drafting notes.");try{let body;if(remote){const result=await request("tutor",{method:"POST",body:JSON.stringify({mode:"Explain",prompt:"Turn this lesson into concise, editable study notes. Use a short summary and key points. Do not add facts or citations beyond the lesson.",lessonId})});body=result.reply;}else{body=`Objective\n${lesson.objective}\n\nKey ideas\n${String(lesson.content||lesson.content_markdown||"").split(/\n\n+/).slice(0,3).join("\n\n")}\n\nExample\n${lesson.workedExample||lesson.worked_example||"Add an example in your own words."}`;}await saveNote({title:`Notes — ${lesson.title}`,body,lessonId,sourceRef:lesson.title,origin:"ai_draft"});}catch(error){flashToast(error.message);}};
  const deleteNote=async(id)=>{
    try{
      if(remote)await request(`notes/${id}`,{method:"DELETE"});
      updateData(c=>{
        const nextNotes=c.notes.filter(n=>n.id!==id);
        const next={...c,notes:nextNotes};
        try{
          const raw=localStorage.getItem("learnos.remote_cache");
          if(raw){
            const cached=JSON.parse(raw);
            if(cached?.data)localStorage.setItem("learnos.remote_cache",JSON.stringify({...cached,data:{...cached.data,notes:nextNotes}}));
          }
        }catch(_){}
        return next;
      });
      flashToast("Note deleted.");
    }catch(error){flashToast(error.message);}
  };
  const confirmDeleteCourse=(course,redirectTo=null)=>{if(!course?.id||deletingCourseId)return;setDeleteCourseError("");setModal({type:"delete-course",course,redirectTo});};
  const deleteCourse=async(course,redirectTo=null)=>{
    if(!course?.id||deletingCourseId)return;
    setDeleteCourseError("");
    setDeletingCourseId(course.id);
    try{
      if(remote&&!String(course.id).startsWith("local-")){
        await request(`courses/${course.id}`,{method:"DELETE"});
      }
      const deletedLessonIds=new Set((course.modules||[]).flatMap(m=>m.lessons||[]).map(l=>l.id).filter(Boolean));
      if(activeLessonId&&deletedLessonIds.has(activeLessonId))setActiveLessonId(null);
      if(proposal?.id===course.id)setProposal(null);
      if(generatingCourseId===course.id)setGeneratingCourseId(null);
      updateData(current=>{
        const remainingCourses=current.courses.filter(c=>c.id!==course.id);
        const nextActiveCourseId=current.activeCourseId===course.id?(remainingCourses.find(c=>c.status==="active")?.id||remainingCourses[0]?.id||null):current.activeCourseId;
        return {
          ...current,
          courses:remainingCourses,
          activeCourseId:nextActiveCourseId,
          tasks:current.tasks.filter(t=>t.course_id!==course.id),
          notes:current.notes.map(n=>n.course_id===course.id||deletedLessonIds.has(n.lesson_id)?{...n,course_id:null,lesson_id:null,course_title:null,lesson_title:null}:n),
          flashcards:current.flashcards.map(f=>f.course_id===course.id||deletedLessonIds.has(f.lesson_id)?{...f,course_id:null,lesson_id:null,lesson_title:null}:f),
        };
      });
      if(remote)await refreshRemote();
      setModal(null);
      const nextRoute=redirectTo||(["course","proposal","lesson"].includes(page)?"courses":null);
      if(nextRoute)go(nextRoute);
      flashToast(course.status==="proposal"?"Proposal deleted.":"Course deleted. Your notes and flashcards are kept.");
    }catch(error){
      const msg=error?.message||"The course could not be deleted. Your saved course is unchanged.";
      setDeleteCourseError(msg);
      flashToast(msg);
    }finally{
      setDeletingCourseId(null);
    }
  };
  const rateCard=async(card,rating)=>{try{if(remote)await request(`flashcards/${card.id}/review`,{method:"POST",body:JSON.stringify({rating})});const days=rating==="Again"?0:rating==="Hard"?1:rating==="Good"?3:7;updateData(c=>({...c,flashcards:c.flashcards.map(x=>x.id===card.id?{...x,due_at:new Date(Date.now()+Math.max(days*86400000,10*60000)).toISOString()}:x)}));if(remote)await refreshRemote();}catch(error){flashToast(error.message);}};
  const addFlashcard=async(card)=>{try{if(remote){const result=await request("flashcards",{method:"POST",body:JSON.stringify(card)});updateData(c=>({...c,flashcards:[result.flashcard,...c.flashcards]}));}else updateData(c=>({...c,flashcards:[{...card,id:`f-${Date.now()}`,due_at:new Date().toISOString()},...c.flashcards]}));flashToast("Flashcard added.");}catch(error){flashToast(error.message);}};
  const sendTutor=async({mode,prompt,attempt})=>{if(!prompt.trim())return null;if(!remote){flashToast("Sign in to connect the AI tutor.");return null;}try{const r=await request("tutor",{method:"POST",body:JSON.stringify({mode,prompt,attempt,lessonId:activeLesson?.id})});return {text:r.reply,structured:r.structured||null,mode:r.mode||mode,source:r.source,model:r.model||null,failoverCount:Number(r.failoverCount||0),sources:Array.isArray(r.sources)?r.sources:[]};}catch(error){const message=error?.message||"The tutor could not complete your request.";flashToast(message);return {error:message};}};
  const submitSearch=async(event)=>{event.preventDefault();if(!queryText.trim())return;try{if(remote){const result=await request(`search?q=${encodeURIComponent(queryText)}`);setSearchResults(result);}else{const q=queryText.toLowerCase();setSearchResults({courses:data.courses.filter(c=>c.title.toLowerCase().includes(q)),notes:data.notes.filter(n=>(n.title+n.body).toLowerCase().includes(q)),lessons:lessons.filter(l=>(l.title+l.objective).toLowerCase().includes(q)),flashcards:data.flashcards.filter(c=>(c.front+c.back).toLowerCase().includes(q))});}go("search");}catch(error){flashToast(error.message);}};
  const openAccount=useCallback((mode="login")=>{setLoginMode(mode);setAuthError("");setAuthMessage("");setModal(null);if(page!=="login"&&page!=="signup"&&page!=="auth"){setReturnPage(page||"home");}go(mode==="signup"?"signup":"login");},[go,page]);
  const authSubmit=async(e)=>{
    e.preventDefault();
    setAuthError("");
    setAuthMessage("");
    setAuthBusy(true);
    const form=new FormData(e.currentTarget);
    const body=Object.fromEntries(form.entries());
    try{
      if(loginMode==="forgot"){
        await request("auth/forgot-password",{method:"POST",body:JSON.stringify(body)});
        setAuthMessage("If that account exists, a reset link has been sent.");
        return;
      }
      const result=await request(`auth/${loginMode}`,{method:"POST",body:JSON.stringify(body)});
      if(loginMode==="signup")flashToast("Account ready. You can start learning.");
      setUser(result.user);
      setRemote(true);
      await refreshRemote(result.user);
      setModal(null);
      const resumeGoal=Boolean(sessionStorage.getItem("learnos.goal.draft"));
      const dest=resumeGoal?"goal":(returnPage&&returnPage!=="login"&&returnPage!=="signup"&&returnPage!=="auth"?returnPage:"home");
      go(dest);
    }catch(error){
      setAuthError(error.message);
    }finally{
      setAuthBusy(false);
    }
  };
  const logout=async()=>{
    try{if(remote)await request("auth/logout",{method:"POST",body:"{}"});}catch(_){}
    try{localStorage.removeItem("learnos.remote_cache");}catch(_){}
    setUser(null);
    setRemote(false);
    setData(loadSaved());
    go("home");
    flashToast("Signed out.");
  };
  const mobileToolPage=toolNavItems.some(([name])=>name===page);
  const nav=(name,label,glyph)=> <button key={name} className={`nav-link ${page===name?"active":""}`} type="button" onClick={()=>{setMobileMoreOpen(false);go(name);}} aria-current={page===name?"page":undefined} aria-label={label} title={label}><span className="nav-icon"><Icon name={glyph} size={19}/></span><span>{label}</span></button>;

  if(page==="login"||page==="signup"||page==="auth"){
    return <>
      {(syncing||activeRequests>0||busy)&&<div className="global-progress-bar" role="progressbar" aria-label="Loading workspace data"/>}
      <LoginPage loginMode={loginMode} setLoginMode={setLoginMode} authSubmit={authSubmit} authError={authError} authMessage={authMessage} setAuthError={setAuthError} setAuthMessage={setAuthMessage} go={go} user={user} logout={logout} returnPage={returnPage} authBusy={authBusy} />
      {toast&&<div className="toast show fixed z-50" role="status" aria-live="polite">{toast}</div>}
    </>;
  }

  return <div className="app-shell flex min-h-screen">
    {(syncing||activeRequests>0||busy)&&<div className="global-progress-bar" role="progressbar" aria-label="Loading workspace data"/>}
    <aside className="sidebar sticky top-0 h-screen flex flex-col overflow-hidden" aria-label="Main navigation">
      <div className="brand-row flex items-center gap-3"><div className="brand-mark grid place-items-center">✦</div><div className="brand-name">Drizzlearn</div><span className="brand-ai">AI</span></div>
      <div className="nav-section flex flex-col"><div className="nav-label">Workspace</div><nav className="nav-list grid gap-1.5" aria-label="Workspace">{primaryNavItems.map(([name,label,glyph])=>nav(name,label,glyph))}</nav></div>
      <div className="nav-section nav-tools-section flex flex-col"><div className="nav-label">Study tools</div><nav className="nav-list grid gap-1.5" aria-label="Study tools">{toolNavItems.map(([name,label,glyph])=>nav(name,label,glyph))}</nav></div>
      <button className={`nav-link mobile-more-trigger ${mobileMoreOpen||mobileToolPage?"active":""}`} type="button" aria-label="More study tools" aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu" onClick={()=>setMobileMoreOpen(open=>!open)}><span className="nav-icon"><Icon name="more" size={19}/></span><span>More</span></button>
      <div className="sidebar-spacer flex-1" />
      <button className="tutor-card relative overflow-hidden" type="button" onClick={()=>go("tutor")} aria-label="Open AI Tutor"><span className="tutor-orb" aria-hidden="true"/><strong className="tutor-card-title">AI Tutor</strong><span className="tutor-card-copy">Ask questions, get explanations and work through difficult concepts.</span><span className="tutor-open flex items-center justify-between">Open tutor <span className="round-arrow grid place-items-center">↗</span></span></button>
    </aside>
    {mobileMoreOpen&&<><button className="mobile-more-scrim fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" type="button" aria-label="Close study tools menu" onClick={()=>setMobileMoreOpen(false)}/><nav className="mobile-more-menu z-50" id="mobile-more-menu" aria-label="More study tools">{toolNavItems.map(([name,label,glyph])=>nav(name,label,glyph))}</nav></>}
    <main className="main flex-1 min-w-0">
      <header className="topbar flex items-center justify-end gap-3.5 mb-7">
        {(syncing||activeRequests>0||busy)&&<span className="sync-indicator flex items-center gap-1.5 text-xs" role="status" aria-live="polite"><span className="btn-spinner"/><span>Loading...</span></span>}
        <form className="top-search flex items-center gap-2.5" onSubmit={submitSearch}><Icon name="search"/><input value={queryText} onChange={e=>setQueryText(e.target.value)} type="search" placeholder="Search lessons and tools" aria-label="Search lessons and tools" /></form>
        <button className={`avatar grid place-items-center ${!(user?.fullName||data.settings.fullName)?"logged-out":""}`} type="button" aria-label={user?.fullName||data.settings.fullName||"Sign in"} title={user?.fullName||data.settings.fullName||"Sign in to your account"} onClick={()=>user?go("settings"):openAccount()}>{(user?.fullName||data.settings.fullName||"?").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}</button>
      </header>
      <PageContent page={page} data={data} setData={setData} user={user} setUser={setUser} remote={remote} setRemote={setRemote} logout={logout} openAccount={openAccount} activeCourse={activeCourse} lessons={lessons} activeLesson={activeLesson} dueCards={dueCards} nextTask={nextTask} stats={stats} progressPercent={progressPercent} pendingTasks={pendingTasks} proposal={proposal} setProposal={setProposal} busy={busy} generationProgress={generationProgress} generationError={generationError} setGenerationError={setGenerationError} courseFilter={courseFilter} setCourseFilter={setCourseFilter} go={go} openLesson={openLesson} submitGoal={submitGoal} approveProposal={approveProposal} submitCheckpoint={submitCheckpoint} saveNote={saveNote} draftNote={draftNote} deleteNote={deleteNote} confirmDeleteCourse={confirmDeleteCourse} deletingCourseId={deletingCourseId} rateCard={rateCard} addFlashcard={addFlashcard} sendTutor={sendTutor} updateData={updateData} request={request} requestStream={requestStream} refreshRemote={refreshRemote} flashToast={flashToast} setModal={setModal} setActiveLessonId={setActiveLessonId} setSearchResults={setSearchResults} searchResults={searchResults} setLoginMode={setLoginMode} setModalState={setModal} generatingCourseId={generatingCourseId} syncing={syncing} activeRequests={activeRequests} />
      <footer className="app-footer flex items-center justify-between text-sm"><span>Drizzlearn</span><button type="button" onClick={()=>go("settings")}>Settings</button></footer>
    </main>
    {toast&&<div className="toast show fixed z-50" role="status" aria-live="polite">{toast}</div>}
    {modal&&<Modal modal={modal} onClose={()=>{if(!deletingCourseId){setDeleteCourseError("");setModal(null);}}} onApprove={()=>approveProposal(true)} onDeleteCourse={deleteCourse} deletingCourse={Boolean(deletingCourseId)} deleteCourseError={deleteCourseError} loginMode={loginMode} setLoginMode={setLoginMode} authSubmit={authSubmit} authError={authError} authMessage={authMessage} setAuthError={setAuthError} setAuthMessage={setAuthMessage} logout={logout} authBusy={authBusy} />}
  </div>;
}

function PageContent(props){
  const {page,data,activeCourse,lessons,activeLesson,dueCards,nextTask,stats,progressPercent,pendingTasks,proposal,busy,go,openLesson}=props;
  const common={...props};
  const titles={courses:"My Courses",today:"Today’s plan","study-together":"Study Together",notes:"Notes",flashcards:"Flashcards",practice:"Practice",progress:"Your progress",tutor:"AI Tutor",settings:"Settings",goal:"Build a learning plan",proposal:"Your course proposal",course:"Course roadmap",lesson:"Lesson workspace",search:"Search results",verify:"Verify your email", "reset-password":"Choose a new password",verified:"Email verified",login:"Account",signup:"Create account",auth:"Account"};
  if(page==="home")return <Home {...common} />;
  return <div className="workspace-page">
    <div className="page-heading"><div>{page==="lesson"&&<span className="eyebrow">{activeLesson?.moduleTitle||"Learning session"}</span>}<h1>{page==="lesson"?activeLesson?.title||"Lesson":titles[page]||"Drizzlearn"}</h1></div>{page==="courses"&&<button className="primary-btn" onClick={()=>go("goal")}><Icon name="plus" size={14}/>Create a course</button>}</div>
    {page==="courses"&&<CoursesPage {...common}/>}
    {page==="today"&&<TodayPage {...common}/>}
    {page==="study-together"&&<StudyTogetherPage {...common}/>}
    {page==="notes"&&<NotesPage {...common}/>}
    {page==="flashcards"&&<FlashcardsPage {...common}/>}
    {page==="practice"&&<PracticePage {...common}/>}
    {page==="progress"&&<ProgressPage {...common}/>}
    {page==="tutor"&&<TutorPage {...common}/>}
    {page==="settings"&&<SettingsPage {...common}/>}
    {page==="goal"&&<GoalPage {...common}/>}
    {page==="proposal"&&<ProposalPage {...common}/>}
    {page==="course"&&<CoursePage {...common}/>}
    {page==="lesson"&&<LessonPage {...common}/>}
    {page==="search"&&<SearchPage {...common}/>}
    {page==="verify"&&<VerifyPage {...common}/>}
    {page==="reset-password"&&<ResetPasswordPage {...common}/>}
    {(page==="login"||page==="signup"||page==="auth")&&<LoginPage {...common}/>}
    {page==="verified"&&<EmptyState title="Your email is verified" body="Your Drizzlearn account is ready. Go back to your workspace and keep learning." action="Go to home" onAction={()=>go("home")}/>}
    {!titles[page]&&<EmptyState title="This page is ready for your next course" body="Create a learning goal to start building your workspace." action="Create a course" onAction={()=>go("goal")}/>}
  </div>;
}
function readGoalDraft(){try{return JSON.parse(sessionStorage.getItem("learnos.goal.draft")||"{}");}catch{return {};}}

const LOCAL_ROOMS_KEY="learnos.study-rooms.v1";
const readLocalRooms=()=>{try{return typeof window==="undefined"?[]:JSON.parse(localStorage.getItem(LOCAL_ROOMS_KEY)||"[]");}catch{return [];}};
const persistLocalRooms=(rooms)=>{try{localStorage.setItem(LOCAL_ROOMS_KEY,JSON.stringify(rooms));}catch{}}
const roomFromApi=(r)=>({...r,code:r.code||r.room_code,title:r.title||r.room_title,topic:r.topic||"",focusMinutes:Number(r.focusMinutes??r.focus_minutes??25),breakMinutes:Number(r.breakMinutes??r.break_minutes??5),longBreakMinutes:Number(r.longBreakMinutes??r.long_break_minutes??15),longBreakEvery:Number(r.longBreakEvery??r.long_break_every??4),completedFocuses:Number(r.completedFocuses??r.completed_focuses??0),phaseStartedAt:r.phaseStartedAt||r.phase_started_at||null,phaseEndsAt:r.phaseEndsAt||r.phase_ends_at||null,pausedRemainingSeconds:Number(r.pausedRemainingSeconds??r.paused_remaining_seconds??0),participants:r.participants||[]});
function nextRoomPhase(room,now){
  if(room.phase==="focus"){
    const completedFocuses=room.completedFocuses+1,phase=completedFocuses%room.longBreakEvery===0?"long_break":"short_break",minutes=phase==="long_break"?room.longBreakMinutes:room.breakMinutes;
    return {...room,phase,completedFocuses,phaseStartedAt:new Date(now).toISOString(),phaseEndsAt:new Date(now+minutes*60000).toISOString(),pausedRemainingSeconds:0};
  }
  return {...room,phase:"focus",phaseStartedAt:new Date(now).toISOString(),phaseEndsAt:new Date(now+room.focusMinutes*60000).toISOString(),pausedRemainingSeconds:0};
}
function advanceLocalRoom(room,now=Date.now()){
  let current=room,guard=0;
  while(current&&["focus","short_break","long_break"].includes(current.phase)&&current.phaseEndsAt&&Date.parse(current.phaseEndsAt)<=now&&guard++<100){current=nextRoomPhase(current,Date.parse(current.phaseEndsAt));}
  return current;
}
function controlLocalRoom(room,action,now=Date.now()){
  const current=advanceLocalRoom(room,now);
  if(action==="start"&&current.phase==="idle")return {...current,phase:"focus",phaseStartedAt:new Date(now).toISOString(),phaseEndsAt:new Date(now+current.focusMinutes*60000).toISOString()};
  if(action==="pause"&&["focus","short_break","long_break"].includes(current.phase))return {...current,pausedPhase:current.phase,pausedRemainingSeconds:Math.max(0,Math.ceil((Date.parse(current.phaseEndsAt)-now)/1000)),phase:"paused",phaseEndsAt:null};
  if(action==="resume"&&current.phase==="paused")return {...current,phase:current.pausedPhase||"focus",phaseStartedAt:new Date(now).toISOString(),phaseEndsAt:new Date(now+current.pausedRemainingSeconds*1000).toISOString(),pausedPhase:null};
  if(action==="reset")return {...current,phase:"idle",phaseStartedAt:null,phaseEndsAt:null,pausedPhase:null,pausedRemainingSeconds:0,completedFocuses:0};
  if(action==="skip"&&current.phase==="focus")return nextRoomPhase(current,now);
  if(action==="skip"&&["short_break","long_break"].includes(current.phase))return {...current,phase:"focus",phaseStartedAt:new Date(now).toISOString(),phaseEndsAt:new Date(now+current.focusMinutes*60000).toISOString(),pausedRemainingSeconds:0};
  return current;
}
function roomPhaseName(phase){return ({idle:"Ready when you are",focus:"Focus session",short_break:"Short break",long_break:"Long break",paused:"Paused"})[phase]||"Focus session";}
function roomSeconds(room,now){return room.phase==="paused"?room.pausedRemainingSeconds:room.phaseEndsAt?Math.max(0,Math.ceil((Date.parse(room.phaseEndsAt)-now)/1000)):room.focusMinutes*60;}
function formatClock(totalSeconds){const value=Math.max(0,totalSeconds);return `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;}

function StudyTogetherPage(p){
  const selfName=p.user?.fullName||p.data.settings?.fullName||"You";
  const [rooms,setRooms]=useState(readLocalRooms),[room,setRoom]=useState(null),[joinCode,setJoinCode]=useState(""),[roomError,setRoomError]=useState(""),[roomsLoading,setRoomsLoading]=useState(true),[roomsLoadError,setRoomsLoadError]=useState(""),[reloadRooms,setReloadRooms]=useState(0),[now,setNow]=useState(Date.now()),[form,setForm]=useState({title:"",topic:p.activeCourse?.title||"",focusMinutes:25,breakMinutes:5,longBreakMinutes:15,longBreakEvery:4});
  const rememberRoom=(next)=>{setRoom(next);if(!p.remote){const nextRooms=[next,...readLocalRooms().filter(x=>x.code!==next.code)];persistLocalRooms(nextRooms);setRooms(nextRooms);}};
  const openRoom=async(code,join=false)=>{
    const clean=String(code||"").trim().toUpperCase();if(!clean)return;
    setRoomError("");
    try{
      let next;
      if(p.remote){const result=await p.request(join?`study-rooms/${clean}/join`:`study-rooms/${clean}`,{method:join?"POST":"GET",...(join?{body:JSON.stringify({})}:{})});next=roomFromApi(result.room);}
      else {next=readLocalRooms().find(x=>x.code===clean)||null;if(!next){setRoomError("No room with that code could be found. Sign in to share rooms across devices.");return;}if(!next.participants.some(m=>m.name===selfName))next={...next,participants:[...next.participants,{id:`guest-${Date.now()}`,name:selfName,isOnline:true}]};}
      rememberRoom(next);setJoinCode(clean);if(typeof window!=="undefined")location.hash=`/study-together?room=${encodeURIComponent(clean)}`;
      if(p.remote){const list=await p.request("study-rooms");setRooms((list.rooms||[]).map(roomFromApi));}
    }catch(error){setRoomError(error.message||"This room could not be opened.");}
  };
  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      setRoomsLoading(true);setRoomsLoadError("");setRoomError("");
      const roomParam=typeof window==="undefined"?"":new URLSearchParams(location.hash.split("?")[1]||"").get("room")||"";
      if(p.remote){
        try{const list=await p.request("study-rooms");if(cancelled)return;setRooms((list.rooms||[]).map(roomFromApi));}
        catch(error){if(!cancelled)setRoomsLoadError(error.message||"Your rooms could not be loaded.");}
        if(!cancelled&&roomParam){try{const result=await p.request(`study-rooms/${roomParam.toUpperCase()}/join`,{method:"POST",body:JSON.stringify({})});if(!cancelled)setRoom(roomFromApi(result.room));}catch(error){if(!cancelled)setRoomError(error.message||"This room could not be opened.");}}
      }else {const local=readLocalRooms();if(cancelled)return;setRooms(local);if(roomParam){const found=local.find(x=>x.code===roomParam.toUpperCase());if(found)setRoom(found);else setRoomError("No room with that code could be found. Sign in to share rooms across devices.");}}
      if(!cancelled)setRoomsLoading(false);
    };
    load();return()=>{cancelled=true;};
  },[p.remote,reloadRooms]);
  useEffect(()=>{const tick=()=>{const at=Date.now();setNow(at);if(!p.remote)setRoom(current=>{if(!current)return current;const advanced=advanceLocalRoom(current,at);if(advanced!==current){const nextRooms=[advanced,...readLocalRooms().filter(x=>x.code!==advanced.code)];persistLocalRooms(nextRooms);setRooms(nextRooms);}return advanced;});};const id=window.setInterval(tick,1000);return()=>window.clearInterval(id);},[p.remote]);
  useEffect(()=>{if(!p.remote||!room?.code)return;let alive=true;const sync=async()=>{try{const result=await p.request(`study-rooms/${room.code}`);if(alive){const fresh=roomFromApi(result.room);setRoom(fresh);setRooms(current=>[fresh,...current.filter(x=>x.code!==fresh.code)]);}}catch{}};const id=window.setInterval(sync,7000);return()=>{alive=false;window.clearInterval(id);};},[p.remote,room?.code]);
  const createRoom=async(event)=>{
    event.preventDefault();setRoomError("");
    const config={...form,title:String(form.title||"").trim(),topic:String(form.topic||"").trim(),focusMinutes:Number(form.focusMinutes),breakMinutes:Number(form.breakMinutes),longBreakMinutes:Number(form.longBreakMinutes),longBreakEvery:Number(form.longBreakEvery)};
    if(config.title.length<2){setRoomError("Give your room a name with at least two characters.");return;}
    try{
      let created;
      if(p.remote){const result=await p.request("study-rooms",{method:"POST",body:JSON.stringify(config)});created=roomFromApi(result.room);}
      else {const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",code=Array.from({length:8},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join("");created={...config,code,phase:"idle",completedFocuses:0,phaseStartedAt:null,phaseEndsAt:null,pausedRemainingSeconds:0,participants:[{id:"self",name:selfName,role:"owner",isOnline:true}],isOwner:true,createdAt:new Date().toISOString()};}
      rememberRoom(created);if(typeof window!=="undefined")location.hash=`/study-together?room=${created.code}`;
      if(p.remote){const list=await p.request("study-rooms");setRooms((list.rooms||[]).map(roomFromApi));}
    }catch(error){setRoomError(error.message||"The room could not be created.");}
  };
  const applyTimer=async(action)=>{
    if(!room)return;
    try{if(p.remote){const result=await p.request(`study-rooms/${room.code}/timer`,{method:"POST",body:JSON.stringify({action})});rememberRoom(roomFromApi(result.room));}else rememberRoom(controlLocalRoom(room,action));}
    catch(error){setRoomError(error.message||"The timer could not be updated.");}
  };
  const copyInvite=async()=>{const url=typeof window==="undefined"?"":`${location.origin}${location.pathname}#/study-together?room=${room.code}`;try{await navigator.clipboard.writeText(url);p.flashToast("Invite link copied.");}catch{setRoomError(`Share this room code: ${room.code}`);}};
  const leaveRoom=()=>{setRoom(null);setRoomError("");if(typeof window!=="undefined")location.hash="/study-together";};
  const seconds=room?roomSeconds(room,now):0,timedPhase=room?.phase==="paused"?room.pausedPhase:room?.phase,timerLength=timedPhase==="focus"?room?.focusMinutes:timedPhase==="long_break"?room?.longBreakMinutes:room?.breakMinutes,progress=room&&timerLength&&(["focus","short_break","long_break"].includes(room.phase)||room.phase==="paused")?Math.max(0,Math.min(100,100-(seconds/(timerLength*60))*100)):0;
  return <section className="study-together-workspace flex flex-col gap-6">
    {room?<>
      <div className="study-room-toolbar flex items-center justify-between gap-3"><button className="quiet-btn" type="button" onClick={leaveRoom}>← All rooms</button><span className="room-live-label inline-flex items-center gap-2"><i/> Shared room</span></div>
      <div className="study-room-layout grid gap-6">
        <section className="panel study-timer-panel flex flex-col p-6 gap-6">
          <div className="study-room-heading flex items-start justify-between gap-4"><div><span className="eyebrow">{room.topic||"Study room"}</span><h2>{room.title}</h2><p>{roomPhaseName(room.phase)} · Focus {room.focusMinutes} min / break {room.breakMinutes} min</p></div><button className="quiet-btn room-code-button flex flex-col items-center" onClick={copyInvite} type="button"><span>ROOM CODE</span><strong>{room.code}</strong><small>Copy invite ↗</small></button></div>
          <div className={`pomodoro-clock flex items-center justify-center ${room.phase}`}>
            <div className="pomodoro-progress flex items-center justify-center" style={{"--timer-progress":`${progress}%`}}><div><span>{roomPhaseName(room.phase)}</span><strong aria-live="off">{formatClock(seconds)}</strong><small>{room.completedFocuses} focus session{room.completedFocuses===1?"":"s"} complete</small></div></div>
          </div>
          <div className="pomodoro-controls flex items-center justify-center gap-3" aria-label="Pomodoro controls">
            {room.phase==="paused"?<button className="primary-btn" onClick={()=>applyTimer("resume")} type="button">▶ Resume</button>:room.phase==="idle"?<button className="primary-btn" onClick={()=>applyTimer("start")} type="button">▶ Start focus</button>:<button className="primary-btn" onClick={()=>applyTimer("pause")} type="button">Ⅱ Pause</button>}
            <button className="quiet-btn" onClick={()=>applyTimer("skip")} type="button" disabled={room.phase==="idle"}>Skip phase ↗</button>
            <button className="quiet-btn" onClick={()=>applyTimer("reset")} type="button">Reset</button>
          </div>
          <div className="pomodoro-cycle flex items-center justify-center gap-2" aria-label="Pomodoro cycle">{Array.from({length:room.longBreakEvery},(_,i)=><span key={i} className={i<room.completedFocuses%room.longBreakEvery?"complete":""} title={`Focus ${i+1}`}/>) }<small>Long break every {room.longBreakEvery} sessions</small></div>
        </section>
        <aside className="study-room-aside flex flex-col gap-4">
          <section className="panel participants-panel flex flex-col p-5 gap-3"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="people"/>Studying together</div><span className="count-pill">{room.participants?.filter(m=>m.isOnline!==false).length||1}</span></div><div className="room-participants flex flex-col gap-2">{(room.participants?.length?room.participants:[{name:selfName,isOnline:true}]).map((member,i)=><div className="room-person flex items-center gap-3 p-2" key={member.id||member.userId||i}><span className="room-avatar grid place-items-center">{String(member.name||member.fullName||"S").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}</span><span><strong>{member.name||member.fullName||"Study partner"}</strong><small><i className={member.isOnline===false?"away":""}/>{member.isOnline===false?"Away":"In this room"}</small></span>{member.role==="owner"&&<em>HOST</em>}</div>)}</div><button className="primary-btn invite-button" onClick={copyInvite} type="button">Invite a study partner <span>↗</span></button></section>
          <section className="panel room-guidelines flex flex-col p-5 gap-2"><div className="panel-title flex items-center gap-2"><Icon name="spark"/>A shared rhythm</div><p>Work quietly through the focus session, then take the break together. Everyone in the room can pause or skip the timer.</p><div className="room-duration-row flex items-center justify-between text-sm"><span>Focus</span><strong>{room.focusMinutes} min</strong><span>Break</span><strong>{room.breakMinutes} min</strong></div></section>
        </aside>
      </div>
      {roomError&&<p className="room-error" role="alert">{roomError}</p>}
    </>:<>
      <div className="study-together-grid grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="panel create-room-panel flex flex-col p-6 gap-4"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="people"/>Create a room</div><span className="room-step">01</span></div><p className="room-panel-intro">Set a shared focus rhythm and invite someone to join your next session.</p>
          <form className="room-create-form flex flex-col gap-3" onSubmit={createRoom}>
            <label>Room name<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} maxLength="80" placeholder="e.g. Evening study session"/></label>
            <label>What are you studying?<input value={form.topic} onChange={e=>setForm({...form,topic:e.target.value})} maxLength="120" placeholder="Topic or course"/></label>
            <div className="room-duration-fields grid grid-cols-2 sm:grid-cols-4 gap-2.5"><label>Focus<select value={form.focusMinutes} onChange={e=>setForm({...form,focusMinutes:Number(e.target.value)})}>{[15,20,25,30,45,50].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label><label>Break<select value={form.breakMinutes} onChange={e=>setForm({...form,breakMinutes:Number(e.target.value)})}>{[5,10,15].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label><label>Long break<select value={form.longBreakMinutes} onChange={e=>setForm({...form,longBreakMinutes:Number(e.target.value)})}>{[10,15,20,30].map(n=><option key={n} value={n}>{n} minutes</option>)}</select></label><label>Long break after<select value={form.longBreakEvery} onChange={e=>setForm({...form,longBreakEvery:Number(e.target.value)})}>{[2,3,4,5].map(n=><option key={n} value={n}>{n} focus sessions</option>)}</select></label></div>
            <button className="primary-btn" type="submit">Create study room <span>↗</span></button>
          </form>
        </section>
        <section className="panel join-room-panel flex flex-col p-6 gap-4"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="arrow"/>Join a room</div><span className="room-step">02</span></div><p className="room-panel-intro">Have an invite code? Enter it to join the shared timer and study session.</p><form className="room-join-form flex flex-col gap-3" onSubmit={e=>{e.preventDefault();openRoom(joinCode,true);}}><label htmlFor="study-room-code">Room code</label><div className="flex items-center gap-2"><input id="study-room-code" value={joinCode} onChange={e=>setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8))} placeholder="8 character code" maxLength="8"/><button className="primary-btn" type="submit" disabled={joinCode.length!==8}>Join</button></div></form></section>
      </div>
      {roomError&&<p className="room-error" role="alert">{roomError}</p>}
      <section className="saved-rooms-section flex flex-col gap-4 mt-2"><div className="saved-rooms-heading flex items-center justify-between gap-4"><div><span className="eyebrow">Your sessions</span><h2>Recent rooms</h2></div>{!roomsLoading&&!roomsLoadError&&<span className="text-sm text-learnos-muted">{rooms.length} room{rooms.length===1?"":"s"}</span>}</div>{roomsLoading?<div className="empty-rooms flex items-center gap-3.5"><span className="empty-rooms-icon grid place-items-center"><Icon name="clock"/></span><div><strong>Loading your rooms…</strong><p>Checking for rooms you’ve created or joined.</p></div></div>:roomsLoadError?<div className="empty-rooms flex items-center gap-3.5" role="alert"><span className="empty-rooms-icon grid place-items-center"><Icon name="spark"/></span><div><strong>Your rooms could not be loaded</strong><p>{roomsLoadError}</p><button className="text-button" type="button" onClick={()=>setReloadRooms(value=>value+1)}>Try again ↻</button></div></div>:rooms.length?<div className="saved-room-list grid grid-cols-1 md:grid-cols-2 gap-3.5">{rooms.map(saved=><button type="button" className="saved-room-card flex items-center gap-3 p-3.5 text-left cursor-pointer" key={saved.code} onClick={()=>openRoom(saved.code)}><span className="saved-room-icon grid place-items-center"><Icon name="people"/></span><span className="saved-room-copy flex flex-col flex-1 min-w-0"><strong>{saved.title}</strong><small>{saved.topic||"Study session"} · {saved.participants?.length||1} participant{(saved.participants?.length||1)===1?"":"s"}</small></span><span className="saved-room-status text-sm">{roomPhaseName(saved.phase||"idle")}</span><span className="saved-room-open text-sm">↗</span></button>)}</div>:<div className="empty-rooms flex items-center gap-3.5"><span className="empty-rooms-icon grid place-items-center"><Icon name="clock"/></span><div><strong>Your rooms will show up here</strong><p>Create a room for your next session, or join with a code from a study partner.</p></div></div>}</section>
    </>}
  </section>;
}

function Home(p){
  const {data,activeCourse,lessons,dueCards,nextTask,stats,progressPercent,go,openLesson,setModal}=p;
  const [timelinePeriod,setTimelinePeriod]=useState("week");
  const done=data.tasks.filter(t=>t.status==="completed").length,plannedToday=data.tasks.filter(t=>new Date(t.scheduled_at||0).toDateString()===new Date().toDateString());
  const weekDays=Array.from({length:7},(_,i)=>{const date=new Date();const day=(date.getDay()+6)%7;date.setDate(date.getDate()-day+i);return date;});
  const moduleIcons=["book","cards","spark","progress"];
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
    <section className="hero grid items-center gap-6" id="generator">
      <div className="hero-copy flex flex-col justify-center"><h1>What do you want to <span>learn?</span></h1><form className="generate-row flex items-center gap-2.5 max-w-2xl" onSubmit={e=>{e.preventDefault();const value=new FormData(e.currentTarget).get("topic");sessionStorage.setItem("learnos.goal.prefill",String(value||""));p.setModalState(null);go("goal");}}><input name="topic" defaultValue={activeCourse?.title||""} aria-label="Topic to learn" placeholder="What do you want to learn?"/><button className="primary-btn" type="submit" disabled={p.busy}>{p.busy?<><span className="btn-spinner"/> Generating…</>:<>Generate course <span>↗</span></>}</button></form><div className="suggestions flex flex-wrap items-center gap-2" aria-label="Suggested topics"><span>Try:</span>{["Web development","Data analysis","Writing","A subject you’re curious about"].map((topic,i)=><button className="suggestion cursor-pointer" type="button" key={topic} onClick={()=>{const input=document.querySelector('.generate-row input[name="topic"]');if(input)input.value=topic;}}>{topic}</button>)}</div></div>
      <div className="hero-art relative flex items-center justify-center overflow-hidden" aria-label="AI learning companion illustration"><div className="orbital-blob"/><div className="float-chip one"><span>✧</span> Roadmap</div><div className="float-chip two"><span>⌘</span> Interactive practice</div><div className="float-chip three"><span>✦</span> AI tutor</div><div className="bot"><span className="bot-ear left"/><span className="bot-ear right"/><div className="bot-face"><span>⌃</span><span>⌃</span></div></div></div>
    </section>
    <section className="feature-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5" aria-label="Learning tools">
      <FeatureCard featured icon="progress" title="Roadmap" detail="A structured learning path" action={()=>go("course")}/>
      <FeatureCard icon="calendar" title="Timeline" detail="Daily and weekly plan" action={()=>go("today")}/>
      <FeatureCard icon="cards" title="Flashcards" detail={`${dueCards.length} due for review`} action={()=>go("flashcards")}/>
      <FeatureCard icon="notes" title="AI Notes" detail="Organized lesson notes" action={()=>go("notes")}/>
      <FeatureCard icon="practice" title="Practice" detail="Checkpoints and evidence" action={()=>go("practice")}/>
    </section>
    <section className="dashboard-grid grid gap-5 items-start">
      <div className="left-stack flex flex-col gap-4.5">
        <section className="panel course-panel flex flex-col" id="course"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="book"/>Current course</div><button className="quiet-btn grid place-items-center" aria-label="View courses" onClick={()=>go("courses")}>↗</button></div>
          {activeCourse?<div className="course-content grid items-center gap-5"><div className="course-art relative overflow-hidden" aria-hidden="true"><span>LEARNING PATH</span></div><div className="course-info flex flex-col"><h2>{activeCourse.title}</h2><div className="course-meta flex flex-wrap items-center gap-3.5 text-sm"><span><Icon name="clock"/>{activeCourse.target_weeks||activeCourse.durationWeeks||8} Weeks</span><span>▧ {lessons.length} Lessons</span><span>{activeCourse.current_level||activeCourse.currentLevel||"Beginner"}</span></div><div className="course-progress-row flex items-center gap-2.5"><div className="progress-track flex-1 overflow-hidden" role="progressbar" aria-label="Completed study tasks" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100"><div className="progress-fill" style={{width:`${progressPercent}%`}}/></div><span className="progress-number">{progressPercent}%</span><button className="continue-btn" onClick={()=>nextTask?openLesson(nextTask.lesson_id):go("course")}>{nextTask?"Continue ↗":"Open course ↗"}</button></div><p className="course-progress-note text-sm text-learnos-muted">{done} of {stats.total} planned sessions complete</p></div></div>:<div className="panel-empty flex flex-col items-center justify-center p-6 text-center"><strong>Your learning path starts with a goal.</strong><p>Build a course around what you want to be able to do.</p><button className="primary-btn" onClick={()=>go("goal")}>Create learning goal</button></div>}
        </section>
        <section className="panel roadmap-panel flex flex-col" id="roadmap"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="spark"/>Learning roadmap</div><button className="quiet-btn grid place-items-center" aria-label="Open full roadmap" onClick={()=>go("course")}>↗</button></div>
          {activeCourse?<ol className="roadmap-list flex flex-col relative">{activeCourse.modules.slice(0,5).map((m,i)=>{const complete=isModuleDone(m);const isActive=i===activeModuleIndex;const targetLesson=m.lessons?.find(l=>!isLessonDone(l.id))||m.lessons?.[0];return <li key={m.id||i} className={`module grid items-center gap-2.5 ${isActive?"active":""} ${complete?"complete":""}`}><span className="module-dot"/><span className="module-icon grid place-items-center"><Icon name={moduleIcons[i%moduleIcons.length]}/></span><span className="module-copy flex flex-col min-w-0"><strong>{i+1}. {m.title}</strong><small>{complete?"Completed ✓":m.weeks||`${m.lessons?.length||1} lessons · ${m.objective}`}</small></span><button className="module-action" type="button" aria-label={`Open ${m.title}`} onClick={()=>targetLesson&&openLesson(targetLesson.id)}>{complete?"✓":isActive?"▶":"›"}</button></li>;})}</ol>:<div className="panel-empty flex flex-col items-center justify-center p-6 text-center">Create a goal to see your course roadmap.</div>}
        </section>
      </div>
      <div className="right-stack flex flex-col gap-4.5">
        <section className="panel timeline-panel flex flex-col" id="timeline"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="calendar"/>Study timeline</div><div className="segmented inline-flex gap-1 p-1"><button className={timelinePeriod==="week"?"active":""} onClick={()=>setTimelinePeriod("week")}>Week</button><button className={timelinePeriod==="month"?"active":""} onClick={()=>setTimelinePeriod("month")}>Month</button></div></div><div className="week-grid grid grid-cols-7 gap-2">{timelinePeriod==="week"?weekDays.map((day,i)=>{const tasks=data.tasks.filter(t=>new Date(t.scheduled_at||0).toDateString()===day.toDateString());const complete=tasks.length>0&&tasks.every(t=>t.status==="completed");const current=day.toDateString()===new Date().toDateString();return <div className={`day flex flex-col items-center text-center ${complete?"complete":""} ${current?"current":""}`} key={i}><span>{day.toLocaleDateString(undefined,{weekday:"short"})}</span><div className="day-state grid place-items-center w-full">{complete?"✓":tasks.length?tasks.length:"–"}</div></div>;}):Array.from({length:7},(_,i)=>{const label=`Wk ${i+1}`,tasks=data.tasks.filter(t=>{const days=(new Date(t.scheduled_at||0)-new Date())/86400000;return days>=i*7&&days<(i+1)*7;});const complete=tasks.length>0&&tasks.every(t=>t.status==="completed");return <div className={`day flex flex-col items-center text-center ${complete?"complete":""} ${i===0?"current":""}`} key={i}><span>{label}</span><div className="day-state grid place-items-center w-full">{complete?"✓":tasks.length?tasks.length:"–"}</div></div>;})}</div><div className="timeline-caption flex items-center justify-between text-sm">{plannedToday.length?`${plannedToday.length} planned session${plannedToday.length===1?"":"s"} today`:`${pendingTasksCount(data)} upcoming sessions`} · <button onClick={()=>go("today")}>View plan</button></div></section>
        {dueCards.length>0&&<section className="panel review-panel flex flex-col"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="cards"/>Review due</div><span className="due-count">{dueCards.length}</span></div><div className="review-card-body flex items-center justify-between gap-3 p-4"><div><strong>Keep key ideas fresh.</strong><p className="text-sm text-learnos-muted">About {Math.max(1,Math.round(dueCards.length*0.6))} minutes of review</p></div><button className="continue-btn" onClick={()=>go("flashcards")}>Start review ↗</button></div></section>}
        <section className="panel progress-panel flex flex-col" id="progress"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="progress"/>Your progress</div><button className="quiet-btn grid place-items-center" aria-label="View detailed progress" onClick={()=>go("progress")}>↗</button></div><div className="progress-labels"><span>Session tasks complete</span><span className="progress-evidence-badge"><Icon name="check" size={12}/>{checkpointsPassed} checkpoint{checkpointsPassed===1?"":"s"} passed</span></div><div className="overall-progress flex items-center gap-3.5"><div className="progress-track flex-1 overflow-hidden" role="progressbar" aria-label="Session tasks complete" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100"><div className="progress-fill" style={{width:`${progressPercent}%`}}/></div><strong>{progressPercent}%</strong></div><div className="stats-grid grid grid-cols-2 sm:grid-cols-4 gap-2.5"><Stat icon="play" value={lessons.length} label="Lessons"/><Stat icon="notes" value={stats.notes} label="Notes"/><Stat icon="cards" value={stats.flashcards} label="Flashcards"/><Stat icon="practice" value={stats.attempts} label="Practice"/></div></section>
      </div>
    </section>
  </>;
}
function pendingTasksCount(data){return data.tasks.filter(t=>t.status!=="completed").length;}
function FeatureCard({featured,icon,title,detail,action}){return <button className={`feature-card flex items-center gap-3.5 p-4 text-left cursor-pointer transition-all ${featured?"featured":""}`} type="button" onClick={action}><span className="feature-icon grid place-items-center"><Icon name={icon}/></span><span className="flex flex-col gap-0.5 min-w-0"><strong>{title}</strong><small className="leading-snug">{detail}</small></span></button>}
function Stat({icon,value,label}){return <div className="stat flex flex-col items-center justify-center p-3 text-center gap-1"><span className="stat-icon"><Icon name={icon}/></span><strong className="tabular-nums tracking-tight">{value}</strong><small className="leading-tight text-learnos-muted">{label}</small></div>}
function Panel({title,icon,children,action}){return <section className="panel flex flex-col"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name={icon||"spark"}/>{title}</div>{action}</div>{children}</section>}
function EmptyState({title,body,action,onAction,illustration}){return <div className="empty-state flex flex-col items-center justify-center text-center p-8">{illustration?<div className="empty-illustration-wrap mb-3"><img src={illustration} alt="" className="empty-illustration-img" loading="lazy"/></div>:<span className="empty-orb grid place-items-center mb-3"><Icon name="spark" size={24}/></span>}<h2>{title}</h2><p className="max-w-md mb-4">{body}</p>{action&&<button className="primary-btn" onClick={onAction}>{action} ↗</button>}</div>}

const courseCovers=["/images/course-cover-ai.svg","/images/course-cover-systems.svg","/images/course-cover-math.svg","/images/course-cover-design.svg"];

function CoursesPage(p){
  const {data,courseFilter,setCourseFilter,go,updateData}=p;
  const visible=data.courses.filter(c=>courseFilter==="all"||c.status===courseFilter);
  return <>
    <div className="filter-row flex flex-wrap items-center gap-2" role="group" aria-label="Filter courses">{[["all","All courses"],["active","Active"],["proposal","Proposals"],["completed","Completed"]].map(([value,label])=><button key={value} className={`filter-chip cursor-pointer ${courseFilter===value?"selected":""}`} onClick={()=>setCourseFilter(value)}>{label}</button>)}</div>
    {visible.length?<div className="course-library-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{visible.map((course,i)=>{const all=course.modules?.flatMap(m=>m.lessons)||[],courseTasks=data.tasks.filter(t=>t.course_id===course.id),done=courseTasks.filter(t=>t.status==="completed").length,percent=courseTasks.length?Math.round(done/courseTasks.length*100):0;return <article className="library-course panel flex flex-col overflow-hidden" key={course.id}><div className="library-cover flex items-center justify-between p-3.5" style={{backgroundImage:`linear-gradient(rgba(17,18,29,0.7),rgba(17,18,29,0.92)), url(${courseCovers[i%courseCovers.length]})`,backgroundSize:"cover",backgroundPosition:"center"}}><span>{course.status==="proposal"?"DRAFT PLAN":"LEARNING PATH"}</span><span className={`status-pill ${course.status}`}>{course.status}</span></div><div className="library-course-content flex flex-col p-4 gap-2.5"><div className="course-meta-small flex items-center gap-1.5 text-sm">{course.current_level||course.currentLevel||"Flexible level"} <span>·</span> {course.target_weeks||course.durationWeeks||8} weeks</div><h2>{course.title}</h2><p>{course.summary||course.desired_outcome}</p><div className="course-facts flex flex-wrap items-center gap-3 text-sm"><span><Icon name="book" size={14}/>{all.length} lessons</span><span><Icon name="progress" size={14}/>{course.modules?.length||0} modules</span><span><Icon name="clock" size={14}/>{Math.round((course.estimated_minutes||0)/60)||1} hours</span></div><div className="course-progress-row flex items-center gap-2.5"><div className="progress-track flex-1 overflow-hidden"><div className="progress-fill" style={{width:`${percent}%`}}/></div><span className="progress-number">{percent}%</span></div><div className="library-actions flex items-center gap-2 mt-auto pt-2">{course.status==="proposal"?<button className="primary-btn" onClick={()=>{p.setProposal(course);updateData(x=>({...x,activeCourseId:course.id}));go("proposal");}}>Review plan ↗</button>:<button className="primary-btn" onClick={()=>{updateData(x=>({...x,activeCourseId:course.id}));go("course");}}>Open course ↗</button>}<div className="library-actions-secondary flex items-center gap-2 ml-auto"><button type="button" className="quiet-btn" aria-label={`View roadmap for ${course.title}`} onClick={()=>{updateData(x=>({...x,activeCourseId:course.id}));go(course.status==="proposal"?"proposal":"course");if(course.status==="proposal")p.setProposal(course);}}>⋯</button>{p.confirmDeleteCourse&&<button type="button" className="quiet-btn danger course-delete-btn" aria-label={`Delete ${course.title}`} disabled={p.deletingCourseId===course.id} onClick={()=>p.confirmDeleteCourse(course)}>Delete</button>}</div></div></div></article>;})}</div>:<EmptyState title="No courses yet" body="Write down the capability you want to build. Sign in to generate a course plan with lessons and practice." action="Create a learning goal" onAction={()=>go("goal")}/>}
  </>;
}

function TodayPage(p){
  const {data,updateData,openLesson,request,remote,refreshRemote,flashToast}=p;
  const {lessonOrderMap,courseOrderMap}=useMemo(()=>{
    const lessonsByOrder=new Map(),coursesByOrder=new Map();
    (data.courses||[]).forEach((course,cIdx)=>{
      if(course?.id)coursesByOrder.set(course.id,cIdx);
      (course?.modules||[]).forEach((mod,mIdx)=>{
        const mPos=Number(mod?.position)||mIdx+1;
        (mod?.lessons||[]).forEach((lesson,lIdx)=>{
          const lPos=Number(lesson?.position)||lIdx+1;
          if(lesson?.id)lessonsByOrder.set(lesson.id,cIdx*1_000_000+mPos*1_000+lPos);
        });
      });
    });
    return {lessonOrderMap:lessonsByOrder,courseOrderMap:coursesByOrder};
  },[data.courses]);
  const taskTypeRank=(t)=>t?.task_type==="lesson"?0:t?.task_type==="practice"?1:2;
  const roadmapRank=(t)=>{
    if(t?.lesson_id&&lessonOrderMap.has(t.lesson_id))return lessonOrderMap.get(t.lesson_id);
    const cIdx=courseOrderMap.get(t?.course_id)??999;
    if(Number(t?.module_position)>0){
      return cIdx*1_000_000+Number(t.module_position)*1_000+(Number(t?.lesson_position)||0);
    }
    return cIdx*1_000_000+999_000;
  };
  const dayStartMs=(iso)=>{const d=new Date(iso||0);return Number.isNaN(d.getTime())?0:new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();};
  const compareTodayTasks=(a,b)=>{
    const dayDiff=dayStartMs(a.scheduled_at)-dayStartMs(b.scheduled_at);
    if(dayDiff!==0)return dayDiff;
    const roadDiff=roadmapRank(a)-roadmapRank(b);
    if(roadDiff!==0)return roadDiff;
    const typeDiff=taskTypeRank(a)-taskTypeRank(b);
    if(typeDiff!==0)return typeDiff;
    return new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0);
  };
  const weekAgo=Date.now()-7*86400000;const tasks=[...data.tasks].filter(t=>t.status!=="completed"||new Date(t.scheduled_at||0).getTime()>=weekAgo).sort(compareTodayTasks);
  const next=[...tasks].find(t=>t.status!=="completed");
  const groups=tasks.reduce((acc,t)=>{const key=prettyDate(t.scheduled_at);(acc[key]??=[]).push(t);return acc;},{});
  const overdueTasks=data.tasks.filter(t=>t.status==="overdue"||(t.status!=="completed"&&t.scheduled_at&&new Date(t.scheduled_at).getTime()<new Date().setHours(0,0,0,0)));

  async function rebalanceSchedule(){
    const preferred=(data.settings.preferredStudyDays?.length?data.settings.preferredStudyDays:[1,3,5]).map(Number);
    const sessionBudget=Number(data.settings.sessionMinutes)||120;
    const incomplete=data.tasks.filter(t=>t.status!=="completed").sort((a,b)=>{
      const roadDiff=roadmapRank(a)-roadmapRank(b);
      if(roadDiff!==0)return roadDiff;
      const typeDiff=taskTypeRank(a)-taskTypeRank(b);
      if(typeDiff!==0)return typeDiff;
      return new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0);
    });
    if(!incomplete.length){flashToast("No incomplete sessions to rebalance.");return;}
    function nextStudyDay(start){const d=new Date(start);while(!preferred.includes(d.getDay())){d.setDate(d.getDate()+1);}return d;}
    let cursor=new Date();cursor.setDate(cursor.getDate()+1);cursor.setHours(18,0,0,0);
    let targetDay=nextStudyDay(cursor);let dayMinutes=0;const updates=[];
    for(const task of incomplete){
      const taskMinutes=Number(task.estimated_minutes)||30;
      if(dayMinutes>0&&dayMinutes+taskMinutes>sessionBudget){const nextDay=new Date(targetDay);nextDay.setDate(nextDay.getDate()+1);targetDay=nextStudyDay(nextDay);dayMinutes=0;}
      updates.push({id:task.id,scheduled_at:new Date(targetDay.getTime()+updates.length*1000).toISOString()});
      dayMinutes+=taskMinutes;
    }
    try{
      if(remote){for(const u of updates){await request(`tasks/${u.id}/reschedule`,{method:"POST",body:JSON.stringify({scheduledAt:u.scheduled_at})});}await refreshRemote();}
      else{updateData(d=>({...d,tasks:d.tasks.map(t=>{const m=updates.find(u=>u.id===t.id);return m?{...t,scheduled_at:m.scheduled_at,status:"rescheduled"}:t;})}));}
      flashToast("Schedule rebalanced across your preferred study days.");
    }catch(error){flashToast(error.message||"Failed to rebalance schedule.");}
  }

  async function reschedule(task){const next=prompt("Choose a new date (YYYY-MM-DD)",new Date(Date.now()+86400000).toISOString().slice(0,10));if(!next)return;const date=new Date(`${next}T18:00:00`);if(Number.isNaN(date.getTime()))return flashToast("Enter a valid date.");try{if(remote)await request(`tasks/${task.id}/reschedule`,{method:"POST",body:JSON.stringify({scheduledAt:date.toISOString()})});updateData(d=>({...d,tasks:d.tasks.map(t=>t.id===task.id?{...t,scheduled_at:date.toISOString(),status:"rescheduled"}:t)}));if(remote)await refreshRemote();flashToast("Session moved. Its learning record is kept.");}catch(error){flashToast(error.message);}}
  return <div className="today-layout grid gap-4 items-start"><div className="today-main flex flex-col gap-4">{tasks.length>0&&<div className="today-summary flex flex-col gap-3 p-4"><div className="flex items-center justify-between gap-4 w-full"><div><span className="eyebrow">YOUR NEXT STEP</span><h2>{next?.title||"You’re caught up"}</h2><p>{tasks.filter(t=>new Date(t.scheduled_at||0).toDateString()===new Date().toDateString()&&t.status!=="completed").length} tasks planned today · {data.tasks.filter(t=>t.status!=="completed").length} sessions remain in this plan</p></div><button className="primary-btn" onClick={()=>{if(next?.task_type==="review")p.go("flashcards");else if(next?.task_type==="practice"){if(next?.lesson_id)openLesson(next.lesson_id);else p.go("practice");}else if(next?.task_type==="roadmap")p.go("course");else if(next?.lesson_id)openLesson(next.lesson_id);else p.go("courses");}}>{next?.task_type==="review"?"Start review":next?.task_type==="practice"?"Start practice":next?.task_type==="roadmap"?"View roadmap":next?.lesson_id?"Start next session":"View courses"} ↗</button></div>{overdueTasks.length>0&&<div className="rebalance-notice flex items-center justify-between gap-3 p-3 rounded-lg bg-learnos-surface border border-learnos-line"><div className="flex items-center gap-2 text-sm"><Icon name="clock" size={16}/><span><strong>{overdueTasks.length}</strong> overdue or missed session{overdueTasks.length===1?"":"s"}</span></div><button className="primary-btn compact" type="button" onClick={rebalanceSchedule}>Rebalance schedule ↻</button></div>}</div>}
    {Object.entries(groups).length?Object.entries(groups).map(([day,items])=><section className="task-day flex flex-col gap-2" key={day}><div className="task-day-heading flex items-center justify-between"><h3>{day}</h3><span>{items.filter(t=>t.status==="completed").length} / {items.length} complete</span></div><div className="task-list flex flex-col gap-2">{items.map(task=>{
      const isPractice=task.task_type==="practice",isReview=task.task_type==="review",isRoadmap=task.task_type==="roadmap"||task.task_type==="milestone";
      const taskIcon=isPractice?"practice":isReview?"cards":isRoadmap?"progress":"book";
      const actionLabel=task.status==="completed"?"Review":isPractice?"Practice ↗":isReview?"Review ↗":isRoadmap?"Roadmap ↗":"Open ↗";
      const handleAction=()=>{if(isReview)p.go("flashcards");else if(isPractice){if(task.lesson_id)openLesson(task.lesson_id);else p.go("practice");}else if(isRoadmap)p.go("course");else if(task.lesson_id)openLesson(task.lesson_id);else flashToast("Open the course to see this task.");};
      return <article className={`task-row flex items-center gap-3 p-3 ${task.status} ${task.task_type||"lesson"}`} key={task.id}><span className={`task-check ${task.status==="completed"?"done":""}`} aria-label={task.status==="completed"?"Completed task":"Pending task"}>{task.status==="completed"?"✓":task.status==="in_progress"?"•":""}</span><div className={`task-type-glyph ${task.task_type||"lesson"}`} title={task.task_type||"lesson"} aria-hidden="true"><Icon name={taskIcon} size={15}/></div><div className="task-main-copy flex flex-col flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><strong>{task.title}</strong>{task.task_type&&task.task_type!=="lesson"&&<span className={`task-type-badge ${task.task_type}`}>{task.task_type}</span>}</div><span>{task.course_title||p.activeCourse?.title||"Learning session"} · {minuteLabel(task.estimated_minutes)}</span></div><span className={`task-status ${task.status}`}>{task.status.replace("_"," ")}</span><button className="continue-btn" onClick={handleAction}>{actionLabel}</button>{task.status!=="completed"&&<button className="quiet-btn" aria-label={`Reschedule ${task.title}`} title="Reschedule" onClick={()=>reschedule(task)}>↗</button>}</article>;
    })}</div></section>):<EmptyState title="No study sessions yet" body="Create a learning goal, then sign in to build a course plan and schedule your first session." action="Create a learning goal" onAction={()=>p.go("goal")}/>}</div>
    <aside className="today-aside flex flex-col gap-4"><Panel title="Study rhythm" icon="calendar"><div className="side-panel-copy flex flex-col gap-2 p-4">{tasks.length>0?<><div className="rhythm-big">{tasks.filter(t=>t.status!=="completed").length}<span> sessions left</span></div><p>Study days and session length can be adjusted in settings. Moving a session keeps its original notes and attempts.</p>{overdueTasks.length>0&&<button className="primary-btn compact mt-1" type="button" onClick={rebalanceSchedule}>Rebalance schedule ↻</button>}</>:<p>Study days and session length can be adjusted in settings. Once you approve a plan, your upcoming sessions will appear here.</p>}<button className="text-button" onClick={()=>p.go("settings")}>Edit study schedule ↗</button></div></Panel>{(p.dueCards.length>0||tasks.length>0)&&<Panel title="Review due" icon="cards"><div className="side-panel-copy flex flex-col gap-2 p-4"><div className="rhythm-big">{p.dueCards.length}<span> cards</span></div><p>Short recall sessions help you revisit ideas at the right time.</p><button className="text-button" onClick={()=>p.go("flashcards")}>Start review ↗</button></div></Panel>}</aside></div>;
}

function parseMarkdownToHtml(text){
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

function NotesPage(p){
  const [selected,setSelected]=useState(p.data.notes[0]?.id||""),[draft,setDraft]=useState(()=>p.data.notes[0]?{...p.data.notes[0]}:null);
  const [savingNote,setSavingNote]=useState(false),[deletingNote,setDeletingNote]=useState(false);
  const [searchQuery,setSearchQuery]=useState(""),[filterCourse,setFilterCourse]=useState("all");
  // Default to preview mode when an existing note is selected/opened
  const [viewMode,setViewMode]=useState(()=>p.data.notes[0]?"preview":"edit");
  const [selectedCourseId,setSelectedCourseId]=useState(()=>{
    const first=p.data.notes[0];
    return first?.course_id||"";
  });
  const [sidebarOpen,setSidebarOpen]=useState(true);

  const note= p.data.notes.find(n=>n.id===selected);

  // Group all courses and their modules/lessons for structured selection
  const allCourses=p.data.courses||[];
  const allLessonsMap=useMemo(()=>{
    const map=new Map();
    allCourses.forEach(c=>{
      (c.modules||[]).forEach(m=>{
        (m.lessons||[]).forEach(l=>{
          map.set(l.id,{...l,courseId:c.id,courseTitle:c.title,moduleTitle:m.title});
        });
      });
    });
    return map;
  },[allCourses]);

  const startNew=()=>{
    const activeLessonMeta=p.activeLesson?allLessonsMap.get(p.activeLesson.id):null;
    setSelected("");
    setSelectedCourseId(activeLessonMeta?.courseId||p.activeCourse?.id||"");
    setDraft({title:"",body:"",lesson_id:p.activeLesson?.id||"",source_ref:"",origin:"learner"});
    setViewMode("edit");
  };

  const open=(n)=>{
    setSelected(n.id);
    setDraft({...n});
    const lessonMeta=n.lesson_id?allLessonsMap.get(n.lesson_id):null;
    setSelectedCourseId(lessonMeta?.courseId||n.course_id||"");
    setViewMode("preview");
  };

  const insertMarkdown=(prefix,suffix="",placeholder="text")=>{
    const textarea=document.querySelector('.note-body-input');
    if(!textarea||!draft)return;
    const start=textarea.selectionStart,end=textarea.selectionEnd;
    const sel=draft.body.slice(start,end);
    const replacement=prefix+(sel||placeholder)+suffix;
    const nextBody=draft.body.slice(0,start)+replacement+draft.body.slice(end);
    setDraft({...draft,body:nextBody});
    setTimeout(()=>{
      textarea.focus();
      const cursorStart=start+prefix.length;
      const cursorEnd=cursorStart+(sel?sel.length:placeholder.length);
      textarea.setSelectionRange(cursorStart,cursorEnd);
    },10);
  };

  const handleSave=async()=>{
    if(!draft)return;
    setSavingNote(true);
    try{
      await p.saveNote({id:draft.id,title:draft.title,body:draft.body,lessonId:draft.lesson_id||null,sourceRef:draft.source_ref||"",origin:draft.origin||"learner"});
      setViewMode("preview");
    }finally{
      setSavingNote(false);
    }
  };

  const handleDelete=async()=>{
    if(!draft?.id)return;
    if(!confirm(`Delete "${draft.title||"this note"}"? This cannot be undone.`))return;
    setDeletingNote(true);
    try{
      await p.deleteNote(draft.id);
      setDraft(null);
      setSelected("");
    }finally{
      setDeletingNote(false);
    }
  };

  // Filter notes by search query and course
  const filteredNotes=useMemo(()=>{
    return p.data.notes.filter(n=>{
      if(searchQuery.trim()){
        const q=searchQuery.toLowerCase();
        const matchTitle=(n.title||"").toLowerCase().includes(q);
        const matchBody=(n.body||"").toLowerCase().includes(q);
        const matchSource=(n.lesson_title||n.source_ref||"").toLowerCase().includes(q);
        if(!matchTitle&&!matchBody&&!matchSource)return false;
      }
      if(filterCourse!=="all"){
        if(filterCourse==="unlinked")return !n.lesson_id&&!n.course_id;
        const meta=n.lesson_id?allLessonsMap.get(n.lesson_id):null;
        const cId=meta?.courseId||n.course_id;
        if(cId!==filterCourse)return false;
      }
      return true;
    });
  },[p.data.notes,searchQuery,filterCourse,allLessonsMap]);

  // Available lessons for the currently selected course in the editor
  const availableLessons=useMemo(()=>{
    if(!selectedCourseId)return [];
    const crs=allCourses.find(c=>c.id===selectedCourseId);
    if(!crs)return [];
    const list=[];
    (crs.modules||[]).forEach((m,mIdx)=>{
      (m.lessons||[]).forEach((l,lIdx)=>{
        list.push({...l,label:`M${mIdx+1}: ${l.title}`});
      });
    });
    return list;
  },[allCourses,selectedCourseId]);

  return <div className={`notes-layout grid gap-4 items-start ${sidebarOpen?"sidebar-open":"sidebar-closed"}`}>
    {sidebarOpen&&(
      <aside className="notes-sidebar panel flex flex-col p-3 gap-2.5">
        <div className="panel-head flex items-center justify-between">
          <div className="panel-title flex items-center gap-2.5">
            <Icon name="notes"/>
            <span>All notes</span>
            <span className="count-pill">{p.data.notes.length}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="primary-btn compact" onClick={startNew}><Icon name="plus" size={13}/>New</button>
            <button
              type="button"
              className="notes-toggle-sidebar-btn"
              onClick={()=>setSidebarOpen(false)}
              aria-label="Hide notes sidebar"
              title="Collapse notes list"
            >
              <Icon name="chevronLeft" size={15}/>
            </button>
          </div>
        </div>

        <div className="notes-filter-bar flex flex-col gap-2 px-1">
          <div className="notes-search-box flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-learnos-bg/70 border border-learnos-line">
            <Icon name="search" size={14}/>
            <input
              type="search"
              value={searchQuery}
              onChange={e=>setSearchQuery(e.target.value)}
              placeholder="Search in notes…"
              aria-label="Search notes"
              className="w-full bg-transparent border-0 outline-none text-xs text-learnos-text placeholder-learnos-muted"
            />
            {searchQuery&&<button type="button" className="text-xs text-learnos-muted hover:text-white" onClick={()=>setSearchQuery("")}>×</button>}
          </div>

          {allCourses.length>0&&(
            <div className="notes-course-filter flex items-center gap-1.5">
              <span className="text-xs text-learnos-muted font-medium shrink-0">Filter:</span>
              <select
                value={filterCourse}
                onChange={e=>setFilterCourse(e.target.value)}
                aria-label="Filter notes by course"
                className="notes-filter-select w-full text-xs rounded-lg px-2 py-1 bg-learnos-bg/70 border border-learnos-line text-learnos-text"
              >
                <option value="all">All courses ({p.data.notes.length})</option>
                {allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
                <option value="unlinked">Personal / Unlinked</option>
              </select>
            </div>
          )}
        </div>

        <div className="notes-list-scroll flex flex-col gap-1 overflow-y-auto max-h-[560px]">
          {p.data.notes.length===0?<p className="muted-copy padded">No notes saved yet.</p>:
           filteredNotes.length===0?<div className="p-4 text-center text-xs text-learnos-muted">No notes match your filter. <button type="button" className="text-learnos-purple underline ml-1" onClick={()=>{setSearchQuery("");setFilterCourse("all");}}>Clear</button></div>:
           filteredNotes.map(n=><button key={n.id} className={`note-list-item flex flex-col text-left p-3 cursor-pointer ${selected===n.id?"active":""}`} onClick={()=>open(n)} aria-label={`Note: ${n.title}`}>
            <div className="flex items-center justify-between gap-2 w-full">
              <strong>{n.title}</strong>
              {n.origin==="ai_draft"&&<span className="ai-draft-badge" title="Drafted by AI — ready for you to personalize"><Icon name="spark" size={10}/>AI DRAFT</span>}
              {n.origin==="roadmap"&&<span className="ai-draft-badge roadmap" title="Created from course roadmap"><Icon name="spark" size={10}/>ROADMAP</span>}
            </div>
            <span>{n.lesson_title||n.source_ref||"Personal note"}</span>
            <small>{prettyDate(n.updated_at,{month:"short",day:"numeric"})}</small>
          </button>)}
        </div>
      </aside>
    )}

    <section className="note-editor panel flex flex-col p-4 gap-3">
      {!sidebarOpen&&(
        <div className="notes-collapsed-bar flex items-center justify-between pb-2 mb-1 border-b border-learnos-line/50">
          <button
            type="button"
            className="notes-expand-sidebar-btn flex items-center gap-2 text-xs font-semibold text-learnos-muted hover:text-white"
            onClick={()=>setSidebarOpen(true)}
          >
            <Icon name="chevronRight" size={14}/>
            <span>Show all notes ({p.data.notes.length})</span>
          </button>
          <button className="primary-btn compact" onClick={startNew}><Icon name="plus" size={13}/>New note</button>
        </div>
      )}

      {draft?<>
        <div className="note-editor-top flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="eyebrow">{draft.lesson_title||(selectedCourseId?allCourses.find(c=>c.id===selectedCourseId)?.title:"LEARNER NOTE")}</span>
              {(draft.origin==="ai_draft"||note?.origin==="ai_draft")&&<span className="ai-draft-badge" title="Drafted by AI — ready for you to personalize"><Icon name="spark" size={11}/>AI DRAFT</span>}
              {(draft.origin==="roadmap"||note?.origin==="roadmap")&&<span className="ai-draft-badge roadmap" title="Created from course roadmap"><Icon name="spark" size={11}/>ROADMAP</span>}
            </div>
            <span className="autosave-label">{(draft.origin==="ai_draft"||note?.origin==="ai_draft")?"AI draft — edit and personalize your notes below":(draft.origin==="roadmap"||note?.origin==="roadmap")?"Roadmap note — customize your takeaways below":"Saved when you choose Save note"}</span>
          </div>

          <div className="note-actions flex items-center gap-2.5">
            <div className="note-view-toggle" role="tablist">
              <button
                type="button"
                className={`note-toggle-btn ${viewMode==="preview"?"active":""}`}
                onClick={()=>setViewMode("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                className={`note-toggle-btn ${viewMode==="edit"?"active":""}`}
                onClick={()=>setViewMode("edit")}
              >
                Write
              </button>
            </div>
            {draft.id&&<button className="danger-btn compact note-delete-btn" disabled={deletingNote||savingNote} onClick={handleDelete}>{deletingNote?<><span className="btn-spinner"/> Deleting…</>:"Delete"}</button>}
            <button className="primary-btn" disabled={savingNote||deletingNote} onClick={handleSave}>{savingNote?<><span className="btn-spinner"/> Saving…</>:"Save note"}</button>
          </div>
        </div>

        <input className="note-title-input" value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} placeholder="Untitled note" aria-label="Note title"/>

        {viewMode==="edit"&&(
          <div className="markdown-toolbar flex items-center gap-1 p-1.5 rounded-lg bg-learnos-bg/60 border border-learnos-line flex-wrap text-xs text-learnos-muted">
            <button type="button" className="md-tool-btn" title="Bold (**text**)" onClick={()=>insertMarkdown("**","**","bold")}><strong>B</strong></button>
            <button type="button" className="md-tool-btn" title="Italic (*text*)" onClick={()=>insertMarkdown("*","*","italic")}><em>I</em></button>
            <span className="md-sep"/>
            <button type="button" className="md-tool-btn" title="Heading 1 (# Heading)" onClick={()=>insertMarkdown("# ","","Heading 1")}>H1</button>
            <button type="button" className="md-tool-btn" title="Heading 2 (## Heading)" onClick={()=>insertMarkdown("## ","","Heading 2")}>H2</button>
            <button type="button" className="md-tool-btn" title="Heading 3 (### Heading)" onClick={()=>insertMarkdown("### ","","Heading 3")}>H3</button>
            <span className="md-sep"/>
            <button type="button" className="md-tool-btn" title="Bulleted list (- item)" onClick={()=>insertMarkdown("- ","","List item")}>• List</button>
            <button type="button" className="md-tool-btn" title="Numbered list (1. item)" onClick={()=>insertMarkdown("1. ","","Numbered item")}>1. List</button>
            <button type="button" className="md-tool-btn" title="Blockquote (> quote)" onClick={()=>insertMarkdown("> ","","Quote")}>“ Quote</button>
            <button type="button" className="md-tool-btn" title="Code snippet (`code`)" onClick={()=>insertMarkdown("`","`","code")}>&lt;/&gt;</button>
            <button type="button" className="md-tool-btn" title="Code block (```)" onClick={()=>insertMarkdown("```\n","\n```","code here")}>Code block</button>
          </div>
        )}

        {viewMode==="edit"?(
          <textarea className="note-body-input" value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})} placeholder="Write down the idea in your own words with Markdown (headings, lists, code)…" aria-label="Note body"/>
        ):(
          <div
            className="note-markdown-preview reading-copy flex flex-col gap-3 p-4 min-h-[260px] rounded-xl bg-learnos-bg/40 border border-learnos-line/70 overflow-y-auto"
            dangerouslySetInnerHTML={{__html:parseMarkdownToHtml(draft.body)||"<em>No content written yet. Switch to Write to begin.</em>"}}
          />
        )}

        <div className="note-source-row note-link-card">
          <div className="note-link-head">
            <span className="note-link-kicker">Course & Lesson Link</span>
            <span className="note-link-hint">Connect note to your curriculum and tutor citations</span>
          </div>

          <div className="note-link-fields">
            <label className="note-field-group">
              <span className="note-field-label">Course</span>
              <select
                value={selectedCourseId}
                onChange={e=>{
                  const nextCourseId=e.target.value;
                  setSelectedCourseId(nextCourseId);
                  if(!nextCourseId){
                    setDraft({...draft,lesson_id:"",lesson_title:"",course_id:null});
                  }else{
                    setDraft({...draft,course_id:nextCourseId,lesson_id:"",lesson_title:""});
                  }
                }}
                className="note-link-select"
              >
                <option value="">Personal note (no course)</option>
                {allCourses.map(c=><option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>

            {Boolean(selectedCourseId)&&(
              <label className="note-field-group animate-fadeIn">
                <span className="note-field-label">Topic / Lesson</span>
                <select
                  value={draft.lesson_id||""}
                  onChange={e=>{
                    const lId=e.target.value;
                    const meta=allLessonsMap.get(lId);
                    setDraft({
                      ...draft,
                      lesson_id:lId||"",
                      lesson_title:meta?.title||"",
                      source_ref:meta?.title||draft.source_ref||""
                    });
                  }}
                  className="note-link-select"
                >
                  <option value="">Whole course / general note</option>
                  {availableLessons.map(l=><option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
      </>:
      <EmptyState title="Choose a note to edit" body="Select a note, or make a new one to capture an idea while it is fresh." action="New note" onAction={startNew}/>}
    </section>
  </div>;
}

function FlashcardsPage(p){
  const [index,setIndex]=useState(0),[revealed,setRevealed]=useState(false),[showCreate,setShowCreate]=useState(false),[front,setFront]=useState(""),[back,setBack]=useState("");
  const [ratingCard,setRatingCard]=useState(false),[savingCard,setSavingCard]=useState(false);
  const due=p.dueCards;const card=due[index%Math.max(due.length,1)];
  const rating=async(value)=>{
    if(!card||ratingCard)return;
    setRatingCard(true);
    try{
      await p.rateCard(card,value);
      setRevealed(false);
      setIndex(0);
    }finally{
      setRatingCard(false);
    }
  };
  const cardLessonId=card?.lesson_id||card?.lessonId;
  const cardCourseId=card?.course_id||card?.courseId;
  const targetLesson=p.lessons?.find(l=>l.id===cardLessonId)||(cardCourseId?p.lessons?.find(l=>l.course_id===cardCourseId):null);
  const targetLessonId=cardLessonId||targetLesson?.id;

  return <div className="flashcards-layout grid gap-4 items-start"><section className="flash-main flex flex-col gap-4"><div className="review-progress-row flex items-center justify-between"><div><span className="eyebrow">SPACED REVIEW</span><h2>{due.length?`${due.length} cards due`:"You’re all caught up"}</h2></div><span className="review-index">{due.length?`${Math.min(index+1,due.length)} / ${due.length}`:"✓"}</span></div>
    {due.length?<><button className={`flashcard-face flex flex-col items-center justify-center p-8 text-center cursor-pointer ${revealed?"revealed":""}`} onClick={()=>setRevealed(!revealed)} aria-label={revealed?"Show question":"Reveal answer"}><span className="flashcard-label">{revealed?"ANSWER":"PROMPT"}</span><strong>{revealed?card.back:card.front}</strong><span className="flashcard-hint">{revealed?"Choose how well you recalled this":"Tap or press Enter to reveal"}</span></button>{(targetLessonId||cardCourseId)&&<div className="flashcard-source-link flex items-center justify-center gap-2 text-sm"><span className="text-learnos-muted">Review lesson:</span><button type="button" className="text-button inline-flex items-center gap-1 cursor-pointer" onClick={()=>{if(targetLessonId)p.openLesson(targetLessonId);else p.go("course");}}>{targetLesson?.title||card.lesson_title||"Source lesson"} ↗</button></div>}{revealed?<div className="rating-row grid grid-cols-2 sm:grid-cols-4 gap-2"><button disabled={ratingCard} onClick={()=>rating("Again")}><strong>Again</strong><small>Review soon</small></button><button disabled={ratingCard} onClick={()=>rating("Hard")}><strong>Hard</strong><small>Tomorrow</small></button><button disabled={ratingCard} onClick={()=>rating("Good")}><strong>Good</strong><small>In a few days</small></button><button disabled={ratingCard} onClick={()=>rating("Easy")}><strong>Easy</strong><small>Next week</small></button></div>:<div className="flashcard-controls flex items-center justify-center"><button className="primary-btn" onClick={()=>setRevealed(true)}>Reveal answer <span>↗</span></button></div>}</>:<EmptyState title="No cards due right now" body="Your saved cards will return when their next review is due." action="Add a card" onAction={()=>setShowCreate(true)}/>}</section>
    <aside className="flash-aside flex flex-col gap-4"><Panel title="Your deck" icon="cards"><div className="side-panel-copy flex flex-col gap-2 p-4"><div className="rhythm-big">{p.data.flashcards.length}<span> cards saved</span></div><p>Cards from lessons come back based on your recall rating.</p><button className="text-button" onClick={()=>setShowCreate(true)}><Icon name="plus" size={13}/>Create a flashcard</button></div></Panel><Panel title="Due later" icon="clock"><div className="side-panel-copy card-list-compact flex flex-col gap-2 p-4">{p.data.flashcards.filter(c=>new Date(c.due_at)>new Date()).slice(0,5).map(c=><div key={c.id}><span>{c.front}</span><small>{prettyDate(c.due_at)}</small></div>)}</div></Panel></aside>
    {showCreate&&<div className="inline-form panel flex flex-col p-4 gap-3"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="cards"/>New flashcard</div><button className="quiet-btn" onClick={()=>setShowCreate(false)}>×</button></div><label>Prompt<input value={front} onChange={e=>setFront(e.target.value)} placeholder="Ask a question"/></label><label>Answer<textarea value={back} onChange={e=>setBack(e.target.value)} placeholder="Write a short answer"/></label><button className="primary-btn" disabled={savingCard} onClick={async()=>{if(!front.trim()||!back.trim())return p.flashToast("Add both a prompt and an answer.");setSavingCard(true);try{await p.addFlashcard({front,back,lessonId:null});setFront("");setBack("");setShowCreate(false);}finally{setSavingCard(false);}}}>{savingCard?<><span className="btn-spinner"/> Saving…</>:"Save flashcard"}</button></div>}
  </div>;
}

const PRACTICE_MODES = [
  { id: "fill_blank", label: "Fill in the Blanks", hint: "Complete key ideas using a word bank" },
  { id: "quiz", label: "Quiz", hint: "Applied multiple-choice questions" },
  { id: "order", label: "Correct Order", hint: "Sequence steps in logical order" },
  { id: "word_scramble", label: "Word Builder", hint: "Unscramble core lesson terminology" },
  { id: "mixed", label: "Quick Mix", hint: "One drill of each interactive type" },
  { id: "checkpoint", label: "Topic Checkpoint", hint: "Lesson-end understanding check" },
];

function PracticePage(p){
  const [lessonId,setLessonId]=useState(()=>p.activeLesson?.id||p.lessons[0]?.id||"");
  const [mode,setMode]=useState("mixed");
  const [answer,setAnswer]=useState("");
  const [result,setResult]=useState(null);
  const [customPrompt]=useState("");
  const [studioSet,setStudioSet]=useState(null);
  const [studioStatus,setStudioStatus]=useState({kind:"idle",message:""});
  const [cachedModes,setCachedModes]=useState([]);
  const [generatingKey,setGeneratingKey]=useState(null);
  const generatingKeyRef=useRef(null);

  useEffect(()=>{
    if((!lessonId||!p.lessons.some(l=>l.id===lessonId))&&p.lessons[0]?.id){
      setLessonId(p.lessons[0].id);
    }
  },[lessonId,p.lessons]);

  const userId=p.user?.id||"anon";
  const lesson=p.lessons.find(l=>l.id===lessonId),checkpoint=lesson?.checkpoint;
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
      if(p.remote)await p.refreshRemote();
    }catch(error){p.flashToast(error.message);}
  }

  const cachedModeSet=new Set(cachedModes.map(m=>m.mode));
  const isGeneratingCurrent=Boolean(generatingKey&&activeKey&&generatingKey===activeKey);

  return <div className="practice-layout grid gap-4 items-start"><section className="panel practice-work flex flex-col p-4 gap-4"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="practice"/>Practice Studio</div><span className="status-pill">UNDERSTANDING EVIDENCE</span></div><div className="practice-body flex flex-col gap-3"><label>Choose a lesson<select value={lessonId} onChange={e=>{setLessonId(e.target.value);setResult(null);}}>{p.lessons.map(l=><option key={l.id} value={l.id}>{l.title}</option>)}</select></label>{lesson?<>
    <div className="practice-mode-tabs flex flex-wrap gap-2" role="tablist" aria-label="Practice exercise modes">
      {PRACTICE_MODES.map(item=>{
        const isActive=mode===item.id;
        const hasCache=item.id!=="checkpoint"&&cachedModeSet.has(item.id);
        return <button key={item.id} type="button" role="tab" aria-selected={isActive} className={`practice-mode-tab ${isActive?"active":""} ${hasCache?"has-cache":""}`.trim()} onClick={()=>{setMode(item.id);setResult(null);}}><span>{item.label}</span>{hasCache&&<span className="practice-mode-badge" aria-label="Cached">●</span>}</button>;
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
        <div>
          <span className="eyebrow">{lesson.moduleTitle||"PRACTICE STUDIO"}</span>
          <p className="muted-copy">{activeModeMeta.hint}</p>
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
  </>:<EmptyState title="Choose a lesson first" body="Open a course to see its practice checkpoints." action="Browse courses" onAction={()=>p.go("courses")}/>}</div></section><aside className="practice-aside flex flex-col gap-4"><Panel title="Recent evidence" icon="progress"><EvidenceList attempts={p.data.attempts.slice(0,6)}/></Panel><Panel title="More practice" icon="tutor"><div className="side-panel-copy flex flex-col gap-2 p-4"><p>Ask the tutor for a hint, a new quiz question, or feedback on your approach.</p><button className="text-button" onClick={()=>p.go("tutor")}>Open AI Tutor ↗</button></div></Panel></aside></div>;
}

function EvidenceList({attempts}){return attempts.length?<div className="evidence-list">{attempts.map((a,i)=><div className="evidence-item" key={a.id||i}><span className={`evidence-dot ${Number(a.score)>=70?"good":""}`}/><div><strong>{a.concept||"Practice attempt"}</strong><small>{a.score==null?"Response saved":Number(a.score)>=70?"Checkpoint passed":"Attempt saved"} · {prettyDate(a.created_at,{month:"short",day:"numeric"})}</small></div></div>)}</div>:<p className="muted-copy padded">Your checkpoint and practice evidence will appear here.</p>}

function ProgressPage(p){
  const done=p.data.tasks.filter(t=>t.status==="completed").length,total=p.data.tasks.length,passed=p.data.attempts.filter(a=>Number(a.score)>=70).length,concepts=[...new Set(p.data.attempts.filter(a=>Number(a.score)>=70).map(a=>a.concept))];
  const byWeek=Array.from({length:6},(_,i)=>{const date=new Date();date.setDate(date.getDate()-((5-i)*7));const week=date.toLocaleDateString(undefined,{month:"short",day:"numeric"});const matches=p.data.tasks.filter(t=>{const d=new Date(t.scheduled_at||0);const diff=(date-d)/(1000*60*60*24);return diff>=0&&diff<7;});return {week,value:matches.filter(t=>t.status==="completed").length,total:matches.length};});
  return <div className="progress-page-grid grid gap-4 items-start"><section className="panel progress-overview flex flex-col p-4 gap-4"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="progress"/>Study activity</div><span className="muted-copy text-sm">Based on sessions in your plan</span></div><div className="progress-hero flex items-center gap-4"><div className="progress-donut grid place-items-center" style={{"--progress":`${total?done/total*100:0}%`}}><strong>{total?Math.round(done/total*100):0}%</strong><span>complete</span></div><div><h2>{done} of {total} sessions done</h2><p>Task completion describes the work you finished. It is not a mastery score.</p></div></div><div className="progress-bars flex items-end justify-between gap-2 h-36 pt-4">{byWeek.map((item,i)=><div className="progress-bar-col flex flex-col items-center gap-1.5 flex-1" key={i}><div className="progress-bar-wrap w-full"><div className="progress-bar-fill" style={{height:`${item.total?Math.max(9,item.value/item.total*100):4}%`}} title={`${item.value} of ${item.total} sessions`}/></div><span>{item.week}</span></div>)}</div><div className="chart-legend flex items-center gap-4 text-sm"><span><i/>Completed sessions</span><span><i className="planned-dot"/>Planned sessions</span></div></section>
    <section className="panel evidence-overview flex flex-col p-4 gap-4"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="check"/>Understanding evidence</div></div><div className="evidence-summary grid grid-cols-1 sm:grid-cols-3 gap-3"><div><strong>{passed}</strong><span>checkpoint passes</span></div><div><strong>{concepts.length}</strong><span>concepts with recent evidence</span></div><div><strong>{p.data.attempts.length}</strong><span>attempts kept</span></div></div><EvidenceList attempts={p.data.attempts}/></section>
    <section className="panel course-progress-table flex flex-col p-4 gap-3"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="book"/>By course</div></div>{p.data.courses.map(c=>{const tasks=p.data.tasks.filter(t=>t.course_id===c.id),complete=tasks.filter(t=>t.status==="completed").length;return <div className="course-progress-line flex items-center justify-between gap-3 p-2" key={c.id}><div><strong>{c.title}</strong><small>{complete} completed of {tasks.length} scheduled tasks</small></div><div className="progress-track flex-1 overflow-hidden"><div className="progress-fill" style={{width:`${tasks.length?complete/tasks.length*100:0}%`}}/></div><span>{tasks.length?Math.round(complete/tasks.length*100):0}%</span></div>;})}{!p.data.courses.length&&<p className="muted-copy padded">Approve a plan to see course progress.</p>}</section>
  </div>;
}

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
  const [mode,setMode]=useState("Explain"),[prompt,setPrompt]=useState(""),[attempt,setAttempt]=useState(""),[messages,setMessages]=useState([]),[sending,setSending]=useState(false),[expandedSources,setExpandedSources]=useState({}),[savedThreads,setSavedThreads]=useState([]);
  const loadedThreadRef=useRef(null);
  const threadId=buildTutorThreadId(p.user?.id,p.activeLesson?.id);
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
      await saveTutorThread(threadId,messages,{lessonTitle:p.activeLesson?.title||"Workspace"});
      const threads=await listTutorThreads(p.user?.id);
      if(!cancelled)setSavedThreads(Array.isArray(threads)?threads:[]);
    })();
    return ()=>{cancelled=true;};
  },[messages,p.remote,p.user?.id,p.activeLesson?.title,threadId]);

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
    const reply=await p.sendTutor({mode:requestMode,prompt:question,attempt:requestAttempt});
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

  const otherSavedThreads=savedThreads.filter(t=>t.threadId!==threadId&&t.messageCount>0&&(!t.lessonId||p.lessons?.some(l=>l.id===t.lessonId)));

  return <div className="tutor-layout grid gap-4 items-start">
    <section className="panel tutor-workspace flex flex-col p-4 gap-4">
      <div className="tutor-topline flex items-center justify-between gap-3">
        <div>
          <span className="eyebrow">{p.activeLesson?.title||"LEARNING COMPANION"}</span>
          <h2>Work through the idea together.</h2>
        </div>
        <div className="tutor-toolbar-actions flex items-center gap-2.5">
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
              onClick={()=>p.setActiveLessonId?.(t.lessonId||null)}
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
        <div className="side-panel-copy flex flex-col gap-2 p-4">
          <strong>{p.activeLesson?.title||p.activeCourse?.title||"No lesson selected"}</strong>
          <p>{p.activeLesson?.objective||p.activeCourse?.summary||"Open a lesson to give the tutor more context."}</p>
          {p.activeLesson&&<button type="button" className="text-button" onClick={()=>p.go("lesson")}>Return to lesson ↗</button>}
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

function AiEngineRagPanel({remote,request,openAccount,flashToast}){
  const [aiStatus,setAiStatus]=useState(null);
  const [ragStatus,setRagStatus]=useState(null);
  const [engineState,setEngineState]=useState(()=>remote?"loading":"signed_out");
  const [engineError,setEngineError]=useState("");
  const [reindexing,setReindexing]=useState(false);
  const [showAllModels,setShowAllModels]=useState(false);
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
    ?<span className="status-pill unavailable">Sign in required</span>
    :engineState==="loading"
      ?<span className="status-pill">Loading…</span>
      :engineState==="error"
        ?<span className="status-pill paused">Unavailable</span>
        :<span className="status-pill connected">Ready</span>;

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
    <section className="panel flex flex-col ai-rag-panel">
      <div className="panel-head flex items-center justify-between gap-2">
        <div className="panel-title flex items-center gap-2.5"><Icon name="spark"/>AI Engine &amp; RAG Knowledge Index</div>
        {statusBadge}
      </div>
      {!remote?(
        <div className="side-panel-copy flex flex-col gap-2.5 p-4">
          <p>Sign in to inspect multi-model failover health and rebuild your hybrid RAG knowledge index.</p>
          <button type="button" className="text-button" onClick={openAccount}>Sign in to inspect AI Engine ↗</button>
        </div>
      ):engineState==="loading"?(
        <div className="engine-state-box" role="status" aria-busy="true">
          <p>Loading model pool health and knowledge index telemetry…</p>
        </div>
      ):engineState==="error"?(
        <div className="engine-error-box" role="alert">
          <p>{engineError||"AI Engine telemetry is currently unavailable."}</p>
          <button type="button" className="secondary-btn compact" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
        </div>
      ):(
        <div className="ai-rag-content">
          {engineError&&(
            <div className="engine-error-box compact" role="alert">
              <span>{engineError}</span>
              <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
            </div>
          )}

          <div className="engine-section">
            <div className="engine-section-head">
              <strong>Active AI Model Pool</strong>
              <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)} aria-label="Refresh AI model status">Refresh ↻</button>
            </div>
            {aiStatus?(
              <>
                <div className="engine-summary-grid">
                  <div className="engine-summary-stat">
                    <span>Healthy</span>
                    <strong>{aiStatus.summary?.healthyModels??0}<small>/{aiStatus.summary?.totalModels??models.length}</small></strong>
                  </div>
                  <div className="engine-summary-stat">
                    <span>Cooling</span>
                    <strong>{aiStatus.summary?.coolingDownModels??0}</strong>
                  </div>
                  <div className="engine-summary-stat">
                    <span>Switches</span>
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
                    <ul className="engine-model-list" aria-label="Model health list">
                      {visibleModels.map(m=>{
                        const state=m.status==="open"?"open":m.status==="half_open"?"half_open":"closed";
                        const stateText=state==="open"?"Cooling":state==="half_open"?"Probing":"Healthy";
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
                  <p className="muted-copy">No active models reported yet.</p>
                )}
              </>
            ):(
              <div className="engine-error-box compact" role="alert">
                <span>Model pool status unavailable.</span>
                <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
              </div>
            )}
          </div>

          <div className="engine-section">
            <div className="engine-section-head">
              <strong>RAG Knowledge Index</strong>
              {ragStatus?.embeddingMode&&<span className="rag-mode-pill">{ragStatus.embeddingMode}</span>}
            </div>
            {ragStatus?(
              <>
                <div className="rag-summary-bar">
                  <span><strong>{Number(ragStatus.chunksCount??0)}</strong> indexed chunks</span>
                  <small>{ragStatus.lastIndexedAt?`Indexed ${prettyDate(ragStatus.lastIndexedAt,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`:"Not indexed yet"}</small>
                </div>
                <div className="rag-type-grid" aria-label="Indexed chunks by type">
                  <div className="rag-type-cell"><strong>{ragCounts.notes}</strong><span>Notes</span></div>
                  <div className="rag-type-cell"><strong>{ragCounts.lessons}</strong><span>Lessons</span></div>
                  <div className="rag-type-cell"><strong>{ragCounts.flashcards}</strong><span>Flashcards</span></div>
                  <div className="rag-type-cell"><strong>{ragCounts.practice}</strong><span>Practice</span></div>
                </div>
                <div className="rag-footer-row">
                  <button
                    type="button"
                    className="secondary-btn compact rag-reindex-btn"
                    disabled={reindexing}
                    aria-busy={reindexing}
                    onClick={handleReindex}
                  >
                    {reindexing?"Rebuilding index…":"Rebuild knowledge index ↻"}
                  </button>
                </div>
              </>
            ):(
              <div className="engine-error-box compact" role="alert">
                <span>Knowledge index status unavailable.</span>
                <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsPage(p){
  const [saved,setSaved]=useState(false),[name,setName]=useState(p.data.settings.fullName||p.user?.fullName||""),[timezone,setTimezone]=useState(p.data.settings.timezone||"UTC"),[weekly,setWeekly]=useState(p.data.settings.weeklyMinutes||360),[session,setSession]=useState(p.data.settings.sessionMinutes||120),[days,setDays]=useState(p.data.settings.preferredStudyDays||[]),[studyNotify,setStudyNotify]=useState(Boolean(p.data.settings.notificationPreferences?.study)),[reviewNotify,setReviewNotify]=useState(Boolean(p.data.settings.notificationPreferences?.review));
  const [deletingAccount,setDeletingAccount]=useState(false);
  async function save(e){e.preventDefault();const settings={fullName:name,timezone,weeklyMinutes:Number(weekly),sessionMinutes:Number(session),preferredStudyDays:days,notificationPreferences:{study:studyNotify,review:reviewNotify}};try{if(p.remote){const result=await p.request("settings",{method:"PUT",body:JSON.stringify(settings)});settings.fullName=result.user.fullName;}p.updateData(d=>({...d,settings:{...d.settings,...settings}}));setSaved(true);p.flashToast("Settings saved.");setTimeout(()=>setSaved(false),2400);}catch(error){p.flashToast(error.message);}}
  function exportWorkspace(){const payload={exportedAt:new Date().toISOString(),workspace:p.data};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="drizzlearn-workspace.json";a.click();URL.revokeObjectURL(url);}
  function toggleDay(day){setDays(current=>current.includes(day)?current.filter(d=>d!==day):[...current,day].sort());}
  async function deleteAccount(){
    if(!confirm("Are you sure you want to delete your account? This will permanently delete all your courses, tasks, notes, and learning evidence. This action cannot be undone."))return;
    setDeletingAccount(true);
    try{
      if(p.remote){
        const password=prompt("Enter your account password to confirm permanent deletion:");
        if(!password)return;
        try{
          await p.request("settings/account",{method:"DELETE",body:JSON.stringify({password})});
          if(p.setUser)p.setUser(null);
          if(p.setRemote)p.setRemote(false);
          if(p.setData)p.setData(emptyWorkspace());
          p.flashToast("Account permanently deleted.");
          p.go("home");
        }catch(error){p.flashToast(error.message||"Could not delete account.");}
      }else{
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        if(p.setData)p.setData(emptyWorkspace());
        p.flashToast("Local workspace deleted.");
        p.go("home");
      }
    }finally{
      setDeletingAccount(false);
    }
  }
  return <div className="settings-grid grid gap-4 items-start"><form className="panel settings-form flex flex-col p-4 gap-4" onSubmit={save}><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="tutor"/>Learner profile</div></div><div className="settings-body flex flex-col gap-4"><label>Display name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" minLength="2"/></label><label>Email address<input value={p.user?.email||""} placeholder="Sign in to attach an email" readOnly/></label><label>Time zone<input value={timezone} onChange={e=>setTimezone(e.target.value)}/></label><div className="form-section flex flex-col gap-3 pt-3 border-t border-learnos-line"><h3>Weekly study budget</h3><p>Plans are checked against the time you can actually set aside.</p><div className="form-grid-two grid grid-cols-1 sm:grid-cols-2 gap-3"><label>Minutes per week<input type="number" min="30" max="2400" step="30" value={weekly} onChange={e=>setWeekly(e.target.value)}/></label><label>Minutes per session<input type="number" min="15" max="240" step="5" value={session} onChange={e=>setSession(e.target.value)}/></label></div></div><div className="form-section flex flex-col gap-3 pt-3 border-t border-learnos-line"><h3>Preferred study days</h3><div className="day-picker flex flex-wrap gap-1.5">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day,i)=><button key={day} type="button" className={`cursor-pointer ${days.includes(i)?"selected":""}`} onClick={()=>toggleDay(i)}>{day}</button>)}</div></div><div className="form-section flex flex-col gap-3 pt-3 border-t border-learnos-line"><h3>Notifications</h3><label className="toggle-row flex items-center justify-between gap-3 p-2"><span><strong>Study session reminders</strong><small>Before a planned session</small></span><input type="checkbox" checked={studyNotify} onChange={e=>setStudyNotify(e.target.checked)}/></label><label className="toggle-row flex items-center justify-between gap-3 p-2"><span><strong>Review reminders</strong><small>When flashcards are due</small></span><input type="checkbox" checked={reviewNotify} onChange={e=>setReviewNotify(e.target.checked)}/></label></div><div className="settings-submit pt-2"><button className="primary-btn" type="submit">{saved?"Saved ✓":"Save settings"}</button></div></div></form>
    <div className="settings-side flex flex-col gap-4"><Panel title="Account" icon="tutor"><div className="side-panel-copy flex flex-col gap-2 p-4"><strong>{p.user?.email||"Your account"}</strong><p>{p.remote?"Signed in to the Drizzlearn workspace.":"Sign in to sync your workspace across devices."}</p>{p.remote?<button type="button" className="text-button" onClick={p.logout}>Sign out ↗</button>:<button type="button" className="text-button" onClick={p.openAccount}>Sign in or create account ↗</button>}<div className="pt-3 border-t border-learnos-line mt-2 flex flex-col gap-1.5"><small className="text-sm text-learnos-muted">Permanently delete your account and all associated learning data.</small><button className="quiet-btn danger text-xs self-start" type="button" disabled={deletingAccount} onClick={deleteAccount}>{deletingAccount?<><span className="btn-spinner"/> Deleting…</>:"Delete account"}</button></div></div></Panel><Panel title="Your data" icon="notes"><div className="side-panel-copy flex flex-col gap-2 p-4"><p>Export saved notes, cards, study sessions and practice history.</p>{p.remote?<button type="button" className="text-button" onClick={async()=>{try{const result=await p.request("settings/export");const b=new Blob([JSON.stringify(result,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="drizzlearn-export.json";a.click();URL.revokeObjectURL(a.href);}catch(e){p.flashToast(e.message);}}}>Download data export ↗</button>:<button type="button" className="text-button" onClick={exportWorkspace}>Download workspace data ↗</button>}</div></Panel><AiEngineRagPanel remote={p.remote} request={p.request} openAccount={p.openAccount} flashToast={p.flashToast}/></div></div>;
}

function GenerationProgressCard({progress,fallbackMessage="Crafting your customized course…",ariaLabel="Course generation progress",note=""}){
  const rawPercent=Number(progress?.percent);
  const percent=Number.isFinite(rawPercent)?Math.max(0,Math.min(100,Math.round(rawPercent))):0;
  const message=progress?.message||fallbackMessage;
  const model=progress?.model;
  const provider=progress?.provider;
  return (
    <div className="course-generation-progress flex flex-col gap-2.5 p-4 rounded-xl border border-learnos-purple/40 bg-learnos-purple/10" role="status" aria-live="polite">
      <div className="generation-progress-header flex items-center justify-between gap-2 flex-wrap">
        <span className="generation-progress-label flex items-center gap-2 font-semibold text-sm text-learnos-lavender">
          <Icon name="spark" size={18}/>
          <span>{message}</span>
        </span>
        <div className="generation-progress-meta flex items-center gap-2 flex-wrap">
          {model&&<span className="generation-model-badge" title={provider?`${provider} · ${model}`:model} aria-label={`Active model: ${model}`}>{model}</span>}
          <span className="generation-stage-pill generation-percent-pill">{percent}%</span>
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
        <div className="generation-progress-bar h-full rounded-full bg-gradient-to-r from-learnos-purple to-learnos-lime" style={{width:`${percent}%`}}/>
      </div>
      {note&&<p className="generation-routing-note text-sm text-learnos-muted">{note}</p>}
    </div>
  );
}

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

function ProposalPage(p){
  const course=p.proposal||p.activeCourse;
  const [title,setTitle]=useState(course?.title||""),[summary,setSummary]=useState(course?.summary||""),[expanded,setExpanded]=useState(0),[saving,setSaving]=useState(false),[improveText,setImproveText]=useState(""),[improving,setImproving]=useState(false),[improveProgress,setImproveProgress]=useState(null),[improveError,setImproveError]=useState("");
  useEffect(()=>{setTitle(course?.title||"");setSummary(course?.summary||"");},[course?.id,course?.title,course?.summary]);
  if(!course)return <EmptyState title="No proposal to review" body="Create a learning goal to generate an editable plan." action="Create a goal" onAction={()=>p.go("goal")}/>;
  const modules=course.modules||[];const minutes=Number(course.estimated_minutes)||modules.reduce((sum,m)=>sum+(Number(m.estimatedMinutes)||Number(m.estimated_minutes)||0),0);const weeks=Number(course.durationWeeks||course.target_weeks)||8;const weeklyBudget=Number(course.weeklyMinutes||course.weekly_minutes||p.data.settings.weeklyMinutes);const weeklyNeeded=Math.ceil(minutes/weeks);
  async function saveChanges(){setSaving(true);const updated={...course,title,summary};try{if(p.remote){await p.request(`courses/${course.id}`,{method:"PUT",body:JSON.stringify({title,summary})});for(const mod of modules){if(mod.id&&!String(mod.id).startsWith("proposal-m"))await p.request(`modules/${mod.id}`,{method:"PUT",body:JSON.stringify({title:mod.title,objective:mod.objective})});}await p.refreshRemote();}else p.updateData(d=>({...d,courses:d.courses.map(c=>c.id===course.id?updated:c)}));p.setProposal(updated);p.flashToast("Proposal changes saved.");}catch(error){p.flashToast(error.message);}finally{setSaving(false);}}
  async function improvePlan(event){
    event.preventDefault();
    if(!p.remote){p.openAccount();return;}
    setImproveError("");
    setImproving(true);
    setImproveProgress({stage:"initializing",percent:5,message:"Starting proposal revision…",model:"",provider:""});
    try{
      const result=await p.requestStream(`courses/${course.id}/improve?stream=1`,{method:"POST",body:JSON.stringify({feedback:improveText})},(frame)=>{
        setImproveProgress(prev=>mergeStreamProgress(prev,frame,"Revising your course proposal…"));
      });
      if(!result?.course){
        throw new Error("The revised proposal could not be loaded. Your current proposal is still available.");
      }
      p.setProposal(result.course);
      setImproveText("");
      p.flashToast("A revised draft is ready. Review it before approving.");
    }catch(error){
      setImproveError(error?.message||"The revision could not be generated. Your current proposal is still available.");
    }finally{
      setImproving(false);
      setImproveProgress(null);
    }
  }
  return <div className="proposal-layout grid gap-4 items-start"><div className="proposal-main flex flex-col gap-4"><div className="proposal-status-row flex items-center justify-between gap-3"><span className="status-pill proposal">AWAITING YOUR APPROVAL</span><span>{course.generationMode==="multi-agent"?"Three AI roles shaped the curriculum, lessons, and practice checks.":"Nothing is scheduled until you approve this plan."}</span></div><section className="panel proposal-summary flex flex-col p-4 gap-3"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="spark"/>Course overview</div><span className="proposal-duration text-sm">{weeks} weeks</span></div><div className="proposal-fields flex flex-col gap-3"><label>Course title<input value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Learning outcome<textarea value={summary} onChange={e=>setSummary(e.target.value)}/></label></div><div className="proposal-meta grid grid-cols-1 sm:grid-cols-3 gap-3"><div><small>ESTIMATED STUDY TIME</small><strong>{Math.round(minutes/60*10)/10} hrs</strong></div><div><small>ESTIMATED PER WEEK</small><strong>{Math.round(weeklyNeeded/60*10)/10} hrs</strong></div><div><small>YOUR WEEKLY BUDGET</small><strong>{Math.round(weeklyBudget/60)} hrs</strong></div></div></section>
    <section className="panel proposal-improve-panel flex flex-col p-4 gap-3"><div className="panel-title flex items-center gap-2.5"><Icon name="spark"/>Improve this draft</div><p>Ask for a different pace, more examples, clearer prerequisites, or stronger practice. Your current draft stays available until you review the revision.</p><form className="flex flex-col gap-3" onSubmit={improvePlan}><label htmlFor="proposal-improvement">What would you like to change?</label><textarea id="proposal-improvement" value={improveText} onChange={e=>setImproveText(e.target.value)} disabled={improving} maxLength="1200" minLength="8" required placeholder="For example: Add a small project to each module and make the checkpoints more practical."/>{improving&&<GenerationProgressCard progress={improveProgress} fallbackMessage="Working on your revision…" ariaLabel="Course improvement progress" note="Refining modules, lessons, and checkpoints around your feedback. Your current draft stays available until the revision finishes."/>}<div className="proposal-improve-actions flex items-center justify-between gap-3 mt-2"><small className="text-sm text-learnos-muted leading-relaxed">{p.remote?"You can request another revision after reviewing this one.":"Sign in to generate AI revisions. You can still edit the proposal by hand."}</small><button className="primary-btn" type="submit" disabled={improving||p.busy||!improveText.trim()}>{improving?"Working on revision…":p.remote?"Improve with AI ↗":"Sign in to improve ↗"}</button></div>{improveError&&<p className="form-error" role="alert">{improveError}</p>}</form></section>
    <section className="proposal-modules flex flex-col gap-3"><div className="section-heading-row flex items-center justify-between"><div><span className="eyebrow">THE LEARNING PATH</span><h2>Modules and lessons</h2></div><span className="text-sm font-semibold text-learnos-muted">{modules.length} modules · {modules.reduce((n,m)=>n+(m.lessons?.length||0),0)} lessons</span></div>{modules.map((m,i)=><article className={`panel proposal-module flex flex-col overflow-hidden ${expanded===i?"expanded":""}`} key={m.id||i}><button className="proposal-module-head flex items-center justify-between p-3.5 w-full text-left cursor-pointer" onClick={()=>setExpanded(expanded===i?-1:i)}><span className="module-number">{String(i+1).padStart(2,"0")}</span><span><strong>{m.title}</strong><small className="block text-sm text-learnos-muted">{m.lessons?.length||0} lessons · {Math.round((m.estimatedMinutes||m.estimated_minutes||0)/60*10)/10||1} hrs</small></span><span className="expand-icon">{expanded===i?"−":"+"}</span></button>{expanded===i&&<div className="proposal-module-body flex flex-col p-4 gap-3"><label>Module title<input value={m.title} onChange={e=>{const next=modules.map((x,j)=>j===i?{...x,title:e.target.value}:x);p.setProposal({...course,modules:next});}}/></label><label>Objective<textarea value={m.objective||""} onChange={e=>{const next=modules.map((x,j)=>j===i?{...x,objective:e.target.value}:x);p.setProposal({...course,modules:next});}}/></label><p className="module-rationale text-sm text-learnos-muted">{m.rationale||"This module supports the stated learning outcome."}</p>{(m.sourceRefs||m.source_refs||[]).length>0&&<div className="proposal-sources flex flex-wrap gap-1.5"><small className="w-full text-sm font-semibold text-learnos-muted uppercase tracking-wider">Grounded in your workspace</small>{(m.sourceRefs||m.source_refs||[]).map(source=><span key={source.id}>{source.title}</span>)}</div>}<ol className="proposal-lesson-list flex flex-col gap-2">{m.lessons?.map((l,j)=><li key={l.id||j} className="flex items-center justify-between gap-3 p-2"><span>{j+1}</span><div className="flex-1 min-w-0"><strong>{l.title}</strong><small className="block text-sm text-learnos-muted">{l.objective}</small>{(l.sourceRefs||l.source_refs||[]).length>0&&<span className="proposal-lesson-source block text-sm font-medium">Based on: {(l.sourceRefs||l.source_refs).map(source=>source.title).join(", ")}</span>}</div><em>{minuteLabel(l.estimated_minutes||l.estimatedMinutes)}</em></li>)}</ol></div>}</article>)}</section>
    <div className="proposal-actions flex flex-wrap items-center justify-end gap-3 mt-4"><button className="quiet-action" onClick={()=>p.go("goal")}>← Edit goal details</button><div className="proposal-actions-right flex items-center gap-3">{p.confirmDeleteCourse&&<button type="button" className="danger-btn compact course-delete-btn" disabled={saving||improving||p.busy||p.deletingCourseId===course.id} onClick={()=>p.confirmDeleteCourse(course,"courses")}>Delete proposal</button>}<button className="secondary-btn" disabled={saving||improving} onClick={saveChanges}>{saving?<><span className="btn-spinner"/> Saving…</>:"Save edits"}</button><button className="primary-btn" disabled={p.busy||improving} onClick={()=>p.approveProposal(false,course)}>{p.busy?<><span className="btn-spinner"/> Approving plan…</>:"Approve and schedule ↗"}</button></div></div>
  </div><aside className="proposal-side flex flex-col gap-4"><Panel title={weeklyNeeded<=weeklyBudget?"Fits your schedule":"Needs a schedule check"} icon={weeklyNeeded<=weeklyBudget?"check":"clock"}><div className={`feasibility-card flex flex-col gap-2 p-4 ${weeklyNeeded<=weeklyBudget?"fits":"over"}`}><strong>{weeklyNeeded<=weeklyBudget?"Within your weekly budget":"Above your weekly budget"}</strong><p>This plan needs about {Math.round(weeklyNeeded/60*10)/10} hours each week. Your current budget is {Math.round(weeklyBudget/60)} hours.</p>{weeklyNeeded>weeklyBudget&&<p>Shorten the plan or increase study time before approving.</p>}</div></Panel><Panel title="Plan assumptions" icon="notes"><ul className="assumption-list flex flex-col gap-2 p-4">{(course.assumptions||["The plan is a draft based on the details you provided.","Review the order and effort before you approve."]).map((x,i)=><li key={i}>{x}</li>)}</ul></Panel><div className="proposal-note flex items-center gap-2.5 p-3.5"><Icon name="spark"/><p className="text-sm">Your course remains a proposal until you approve it. You can still edit the title, outcome and module objectives.</p></div></aside></div>;
}

function CoursePage(p){
  const course=p.activeCourse;
  const [expanded,setExpanded]=useState(0);
  if(!course)return <EmptyState title="No active course yet" body="Create and approve a learning plan to see your roadmap here." action="Create a course" onAction={()=>p.go("goal")}/>;
  const total=course.modules?.reduce((n,m)=>n+(m.lessons?.length||0),0)||0;
  const isGenerating=Boolean((course.id&&course.id===p.generatingCourseId)||course.materials_status==="generating"||course.isGenerating||course.materialsGenerating);
  const courseTasks=p.data.tasks.filter(t=>t.course_id===course.id);
  async function toggleStatus(){const status=course.status==="paused"?"active":"paused";try{if(p.remote)await p.request(`courses/${course.id}`,{method:"PUT",body:JSON.stringify({title:course.title,summary:course.summary||course.desired_outcome,status})});p.updateData(d=>({...d,courses:d.courses.map(c=>c.id===course.id?{...c,status}:c)}));if(p.remote)await p.refreshRemote();p.flashToast(status==="paused"?"Course paused. Your notes and attempts are kept.":"Course resumed.");}catch(e){p.flashToast(e.message);}}
  return <div className="course-detail-layout grid gap-4 items-start"><div className="course-detail-main flex flex-col gap-4"><section className="panel course-detail-hero flex flex-col gap-4 p-4"><div className="course-art course-art-large"><span>YOUR LEARNING PATH</span></div><div className="course-detail-title flex flex-col gap-2"><div className="flex items-center gap-2 flex-wrap"><span className={`status-pill ${course.status}`}>{course.status}</span>{isGenerating&&<span className="materials-status-pill" role="status" aria-live="polite"><Icon name="spark" size={14}/> Generating study materials in background...</span>}</div><h2>{course.title}</h2><p>{course.summary||course.desired_outcome}</p><div className="course-facts flex flex-wrap gap-4"><span><Icon name="clock" size={15}/>{course.target_weeks||course.durationWeeks||8} weeks</span><span><Icon name="book" size={15}/>{total} lessons</span><span><Icon name="progress" size={15}/>{course.modules?.length||0} modules</span></div><div className="course-hero-actions flex flex-wrap items-center gap-3">{["active","paused"].includes(course.status)&&<button className="text-button course-pause-action" onClick={toggleStatus}>{course.status==="paused"?"Resume course ↗":"Pause course"}</button>}{p.confirmDeleteCourse&&<button type="button" className="quiet-btn danger course-delete-btn" disabled={p.deletingCourseId===course.id} onClick={()=>p.confirmDeleteCourse(course,"courses")}>Delete course</button>}</div></div></section>
    {isGenerating&&<div className="materials-status-banner flex items-center justify-between gap-3 p-3.5 rounded-xl" role="status" aria-live="polite"><div className="flex items-center gap-2.5 flex-wrap"><span className="materials-status-pill"><Icon name="spark" size={14}/> Generating study materials in background...</span><span className="text-sm text-learnos-muted">Creating study notes, review flashcards, and checkpoints.</span></div><span className="materials-pulse-dot" aria-hidden="true"/></div>}
    <div className="course-roadmap-header flex items-center justify-between"><div><span className="eyebrow">COURSE ROADMAP</span><h2>Follow the sequence</h2></div><button className="text-button" onClick={()=>p.go("today")}>View study plan ↗</button></div><div className="detail-module-list flex flex-col gap-3">{course.modules?.map((mod,i)=><section className={`panel detail-module flex flex-col overflow-hidden ${expanded===i?"open":""}`} key={mod.id||i}><button className="detail-module-head flex items-center justify-between p-3.5 w-full text-left cursor-pointer" onClick={()=>setExpanded(expanded===i?-1:i)} aria-expanded={expanded===i}><span className={`module-number ${mod.status||"planned"}`}>{mod.status==="completed"?"✓":String(i+1).padStart(2,"0")}</span><span className="detail-module-title flex-1 min-w-0"><strong>{mod.title}</strong><small className="block text-sm text-learnos-muted">{mod.objective}</small></span><span className="module-count text-sm font-semibold text-learnos-muted">{mod.lessons?.length||0} lessons</span><span className="expand-icon" aria-hidden="true">{expanded===i?"−":"+"}</span></button>{expanded===i&&<div className="detail-lessons flex flex-col border-t border-learnos-line">{mod.lessons?.map((lesson,j)=>{const lessonTasks=p.data.tasks.filter(t=>t.lesson_id===lesson.id);const task=lessonTasks.find(t=>t.task_type!=="practice")||lessonTasks[0];const practiceTask=lessonTasks.find(t=>t.task_type==="practice");const isDone=task?.status==="completed"||lessonTasks.some(t=>t.status==="completed");return <div key={lesson.id||j} className="detail-lesson-row flex flex-col"><button className="detail-lesson flex items-center justify-between gap-3 p-3 text-left hover:bg-learnos-surface-hover transition-colors" onClick={()=>p.openLesson(lesson.id)} aria-label={`Open lesson: ${lesson.title}`}><span className={`lesson-state ${isDone?"complete":""}`}>{isDone?"✓":String(j+1).padStart(2,"0")}</span><span className="flex-1 min-w-0"><div className="flex items-center gap-2"><Icon name="book" size={14}/><strong>{lesson.title}</strong></div><small className="block text-sm text-learnos-muted">{lesson.objective}</small></span><span className="lesson-duration text-sm font-medium text-learnos-muted">{minuteLabel(lesson.estimated_minutes||25)}</span><span className="lesson-arrow" aria-hidden="true">↗</span></button>{practiceTask&&<div className="detail-practice-task flex items-center justify-between gap-3 px-4 py-2 text-sm"><span className="flex items-center gap-2 text-learnos-muted"><Icon name="practice" size={14}/><span>Practice: {practiceTask.title}</span><span className="task-type-badge practice">practice</span></span><button type="button" className="text-button text-sm" onClick={()=>{p.setActiveLessonId(lesson.id);p.go("practice");}}>{practiceTask.status==="completed"?"Review evidence ↗":"Start practice ↗"}</button></div>}</div>;})}</div>}</section>)}</div>
    {courseTasks.filter(t=>t.task_type==="roadmap"||(t.task_type==="practice"&&!t.lesson_id)).length>0&&<section className="panel course-tasks-section flex flex-col p-4 gap-3"><div className="panel-title flex items-center gap-2"><Icon name="progress" size={16}/><span>Roadmap milestones & practice</span></div><div className="task-list flex flex-col gap-2">{courseTasks.filter(t=>t.task_type==="roadmap"||(t.task_type==="practice"&&!t.lesson_id)).map(t=><div key={t.id} className="task-row flex items-center gap-3 p-3"><Icon name={t.task_type==="practice"?"practice":"progress"} size={15}/><div className="task-main-copy flex flex-col flex-1 min-w-0"><strong>{t.title}</strong><span className="text-sm text-learnos-muted">{minuteLabel(t.estimated_minutes)}</span></div><span className={`task-status ${t.status}`}>{t.status.replace("_"," ")}</span><button className="continue-btn" onClick={()=>t.task_type==="practice"?p.go("practice"):p.go("today")}>{t.task_type==="practice"?"Practice ↗":"View in plan ↗"}</button></div>)}</div></section>}
  </div>
    <aside className="course-detail-aside flex flex-col gap-4"><Panel title="Course progress" icon="progress"><div className="course-progress-aside flex flex-col items-center gap-3 p-4"><div className="progress-ring-small" style={{"--progress":`${p.progressPercent}%`}}><strong>{p.progressPercent}%</strong></div><p className="text-center text-sm">{p.data.tasks.filter(t=>t.status==="completed"&&t.course_id===course.id).length} of {p.data.tasks.filter(t=>t.course_id===course.id).length} study sessions complete</p><button className="text-button" onClick={()=>p.go("progress")}>View progress details ↗</button></div></Panel><Panel title="Course outcome" icon="check"><div className="side-panel-copy p-4 text-sm leading-relaxed"><p>{course.desired_outcome||course.summary}</p></div></Panel><Panel title="Quick tools" icon="spark"><div className="quick-tool-list flex flex-col gap-1.5 p-2"><button onClick={()=>p.go("notes")}><Icon name="notes"/>Course notes <span>↗</span></button><button onClick={()=>p.go("flashcards")}><Icon name="cards"/>Review flashcards <span>↗</span></button><button onClick={()=>p.go("practice")}><Icon name="practice"/>Practice checkpoints <span>↗</span></button><button onClick={()=>p.go("tutor")}><Icon name="tutor"/>Ask your tutor <span>↗</span></button></div></Panel></aside></div>;
}
const CourseDetailPage = CoursePage;

function LessonPage(p){
  const lesson=p.activeLesson;
  const [selected,setSelected]=useState(null),[feedback,setFeedback]=useState(null),[saving,setSaving]=useState(false);
  const [depth,setDepth]=useState("standard"),[tailored,setTailored]=useState({}),[loadingDepth,setLoadingDepth]=useState(false);

  useEffect(()=>{setSelected(null);setFeedback(null);setDepth("standard");setTailored({});setLoadingDepth(false);},[lesson?.id]);
  if(!lesson)return <EmptyState title="Choose a lesson to begin" body="Open a course roadmap or choose a task from today’s plan." action="View courses" onAction={()=>p.go("courses")}/>;
  const checkpoint=lesson.checkpoint||{};
  const paragraphs=String(lesson.content_markdown||lesson.content||"Start with the objective, then connect the key idea to a small example. Check your understanding before moving on.").split(/\n\n+/);
  const all=p.lessons;const at=all.findIndex(l=>l.id===lesson.id);const previous=all[at-1],next=all[at+1];
  const answer=async()=>{if(selected===null)return;p.setActiveLessonId(lesson.id);setSaving(true);const result=await p.submitCheckpoint(selected);setFeedback(result);setSaving(false);};

  const handleDepthChange=async(newDepth)=>{
    setDepth(newDepth);
    if(newDepth==="standard")return;
    if(tailored[newDepth])return;
    if(p.remote){
      setLoadingDepth(true);
      const promptText=newDepth==="simpler"
        ?`Explain "${lesson.title}" (${lesson.objective}) in simpler terms using an intuitive everyday analogy. Break down the core intuition so it is easy to visualize and grasp immediately.`
        :`Provide a deep-dive technical breakdown of "${lesson.title}" (${lesson.objective}), detailing underlying mechanisms, architectural principles, edge cases, and performance/system trade-offs.`;
      const reply=await p.sendTutor({mode:"Explain",prompt:promptText});
      const text=typeof reply==="string"?reply:reply?.text;
      if(text)setTailored(prev=>({...prev,[newDepth]:text}));
      setLoadingDepth(false);
    }else{
      const localAnalogy=newDepth==="simpler"
        ?`Intuitive Analogy for ${lesson.title}:\nThink of this concept like an everyday routine: ${lesson.objective}. Before worrying about syntax or intricate details, imagine the big picture flow and why each step naturally follows the one before it.`
        :`Deep Dive into ${lesson.title}:\nExploring ${lesson.objective}: Notice how the underlying components coordinate, what failure modes or edge cases arise in production, and how this links with adjacent patterns.`;
      setTailored(prev=>({...prev,[newDepth]:localAnalogy}));
    }
  };

  return <div className="lesson-layout grid gap-4 items-start"><article className="lesson-reading panel flex flex-col"><div className="lesson-toolbar flex items-center justify-between p-3.5 border-b border-learnos-line"><button className="quiet-action" onClick={()=>p.go("course")}>← Course roadmap</button><span className="text-sm font-semibold text-learnos-muted uppercase tracking-wider">{lesson.moduleTitle}</span><button className="quiet-action" onClick={()=>p.go("tutor")}>Ask tutor ↗</button></div><div className="lesson-content flex flex-col p-6 gap-5"><div className="lesson-meta flex items-center justify-between text-sm text-learnos-muted"><span><Icon name="clock" size={14}/>{minuteLabel(lesson.estimated_minutes||25)}</span><span>Lesson {at+1} of {all.length}</span></div><h2>{lesson.title}</h2><div className="lesson-objective flex flex-col gap-1 p-3.5 rounded-lg bg-learnos-bg/60 border border-learnos-line"><span>LEARNING OBJECTIVE</span><p>{lesson.objective}</p></div><div className="explanation-depth-bar flex items-center justify-between gap-3 p-2.5 rounded-lg bg-learnos-surface border border-learnos-line"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold text-learnos-muted uppercase tracking-wider">Depth:</span><div className="depth-selector flex flex-wrap items-center gap-1.5" role="group" aria-label="Explanation depth">{[["standard","Standard"],["simpler","Simpler (with analogy)"],["deep","Deep dive"]].map(([key,label])=><button key={key} type="button" className={`cursor-pointer text-sm px-2.5 py-1 rounded transition-colors ${depth===key?"selected font-bold text-learnos-purple bg-learnos-purple/15 border border-learnos-purple/40":"text-learnos-muted hover:text-learnos-text"}`} onClick={()=>handleDepthChange(key)}>{label}</button>)}</div></div>{depth!=="standard"&&p.remote&&<button type="button" className="text-button text-sm" disabled={loadingDepth} onClick={()=>{setTailored(prev=>{const n={...prev};delete n[depth];return n;});handleDepthChange(depth);}}>Regenerate ↻</button>}</div>{lesson.prerequisites?.length>0&&<div className="prereq-row flex flex-wrap items-center gap-2"><strong>Before you start</strong>{lesson.prerequisites.map((item,i)=><span key={i}>{item}</span>)}</div>}{depth==="simpler"?(loadingDepth?<div className="depth-loading p-4 rounded-xl border border-learnos-line flex items-center gap-2 text-sm text-learnos-muted"><Icon name="spark" size={16}/><span>Consulting AI tutor for an intuitive analogy and simpler breakdown…</span></div>:<section className="depth-explanation panel flex flex-col gap-3 p-4 rounded-xl border border-learnos-purple/30 bg-learnos-purple/5"><div className="flex items-center gap-2 text-learnos-purple font-semibold text-sm"><Icon name="spark" size={17}/><span>Simpler explanation (with analogy)</span></div><div className="reading-copy flex flex-col gap-3 text-sm leading-relaxed">{(tailored.simpler||"").split(/\n\n+/).map((para,i)=><p key={i}>{para}</p>)}</div></section>):depth==="deep"?(loadingDepth?<div className="depth-loading p-4 rounded-xl border border-learnos-line flex items-center gap-2 text-sm text-learnos-muted"><Icon name="spark" size={16}/><span>Consulting AI tutor for deep dive and edge cases…</span></div>:<section className="depth-explanation panel flex flex-col gap-3 p-4 rounded-xl border border-learnos-lime/30 bg-learnos-lime/5"><div className="flex items-center gap-2 text-learnos-lime font-semibold text-sm"><Icon name="spark" size={17}/><span>Deep dive breakdown & edge cases</span></div><div className="reading-copy flex flex-col gap-3 text-sm leading-relaxed">{(tailored.deep||"").split(/\n\n+/).map((para,i)=><p key={i}>{para}</p>)}</div></section>):(<div className="reading-copy flex flex-col gap-4 leading-relaxed">{paragraphs.map((text,i)=><p key={i}>{text}</p>)}</div>)}{(lesson.worked_example||lesson.workedExample)&&<section className="worked-example flex flex-col gap-2 p-4 rounded-xl border border-learnos-line"><div><Icon name="spark" size={17}/>Worked example</div><p>{lesson.worked_example||lesson.workedExample}</p></section>}<div className="lesson-checkpoint flex flex-col gap-3 p-5 rounded-xl border border-learnos-line"><span className="eyebrow">CHECK YOUR UNDERSTANDING</span><h3>{checkpoint.question||"Explain the main idea in your own words."}</h3>{checkpoint.options?.length?<div className="answer-options flex flex-col gap-2">{checkpoint.options.map((option,i)=><button key={i} className={`answer-option ${selected===i?"selected":""} ${feedback&&i===checkpoint.answerIndex?"answer-correct":""}`} onClick={()=>{setSelected(i);setFeedback(null);}}><span>{String.fromCharCode(65+i)}</span>{option}</button>)}</div>:<textarea className="free-answer" value={selected||""} onChange={e=>setSelected(e.target.value)} placeholder="Write your explanation…"/>}{feedback&&<div className={`feedback-box flex flex-col gap-1 p-3.5 rounded-lg ${feedback.correct?"correct":"incorrect"}`} role="status"><strong>{feedback.correct?"Checkpoint passed":"Try that idea again"}</strong><p>{feedback.explanation}</p></div>}<div className="checkpoint-actions flex items-center justify-between gap-3 mt-2"><p className="text-sm text-learnos-muted">Submitting records an attempt. The task is complete when the checkpoint is passed.</p><button className="primary-btn" disabled={selected===null||saving} onClick={answer}>{saving?<><span className="btn-spinner"/> Checking…</>:feedback?.correct?"Passed ✓":"Submit answer"}</button></div></div><div className="lesson-bottom-nav flex items-center justify-between pt-4 border-t border-learnos-line"><button className="quiet-action" disabled={!previous} onClick={()=>p.openLesson(previous.id)}>← {previous?.title||"Previous"}</button><button className="quiet-action" disabled={!next} onClick={()=>p.openLesson(next.id)}>{next?.title||"Next lesson"} →</button></div></div></article>
    <aside className="lesson-rail flex flex-col gap-4"><Panel title="Lesson tools" icon="spark"><div className="quick-tool-list flex flex-col gap-1.5 p-2"><button onClick={()=>p.draftNote(lesson.id)}><Icon name="notes"/>Draft lesson notes <span>↗</span></button><button onClick={()=>p.addFlashcard({front:`What is the key idea in “${lesson.title}”?`,back:lesson.objective,lessonId:lesson.id,courseId:p.activeCourse?.id})}><Icon name="cards"/>Make a flashcard <span>↗</span></button><button onClick={()=>p.go("tutor")}><Icon name="tutor"/>Ask the tutor <span>↗</span></button></div></Panel><Panel title="In this course" icon="book"><div className="lesson-course-nav flex flex-col gap-3 p-3">{p.activeCourse?.modules?.map((m,i)=><div key={m.id||i} className="flex flex-col gap-1"><strong>{m.title}</strong>{m.lessons?.map(l=><button className={`text-left text-sm p-1.5 rounded transition-colors ${l.id===lesson.id?"active font-bold text-learnos-purple bg-learnos-purple/10":"text-learnos-muted hover:text-learnos-text"}`} key={l.id} onClick={()=>p.openLesson(l.id)}>{l.title}</button>)}</div>)}</div></Panel><div className="lesson-evidence-note flex items-start gap-3 p-3.5 panel"><Icon name="check"/><div><strong>Progress tracks two things</strong><p className="text-sm text-learnos-muted">Finished sessions and submitted understanding evidence are kept separately.</p><button className="text-button" onClick={()=>p.go("progress")}>View your evidence ↗</button></div></div></aside></div>;
}

function SearchPage(p){const results=p.searchResults||{courses:[],lessons:[],notes:[],flashcards:[]};const has=(results.courses?.length||0)+(results.lessons?.length||0)+(results.notes?.length||0)+(results.flashcards?.length||0);return has?<div className="search-results-page flex flex-col gap-4">{results.courses?.length>0&&<Panel title="Courses" icon="book">{results.courses.map(c=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={c.id} onClick={()=>{p.updateData(d=>({...d,activeCourseId:c.id}));p.go("course");}}><strong>{c.title}</strong><small className="text-sm text-learnos-muted">{c.status} course</small><span>↗</span></button>)}</Panel>}{results.lessons?.length>0&&<Panel title="Lessons" icon="progress">{results.lessons.map(l=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={l.id} onClick={()=>p.openLesson(l.id)}><strong>{l.title}</strong><small className="text-sm text-learnos-muted">{l.course_title} · {l.objective}</small><span>↗</span></button>)}</Panel>}{results.notes?.length>0&&<Panel title="Notes" icon="notes">{results.notes.map(n=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={n.id} onClick={()=>p.go("notes")}><strong>{n.title}</strong><small className="text-sm text-learnos-muted">{String(n.body).slice(0,130)}</small><span>↗</span></button>)}</Panel>}{results.flashcards?.length>0&&<Panel title="Flashcards" icon="cards">{results.flashcards.map(card=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={card.id} onClick={()=>p.go("flashcards")}><strong>{card.front}</strong><small className="text-sm text-learnos-muted">{String(card.back).slice(0,130)}</small><span>↗</span></button>)}</Panel>}</div>:<EmptyState title="No matching learning material" body="Try a saved note, flashcard, course title, or lesson phrase." action="Back home" onAction={()=>p.go("home")}/>;}

export function LoginPage({loginMode,setLoginMode,authSubmit,authError,authMessage,setAuthError,setAuthMessage,go,user,logout,returnPage="home",authBusy=false}){
  const switchAuthMode=mode=>{
    if(setLoginMode)setLoginMode(mode);
    if(setAuthError)setAuthError("");
    if(setAuthMessage)setAuthMessage("");
    if(mode==="signup")location.hash="#/signup";
    else if(mode==="login")location.hash="#/login";
  };
  const backTarget=returnPage&&returnPage!=="login"&&returnPage!=="signup"&&returnPage!=="auth"?returnPage:"home";
  return <div className="login-fullpage">
    <header className="login-fullpage-header">
      <button type="button" className="login-brand-link" onClick={()=>go("home")} aria-label="Drizzlearn Home">
        <div className="brand-mark grid place-items-center">✦</div>
        <div className="brand-name font-bold text-lg">Drizzlearn</div>
        <span className="brand-ai">AI</span>
      </button>
      <button type="button" className="login-back-btn" onClick={()=>go(backTarget)} aria-label="Back to workspace">
        <span>←</span>
        <span>Back to workspace</span>
      </button>
    </header>
    <main className="login-fullpage-main">
      {user?<section className="auth-page-card panel flex flex-col items-center text-center gap-4">
        <span className="auth-kicker eyebrow">LOGGED IN</span>
        <h2 className="text-2xl font-bold">You are signed in</h2>
        <p className="text-sm text-learnos-muted">Signed in as <strong>{user.fullName||user.email}</strong> ({user.email}).</p>
        <div className="flex items-center gap-3 mt-3 w-full">
          <button type="button" className="secondary-btn flex-1" onClick={logout}>Sign out</button>
          <button type="button" className="primary-btn flex-1" onClick={()=>go("home")}>Open workspace ↗</button>
        </div>
      </section>:<section className="auth-page-card panel flex flex-col gap-4" aria-labelledby="authTitle">
        <div className="auth-heading flex flex-col items-start gap-1">
          <span className="auth-kicker eyebrow self-start">ACCOUNT</span>
          <h1 id="authTitle" className="text-2xl font-bold tracking-tight">{loginMode==="login"?"Welcome back":loginMode==="signup"?"Create your account":"Reset your password"}</h1>
          <p className="text-sm text-learnos-muted">{loginMode==="login"?"Sign in to continue your personalized learning.":loginMode==="signup"?"Save your courses, flashcards, notes, and study progress.":"Enter your email address and we’ll send a reset link."}</p>
        </div>
        {loginMode!=="forgot"&&<div className="auth-tabs" role="group" aria-label="Account type">{["login","signup"].map(id=><button key={id} type="button" aria-pressed={loginMode===id} className={`auth-tab-btn ${loginMode===id?"active":""}`} onClick={()=>switchAuthMode(id)}>{id==="login"?"Sign in":"Create account"}</button>)}</div>}
        {loginMode==="forgot"&&<button className="auth-back text-button text-sm self-start" type="button" onClick={()=>switchAuthMode("login")}>← Back to sign in</button>}
        <form id="auth-form" className="auth-form flex flex-col gap-3" onSubmit={authSubmit}>
          {loginMode==="signup"&&<label className="flex flex-col gap-1 text-sm font-semibold">Full name<input name="fullName" autoComplete="name" minLength="2" required placeholder="Your name"/></label>}
          <label className="flex flex-col gap-1 text-sm font-semibold">Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" autoFocus/></label>
          {loginMode!=="forgot"&&<label className="flex flex-col gap-1 text-sm font-semibold">Password<input name="password" type="password" autoComplete={loginMode==="login"?"current-password":"new-password"} minLength="10" required placeholder="At least 10 characters"/></label>}
          {loginMode==="login"&&<button className="auth-forgot text-button text-sm self-start" type="button" onClick={()=>switchAuthMode("forgot")}>Forgot password?</button>}
          {authError&&<p className="form-error" role="alert">{authError}</p>}
          {authMessage&&<p className="form-success" role="status">{authMessage}</p>}
          <button className="primary-btn mt-2" type="submit" disabled={authBusy}>{authBusy?<><span className="btn-spinner"/> {loginMode==="signup"?"Creating account…":loginMode==="forgot"?"Sending link…":"Signing in…"}</>:loginMode==="login"?"Sign in":loginMode==="signup"?"Create account":"Send reset link"}</button>
        </form>
        <div className="auth-switch-note text-center pt-2 border-t border-learnos-line/40 text-sm text-learnos-muted">
          {loginMode==="login"?<span>Don&apos;t have an account? <button type="button" className="text-button text-sm font-semibold underline text-learnos-purple" onClick={()=>switchAuthMode("signup")}>Create one</button></span>:loginMode==="signup"?<span>Already have an account? <button type="button" className="text-button text-sm font-semibold underline text-learnos-purple" onClick={()=>switchAuthMode("login")}>Sign in</button></span>:<button type="button" className="text-button text-sm font-semibold text-learnos-purple" onClick={()=>switchAuthMode("login")}>Return to sign in</button>}
        </div>
      </section>}
    </main>
    <footer className="login-fullpage-footer">
      <span>✦ Drizzlearn AI Learning Platform</span>
      <span>Local drafts &amp; progress preserved</span>
    </footer>
  </div>;
}

export function Modal({modal,onClose,onApprove,onDeleteCourse,deletingCourse=false,deleteCourseError="",loginMode,setLoginMode,authSubmit,authError,authMessage,setAuthError,setAuthMessage,logout,authBusy=false}){
  const switchAuthMode=mode=>{setLoginMode(mode);setAuthError("");setAuthMessage("");};
  useEffect(()=>{const close=e=>{if(e.key==="Escape"&&!deletingCourse)onClose();};window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);},[onClose,deletingCourse]);
  const isProposalDelete=modal.type==="delete-course"&&modal.course?.status==="proposal";
  const modalHeading=modal.type==="overload"?"This plan needs more time":modal.type==="delete-course"?(isProposalDelete?"Delete course proposal?":"Delete course?"):modal.type==="account"?"Your Drizzlearn account":"Drizzlearn";
  return <div className="modal-backdrop open fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!deletingCourse)onClose();}}><section className={`modal ${modal.type==="account"?"auth-modal":""} panel flex flex-col max-w-lg w-full overflow-hidden`} role="dialog" aria-modal="true" aria-labelledby="modalTitle"><div className="modal-head flex items-center justify-between p-4 border-b border-learnos-line"><h2 id="modalTitle" className="text-lg font-bold">{modalHeading}</h2><button className="modal-close p-1 cursor-pointer text-learnos-muted hover:text-learnos-text" disabled={deletingCourse} onClick={onClose} aria-label="Close">×</button></div><div className={`modal-body ${modal.type==="account"?"auth-modal-body p-5 sm:p-6":"p-6"} flex flex-col gap-4`}>
    {modal.type==="overload"&&<div className="overload-copy flex flex-col gap-3"><p>This plan is estimated at <strong>{Math.round((modal.details?.neededPerWeek||0)/60*10)/10} hours per week</strong>, above the current budget of <strong>{Math.round((modal.details?.weeklyMinutes||0)/60)} hours</strong>.</p><p>You can adjust the goal details or continue with the plan as written.</p><div className="modal-actions flex justify-end gap-3 mt-3"><button className="secondary-btn" onClick={onClose}>Review schedule</button><button className="primary-btn" onClick={onApprove}>Approve anyway</button></div></div>}
    {modal.type==="delete-course"&&modal.course&&<div className="delete-course-copy flex flex-col gap-3"><div className="delete-course-target"><strong>{modal.course.title}</strong><span>{modal.course.status==="proposal"?"Draft proposal":`${modal.course.modules?.length||0} modules · ${modal.course.modules?.reduce((n,m)=>n+(m.lessons?.length||0),0)||0} lessons`}</span></div><p>This permanently deletes the {isProposalDelete?"proposal":"course"}, its modules, lessons, and scheduled study sessions.</p><p>Any notes or flashcards you saved stay in your workspace.</p>{deleteCourseError&&<p className="form-error" role="alert">{deleteCourseError}</p>}<div className="modal-actions flex justify-end gap-3 mt-2"><button type="button" className="secondary-btn" disabled={deletingCourse} onClick={onClose}>Cancel</button><button type="button" className="danger-btn" disabled={deletingCourse} onClick={()=>onDeleteCourse?.(modal.course,modal.redirectTo)}>{deletingCourse?<><span className="btn-spinner"/> Deleting…</>:(isProposalDelete?"Delete proposal":"Delete course")}</button></div></div>}
    {modal.type==="account"&&<div className="auth-panel flex flex-col gap-3.5">
      <div className="auth-heading flex flex-col items-start gap-1">
        <span className="auth-kicker eyebrow self-start">ACCOUNT</span>
        <h3 className="text-xl font-bold">{loginMode==="login"?"Welcome back":loginMode==="signup"?"Create your account":"Reset your password"}</h3>
        <p className="text-sm text-learnos-muted">{loginMode==="login"?"Sign in to continue.":loginMode==="signup"?"Save your courses and progress.":"Enter your email address and we’ll send a reset link."}</p>
      </div>
      {loginMode!=="forgot"&&<div className="auth-tabs" role="group" aria-label="Account type">{["login","signup"].map(id=><button key={id} type="button" aria-pressed={loginMode===id} className={`auth-tab-btn ${loginMode===id?"active":""}`} onClick={()=>switchAuthMode(id)}>{id==="login"?"Sign in":"Create account"}</button>)}</div>}
      {loginMode==="forgot"&&<button className="auth-back text-button text-sm self-start" type="button" onClick={()=>switchAuthMode("login")}>← Back to sign in</button>}
      <form id="auth-form" className="auth-form flex flex-col gap-2.5" onSubmit={authSubmit}>
        {loginMode==="signup"&&<label className="flex flex-col gap-1 text-sm font-semibold">Full name<input name="fullName" autoComplete="name" minLength="2" required placeholder="Your name"/></label>}
        <label className="flex flex-col gap-1 text-sm font-semibold">Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com" autoFocus/></label>
        {loginMode!=="forgot"&&<label className="flex flex-col gap-1 text-sm font-semibold">Password<input name="password" type="password" autoComplete={loginMode==="login"?"current-password":"new-password"} minLength="10" required placeholder="At least 10 characters"/></label>}
        {loginMode==="login"&&<button className="auth-forgot text-button text-sm self-start" type="button" onClick={()=>switchAuthMode("forgot")}>Forgot password?</button>}
        {authError&&<p className="form-error" role="alert">{authError}</p>}
        {authMessage&&<p className="form-success" role="status">{authMessage}</p>}
        <button className="primary-btn mt-1.5" type="submit" disabled={authBusy}>{authBusy?<><span className="btn-spinner"/> {loginMode==="signup"?"Creating account…":loginMode==="forgot"?"Sending link…":"Signing in…"}</>:loginMode==="login"?"Sign in":loginMode==="signup"?"Create account":"Send reset link"}</button>
      </form>
    </div>}
    {modal.type==="account-actions"&&<div className="flex justify-end"><button className="secondary-btn" onClick={logout}>Sign out</button></div>}
  </div></section></div>;
}

function VerifyPage(p){
  const [state,setState]=useState("checking"),[message,setMessage]=useState("Checking your verification link…");
  useEffect(()=>{const params=new URLSearchParams(location.hash.split("?")[1]||""),token=params.get("token");if(!token){setState("error");setMessage("This verification link is missing its token.");return;}p.request("auth/verify",{method:"POST",body:JSON.stringify({token})}).then(()=>{setState("success");setMessage("Your email is verified. Your account is ready.");}).catch(error=>{setState("error");setMessage(error.message);});},[]);
  return <div className="panel auth-result flex flex-col items-center justify-center p-8 gap-4 max-w-md mx-auto text-center"><span className={`empty-orb ${state}`}><Icon name={state==="success"?"check":"spark"}/></span><h2 className="text-xl font-bold">{state==="checking"?"Checking your link":state==="success"?"Email verified":"Could not verify email"}</h2><p className="text-learnos-muted text-sm">{message}</p><button className="primary-btn" onClick={()=>p.go("home")}>Return to Drizzlearn ↗</button></div>;
}
function ResetPasswordPage(p){
  const [password,setPassword]=useState(""),[confirmation,setConfirmation]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[done,setDone]=useState(false);
  async function submit(e){e.preventDefault();setError("");setMessage("");if(password!==confirmation){setError("The passwords do not match.");return;}const token=new URLSearchParams(location.hash.split("?")[1]||"").get("token");try{await p.request("auth/reset-password",{method:"POST",body:JSON.stringify({token,password})});setDone(true);setMessage("Your password was updated. You can sign in again.");}catch(e){setError(e.message);}}
  return <form className="panel reset-password-panel flex flex-col p-6 gap-4 max-w-md mx-auto" onSubmit={submit}><span className="eyebrow">ACCOUNT SECURITY</span><h2 className="text-xl font-bold">{done?"Password updated":"Choose a new password"}</h2><p className="text-sm text-learnos-muted">{message||"Choose a password with at least 10 characters."}</p>{!done&&<><label className="flex flex-col gap-1 text-sm font-semibold">New password<input type="password" minLength="10" required value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="flex flex-col gap-1 text-sm font-semibold">Confirm password<input type="password" minLength="10" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>{error&&<p className="form-error">{error}</p>}<button className="primary-btn" type="submit">Update password ↗</button></>}<button className="text-button self-start" type="button" onClick={p.openAccount}>Back to sign in</button></form>;
}
