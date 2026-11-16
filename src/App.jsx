import { AmbientFocusStation } from "./components/AmbientFocusStation.jsx";
import { DiaryTodoSection } from "./components/DiaryTodoSection.jsx";
import { SnowfallOverlay } from "./components/SnowfallOverlay.jsx";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TutorMarkdown } from "./tutor-markdown.jsx";
import { FlashcardPortalModal } from "./flashcard-portal.jsx";
import { previewFlashcardIntervals, scheduleFlashcardReview } from "./srs.js";
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
import {
  calculateLearnerMetrics,
  recordBehavior,
} from "./behavior-tracking.js";
import {
  buildPath,
  getActiveNav,
  getPageTitle,
  getRouteContext,
  navigateTo,
  parseLocation,
  shouldInterceptNavClick,
  updateDocumentMeta,
} from "./router.js";

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

function collectAllCourseLessons(courses=[],fallbackLessons=[],fallbackCourse=null){
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
const initialRoute=()=>typeof window==="undefined"?{page:"home",params:{},query:new URLSearchParams(),isLegacyHash:false}:parseLocation(window.location);
const initialPage=()=>initialRoute().page||"home";
const initialLoginMode=()=>initialRoute().page==="signup"?"signup":"login";
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
  const paths={home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1z"/></>,plus:<><path d="M12 5v14M5 12h14"/></>,book:<><path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/></>,calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,people:<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,notes:<><path d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,cards:<><rect x="4" y="5" width="14" height="16" rx="2"/><path d="M8 3h12a2 2 0 0 1 2 2v13M8 10h6M8 14h6"/></>,practice:<><path d="m8 5-6 7 6 7M16 5l6 7-6 7M14 3l-4 18"/></>,progress:<><path d="M4 20V12h4v8M10 20V5h4v15M16 20V2h4v18"/></>,tutor:<><rect x="4" y="6" width="16" height="13" rx="4"/><path d="M9 12h.01M15 12h.01M9 16h6M12 2v4"/></>,search:<><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,play:<path d="m8 5 11 7-11 7z"/>,check:<path d="m5 12 4 4L19 6"/>,arrow:<><path d="M5 12h14M13 6l6 6-6 6"/></>,arrowLeft:<><path d="M19 12H5M11 6l-6 6 6 6"/></>,alert:<><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></>,chevron:<><path d="m6 9 6 6 6-6"/></>,chevronLeft:<><path d="m15 18-6-6 6-6"/></>,chevronRight:<><path d="m9 18 6-6-6-6"/></>,spark:<path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>,edit:<><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>,trash:<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></>,eye:<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>};
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]||paths.spark}</svg>;
}

