import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition, lazy, Suspense } from "react";
import { AmbientFocusStation } from "./components/AmbientFocusStation.jsx";
import { DiaryTodoSection } from "./components/DiaryTodoSection.jsx";
import { SnowfallOverlay } from "./components/SnowfallOverlay.jsx";
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
import {
  Icon,
  PageContextBar,
  Panel,
  EmptyState,
  FeatureCard,
  Stat,
  courseCovers,
  parseMarkdownToHtml,
  GenerationProgressCard
} from "./components/common.jsx";
import { HeaderSearchBar } from "./components/HeaderSearchBar.jsx";
import { MobileNavDrawer } from "./components/MobileNavDrawer.jsx";
import { AppFooter } from "./components/AppFooter.jsx";
import { HomePage, Home } from "./pages/HomePage.jsx";

const CoursesPage = lazy(() => import("./pages/CoursesPage.jsx").then(m => ({ default: m.CoursesPage })));
const TodayPage = lazy(() => import("./pages/TodayPage.jsx").then(m => ({ default: m.TodayPage })));
const StudyTogetherPage = lazy(() => import("./pages/StudyTogetherPage.jsx").then(m => ({ default: m.StudyTogetherPage })));
const NotesPage = lazy(() => import("./pages/NotesPage.jsx").then(m => ({ default: m.NotesPage })));
const FlashcardsPage = lazy(() => import("./pages/FlashcardsPage.jsx").then(m => ({ default: m.FlashcardsPage })));
const PracticePage = lazy(() => import("./pages/PracticePage.jsx").then(m => ({ default: m.PracticePage })));
const ProgressPage = lazy(() => import("./pages/ProgressPage.jsx").then(m => ({ default: m.ProgressPage })));
const TutorPage = lazy(() => import("./pages/TutorPage.jsx").then(m => ({ default: m.TutorPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage.jsx").then(m => ({ default: m.SettingsPage })));
const CreateCoursePage = lazy(() => import("./pages/CreateCoursePage.jsx").then(m => ({ default: m.CreateCoursePage })));
const GoalPage = CreateCoursePage;
const ProposalPage = lazy(() => import("./pages/ProposalPage.jsx").then(m => ({ default: m.ProposalPage })));
const CoursePage = lazy(() => import("./pages/CoursePage.jsx").then(m => ({ default: m.CoursePage })));
const LessonPage = lazy(() => import("./pages/LessonPage.jsx").then(m => ({ default: m.LessonPage })));
const SearchPage = lazy(() => import("./pages/SearchPage.jsx").then(m => ({ default: m.SearchPage })));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx").then(m => ({ default: m.LoginPage })));
const VerifyPage = lazy(() => import("./pages/VerifyPage.jsx").then(m => ({ default: m.VerifyPage })));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage.jsx").then(m => ({ default: m.ResetPasswordPage })));
const Modal = lazy(() => import("./pages/LoginPage.jsx").then(m => ({ default: m.Modal })));

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

function RouteSuspenseFallback() {
  return (
    <div className="route-suspense-fallback flex flex-col items-center justify-center p-12 min-h-[300px] text-center" role="status" aria-live="polite">
      <div className="btn-spinner mb-3" style={{ width: "24px", height: "24px" }} />
      <span className="text-sm text-slate-400">Loading view…</span>
    </div>
  );
}

function PageContent(props){
  const {page,routeParams,routeQuery,data,activeCourse,lessons,activeLesson,dueCards,nextTask,stats,progressPercent,pendingTasks,proposal,busy,go,openLesson}=props;
  const common={...props};
  const titles={courses:"My Courses",today:"Today’s plan","study-together":"Study Together",notes:"Notes",flashcards:"Flashcards",practice:"Practice",progress:"Your progress",tutor:"AI Tutor",settings:"Settings","create-course":"Create a course","create/course":"Create a course",goal:"Create a course",proposal:"Your course proposal",course:"Course roadmap",lesson:"Lesson workspace",search:"Search results",verify:"Verify your email", "reset-password":"Choose a new password",verified:"Email verified",login:"Account",signup:"Create account",auth:"Account"};
  if(page==="home")return <Home {...common} />;
  const routeContext=getRouteContext({page,routeParams,routeQuery,activeCourse,activeLesson,proposalCourse:proposal||activeCourse,pageTitle:titles[page]||"Workspace",knownTitles:titles});
  const isCreatePage = page === "goal" || page === "create-course" || page === "create/course";
  const isProposalPage = page === "proposal";
  const isCourseDetailPage = page === "course";
  const isTodayPage = page === "today";
  const isStudyTogetherPage = page === "study-together";
  const isDedicatedFlow = isCreatePage || isProposalPage || isCourseDetailPage || isTodayPage || isStudyTogetherPage;
  return <div className={`workspace-page ${isCreatePage ? "workspace-create-course-page" : ""} ${isProposalPage ? "workspace-proposal-page" : ""} ${isCourseDetailPage ? "workspace-course-detail-page" : ""} ${isTodayPage ? "workspace-today-page" : ""} ${isStudyTogetherPage ? "workspace-study-together-page" : ""}`}>
    {!isDedicatedFlow && <PageContextBar context={routeContext} go={go}/>}
    {!isDedicatedFlow && (
      <div className={`page-heading ${page==="lesson"?"page-heading-lesson":""} ${page==="goal"?"page-heading-goal":""}`}>
        <div>{page==="lesson"&&<span className="eyebrow">{activeLesson?.moduleTitle||"Learning session"}</span>}<h1>{page==="lesson"?activeLesson?.title||"Lesson":titles[page]||"Drizzlearn"}</h1></div>
        {page==="courses"&&<button className="primary-btn" onClick={()=>go("create-course")}><Icon name="plus" size={14}/>Create a course</button>}
      </div>
    )}
    <Suspense fallback={<RouteSuspenseFallback />}>
      {page==="courses"&&<CoursesPage {...common}/>}
      {page==="today"&&<TodayPage {...common}/>}
      {page==="study-together"&&<StudyTogetherPage {...common}/>}
      {page==="notes"&&<NotesPage {...common}/>}
      {page==="flashcards"&&<FlashcardsPage {...common}/>}
      {page==="practice"&&<PracticePage {...common}/>}
      {page==="progress"&&<ProgressPage {...common}/>}
      {page==="tutor"&&<TutorPage {...common}/>}
      {page==="settings"&&<SettingsPage {...common}/>}
      {isCreatePage&&<CreateCoursePage {...common}/>}
      {page==="proposal"&&<ProposalPage {...common}/>}
      {page==="course"&&<CoursePage {...common}/>}
      {page==="lesson"&&<LessonPage {...common}/>}
      {page==="search"&&<SearchPage {...common}/>}
      {page==="verify"&&<VerifyPage {...common}/>}
      {page==="reset-password"&&<ResetPasswordPage {...common}/>}
      {(page==="login"||page==="signup"||page==="auth")&&<LoginPage {...common}/>}
      {page==="verified"&&<EmptyState title="Your email is verified" body="Your Drizzlearn account is ready. Go back to your workspace and keep learning." action="Go to home" onAction={()=>go("home")}/>}
      {!titles[page]&&<EmptyState title="This page is ready for your next course" body="Create a learning goal to start building your workspace." action="Create a course" onAction={()=>go("create-course")}/>}
    </Suspense>
  </div>;
}

export default function App(){
  const [data,setData]=useState(loadSaved),[user,setUser]=useState(loadCachedUser),[remote,setRemote]=useState(()=>Boolean(loadCachedUser())),[page,setPage]=useState(initialPage),[routeParams,setRouteParams]=useState(()=>initialRoute().params),[routeQuery,setRouteQuery]=useState(()=>initialRoute().query),[toast,setToast]=useState(""),[busy,setBusy]=useState(false),[queryText,setQueryText]=useState(""),[searchResults,setSearchResults]=useState(null),[modal,setModal]=useState(null),[activeLessonId,setActiveLessonId]=useState(()=>initialRoute().params?.lessonId||null),[proposal,setProposal]=useState(null),[courseFilter,setCourseFilter]=useState("all"),[mobileMoreOpen,setMobileMoreOpen]=useState(false),[mobileDrawerOpen,setMobileDrawerOpen]=useState(false),[generatingCourseId,setGeneratingCourseId]=useState(null);
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
  useEffect(() => {
    if (page === "courses" || page === "course") {
      document.body.setAttribute("data-page", page);
    } else {
      document.body.removeAttribute("data-page");
    }
    return () => {
      document.body.removeAttribute("data-page");
    };
  }, [page]);
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

    const MAX_RETRIES = 4;
    let goalId = null;
    let lastError = null;

    try{
      for(let attempt = 1; attempt <= MAX_RETRIES; attempt++){
        try{
          if(!goalId){
            const created = await request("goals", { method: "POST", body: JSON.stringify(form) });
            goalId = created.goal.id;
          }

          if(attempt > 1){
            setGenerationProgress({
              stage: "retrying",
              percent: Math.min(30, 5 + attempt * 6),
              message: `Refining course structure (auto-retry ${attempt} of ${MAX_RETRIES})…`,
              model: "",
              provider: "",
            });
            await new Promise((r) => setTimeout(r, 1000));
          }

          const result = await requestStream(`goals/${goalId}/proposal?stream=1`, { method: "POST", body: JSON.stringify({}) }, (frame) => {
            setGenerationProgress((prev) => mergeStreamProgress(prev, frame, "Crafting your customized course…"));
          });

          setProposal(result.course);
          sessionStorage.removeItem("learnos.goal.draft");
          sessionStorage.removeItem("learnos.goal.prefill");
          go("proposal", { params: { courseId: result.course?.id } });
          return;
        }catch(error){
          lastError = error;
          const errMsg = String(error?.message || "");
          const isJsonError =
            error?.code === "AI_INVALID_JSON" ||
            errMsg.toLowerCase().includes("not valid json") ||
            errMsg.toLowerCase().includes("invalid json");
          const isRetryable = isJsonError || error?.details?.retryable || error?.code === "AI_RATE_LIMIT" || error?.code === "AI_PROVIDER_ERROR";

          if(isRetryable && attempt < MAX_RETRIES){
            console.warn(`[Drizzlearn] Course proposal attempt ${attempt} failed with ${error?.code || errMsg}. Auto-retrying (${attempt + 1}/${MAX_RETRIES})...`);
            continue;
          }
          break;
        }
      }

      const msg = lastError?.message || "Course generation could not be completed.";
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
      <Suspense fallback={<RouteSuspenseFallback />}>
        <LoginPage loginMode={loginMode} setLoginMode={setLoginMode} authSubmit={authSubmit} authError={authError} authMessage={authMessage} setAuthError={setAuthError} setAuthMessage={setAuthMessage} go={go} user={user} logout={logout} returnPage={returnPage} authBusy={authBusy} />
      </Suspense>
      {toast&&<div className="toast show fixed z-50" role="status" aria-live="polite">{toast}</div>}
    </>;
  }

  const isCoursePage = page === "courses" || page === "course";
  const isCreateCoursePage = page === "create-course" || page === "create/course" || page === "goal";
  const isTodayAppPage = page === "today";

  return <div className={`app-shell flex min-h-screen relative ${isCoursePage ? "app-shell-course-page" : ""} ${isCreateCoursePage ? "app-shell-create-course-page" : ""} ${isTodayAppPage ? "app-shell-today-page" : ""}`} data-page={page}>
    <SnowfallOverlay />
    {(syncing||activeRequests>0||busy)&&<div className="global-progress-bar" role="progressbar" aria-label="Loading workspace data"/>}
    <aside className="sidebar sticky top-0 h-screen flex flex-col overflow-hidden" aria-label="Main navigation">
      <div className="brand-row flex items-center gap-3"><div className="brand-mark grid place-items-center">✦</div><div className="brand-name">Drizzlearn</div></div>
      <div className="nav-section flex flex-col"><div className="nav-label">Workspace</div><nav className="nav-list grid gap-1.5" aria-label="Workspace">{primaryNavItems.map(([name,label,glyph])=>nav(name,label,glyph))}</nav></div>
      <div className="nav-section nav-tools-section flex flex-col"><div className="nav-label">Study tools</div><nav className="nav-list grid gap-1.5" aria-label="Study tools">{toolNavItems.map(([name,label,glyph])=>nav(name,label,glyph))}</nav></div>
      <button className={`nav-link mobile-more-trigger ${mobileMoreOpen||mobileToolPage?"active":""}`} type="button" aria-label="More study tools" aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu" onClick={()=>setMobileMoreOpen(open=>!open)}><span className="nav-icon"><Icon name="more" size={19}/></span><span>More</span></button>
      <div className="sidebar-spacer flex-1" />
      <button className="tutor-card relative overflow-hidden" type="button" onClick={()=>go("tutor")} aria-label="Open AI Tutor"><span className="tutor-orb" aria-hidden="true"/><strong className="tutor-card-title">AI Tutor</strong><span className="tutor-card-copy">Ask questions, get explanations and work through difficult concepts.</span><span className="tutor-open flex items-center justify-between">Open tutor <span className="round-arrow grid place-items-center">↗</span></span></button>
    </aside>
    {mobileMoreOpen&&<><button className="mobile-more-scrim fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" type="button" aria-label="Close study tools menu" onClick={()=>setMobileMoreOpen(false)}/><nav className="mobile-more-menu z-50" id="mobile-more-menu" aria-label="More study tools">{toolNavItems.map(([name,label,glyph])=>nav(name,label,glyph))}</nav></>}
    <main className="main flex-1 min-w-0">
      {(() => {
        const headerElement = (
          <header className="topbar flex items-center justify-between gap-3.5 mb-7 sticky top-0 z-30" aria-label="Header navigation">
            <div className="header-brand-wrap flex items-center gap-2">
              {/* Mobile Navigation Drawer Hamburger Toggle Button */}
              <button
                type="button"
                className="mobile-drawer-btn shrink-0"
                onClick={() => setMobileDrawerOpen(true)}
                aria-label="Open navigation menu"
                title="Menu"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>

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

                  {/* Layer 2: Hanging Paper Tag Card with white DRIZZ + cyan LEARN */}
                  <div className="hanging-card-tag flex items-center">
                    <span className="brand-logo-text"><span className="brand-text-drizz">DRIZZ</span><span className="brand-text-learn">LEARN</span></span>
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
              <HeaderSearchBar
                queryText={queryText}
                setQueryText={setQueryText}
                onSubmit={submitSearch}
                placeholder="Search..."
              />
              <button className={`avatar grid place-items-center ${!(user?.fullName||data.settings.fullName)?"logged-out":""}`} type="button" aria-label={user?.fullName||data.settings.fullName||"Sign in"} title={user?.fullName||data.settings.fullName||"Sign in to your account"} onClick={()=>user?go("settings"):openAccount()}>
                {(user?.fullName||data.settings.fullName||"?").split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase()}
              </button>
            </div>
          </header>
        );

        return (
          <>
            {page !== "home" && headerElement}
            <PageContent page={page} header={page === "home" ? headerElement : null} routeParams={routeParams} routeQuery={routeQuery} data={data} setData={setData} user={user} setUser={setUser} remote={remote} setRemote={setRemote} logout={logout} openAccount={openAccount} activeCourse={activeCourse} lessons={lessons} allLessons={allLessons} activeLesson={activeLesson} dueCards={dueCards} nextTask={nextTask} stats={stats} progressPercent={progressPercent} pendingTasks={pendingTasks} proposal={proposal} setProposal={setProposal} busy={busy} generationProgress={generationProgress} generationError={generationError} setGenerationError={setGenerationError} courseFilter={courseFilter} setCourseFilter={setCourseFilter} go={go} openLesson={openLesson} submitGoal={submitGoal} approveProposal={approveProposal} submitCheckpoint={submitCheckpoint} saveNote={saveNote} draftNote={draftNote} deleteNote={deleteNote} confirmDeleteCourse={confirmDeleteCourse} deletingCourseId={deletingCourseId} rateCard={rateCard} addFlashcard={addFlashcard} updateFlashcard={updateFlashcard} deleteFlashcard={deleteFlashcard} addFlashcardsBatch={addFlashcardsBatch} sendTutor={sendTutor} updateData={updateData} request={request} requestStream={requestStream} refreshRemote={refreshRemote} flashToast={flashToast} setModal={setModal} setActiveLessonId={setActiveLessonId} setSearchResults={setSearchResults} searchResults={searchResults} setLoginMode={setLoginMode} setModalState={setModal} generatingCourseId={generatingCourseId} syncing={syncing} activeRequests={activeRequests} />
          </>
        );
      })()}
      <AppFooter go={go} />
    </main>
    {toast&&<div className="toast show fixed z-50" role="status" aria-live="polite">{toast}</div>}
    {modal && (
      <Suspense fallback={null}>
        <Modal modal={modal} onClose={()=>{if(!deletingCourseId){setDeleteCourseError("");setModal(null);}}} onApprove={()=>approveProposal(true)} onDeleteCourse={deleteCourse} deletingCourse={Boolean(deletingCourseId)} deleteCourseError={deleteCourseError} loginMode={loginMode} setLoginMode={setLoginMode} authSubmit={authSubmit} authError={authError} authMessage={authMessage} setAuthError={setAuthError} setAuthMessage={setAuthMessage} logout={logout} authBusy={authBusy} />
      </Suspense>
    )}
    <MobileNavDrawer
      isOpen={mobileDrawerOpen}
      onClose={() => setMobileDrawerOpen(false)}
      primaryNavItems={primaryNavItems}
      toolNavItems={toolNavItems}
      activeNav={activeNav}
      go={go}
      user={user}
      settings={data.settings}
      openAccount={openAccount}
    />
  </div>;
}

// Re-export modular pages and common utilities for complete backward compatibility
export {
  HomePage,
  Home,
  CoursesPage,
  TodayPage,
  StudyTogetherPage,
  NotesPage,
  FlashcardsPage,
  PracticePage,
  ProgressPage,
  TutorPage,
  SettingsPage,
  GoalPage,
  ProposalPage,
  CoursePage,
  LessonPage,
  SearchPage,
  LoginPage,
  VerifyPage,
  ResetPasswordPage,
  Modal,
  Icon,
  PageContextBar,
  Panel,
  EmptyState,
  FeatureCard,
  Stat
};
