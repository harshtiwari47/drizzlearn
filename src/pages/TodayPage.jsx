import React from "react";
import { Icon, Panel, EmptyState, minuteLabel } from "../components/common.jsx";

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

export { TodayPage };