export default function App(){
  const [data,setData]=useState(loadSaved),[user,setUser]=useState(loadCachedUser),[remote,setRemote]=useState(()=>Boolean(loadCachedUser())),[page,setPage]=useState(initialPage),[routeParams,setRouteParams]=useState(()=>initialRoute().params),[routeQuery,setRouteQuery]=useState(()=>initialRoute().query),[toast,setToast]=useState(""),[busy,setBusy]=useState(false),[queryText,setQueryText]=useState(""),[searchResults,setSearchResults]=useState(null),[modal,setModal]=useState(null),[activeLessonId,setActiveLessonId]=useState(()=>initialRoute().params?.lessonId||null),[proposal,setProposal]=useState(null),[courseFilter,setCourseFilter]=useState("all"),[mobileMoreOpen,setMobileMoreOpen]=useState(false),[generatingCourseId,setGeneratingCourseId]=useState(null);
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
  useEffect(()=>{
    const syncRoute=(normalizeLegacy=false)=>{
      const parsed=parseLocation(window.location);
      if(parsed.page==="signup")setLoginMode("signup");
      else if(parsed.page==="login"||parsed.page==="auth")setLoginMode("login");
      setPage(parsed.page);
      setRouteParams(parsed.params);
      setRouteQuery(parsed.query);
      if(parsed.params?.lessonId)setActiveLessonId(parsed.params.lessonId);
      if(parsed.params?.courseId){
        setData(current=>current.activeCourseId===parsed.params.courseId?current:{...current,activeCourseId:parsed.params.courseId});
      }
      if(typeof document!=="undefined"){
        updateDocumentMeta(parsed.page,{url:buildPath(parsed.page,{params:parsed.params,query:parsed.query})});
      }
      if(normalizeLegacy&&parsed.isLegacyHash&&typeof window.history?.replaceState==="function"){
        navigateTo(parsed.page,{params:parsed.params,query:parsed.query,replace:true,scrollTop:false});
      }
    };
    const onRouteChange=()=>syncRoute(false);
    window.addEventListener("popstate",onRouteChange);
    window.addEventListener("hashchange",onRouteChange);
    syncRoute(true);
    return()=>{
      window.removeEventListener("popstate",onRouteChange);
      window.removeEventListener("hashchange",onRouteChange);
    };
  },[]);
  useEffect(()=>{
    recordBehavior("page_view",{page,courseId:routeParams?.courseId||null,lessonId:routeParams?.lessonId||null});
  },[page,routeParams?.courseId,routeParams?.lessonId]);
  useEffect(()=>{
    if(typeof window==="undefined")return;
    let userActive=false;
    const onUserActivity=()=>{userActive=true;};
    window.addEventListener("pointerdown",onUserActivity,{passive:true});
    window.addEventListener("keydown",onUserActivity,{passive:true});
    const interval=setInterval(()=>{
      if(userActive){
        recordBehavior("session_heartbeat",{minutes:1});
        userActive=false;
      }
    },60000);
    return()=>{
      clearInterval(interval);
      window.removeEventListener("pointerdown",onUserActivity);
      window.removeEventListener("keydown",onUserActivity);
    };
  },[]);
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
  const go=useCallback((next,options={})=>{
    const cleanOptions=options&&typeof options==="object"?options:{};
    const targetUrl=navigateTo(next,cleanOptions);
    const parsed=parseLocation({pathname:targetUrl.split("?")[0],search:targetUrl.includes("?")?`?${targetUrl.split("?")[1]}`:"",hash:""});
    if(parsed.page==="signup")setLoginMode("signup");
    else if(parsed.page==="login"||parsed.page==="auth")setLoginMode("login");
    setPage(parsed.page);
    setRouteParams(parsed.params);
    setRouteQuery(parsed.query);
    if(parsed.page!=="search")setSearchResults(null);
  },[]);
  const activeCourse=useMemo(()=>{
    if(routeParams?.courseId){
      return data.courses.find(c=>c.id===routeParams.courseId)||data.courses.find(c=>c.status==="active")||data.courses[0]||null;
    }
    const targetLessonId=routeParams?.lessonId||activeLessonId;
    if(targetLessonId){
      const byLesson=data.courses.find(c=>c.modules?.some(m=>m.lessons?.some(l=>l.id===targetLessonId)));
      if(byLesson)return byLesson;
    }
    return data.courses.find(c=>c.id===data.activeCourseId)||data.courses.find(c=>c.status==="active")||data.courses[0]||null;
  },[data,routeParams?.courseId,routeParams?.lessonId,activeLessonId]);
  const lessons=useMemo(()=>activeCourse?.modules?.flatMap(m=>m.lessons.map(l=>({...l,moduleTitle:m.title})))||[],[activeCourse]);
  const allLessons=useMemo(()=>collectAllCourseLessons(data.courses),[data.courses]);
  const activeLesson=useMemo(()=>{
    const targetLessonId=routeParams?.lessonId||activeLessonId;
    return lessons.find(l=>l.id===targetLessonId)||lessons.find(l=>l.id===data.tasks.find(t=>t.status!=="completed")?.lesson_id)||lessons[0]||null;
  },[lessons,activeLessonId,routeParams?.lessonId,data.tasks]);
  const dueCards=data.flashcards.filter(c=>!c.due_at||new Date(c.due_at)<=new Date());
  const completedTasks=data.tasks.filter(t=>t.status==="completed").length;
  const totalTasks=data.tasks.length||0;
  const progressPercent=totalTasks?Math.round(completedTasks/totalTasks*100):0;
  const pendingTasks=data.tasks.filter(t=>t.status!=="completed");
  const nextTask=pendingTasks.sort((a,b)=>new Date(a.scheduled_at||0)-new Date(b.scheduled_at||0))[0];
  const stats={notes:data.notes.length,flashcards:data.flashcards.length,attempts:data.attempts.length,completed:completedTasks,total:totalTasks};

  const openLesson=(id)=>{const target=data.courses.find(c=>c.modules?.some(m=>m.lessons?.some(l=>l.id===id)));if(target)updateData(current=>({...current,activeCourseId:target.id}));setActiveLessonId(id);go("lesson",{params:{lessonId:id}});};
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
      go("proposal",{params:{courseId:result.course?.id}});
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
      go("course",{params:{courseId:courseToApprove.id}});
    }catch(error){if(error.code==="PLAN_OVER_BUDGET"){setModal({type:"overload",details:error.details});}else flashToast(error.message);}finally{setBusy(false);}
  };
  const submitCheckpoint=async(answerIndex)=>{
    if(!activeLesson)return;const correct=Number(answerIndex)===Number(activeLesson.checkpoint?.answerIndex);
    try{
      if(remote)await request("practice",{method:"POST",body:JSON.stringify({lessonId:activeLesson.id,concept:activeLesson.title,prompt:activeLesson.checkpoint?.question,answer:activeLesson.checkpoint?.options?.[answerIndex]||"",selectedIndex:Number(answerIndex)})});
      if(remote&&correct){const task=data.tasks.find(t=>t.lesson_id===activeLesson.id&&t.status!=="completed");if(task)await request(`tasks/${task.id}/complete`,{method:"POST",body:JSON.stringify({actualMinutes:task.estimated_minutes})});}
      updateData(current=>{const attempts=[{id:`a-${Date.now()}`,lesson_id:activeLesson.id,concept:activeLesson.title,score:correct?100:0,created_at:new Date().toISOString()},...current.attempts];const tasks=current.tasks.map(t=>t.lesson_id===activeLesson.id&&correct?{...t,status:"completed",completed_at:new Date().toISOString()}:t);return {...current,attempts,tasks};});
      recordBehavior("checkpoint_attempt",{lessonId:activeLesson.id,concept:activeLesson.title,score:correct?100:0,passed:correct});
      if(correct){flashToast("Checkpoint passed. Understanding evidence saved.");if(remote)await refreshRemote();}else flashToast("Not quite. Review the explanation and try again.");
      return {correct,explanation:activeLesson.checkpoint?.explanation||"Review the lesson objective and try again."};
    }catch(error){flashToast(error.message);return {correct:false,explanation:"Your answer could not be saved. Try again when you are connected."};}
  };
  const saveNote=async(note)=>{
    try{
      if(remote){
        const result=note.id?await request(`notes/${note.id}`,{method:"PUT",body:JSON.stringify(note)}):await request("notes",{method:"POST",body:JSON.stringify(note)});
        const saved=result.note;
        updateData(c=>({...c,notes:[saved,...c.notes.filter(n=>n.id!==saved.id)]}));
      }
      else {
        // In local mode, if saving an ai_draft note for a lesson, deduplicate by updating existing AI draft if present
        const existingLocalAiNote=note.origin==="ai_draft"&&note.lessonId?data.notes.find(n=>n.lesson_id===note.lessonId&&n.origin==="ai_draft"):null;
        const noteIdToUse=note.id||existingLocalAiNote?.id||`n-${Date.now()}`;
        const saved={...note,id:noteIdToUse,origin:note.origin||"learner",updated_at:new Date().toISOString()};
        updateData(c=>({...c,notes:[saved,...c.notes.filter(n=>n.id!==saved.id)]}));
      }
      setModal(null);flashToast("Note saved.");
      recordBehavior("note_save",{noteId:note.id||undefined,origin:note.origin||"learner",courseId:note.course_id||note.courseId||null});
    }catch(error){flashToast(error.message);}
  };
  const draftNote=async(lessonId)=>{
    const lesson=data.courses.flatMap(c=>c.modules||[]).flatMap(m=>m.lessons||[]).find(l=>l.id===lessonId);
    if(!lesson)return flashToast("Open a lesson before drafting notes.");
    const existingAiNote=data.notes.find(n=>n.lesson_id===lessonId&&n.origin==="ai_draft");
    try{
      let body;
      if(remote){
        const result=await request("tutor",{method:"POST",body:JSON.stringify({mode:"Explain",prompt:"Turn this lesson into concise, editable study notes. Use a short summary and key points. Do not add facts or citations beyond the lesson.",lessonId})});
        body=result.reply;
      }else{
        body=`Objective\n${lesson.objective}\n\nKey ideas\n${String(lesson.content||lesson.content_markdown||"").split(/\n\n+/).slice(0,3).join("\n\n")}\n\nExample\n${lesson.workedExample||lesson.worked_example||"Add an example in your own words."}`;
      }
      await saveNote({
        id:existingAiNote?.id||undefined,
        title:`Notes — ${lesson.title}`,
        body,
        lessonId,
        sourceRef:lesson.title,
        origin:"ai_draft"
      });
    }catch(error){flashToast(error.message);}
  };
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
  const rateCard=async(card,rating)=>{
    try{
      const scheduled=scheduleFlashcardReview(card,rating);
      let serverCard=null;
      if(remote){
        const res=await request(`flashcards/${card.id}/review`,{method:"POST",body:JSON.stringify({rating})});
        serverCard=res?.flashcard||null;
      }
      updateData(c=>({
        ...c,
        flashcards:c.flashcards.map(x=>x.id===card.id?{...x,...scheduled,...(serverCard||{})}:x),
      }));
      recordBehavior("flashcard_review",{cardId:card.id,rating,isRetention:rating==="good"||rating==="easy"});
    }catch(error){
      flashToast(error.message);
    }
  };
  const addFlashcard=async(card)=>{
    const payload={
      front:card.front,
      back:card.back,
      hint:card.hint||"",
      cardType:card.cardType||card.card_type||"qa",
      origin:card.origin||"learner",
      courseId:card.courseId??card.course_id??null,
      lessonId:card.lessonId??card.lesson_id??null,
    };
    if(remote){
      const result=await request("flashcards",{method:"POST",body:JSON.stringify(payload)});
      updateData(c=>({...c,flashcards:[result.flashcard,...c.flashcards]}));
      flashToast("Flashcard added.");
      return result.flashcard;
    }
    const localCard={
      ...payload,
      card_type:payload.cardType,
      course_id:payload.courseId,
      lesson_id:payload.lessonId,
      id:`f-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      due_at:new Date().toISOString(),
      interval_days:0,
      ease:2.5,
      repetitions:0,
      lapses:0,
      state:"new",
    };
    updateData(c=>({...c,flashcards:[localCard,...c.flashcards]}));
    flashToast("Flashcard added.");
    return localCard;
  };
  const updateFlashcard=async(id,card)=>{
    const payload={
      front:card.front,
      back:card.back,
      hint:card.hint||"",
      cardType:card.cardType||card.card_type||"qa",
      courseId:card.courseId??card.course_id??null,
      lessonId:card.lessonId??card.lesson_id??null,
    };
    if(remote){
      const result=await request(`flashcards/${id}`,{method:"PUT",body:JSON.stringify(payload)});
      const updated=result?.flashcard;
      updateData(c=>({...c,flashcards:c.flashcards.map(x=>x.id===id?{...x,...(updated||payload),card_type:payload.cardType,course_id:payload.courseId,lesson_id:payload.lessonId}:x)}));
      flashToast("Flashcard updated.");
      return updated;
    }
    updateData(c=>({...c,flashcards:c.flashcards.map(x=>x.id===id?{...x,...payload,card_type:payload.cardType,course_id:payload.courseId,lesson_id:payload.lessonId}:x)}));
    flashToast("Flashcard updated.");
    return null;
  };
  const deleteFlashcard=async(id)=>{
    if(remote){
      await request(`flashcards/${id}`,{method:"DELETE"});
    }
    updateData(c=>({...c,flashcards:c.flashcards.filter(x=>x.id!==id)}));
    flashToast("Flashcard deleted.");
  };
  const addFlashcardsBatch=async(cards)=>{
    const created=[];
    for(const item of cards){
      if(remote){
        const res=await request("flashcards",{method:"POST",body:JSON.stringify(item)});
        if(res?.flashcard)created.push(res.flashcard);
      }else{
        created.push({
          ...item,
          card_type:item.cardType||"qa",
          course_id:item.courseId||null,
          lesson_id:item.lessonId||null,
          id:`f-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
          due_at:new Date().toISOString(),
          interval_days:0,
          ease:2.5,
          repetitions:0,
          lapses:0,
          state:"new",
        });
      }
    }
    if(created.length){
      updateData(c=>({...c,flashcards:[...created,...c.flashcards]}));
    }
    return created;
  };
  const sendTutor=async({mode,prompt,attempt,lessonId})=>{if(!prompt.trim())return null;if(!remote){flashToast("Sign in to connect the AI tutor.");return null;}const resolvedLessonId=lessonId===undefined?activeLesson?.id:lessonId;try{const r=await request("tutor",{method:"POST",body:JSON.stringify({mode,prompt,attempt,lessonId:resolvedLessonId||undefined})});recordBehavior("tutor_query",{mode,lessonId:resolvedLessonId||null});return {text:r.reply,structured:r.structured||null,mode:r.mode||mode,source:r.source,model:r.model||null,failoverCount:Number(r.failoverCount||0),sources:Array.isArray(r.sources)?r.sources:[]};}catch(error){const message=error?.message||"The tutor could not complete your request.";flashToast(message);return {error:message};}};
  const submitSearch=async(event)=>{event.preventDefault();if(!queryText.trim())return;try{if(remote){const result=await request(`search?q=${encodeURIComponent(queryText)}`);setSearchResults(result);}else{const q=queryText.toLowerCase();setSearchResults({courses:data.courses.filter(c=>c.title.toLowerCase().includes(q)),notes:data.notes.filter(n=>(n.title+n.body).toLowerCase().includes(q)),lessons:allLessons.filter(l=>(l.title+l.objective).toLowerCase().includes(q)).map(l=>({...l,course_title:l.courseTitle})),flashcards:data.flashcards.filter(c=>(c.front+c.back).toLowerCase().includes(q))});}go("search");}catch(error){flashToast(error.message);}};
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
  const activeNav=getActiveNav(page);
  const mobileToolPage=toolNavItems.some(([name])=>name===activeNav);
  const nav=(name,label,glyph,isHeader=false)=>{
    const isExact=page===name;
    const isActive=activeNav===name;
    return (
      <a
        key={name}
        href={buildPath(name)}
        className={`nav-link ${isHeader ? "header-nav-link" : ""} ${isActive ? "active" : ""}`}
        onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();setMobileMoreOpen(false);go(name);}}
        aria-current={isExact ? "page" : isActive ? "true" : undefined}
        aria-label={label}
        title={label}
      >
        <span className="nav-icon"><Icon name={glyph} size={19}/></span>
        <span className="nav-label-text">{label}</span>
      </a>
    );
  };

  if(page==="login"||page==="signup"||page==="auth"){
    return <>
      {(syncing||activeRequests>0||busy)&&<div className="global-progress-bar" role="progressbar" aria-label="Loading workspace data"/>}
      <LoginPage loginMode={loginMode} setLoginMode={setLoginMode} authSubmit={authSubmit} authError={authError} authMessage={authMessage} setAuthError={setAuthError} setAuthMessage={setAuthMessage} go={go} user={user} logout={logout} returnPage={returnPage} authBusy={authBusy} />
      {toast&&<div className="toast show fixed z-50" role="status" aria-live="polite">{toast}</div>}
    </>;
  }

  return <div className="app-shell flex min-h-screen relative">
    <SnowfallOverlay />
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
      <header className="topbar flex items-center justify-between gap-3.5 mb-7 sticky top-0 z-30" aria-label="Header navigation">
        <div className="header-brand-wrap flex items-center">
          <a href="#/" className="header-brand hanging-paperclip-brand flex items-center text-inherit no-underline cursor-pointer" onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("home");}} aria-label="Drizzlearn Home">
            {/* Hanging Paperclip Tag Container */}
            <div className="hanging-clip-anchor relative">
              {/* Layer 1: Back portion of paperclip (sits BEHIND the card tag) */}
              <div className="paperclip-metal clip-back-layer" aria-hidden="true">
                <svg className="paperclip-svg" viewBox="0 0 24 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M19 18 V46 C19 50.5 15.5 54 11 54 C6.5 54 3 50.5 3 46 V11 C3 5.5 6.5 2 11 2 C15.5 2 19 5.5 19 11" 
                    stroke="url(#clipBackGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                  <defs>
                    <linearGradient id="clipBackGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" />
                      <stop offset="40%" stopColor="#8de0fa" />
                      <stop offset="100%" stopColor="#1e3a45" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              {/* Layer 2: Hanging Paper Tag Card with left-to-right transparent fade */}
              <div className="hanging-card-tag flex items-center">
                <div className="brand-name tracking-wider">Drizzlearn</div>
              </div>

              {/* Layer 3: Front prong of paperclip (sits OVER the front face of the card) */}
              <div className="paperclip-metal clip-front-layer" aria-hidden="true">
                <svg className="paperclip-svg" viewBox="0 0 24 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11 2 C15.5 2 19 5.5 19 11 V40 C19 44 16.5 47 13 47 C9.5 47 7 44 7 40 V15 C7 12.5 8.8 10.5 11 10.5 C13.2 10.5 15 12.5 15 15 V33" 
                    stroke="url(#clipFrontGrad)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
                  <defs>
                    <linearGradient id="clipFrontGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ffffff" />
                      <stop offset="30%" stopColor="#a5f3fc" />
                      <stop offset="65%" stopColor="#6ccff6" />
                      <stop offset="100%" stopColor="#0891b2" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </a>
        </div>
        <nav className="header-nav flex items-center gap-1" aria-label="Main navigation">
          <div className="header-nav-group flex items-center gap-1">
            {primaryNavItems.map(([name,label,glyph])=>nav(name,label,glyph,true))}
          </div>
          <div className="header-nav-divider" aria-hidden="true" />
          <div className="header-nav-group flex items-center gap-1">
            {toolNavItems.map(([name,label,glyph])=>nav(name,label,glyph,true))}
          </div>
        </nav>
        <div className="header-actions flex items-center gap-3">
          {(syncing||activeRequests>0||busy)&&<span className="sync-indicator flex items-center gap-1.5 text-xs" role="status" aria-live="polite"><span className="btn-spinner"/><span>Loading...</span></span>}
          <form className="top-search flex items-center gap-2.5" onSubmit={submitSearch}>
            <Icon name="search"/><input value={queryText} onChange={e=>setQueryText(e.target.value)} type="search" placeholder="Search lessons and tools" aria-label="Search lessons and tools" />
          </form>
          <button className={`avatar grid place-items-center ${!(user?.fullName||data.settings.fullName)?"logged-out":""}`} type="button" aria-label={user?.fullName||data.settings.fullName||"Sign in"} title={user?.fullName||data.settings.fullName||"Sign in to your account"} onClick={()=>user?go("settings"):openAccount()}>
            {(user?.fullName||data.settings.fullName||"?").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}
          </button>
        </div>
      </header>
      <PageContent page={page} routeParams={routeParams} routeQuery={routeQuery} data={data} setData={setData} user={user} setUser={setUser} remote={remote} setRemote={setRemote} logout={logout} openAccount={openAccount} activeCourse={activeCourse} lessons={lessons} allLessons={allLessons} activeLesson={activeLesson} dueCards={dueCards} nextTask={nextTask} stats={stats} progressPercent={progressPercent} pendingTasks={pendingTasks} proposal={proposal} setProposal={setProposal} busy={busy} generationProgress={generationProgress} generationError={generationError} setGenerationError={setGenerationError} courseFilter={courseFilter} setCourseFilter={setCourseFilter} go={go} openLesson={openLesson} submitGoal={submitGoal} approveProposal={approveProposal} submitCheckpoint={submitCheckpoint} saveNote={saveNote} draftNote={draftNote} deleteNote={deleteNote} confirmDeleteCourse={confirmDeleteCourse} deletingCourseId={deletingCourseId} rateCard={rateCard} addFlashcard={addFlashcard} updateFlashcard={updateFlashcard} deleteFlashcard={deleteFlashcard} addFlashcardsBatch={addFlashcardsBatch} sendTutor={sendTutor} updateData={updateData} request={request} requestStream={requestStream} refreshRemote={refreshRemote} flashToast={flashToast} setModal={setModal} setActiveLessonId={setActiveLessonId} setSearchResults={setSearchResults} searchResults={searchResults} setLoginMode={setLoginMode} setModalState={setModal} generatingCourseId={generatingCourseId} syncing={syncing} activeRequests={activeRequests} />
      <footer className="app-footer flex items-center justify-between text-sm"><span>Drizzlearn</span><button type="button" onClick={()=>go("settings")}>Settings</button></footer>
    </main>
    {toast&&<div className="toast show fixed z-50" role="status" aria-live="polite">{toast}</div>}
    {modal&&<Modal modal={modal} onClose={()=>{if(!deletingCourseId){setDeleteCourseError("");setModal(null);}}} onApprove={()=>approveProposal(true)} onDeleteCourse={deleteCourse} deletingCourse={Boolean(deletingCourseId)} deleteCourseError={deleteCourseError} loginMode={loginMode} setLoginMode={setLoginMode} authSubmit={authSubmit} authError={authError} authMessage={authMessage} setAuthError={setAuthError} setAuthMessage={setAuthMessage} logout={logout} authBusy={authBusy} />}
  </div>;
}

