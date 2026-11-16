import React from "react";
import { buildPath, shouldInterceptNavClick } from "../router.js";
import { HeaderSearchBar } from "./HeaderSearchBar.jsx";

export function prettyDate(iso){if(!iso)return"";try{return new Date(iso).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});}catch{return iso;}}
export function minuteLabel(mins){if(!mins&&mins!==0)return"";if(mins<60)return`${mins}m`;const h=Math.floor(mins/60);const m=mins%60;return m?`${h}h ${m}m`:`${h}h`;}

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
      <PageContent page={page} routeParams={routeParams} routeQuery={routeQuery} data={data} setData={setData} user={user} setUser={setUser} remote={remote} setRemote={setRemote} logout={logout} openAccount={openAccount} activeCourse={activeCourse} lessons={lessons} allLessons={allLessons} activeLesson={activeLesson} dueCards={dueCards} nextTask={nextTask} stats={stats} progressPercent={progressPercent} pendingTasks={pendingTasks} proposal={proposal} setProposal={setProposal} busy={busy} generationProgress={generationProgress} generationError={generationError} setGenerationError={setGenerationError} courseFilter={courseFilter} setCourseFilter={setCourseFilter} go={go} openLesson={openLesson} submitGoal={submitGoal} approveProposal={approveProposal} submitCheckpoint={submitCheckpoint} saveNote={saveNote} draftNote={draftNote} deleteNote={deleteNote} confirmDeleteCourse={confirmDeleteCourse} deletingCourseId={deletingCourseId} rateCard={rateCard} addFlashcard={addFlashcard} updateFlashcard={updateFlashcard} deleteFlashcard={deleteFlashcard} addFlashcardsBatch={addFlashcardsBatch} sendTutor={sendTutor} updateData={updateData} request={request} requestStream={requestStream} refreshRemote={refreshRemote} flashToast={flashToast} setModal={setModal} setActiveLessonId={setActiveLessonId} setSearchResults={setSearchResults} searchResults={searchResults} setLoginMode={setLoginMode} setModalState={setModal} generatingCourseId={generatingCourseId} syncing={syncing} activeRequests={activeRequests} />
      <footer className="app-footer flex items-center justify-between text-sm"><span>Drizzlearn</span><button type="button" onClick={()=>go("settings")}>Settings</button></footer>
    </main>
    {toast&&<div className="toast show fixed z-50" role="status" aria-live="polite">{toast}</div>}
    {modal&&<Modal modal={modal} onClose={()=>{if(!deletingCourseId){setDeleteCourseError("");setModal(null);}}} onApprove={()=>approveProposal(true)} onDeleteCourse={deleteCourse} deletingCourse={Boolean(deletingCourseId)} deleteCourseError={deleteCourseError} loginMode={loginMode} setLoginMode={setLoginMode} authSubmit={authSubmit} authError={authError} authMessage={authMessage} setAuthError={setAuthError} setAuthMessage={setAuthMessage} logout={logout} authBusy={authBusy} />}
  </div>;
}

export { Icon };

function PageContextBar({context,go}){
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

export { PageContextBar };

function pendingTasksCount(data){return data.tasks.filter(t=>t.status!=="completed").length;}
function FeatureCard({featured,icon,title,detail,action}){return <button className={`feature-card flex items-center gap-3.5 p-4 text-left cursor-pointer transition-all ${featured?"featured":""}`} type="button" onClick={action}><span className="feature-icon grid place-items-center"><Icon name={icon}/></span><span className="flex flex-col gap-0.5 min-w-0"><strong>{title}</strong><small className="leading-snug">{detail}</small></span></button>}
function Stat({icon,value,label}){return <div className="stat flex flex-col items-center justify-center p-3 text-center gap-1"><span className="stat-icon"><Icon name={icon}/></span><strong className="tabular-nums tracking-tight">{value}</strong><small className="leading-tight text-learnos-muted">{label}</small></div>}
function Panel({title,icon,children,action}){return <section className="panel flex flex-col"><div className="panel-head flex items-center justify-between"><div className="panel-title flex items-center gap-2.5"><Icon name={icon||"spark"}/>{title}</div>{action}</div>{children}</section>}

function EmptyState({title,body,action,onAction,illustration}){return <div className="empty-state flex flex-col items-center justify-center text-center p-8">{illustration?<div className="empty-illustration-wrap mb-3"><img src={illustration} alt="" className="empty-illustration-img" loading="lazy"/></div>:<span className="empty-orb grid place-items-center mb-3"><Icon name="spark" size={24}/></span>}<h2>{title}</h2><p className="max-w-md mb-4">{body}</p>{action&&<button className="primary-btn" onClick={onAction}>{action} ↗</button>}</div>}

const courseCovers=["/images/course-cover-ai.svg","/images/course-cover-systems.svg","/images/course-cover-math.svg","/images/course-cover-design.svg"];

export { pendingTasksCount, FeatureCard, Stat, Panel, EmptyState, courseCovers };

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

export { parseMarkdownToHtml };

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

export { GenerationProgressCard };