function PageContextBar({context,go}){
  if(!context)return null;
  const {back,breadcrumbs}=context;
  const navigateItem=(e,item)=>{
    if(!item?.page||!shouldInterceptNavClick(e))return;
    e.preventDefault();
    go(item.page,{params:item.params||{},query:item.query||{}});
  };
    if(context?.page==="goal" || (typeof page!=="undefined" && page==="goal")){
    return (
      <div className="page-context-bar page-context-bar-goal flex items-center">
        <a
          href={buildPath(back?.page||"courses",{params:back?.params,query:back?.query})}
          className="goal-back-pill-btn flex items-center gap-3.5 group"
          onClick={e=>navigateItem(e,back||{page:"courses"})}
          aria-label="Back to My Courses"
          title="Back to My Courses"
        >
          <span className="goal-back-chevron-icon-box flex items-center justify-center">
            <Icon name="chevronLeft" size={20}/>
          </span>
          <span className="goal-back-pill-label font-semibold">
            My Courses
          </span>
        </a>
      </div>
    );
  }
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

function PageContent(props){
  const {page,routeParams,routeQuery,data,activeCourse,lessons,activeLesson,dueCards,nextTask,stats,progressPercent,pendingTasks,proposal,busy,go,openLesson}=props;
  const common={...props};
  const titles={courses:"My Courses",today:"Today’s plan","study-together":"Study Together",notes:"Notes",flashcards:"Flashcards",practice:"Practice",progress:"Your progress",tutor:"AI Tutor",settings:"Settings",goal:"Build a learning plan",proposal:"Your course proposal",course:"Course roadmap",lesson:"Lesson workspace",search:"Search results",verify:"Verify your email", "reset-password":"Choose a new password",verified:"Email verified",login:"Account",signup:"Create account",auth:"Account"};
  if(page==="home")return <Home {...common} />;
  const routeContext=getRouteContext({page,routeParams,routeQuery,activeCourse,activeLesson,proposalCourse:proposal||activeCourse,pageTitle:titles[page]||"Workspace",knownTitles:titles});
  return <div className="workspace-page">
    <PageContextBar context={routeContext} go={go}/>
    <div className={`page-heading ${page==="lesson"?"page-heading-lesson":""} ${page==="goal"?"page-heading-goal":""}`}><div>{page==="lesson"&&<span className="eyebrow">{activeLesson?.moduleTitle||"Learning session"}</span>}<h1>{page==="lesson"?activeLesson?.title||"Lesson":titles[page]||"Drizzlearn"}</h1></div>{page==="courses"&&<button className="primary-btn" onClick={()=>go("goal")}><Icon name="plus" size={14}/>Create a course</button>}</div>
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
      rememberRoom(next);setJoinCode(clean);if(typeof window!=="undefined")p.go("study-together",{query:{room:clean}});
      if(p.remote){const list=await p.request("study-rooms");setRooms((list.rooms||[]).map(roomFromApi));}
    }catch(error){setRoomError(error.message||"This room could not be opened.");}
  };
  useEffect(()=>{
    let cancelled=false;
    const load=async()=>{
      setRoomsLoading(true);setRoomsLoadError("");setRoomError("");
      const parsed=typeof window==="undefined"?null:parseLocation(window.location);
      const roomParam=p.routeParams?.roomCode||p.routeQuery?.get?.("room")||parsed?.params?.roomCode||parsed?.query?.get?.("room")||"";
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
      rememberRoom(created);if(typeof window!=="undefined")p.go("study-together",{query:{room:created.code}});
      if(p.remote){const list=await p.request("study-rooms");setRooms((list.rooms||[]).map(roomFromApi));}
    }catch(error){setRoomError(error.message||"The room could not be created.");}
  };
  const applyTimer=async(action)=>{
    if(!room)return;
    try{if(p.remote){const result=await p.request(`study-rooms/${room.code}/timer`,{method:"POST",body:JSON.stringify({action})});rememberRoom(roomFromApi(result.room));}else rememberRoom(controlLocalRoom(room,action));}
    catch(error){setRoomError(error.message||"The timer could not be updated.");}
  };
  const copyInvite=async()=>{const url=typeof window==="undefined"?"":`${location.origin}${buildPath("study-together",{query:{room:room.code}})}`;try{await navigator.clipboard.writeText(url);p.flashToast("Invite link copied.");}catch{setRoomError(`Share this room code: ${room.code}`);}};
  const leaveRoom=()=>{setRoom(null);setRoomError("");if(typeof window!=="undefined")p.go("study-together");};
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

function HumanProgressAvatar({ progress = 0 }) {
  const percent = Math.max(0, Math.min(100, Number(progress) || 0));
  // Total vertical span from crown Y=12 to chest base Y=270 is 258px
  const fillHeight = 258 * (percent / 100);
  const waterlineY = 270 - fillHeight;
  const tooltipY = Math.min(252, Math.max(30, waterlineY));

  // Sculpted human face and upper chest bust silhouette (profile facing left)
  const silhouettePath = "M 45 270 C 48 245, 58 220, 72 195 C 78 182, 80 172, 78 162 C 75 148, 62 142, 54 138 C 46 136, 42 130, 42 122 C 42 116, 48 114, 50 110 C 52 106, 50 102, 44 98 C 48 97, 54 96, 50 94 C 45 92, 42 86, 46 82 C 48 80, 44 78, 40 76 C 35 73, 34 68, 36 64 C 40 56, 46 44, 48 36 C 49 32, 48 28, 47 24 C 46 20, 50 15, 56 12 C 65 8, 85 8, 110 9 C 140 10, 175 18, 202 38 C 224 58, 235 90, 232 128 C 230 155, 218 180, 200 200 C 192 210, 188 225, 188 240 C 190 250, 202 260, 215 270 Z";

  return (
    <div className="human-progress-container relative flex items-center justify-center flex-shrink-0" aria-label={`Course progress: ${percent}%`}>
      <svg className="human-progress-svg" viewBox="0 0 250 280" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="bustObsidianGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#102a38" />
            <stop offset="40%" stopColor="#0a1d27" />
            <stop offset="100%" stopColor="#040e14" />
          </linearGradient>
          <linearGradient id="bustEnergyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#a5f3fc" />
            <stop offset="20%" stopColor="#38bdf8" />
            <stop offset="65%" stopColor="#0284c7" />
            <stop offset="100%" stopColor="#083344" />
          </linearGradient>
          <linearGradient id="bustMeniscusGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0)" />
            <stop offset="20%" stopColor="#38bdf8" />
            <stop offset="50%" stopColor="#ffffff" />
            <stop offset="80%" stopColor="#38bdf8" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0)" />
          </linearGradient>
          <filter id="bustGlowFilter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="tooltipDropShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.6)" />
          </filter>
          <clipPath id="bustFillClip">
            <rect x="0" y={waterlineY} width="250" height={fillHeight + 40} />
          </clipPath>
        </defs>
        <g className="bust-base-layer">
          <path 
            d={silhouettePath} 
            fill="url(#bustObsidianGrad)" 
            stroke="rgba(56, 189, 248, 0.4)" 
            strokeWidth="1.8" 
            className="bust-silhouette-base"
          />
        </g>
        <g className="bust-active-layer" clipPath="url(#bustFillClip)">
          <path 
            d={silhouettePath} 
            fill="url(#bustEnergyGrad)" 
            stroke="#a5f3fc" 
            strokeWidth="2.2" 
            filter="url(#bustGlowFilter)"
          />
        </g>
        {percent > 0 && percent < 100 && (
          <g className="bust-meniscus-group" aria-hidden="true">
            <line x1="30" y1={waterlineY} x2="225" y2={waterlineY} stroke="url(#bustMeniscusGrad)" strokeWidth="3" filter="url(#bustGlowFilter)" />
          </g>
        )}
        <g className="human-permanent-tooltip" transform={`translate(0, ${tooltipY - 13})`}>
          <rect x="0" y="0" width="46" height="26" rx="6" fill="rgba(8, 26, 36, 0.94)" stroke="#38bdf8" strokeWidth="1.4" filter="url(#tooltipDropShadow)" />
          <polygon points="46,8 52,13 46,18" fill="rgba(8, 26, 36, 0.94)" stroke="#38bdf8" strokeWidth="1.4" strokeLinejoin="round" />
          <text x="23" y="17.5" textAnchor="middle" fill="#ffffff" fontFamily="var(--font-display, 'Space Grotesk', sans-serif)" fontSize="13" fontWeight="800" letterSpacing="-0.02em">
            {percent}%
          </text>
        </g>
      </svg>
    </div>
  );
}

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

function Home(p){
  const {data,activeCourse,lessons,dueCards,nextTask,stats,progressPercent,go,openLesson,setModal}=p;
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
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
          What do you want to <span className="text-primary-gradient">learn?</span>
        </h1>
        <form
          className="generate-row flex items-center gap-2.5 max-w-2xl w-full"
          onSubmit={e=>{
            e.preventDefault();
            const value=new FormData(e.currentTarget).get("topic");
            sessionStorage.setItem("learnos.goal.prefill",String(value||""));
            p.setModalState(null);
            go("goal");
          }}
        >
          <span className="spark pl-3" aria-hidden="true">✦</span>
          <input
            name="topic"
            defaultValue={activeCourse?.title||"Mastering English Tenses for Daily Communication"}
            aria-label="Topic to learn"
            placeholder="What do you want to learn?"
            className="flex-1"
          />
          <button className="primary-btn flex items-center gap-1.5" type="submit" disabled={p.busy}>
            {p.busy?<><span className="btn-spinner"/> Generating…</>:<>Generate course <span>↗</span></>}
          </button>
        </form>
      </section>

      {/* 4 Square Frosted Glass Learning Tool Cards */}
      <section className="learning-tools-strip flex justify-center w-full mb-8 relative" aria-label="Learning tools">
        <div className="square-tools-grid relative z-10">
          <a href="#/course" className="square-card square-card-roadmap" onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("course");}}>
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

          <a href="#/flashcards" className="square-card square-card-flashcards" onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("flashcards");}}>
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

          <a href="#/notes" className="square-card square-card-notes" onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("notes");}}>
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

          <a href="#/practice" className="square-card square-card-practice" onClick={e=>{if(!shouldInterceptNavClick(e))return;e.preventDefault();go("practice");}}>
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
            <button className="quiet-btn grid place-items-center" aria-label="View courses" onClick={()=>go("courses")}>↗</button>
          </div>
          {activeCourse?(
            <div className="course-content flex flex-col sm:flex-row items-center gap-6 p-6">
              <HumanProgressAvatar progress={progressPercent || 4} />
              <div className="course-info flex flex-col flex-1 min-w-0 gap-3">
                <h2 className="text-xl font-bold leading-snug">{activeCourse.title}</h2>
                <div className="course-meta flex flex-wrap items-center gap-3 text-sm text-learnos-muted">
                  <span>{activeCourse.target_weeks||activeCourse.durationWeeks||12} Weeks</span>
                  <span>{lessons.length || 14} Lessons</span>
                  <span>{activeCourse.current_level||activeCourse.currentLevel||"Beginner"}</span>
                </div>
                <div className="course-progress-row flex items-center gap-3">
                  <div className="progress-track flex-1 overflow-hidden" role="progressbar" aria-label="Completed study tasks" aria-valuenow={progressPercent} aria-valuemin="0" aria-valuemax="100">
                    <div className="progress-fill" style={{width:`${progressPercent||4}%`}}/>
                  </div>
                  <span className="progress-number font-bold">{progressPercent || 4}%</span>
                  <button className="continue-btn" onClick={()=>nextTask?openLesson(nextTask.lesson_id):go("course")}>
                    {nextTask?"Continue ↗":"Continue ↗"}
                  </button>
                </div>
                <p className="course-progress-note text-xs text-learnos-muted">
                  {done || 1} of {stats.total || 26} planned sessions complete
                </p>
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
      </div>
    </section>

    {/* Study Journal & Action List Full Width at Bottom */}
    <div className="diary-section-wrapper w-full mt-6">
      <DiaryTodoSection data={data} updateData={p.updateData} />
    </div>
  </>;
}


function EmptyState({title,body,action,onAction,illustration}){return <div className="empty-state flex flex-col items-center justify-center text-center p-8">{illustration?<div className="empty-illustration-wrap mb-3"><img src={illustration} alt="" className="empty-illustration-img" loading="lazy"/></div>:<span className="empty-orb grid place-items-center mb-3"><Icon name="spark" size={24}/></span>}<h2>{title}</h2><p className="max-w-md mb-4">{body}</p>{action&&<button className="primary-btn" onClick={onAction}>{action} ↗</button>}</div>}

const courseCovers=["/images/course-cover-ai.svg","/images/course-cover-systems.svg","/images/course-cover-math.svg","/images/course-cover-design.svg"];

function CoursesPage(p){
  const {data,courseFilter,setCourseFilter,go,updateData}=p;
  const courses = data.courses || [];
  const visible = courses.filter(c => courseFilter === "all" || c.status === courseFilter);
  const filterCounts = React.useMemo(() => ({
    all: courses.length,
    active: courses.filter(c => c.status === "active").length,
    proposal: courses.filter(c => c.status === "proposal").length,
    completed: courses.filter(c => c.status === "completed").length
  }), [courses]);

  return (
    <div className="courses-page-container flex flex-col gap-6">
      {/* Filters row with count pills */}
      <div className="filter-row flex flex-wrap items-center justify-between gap-3" role="group" aria-label="Filter courses">
        <div className="flex flex-wrap items-center gap-2">
          {[["all","All courses"],["active","Active"],["proposal","Proposals"],["completed","Completed"]].map(([value,label]) => {
            const count = filterCounts[value] ?? 0;
            const isSelected = courseFilter === value;
            return (
              <button 
                key={value} 
                className={`filter-chip cursor-pointer flex items-center gap-2 ${isSelected ? "selected" : ""}`} 
                onClick={() => setCourseFilter(value)}
              >
                <span>{label}</span>
                <span className={`filter-chip-count ${isSelected ? "active" : ""}`}>{count}</span>
              </button>
            );
          })}
        </div>
        <div className="text-xs text-slate-400 font-medium">
          Showing {visible.length} of {courses.length} course{courses.length === 1 ? "" : "s"}
        </div>
      </div>

      {visible.length ? (
        <div className="course-library-grid grid grid-cols-1 md:grid-cols-2 gap-6">
          {visible.map((course, i) => {
            const all = (course.modules || []).flatMap(m => m?.lessons || []);
            const courseTasks = (data.tasks || []).filter(t => t.course_id === course.id);
            const done = courseTasks.filter(t => t.status === "completed").length;
            const percent = courseTasks.length ? Math.round(done / courseTasks.length * 100) : 0;
            const coverIdx = i % courseCovers.length;
            const isProposal = course.status === "proposal";
            const levelText = course.current_level || course.currentLevel || "Beginner";
            const durationText = `${course.target_weeks || course.durationWeeks || 8} weeks`;
            const hoursEst = Math.round((course.estimated_minutes || 0) / 60) || 1;

            return (
              <article 
                className={`library-course modern-course-card panel flex flex-col overflow-hidden relative group status-${course.status || "active"}`} 
                key={course.id}
              >
                {/* Glowing Specular Top Highlight */}
                <div className="course-card-glow-bar" aria-hidden="true" />

                {/* Integrated Cover Header */}
                <div 
                  className="library-cover modern-library-cover flex items-center justify-between"
                  style={{
                    backgroundImage: `linear-gradient(180deg, rgba(8, 16, 26, 0.45) 0%, rgba(6, 12, 19, 0.95) 100%), url(${courseCovers[coverIdx]})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center 30%"
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="course-cat-tag flex items-center gap-1.5">
                      <span className="cat-spark text-cyan-400 text-xs">✦</span>
                      <span>{isProposal ? "DRAFT PLAN" : "LEARNING PATH"}</span>
                    </span>
                  </div>
                  <span className={`status-pill modern-status-pill ${course.status}`}>
                    <span className="status-dot" />
                    {course.status}
                  </span>
                </div>

                {/* Card Content */}
                <div className="library-course-content flex flex-col flex-1 p-5 gap-3.5 relative z-10">
                  {/* Level & Duration with high contrast */}
                  <div className="course-meta-small flex items-center gap-2 text-xs">
                    <span className="meta-badge-level">{levelText}</span>
                    <span className="meta-sep text-slate-500">·</span>
                    <span className="meta-badge-duration flex items-center gap-1.5">
                      <Icon name="clock" size={12} />
                      {durationText}
                    </span>
                  </div>

                  {/* Title & Summary */}
                  <div className="flex flex-col gap-1.5">
                    <h2 className="course-card-heading text-lg font-bold text-white tracking-tight group-hover:text-cyan-300 transition-colors">
                      {course.title}
                    </h2>
                    <p className="course-card-desc text-xs text-slate-300 leading-relaxed line-clamp-2">
                      {course.summary || course.desired_outcome}
                    </p>
                  </div>

                  {/* Stats Chips (Lessons, Modules, Hours) */}
                  <div className="course-facts flex flex-wrap items-center gap-2 text-xs mt-1">
                    <span className="course-stat-chip">
                      <Icon name="book" size={13} />
                      <span>{all.length} lessons</span>
                    </span>
                    <span className="course-stat-chip">
                      <Icon name="progress" size={13} />
                      <span>{course.modules?.length || 0} modules</span>
                    </span>
                    <span className="course-stat-chip">
                      <Icon name="clock" size={13} />
                      <span>{hoursEst} hours</span>
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="course-progress-row flex flex-col gap-1.5 mt-auto pt-2">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-slate-400">Course Progress</span>
                      <span className={`progress-number ${percent > 0 ? "text-cyan-400" : "text-slate-400"}`}>
                        {percent}%
                      </span>
                    </div>
                    <div className="progress-track flex-1 overflow-hidden">
                      <div 
                        className="progress-fill" 
                        style={{ width: `${Math.max(percent, percent > 0 ? 3 : 0)}%` }} 
                      />
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="library-actions flex items-center gap-3 pt-3 border-t border-slate-800/60 mt-1">
                    {isProposal ? (
                      <button 
                        className="primary-btn course-open-btn flex items-center gap-1.5" 
                        onClick={() => {
                          p.setProposal(course);
                          updateData(x => ({ ...x, activeCourseId: course.id }));
                          go("proposal", { params: { courseId: course.id } });
                        }}
                      >
                        <span>Review plan</span>
                        <span className="btn-arrow">↗</span>
                      </button>
                    ) : (
                      <button 
                        className="primary-btn course-open-btn flex items-center gap-1.5" 
                        onClick={() => {
                          updateData(x => ({ ...x, activeCourseId: course.id }));
                          go("course", { params: { courseId: course.id } });
                        }}
                      >
                        <span>Open course</span>
                        <span className="btn-arrow">↗</span>
                      </button>
                    )}

                    <div className="library-actions-secondary flex items-center gap-2 ml-auto">
                      <button 
                        type="button" 
                        className="quiet-btn course-more-btn grid place-items-center" 
                        aria-label={`View roadmap for ${course.title}`} 
                        title="View roadmap"
                        onClick={() => {
                          updateData(x => ({ ...x, activeCourseId: course.id }));
                          go(isProposal ? "proposal" : "course", { params: { courseId: course.id } });
                          if (isProposal) p.setProposal(course);
                        }}
                      >
                        ⋯
                      </button>
                      {p.confirmDeleteCourse && (
                        <button 
                          type="button" 
                          className="quiet-btn danger course-delete-btn flex items-center gap-1.5" 
                          aria-label={`Delete ${course.title}`} 
                          title="Delete course"
                          disabled={p.deletingCourseId === course.id} 
                          onClick={() => p.confirmDeleteCourse(course)}
                        >
                          <Icon name="trash" size={13} />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState 
          title="No courses yet" 
          body="Write down the capability you want to build. Sign in to generate a course plan with lessons and practice." 
          action="Create a learning goal" 
          onAction={() => go("goal")}
        />
      )}
    </div>
  );
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
      return <article className={`task-row flex items-center gap-3 p-3 ${task.status} ${task.task_type||"lesson"}`} key={task.id}><span className={`task-check ${task.status==="completed"?"done":""}`} aria-label={task.status==="completed"?"Completed task":"Pending task"}>{task.status==="completed"?"✓":task.status==="in_progress"?"•":""}</span><div className={`task-type-glyph ${task.task_type||"lesson"}`} title={task.task_type||"lesson"} aria-hidden="true"><Icon name={taskIcon} size={15}/></div><div className="task-main-copy flex flex-col flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><strong>{task.title}</strong>{task.task_type&&task.task_type!=="lesson"&&<span className={`task-type-badge ${task.task_type}`}>{task.task_type}</span>}</div><span>{task.course_title||p.activeCourse?.title||"Learning session"} · {minuteLabel(task.estimated_minutes)}</span></div>{task.status!=="upcoming"&&<span className={`task-status ${task.status}`}>{task.status.replace("_"," ")}</span>}<button className="continue-btn" onClick={handleAction}>{actionLabel}</button>{task.status==="completed"?<span className="task-completed-check flex items-center justify-center text-learnos-mint" title="Completed" aria-label="Completed"><Icon name="check" size={16}/></span>:<button className="quiet-btn" aria-label={`Reschedule ${task.title}`} title="Reschedule" onClick={()=>reschedule(task)}>↗</button>}</article>;
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
  const [searchQuery,setSearchQuery]=useState(""),[filterCourse,setFilterCourse]=useState(()=>p.routeQuery?.get?.("course")||"all");
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

  // Keep selected and draft synchronized with p.data.notes if notes change externally
  useEffect(()=>{
    if(selected){
      const stillExists=p.data.notes.find(n=>n.id===selected);
      if(!stillExists){
        const next=p.data.notes[0]||null;
        if(next){
          setSelected(next.id);
          setDraft({...next});
          const meta=next.lesson_id?allLessonsMap.get(next.lesson_id):null;
          setSelectedCourseId(meta?.courseId||next.course_id||"");
          setViewMode("preview");
        }else{
          setSelected("");
          setDraft(null);
          setSelectedCourseId("");
        }
      }
    }
  },[p.data.notes,selected,allLessonsMap]);

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
    const targetId=draft.id;
    setDeletingNote(true);
    try{
      await p.deleteNote(targetId);
      const remaining=p.data.notes.filter(n=>n.id!==targetId);
      const nextNote=remaining[0]||null;
      if(nextNote){
        setSelected(nextNote.id);
        setDraft({...nextNote});
        const meta=nextNote.lesson_id?allLessonsMap.get(nextNote.lesson_id):null;
        setSelectedCourseId(meta?.courseId||nextNote.course_id||"");
        setViewMode("preview");
      }else{
        setSelected("");
        setDraft(null);
        setSelectedCourseId("");
      }
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
        <Panel title="Your deck" icon="cards">
          <div className="side-panel-copy flex flex-col gap-3 p-4">
            <div className="rhythm-big">{savedInScope}<span> cards saved</span></div>
            <p>Adaptive spaced repetition surfaces each question right before you forget it.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="primary-btn compact" onClick={()=>openPortal("ai",null)}>Generate with AI ✦</button>
              <button type="button" className="secondary-btn compact" onClick={()=>openPortal("manual",null)}><Icon name="plus" size={13}/>Create a flashcard</button>
              {(p.data.flashcards||[]).length>0&&<button type="button" className="quiet-btn compact" onClick={()=>openPortal("deck",null)}>Manage deck</button>}
            </div>
          </div>
        </Panel>
        <Panel title="Due later" icon="clock">
          <div className="side-panel-copy card-list-compact flex flex-col gap-2 p-4">
            {dueLater.length>0?dueLater.slice(0,5).map(c=><div key={c.id} className="fc-due-later-item"><span title={c.front}>{c.front}</span><small>{prettyDate(c.due_at)}</small></div>):(
              <p className="fc-empty-schedule">No upcoming cards scheduled yet. Cards you rate as Hard, Good, or Easy will appear here with their next review date.</p>
            )}
          </div>
        </Panel>
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

function EvidenceList({
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
        <div className="panel-title flex items-center gap-2.5"><Icon name="spark"/>Tutor Knowledge Base</div>
        {statusBadge}
      </div>
      {!remote?(
        <div className="side-panel-copy flex flex-col gap-2.5 p-4">
          <p>Sign in to sync your study materials with your personal AI Tutor and keep answers tailored to your courses.</p>
          <button type="button" className="text-button" onClick={openAccount}>Sign in to sync tutor memory ↗</button>
        </div>
      ):engineState==="loading"?(
        <div className="engine-state-box" role="status" aria-busy="true">
          <p>Checking your tutor's memory and learning materials…</p>
        </div>
      ):engineState==="error"?(
        <div className="engine-error-box" role="alert">
          <p>{engineError||"Tutor memory status is temporarily unavailable."}</p>
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
              <div>
                <strong>Tutor Knowledge Base</strong>
                <p className="engine-section-sub">Materials your AI Tutor reads to explain concepts and quote your lessons.</p>
              </div>
              <span className="rag-mode-pill">Auto-Synced</span>
            </div>
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
                    className="secondary-btn compact rag-reindex-btn"
                    disabled={reindexing}
                    aria-busy={reindexing}
                    onClick={handleReindex}
                  >
                    {reindexing?"Refreshing memory…":"Refresh tutor memory ↻"}
                  </button>
                  <small className="muted-copy text-xs">Click only if the AI Tutor seems unaware of recent edits or new lessons.</small>
                </div>
              </>
            ):(
              <div className="engine-error-box compact" role="alert">
                <span>Tutor knowledge base status unavailable.</span>
                <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
              </div>
            )}
          </div>

          <div className="engine-section">
            <div className="engine-section-head">
              <div>
                <strong>AI Reliability &amp; Models</strong>
                <p className="engine-section-sub">Multi-model backup pool so course generation never stalls.</p>
              </div>
              <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)} aria-label="Refresh AI models">Check status ↻</button>
            </div>
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
                  <p className="muted-copy">No active models reported yet.</p>
                )}
              </>
            ):(
              <div className="engine-error-box compact" role="alert">
                <span>Model status unavailable.</span>
                <button type="button" className="text-button" onClick={()=>setReloadTick(t=>t+1)}>Retry ↻</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

const COMMON_TIMEZONES = [
  "UTC",
  "Africa/Cairo",
  "Africa/Johannesburg",
  "Africa/Lagos",
  "America/Anchorage",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Calcutta",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Jerusalem",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Asia/Kolkata",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Riyadh",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Taipei",
  "Asia/Tokyo",
  "Australia/Melbourne",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Dublin",
  "Europe/Istanbul",
  "Europe/London",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Rome",
  "Europe/Zurich",
  "Pacific/Auckland",
  "Pacific/Honolulu"
];

function getAllTimezones() {
  let list = [];
  try {
    if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
      list = Intl.supportedValuesOf("timeZone");
    }
  } catch (_) {}
  return Array.from(new Set(["UTC", "Asia/Kolkata", ...COMMON_TIMEZONES, ...list])).sort((a, b) => a.localeCompare(b));
}

const ALL_TIMEZONES = getAllTimezones();

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
  return <div className="settings-grid grid gap-4 items-start"><form className="panel settings-form flex flex-col p-4 gap-4" onSubmit={save}><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name="tutor"/>Learner profile</div></div><div className="settings-body flex flex-col gap-4"><label>Display name<input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" minLength="2"/></label><label>Email address<input value={p.user?.email||""} placeholder="Sign in to attach an email" readOnly/></label>        <label>Time zone
          <select value={timezone} onChange={e=>setTimezone(e.target.value)}>
            {!ALL_TIMEZONES.includes(timezone)&&<option key={timezone} value={timezone}>{timezone}</option>}
            {ALL_TIMEZONES.map(tz=><option key={tz} value={tz}>{tz.replace(/_/g," ")}</option>)}
          </select>
        </label><div className="form-section flex flex-col gap-3 pt-3 border-t border-learnos-line"><h3>Weekly study budget</h3><p>Plans are checked against the time you can actually set aside.</p><div className="form-grid-two grid grid-cols-1 sm:grid-cols-2 gap-3"><label>Minutes per week<input type="number" min="30" max="2400" step="30" value={weekly} onChange={e=>setWeekly(e.target.value)}/></label><label>Minutes per session<input type="number" min="15" max="240" step="5" value={session} onChange={e=>setSession(e.target.value)}/></label></div></div><div className="form-section flex flex-col gap-3 pt-3 border-t border-learnos-line"><h3>Preferred study days</h3><div className="day-picker flex flex-wrap gap-1.5">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day,i)=><button key={day} type="button" className={`cursor-pointer ${days.includes(i)?"selected":""}`} onClick={()=>toggleDay(i)}>{day}</button>)}</div></div><div className="form-section flex flex-col gap-3 pt-3 border-t border-learnos-line"><h3>Notifications</h3><label className="toggle-row flex items-center justify-between gap-3 p-2"><span><strong>Study session reminders</strong><small>Before a planned session</small></span><input type="checkbox" checked={studyNotify} onChange={e=>setStudyNotify(e.target.checked)}/></label><label className="toggle-row flex items-center justify-between gap-3 p-2"><span><strong>Review reminders</strong><small>When flashcards are due</small></span><input type="checkbox" checked={reviewNotify} onChange={e=>setReviewNotify(e.target.checked)}/></label></div><div className="settings-submit pt-2"><button className="primary-btn" type="submit">{saved?"Saved ✓":"Save settings"}</button></div></div></form>
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
  const topicInputRef=useRef(null);
  const [topic,setTopic]=useState(()=>sessionStorage.getItem("learnos.goal.prefill")||readGoalDraft().topic||"");
  const [outcome,setOutcome]=useState(()=>readGoalDraft().desiredOutcome||"");
  const [level,setLevel]=useState("Beginner"),[purpose,setPurpose]=useState("Personal learning"),[weekly,setWeekly]=useState(p.data.settings.weeklyMinutes||360),[weeks,setWeeks]=useState(8),[date,setDate]=useState("");
  const [topicFocused,setTopicFocused]=useState(false);
  const [outcomeFocused,setOutcomeFocused]=useState(false);

  const runSubmit=async()=>{
    sessionStorage.removeItem("learnos.goal.prefill");
    await p.submitGoal({topic,desiredOutcome:outcome,currentLevel:level,purpose,weeklyMinutes:Number(weekly),targetWeeks:Number(weeks),targetDate:date||null});
  };
  const submit=async(e)=>{e.preventDefault();await runSubmit();};
  const retryGeneration=()=>{
    if(formRef.current?.requestSubmit){formRef.current.requestSubmit();}
    else{runSubmit();}
  };

  const hasTopic = Boolean(topic && topic.trim());
  const hasOutcome = Boolean(outcome && outcome.trim());

  return <div className="goal-full-stage w-full flex flex-col items-center">
    {/* Centered Page Title */}
    <div className="goal-stage-header w-full flex flex-col items-center text-center mb-6">
      <h1 className="goal-stage-title font-extrabold tracking-tight text-white mb-2">Build a learning plan</h1>
      <p className="goal-stage-subtitle text-sm text-slate-400 max-w-lg">
        Define your target, refine what you want to achieve, and calibrate your schedule.
      </p>
    </div>

    <form ref={formRef} className="goal-form-full w-full flex flex-col gap-6" onSubmit={submit}>
      {/* 1. Homepage-style Topic Search Bar (Centered, pill rounded, spark icon, NO generate button) */}
      <div className="w-full flex justify-center">
        <div
          className={`goal-topic-bar flex items-center w-full  cursor-text transition-all ${topicFocused||hasTopic?"is-active":"is-idle"}`}
          onClick={()=>{topicInputRef.current?.focus();}}
        >
          <span className="goal-topic-spark text-cyan-400 pl-4 pr-3 text-lg flex items-center justify-center select-none" aria-hidden="true">✦</span>
          <div className="relative flex-1 flex items-center py-3 pr-4">
            {(!topicFocused && !hasTopic) && (
              <div className="goal-topic-shimmer absolute inset-0 flex items-center pointer-events-none select-none" aria-hidden="true">
                <span className="fake-text-gradient text-[15px] font-medium">What do you want to learn?</span>
              </div>
            )}
            <input
              ref={topicInputRef}
              name="topic"
              value={topic}
              onChange={e=>setTopic(e.target.value)}
              onFocus={()=>setTopicFocused(true)}
              onBlur={()=>setTopicFocused(false)}
              required
              minLength={2}
              maxLength={120}
              aria-label="What do you want to learn?"
              placeholder="What do you want to learn?"
              className={`goal-topic-input w-full bg-transparent text-white text-[15px] font-medium outline-none border-none ${!topicFocused&&!hasTopic?"opacity-0":""}`}
            />
          </div>
        </div>
      </div>

      {/* 2. "What do you want to be able to do?" - Prominent, slightly large standalone card */}
      <div className="goal-outcome-card w-full flex flex-col gap-3 p-5 sm:p-6 rounded-2xl">
        <div className="flex items-center justify-between">
          <label htmlFor="goal-outcome-textarea" className="flex items-center gap-2 text-xs font-bold text-cyan-400 tracking-wider uppercase">
            <Icon name="spark" size={15}/> What do you want to be able to do?
          </label>
          <span className="text-xs text-slate-400">Describe your practical outcome</span>
        </div>
        <div className="relative w-full flex items-start">
          <span className="absolute left-4 top-4 text-cyan-400/80 pointer-events-none select-none z-10 flex items-center justify-center">
            <Icon name="edit" size={18}/>
          </span>
          {(!outcomeFocused && !hasOutcome) && (
            <div className="absolute top-4 left-12 right-4 flex items-start pointer-events-none select-none z-10" aria-hidden="true">
              <span className="goal-shimmer-text text-[14.5px]">Describe what you want to achieve, build, or demonstrate independently…</span>
            </div>
          )}
          <textarea
            id="goal-outcome-textarea"
            value={outcome}
            onChange={e=>setOutcome(e.target.value)}
            onFocus={()=>setOutcomeFocused(true)}
            onBlur={()=>setOutcomeFocused(false)}
            required
            minLength={8}
            rows={4}
            placeholder=""
            aria-label="What do you want to be able to do?"
            className="goal-outcome-input w-full pl-12 pr-4 py-3.5 rounded-xl text-white text-[14.5px] font-medium bg-black/40 border border-white/10 focus:border-cyan-400/60 focus:bg-black/60 outline-none transition-all resize-y leading-relaxed"
          />
        </div>
      </div>

      {/* 3. Row below it: Learner Profile and Pace & Schedule side by side */}
      <div className="goal-config-row grid grid-cols-1 md:grid-cols-2 gap-5 w-full">
        {/* Learner Profile */}
        <div className="goal-config-card flex flex-col gap-4 p-5 rounded-2xl">
          <div className="flex items-center gap-2 text-xs font-bold text-sky-400 uppercase tracking-widest pb-2 border-b border-white/[0.06]">
            <Icon name="people" size={15}/> Learner Profile
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-semibold">
              Current level
              <select value={level} onChange={e=>setLevel(e.target.value)} className="goal-select">
                <option>Beginner</option>
                <option>Some experience</option>
                <option>Intermediate</option>
                <option>Advanced</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-semibold">
              Purpose
              <select value={purpose} onChange={e=>setPurpose(e.target.value)} className="goal-select">
                <option>Personal learning</option>
                <option>School or university</option>
                <option>Work project</option>
                <option>Career transition</option>
                <option>Other</option>
              </select>
            </label>
          </div>
        </div>

        {/* Pace & Schedule */}
        <div className="goal-config-card flex flex-col gap-4 p-5 rounded-2xl">
          <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 uppercase tracking-widest">
              <Icon name="calendar" size={15}/> Pace & Schedule
            </div>
            <span className="text-[11px] text-slate-400">Adaptive weekly budget</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-semibold">
              Hours each week
              <select value={weekly} onChange={e=>setWeekly(Number(e.target.value))} className="goal-select">
                <option value="180">3 hours</option>
                <option value="360">6 hours</option>
                <option value="600">10 hours</option>
                <option value="900">15 hours</option>
                <option value="1200">20 hours</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-slate-300 font-semibold">
              Target duration
              <select value={weeks} onChange={e=>setWeeks(Number(e.target.value))} className="goal-select">
                <option value="4">4 weeks</option>
                <option value="8">8 weeks</option>
                <option value="10">10 weeks</option>
                <option value="12">12 weeks</option>
                <option value="16">16 weeks</option>
              </select>
            </label>
          </div>
          <label className="flex flex-col gap-1 text-xs text-slate-300 font-semibold mt-0.5">
            <span className="flex items-center gap-1.5">
              Target date <span className="text-slate-500 font-normal">(Optional)</span>
            </span>
            <input
              type="date"
              value={date}
              onChange={e=>setDate(e.target.value)}
              onClick={e=>{try{e.target.showPicker?.();}catch(_){}}}
              min={new Date().toISOString().slice(0,10)}
              className="goal-date-input"
            />
          </label>
        </div>
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

      {/* Submit footer row */}
      <div className="goal-submit-bar w-full flex items-center justify-between p-4 rounded-2xl border border-white/[0.08] bg-black/40 backdrop-blur-md mt-2">
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <Icon name="clock" size={18} className="text-cyan-400"/> Your study budget: <strong className="text-white">{Math.round(Number(weekly)/60)} hours / week</strong>
        </p>
        <button
          type="submit"
          className="primary-btn px-6 py-2.5 rounded-xl font-bold text-sm tracking-wide shadow-lg shadow-cyan-500/20"
          disabled={p.busy||!topic||!outcome}
        >
          {p.busy?<><span className="btn-spinner"/> Building your plan…</>:p.remote?"Generate course proposal ↗":"Sign in to generate plan ↗"}
        </button>
      </div>
    </form>
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
    <div className="course-roadmap-header flex items-center justify-between"><div><span className="eyebrow">COURSE ROADMAP</span><h2>Follow the sequence</h2></div><button className="text-button" onClick={()=>p.go("today")}>View study plan ↗</button></div><div className="detail-module-list flex flex-col gap-3">{course.modules?.map((mod,i)=><section className={`panel detail-module flex flex-col overflow-hidden ${expanded===i?"open":""}`} key={mod.id||i}><button className="detail-module-head flex items-center justify-between p-3.5 w-full text-left cursor-pointer" onClick={()=>setExpanded(expanded===i?-1:i)} aria-expanded={expanded===i}><span className={`module-number ${mod.status||"planned"}`}>{mod.status==="completed"?"✓":String(i+1).padStart(2,"0")}</span><span className="detail-module-title flex-1 min-w-0"><strong>{mod.title}</strong><small className="block text-sm text-learnos-muted">{mod.objective}</small></span><span className="module-count text-sm font-semibold text-learnos-muted">{mod.lessons?.length||0} lessons</span><span className="expand-icon" aria-hidden="true">{expanded===i?"−":"+"}</span></button>{expanded===i&&<div className="detail-lessons flex flex-col border-t border-learnos-line">{mod.lessons?.map((lesson,j)=>{const lessonTasks=p.data.tasks.filter(t=>t.lesson_id===lesson.id);const task=lessonTasks.find(t=>t.task_type!=="practice")||lessonTasks[0];const practiceTask=lessonTasks.find(t=>t.task_type==="practice");const isDone=task?.status==="completed"||lessonTasks.some(t=>t.status==="completed");return <div key={lesson.id||j} className="detail-lesson-row flex flex-col"><button className="detail-lesson flex items-center justify-between gap-3 p-3 text-left hover:bg-learnos-surface-hover transition-colors" onClick={()=>p.openLesson(lesson.id)} aria-label={`Open lesson: ${lesson.title}`}><span className={`lesson-state ${isDone?"complete":""}`}>{isDone?"✓":String(j+1).padStart(2,"0")}</span><span className="flex-1 min-w-0"><div className="flex items-center gap-2"><Icon name="book" size={14}/><strong>{lesson.title}</strong></div><small className="block text-sm text-learnos-muted">{lesson.objective}</small></span><span className="lesson-duration text-sm font-medium text-learnos-muted">{minuteLabel(lesson.estimated_minutes||25)}</span><span className="lesson-arrow" aria-hidden="true">↗</span></button>{practiceTask&&<div className="detail-practice-task flex items-center justify-between gap-3 px-4 py-2 text-sm"><span className="flex items-center gap-2 text-learnos-muted"><Icon name="practice" size={14}/><span>Practice: {practiceTask.title}</span><span className="task-type-badge practice">practice</span></span><button type="button" className="text-button text-sm" onClick={()=>{p.setActiveLessonId(lesson.id);p.go("practice",{params:{lessonId:lesson.id}});}}>{practiceTask.status==="completed"?"Review evidence ↗":"Start practice ↗"}</button></div>}</div>;})}</div>}</section>)}</div>
    {courseTasks.filter(t=>t.task_type==="roadmap"||(t.task_type==="practice"&&!t.lesson_id)).length>0&&<section className="panel course-tasks-section flex flex-col p-4 gap-3"><div className="panel-title flex items-center gap-2"><Icon name="progress" size={16}/><span>Roadmap milestones & practice</span></div><div className="task-list flex flex-col gap-2">{courseTasks.filter(t=>t.task_type==="roadmap"||(t.task_type==="practice"&&!t.lesson_id)).map(t=><div key={t.id} className="task-row flex items-center gap-3 p-3"><Icon name={t.task_type==="practice"?"practice":"progress"} size={15}/><div className="task-main-copy flex flex-col flex-1 min-w-0"><strong>{t.title}</strong><span className="text-sm text-learnos-muted">{minuteLabel(t.estimated_minutes)}</span></div><span className={`task-status ${t.status}`}>{t.status.replace("_"," ")}</span><button className="continue-btn" onClick={()=>t.task_type==="practice"?p.go("practice"):p.go("today")}>{t.task_type==="practice"?"Practice ↗":"View in plan ↗"}</button></div>)}</div></section>}
  </div>
    <aside className="course-detail-aside flex flex-col gap-4"><Panel title="Course progress" icon="progress"><div className="course-progress-aside flex flex-col items-center gap-3 p-4"><div className="progress-ring-small" style={{"--progress":`${p.progressPercent}%`}}><strong>{p.progressPercent}%</strong></div><p className="text-center text-sm">{p.data.tasks.filter(t=>t.status==="completed"&&t.course_id===course.id).length} of {p.data.tasks.filter(t=>t.course_id===course.id).length} study sessions complete</p><button className="text-button" onClick={()=>p.go("progress",{query:{course:course.id}})}>View progress details ↗</button></div></Panel><Panel title="Course outcome" icon="check"><div className="side-panel-copy p-4 text-sm leading-relaxed"><p>{course.desired_outcome||course.summary}</p></div></Panel><Panel title="Quick tools" icon="spark"><div className="quick-tool-list flex flex-col gap-1.5 p-2"><button onClick={()=>p.go("notes",{query:{course:course.id}})}><Icon name="notes"/>Course notes <span>↗</span></button><button onClick={()=>p.go("flashcards",{query:{course:course.id}})}><Icon name="cards"/>Review flashcards <span>↗</span></button><button onClick={()=>p.go("practice",{query:{course:course.id}})}><Icon name="practice"/>Practice checkpoints <span>↗</span></button><button onClick={()=>p.go("tutor",{query:{course:course.id}})}><Icon name="tutor"/>Ask your tutor <span>↗</span></button></div></Panel></aside></div>;
}
const CourseDetailPage = CoursePage;

export const LESSON_DEPTH_STORAGE_KEY = "learnos.lesson_depth.v1";

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

function SearchPage(p){const results=p.searchResults||{courses:[],lessons:[],notes:[],flashcards:[]};const has=(results.courses?.length||0)+(results.lessons?.length||0)+(results.notes?.length||0)+(results.flashcards?.length||0);return has?<div className="search-results-page flex flex-col gap-4">{results.courses?.length>0&&<Panel title="Courses" icon="book">{results.courses.map(c=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={c.id} onClick={()=>{p.updateData(d=>({...d,activeCourseId:c.id}));p.go("course");}}><strong>{c.title}</strong><small className="text-sm text-learnos-muted">{c.status} course</small><span>↗</span></button>)}</Panel>}{results.lessons?.length>0&&<Panel title="Lessons" icon="progress">{results.lessons.map(l=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={l.id} onClick={()=>p.openLesson(l.id)}><strong>{l.title}</strong><small className="text-sm text-learnos-muted">{l.course_title} · {l.objective}</small><span>↗</span></button>)}</Panel>}{results.notes?.length>0&&<Panel title="Notes" icon="notes">{results.notes.map(n=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={n.id} onClick={()=>p.go("notes")}><strong>{n.title}</strong><small className="text-sm text-learnos-muted">{String(n.body).slice(0,130)}</small><span>↗</span></button>)}</Panel>}{results.flashcards?.length>0&&<Panel title="Flashcards" icon="cards">{results.flashcards.map(card=><button className="search-result-row flex items-center justify-between gap-3 p-3 w-full text-left hover:bg-learnos-surface-hover transition-colors" key={card.id} onClick={()=>p.go("flashcards")}><strong>{card.front}</strong><small className="text-sm text-learnos-muted">{String(card.back).slice(0,130)}</small><span>↗</span></button>)}</Panel>}</div>:<EmptyState title="No matching learning material" body="Try a saved note, flashcard, course title, or lesson phrase." action="Back home" onAction={()=>p.go("home")}/>;}

export function LoginPage({loginMode,setLoginMode,authSubmit,authError,authMessage,setAuthError,setAuthMessage,go,user,logout,returnPage="home",authBusy=false}){
  const switchAuthMode=mode=>{
    if(setLoginMode)setLoginMode(mode);
    if(setAuthError)setAuthError("");
    if(setAuthMessage)setAuthMessage("");
    if(mode==="signup")go("signup");
    else if(mode==="login")go("login");
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
  useEffect(()=>{const token=p.routeQuery?.get?.("token")||parseLocation(typeof window!=="undefined"?window.location:null).query.get("token");if(!token){setState("error");setMessage("This verification link is missing its token.");return;}p.request("auth/verify",{method:"POST",body:JSON.stringify({token})}).then(()=>{setState("success");setMessage("Your email is verified. Your account is ready.");}).catch(error=>{setState("error");setMessage(error.message);});},[]);
  return <div className="panel auth-result flex flex-col items-center justify-center p-8 gap-4 max-w-md mx-auto text-center"><span className={`empty-orb ${state}`}><Icon name={state==="success"?"check":"spark"}/></span><h2 className="text-xl font-bold">{state==="checking"?"Checking your link":state==="success"?"Email verified":"Could not verify email"}</h2><p className="text-learnos-muted text-sm">{message}</p><button className="primary-btn" onClick={()=>p.go("home")}>Return to Drizzlearn ↗</button></div>;
}
function ResetPasswordPage(p){
  const [password,setPassword]=useState(""),[confirmation,setConfirmation]=useState(""),[message,setMessage]=useState(""),[error,setError]=useState(""),[done,setDone]=useState(false);
  async function submit(e){e.preventDefault();setError("");setMessage("");if(password!==confirmation){setError("The passwords do not match.");return;}const token=p.routeQuery?.get?.("token")||parseLocation(typeof window!=="undefined"?window.location:null).query.get("token");try{await p.request("auth/reset-password",{method:"POST",body:JSON.stringify({token,password})});setDone(true);setMessage("Your password was updated. You can sign in again.");}catch(e){setError(e.message);}}
  return <form className="panel reset-password-panel flex flex-col p-6 gap-4 max-w-md mx-auto" onSubmit={submit}><span className="eyebrow">ACCOUNT SECURITY</span><h2 className="text-xl font-bold">{done?"Password updated":"Choose a new password"}</h2><p className="text-sm text-learnos-muted">{message||"Choose a password with at least 10 characters."}</p>{!done&&<><label className="flex flex-col gap-1 text-sm font-semibold">New password<input type="password" minLength="10" required value={password} onChange={e=>setPassword(e.target.value)}/></label><label className="flex flex-col gap-1 text-sm font-semibold">Confirm password<input type="password" minLength="10" required value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>{error&&<p className="form-error">{error}</p>}<button className="primary-btn" type="submit">Update password ↗</button></>}<button className="text-button self-start" type="button" onClick={p.openAccount}>Back to sign in</button></form>;
}
