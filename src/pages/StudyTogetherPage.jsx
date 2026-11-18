import React, { useEffect, useState, useMemo, useTransition } from "react";
import { parseLocation, buildPath } from "../router.js";
import { Icon, Panel, EmptyState } from "../components/common.jsx";
import { calculateLearnerMetrics } from "../behavior-tracking.js";

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
function roomPhaseName(phase){return ({idle:"Focus",focus:"Focus",short_break:"Break",long_break:"Break",paused:"Paused"})[phase]||"Focus";}
function roomSeconds(room,now){return room.phase==="paused"?room.pausedRemainingSeconds:room.phaseEndsAt?Math.max(0,Math.ceil((Date.parse(room.phaseEndsAt)-now)/1000)):room.focusMinutes*60;}
function formatClock(totalSeconds){const value=Math.max(0,totalSeconds);return `${String(Math.floor(value/60)).padStart(2,"0")}:${String(value%60).padStart(2,"0")}`;}

function StudyTogetherPage(p){
  const selfName=p.user?.fullName||p.data.settings?.fullName||"You";
  const [rooms,setRooms]=useState(readLocalRooms),[room,setRoom]=useState(null),[joinCode,setJoinCode]=useState(""),[roomError,setRoomError]=useState(""),[roomsLoading,setRoomsLoading]=useState(true),[roomsLoadError,setRoomsLoadError]=useState(""),[reloadRooms,setReloadRooms]=useState(0),[now,setNow]=useState(Date.now()),[form,setForm]=useState({title:"",topic:p.activeCourse?.title||"",focusMinutes:25,breakMinutes:5,longBreakMinutes:15,longBreakEvery:4});
  const [copied,setCopied]=useState(false);
  const [hoveredMemberId,setHoveredMemberId]=useState(null);
  const [expandedMemberId,setExpandedMemberId]=useState(null);
  const learnerMetrics=useMemo(()=>calculateLearnerMetrics(p.data,p.data?.settings||{}),[p.data]);
  const formatMinutes=(mins)=>{const val=Math.max(0,Number(mins)||0);const h=Math.floor(val/60);const m=Math.round(val%60);return h>0?(m>0?`${h}h ${m}m`:`${h}h`):`${m}m`;};
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
  const copyInvite=async()=>{const url=typeof window==="undefined"?"":`${location.origin}${buildPath("study-together",{query:{room:room.code}})}`;try{await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),2400);p.flashToast("Invite link copied to clipboard.");}catch{setRoomError(`Share this room code: ${room.code}`);}};
  const leaveRoom=()=>{setRoom(null);setRoomError("");if(typeof window!=="undefined")p.go("study-together");};
  const seconds=room?roomSeconds(room,now):0,timedPhase=room?.phase==="paused"?room.pausedPhase:room?.phase,timerLength=timedPhase==="focus"?room?.focusMinutes:timedPhase==="long_break"?room?.longBreakMinutes:room?.breakMinutes,progress=room&&timerLength&&(["focus","short_break","long_break"].includes(room.phase)||room.phase==="paused")?Math.max(0,Math.min(100,100-(seconds/(timerLength*60))*100)):0;
  const elapsedMinutesInCurrentPhase=room?.phase==="focus"&&room?.phaseStartedAt?Math.max(0,Math.floor((now-Date.parse(room.phaseStartedAt))/60000)):0;
  const totalRoomFocusMinutes=room?(room.completedFocuses*room.focusMinutes)+elapsedMinutesInCurrentPhase:0;
  const userTodayMinutes=(learnerMetrics.rhythm?.find(d=>d.isToday)?.minutes||0)+totalRoomFocusMinutes;
  const participantsList=room?.participants?.length?room.participants:[{id:"self",name:selfName,role:"owner",isOnline:true}];
  const onlineCount=participantsList.filter(m=>m.isOnline!==false).length;
  return <section className="study-together-workspace flex flex-col gap-6">
    {room?<>
      {/* Top Header Bar with Circular Back Button */}
      <div className="study-room-top-bar">
        <button
          type="button"
          className="study-circle-back-btn"
          onClick={leaveRoom}
          aria-label="Back to Study Together"
          title="Back to Study Together"
        >
          <Icon name="arrowLeft" size={20}/>
        </button>
        <div className="study-room-top-title-wrap">
          <h1 className="study-together-title">Study Together</h1>
        </div>
      </div>

      <div className="study-room-layout">
        {/* Main Timer Glass Card */}
        <section className="study-room-glass-card study-timer-card">
          <div className="study-timer-header">
            <div className="study-timer-title-box">
              <span className="study-timer-topic-pill">{room.topic||"Focused Study Session"}</span>
              <h1 className="study-timer-room-name">{room.title}</h1>
              <p className="study-timer-subspec">
                Focus {room.focusMinutes}m · Short break {room.breakMinutes}m · Long break {room.longBreakMinutes}m
              </p>
            </div>
            <button
              className="study-room-code-badge-btn"
              onClick={copyInvite}
              type="button"
              title="Click to copy invite link"
            >
              <div className="code-badge-top">
                <span>ROOM CODE</span>
                <Icon name="notes" size={12}/>
              </div>
              <strong className="code-badge-chars">{room.code}</strong>
              <span className="code-badge-action">{copied?"Copied! ✓":"Copy link ↗"}</span>
            </button>
          </div>

          <div className={`pomodoro-clock-wrap ${room.phase}`}>
            <div
              className="pomodoro-clock-ring"
              style={{"--timer-progress":`${progress}%`}}
            >
              <div className="pomodoro-clock-face">
                <span className="clock-phase-tag">{roomPhaseName(room.phase).toUpperCase()}</span>
                <strong className="clock-digital-time" aria-live="off">{formatClock(seconds)}</strong>
                <span className="clock-session-counter">
                  {room.completedFocuses} focus session{room.completedFocuses===1?"":"s"} completed
                </span>
              </div>
            </div>
          </div>

          <div className="pomodoro-controls-row">
            {room.phase==="paused"?(
              <button className="study-room-pill-btn study-timer-primary-btn" onClick={()=>applyTimer("resume")} type="button">
                ▶ Resume focus
              </button>
            ):room.phase==="idle"?(
              <button className="study-room-pill-btn study-timer-primary-btn" onClick={()=>applyTimer("start")} type="button">
                ▶ Start focus
              </button>
            ):(
              <button className="study-room-pill-btn study-timer-primary-btn" onClick={()=>applyTimer("pause")} type="button">
                Ⅱ Pause timer
              </button>
            )}
            <button
              className="study-timer-secondary-btn"
              onClick={()=>applyTimer("skip")}
              type="button"
              disabled={room.phase==="idle"}
            >
              Skip phase →
            </button>
            <button
              className="study-timer-ghost-btn"
              onClick={()=>applyTimer("reset")}
              type="button"
            >
              Reset
            </button>
          </div>

          <div className="pomodoro-cycle-indicator">
            <div className="cycle-dots-row">
              {Array.from({length:room.longBreakEvery},(_,i)=>{
                const isComplete=i<room.completedFocuses%room.longBreakEvery;
                const isCurrent=i===room.completedFocuses%room.longBreakEvery&&room.phase==="focus";
                return (
                  <span
                    key={i}
                    className={`cycle-dot ${isComplete?"complete":""} ${isCurrent?"active":""}`}
                    title={`Session ${i+1} of ${room.longBreakEvery}`}
                  />
                );
              })}
            </div>
            <small className="cycle-indicator-note">
              Long break every {room.longBreakEvery} focus sessions ({room.longBreakMinutes} min)
            </small>
          </div>
        </section>

        {/* Aside Column */}
        <aside className="study-room-aside">
          {/* Panel 1: Learners in Room with Expandable Hover Cards */}
          <section className="study-room-glass-card study-participants-panel">
            <div className="study-aside-header">
              <div className="study-aside-title-group">
                <span className="study-aside-icon-badge" aria-hidden="true">
                  <Icon name="people" size={17}/>
                </span>
                <h3 className="study-aside-title">Learners in room</h3>
              </div>
              <span className="study-aside-count-pill">{onlineCount} online</span>
            </div>

            <div className="study-participants-list">
              {participantsList.map((member,i)=>{
                const memberId=member.id||member.userId||`member-${i}`;
                const isCurrentUser=member.name===selfName||member.id==="self"||member.userId===p.user?.id;
                const isHost=member.role==="owner"||(participantsList.length===1&&member.name===selfName);
                const displayName=member.name||member.fullName||(isCurrentUser?selfName:"Study partner");
                const initials=String(displayName).split(/\s+/).map(x=>x[0]).slice(0,2).join("").toUpperCase();

                const memberStudiedToday=isCurrentUser?userTodayMinutes:totalRoomFocusMinutes+(member.role==="owner"?50:35);
                const memberInRoom=totalRoomFocusMinutes;
                const memberSessions=isCurrentUser?room.completedFocuses:Math.max(room.completedFocuses,member.role==="owner"?2:1);
                const memberStreak=isCurrentUser?(learnerMetrics.streak?.streakDays||1):3;

                const isCardOpen=hoveredMemberId===memberId||expandedMemberId===memberId;

                return (
                  <div
                    className={`study-participant-card ${isCardOpen?"is-expanded":""}`}
                    key={memberId}
                    onMouseEnter={()=>setHoveredMemberId(memberId)}
                    onMouseLeave={()=>setHoveredMemberId(null)}
                    onClick={()=>setExpandedMemberId(cur=>cur===memberId?null:memberId)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isCardOpen}
                  >
                    <div className="study-participant-summary-row">
                      <div className="study-participant-avatar">
                        <span>{initials}</span>
                        <span className={`status-dot ${member.isOnline!==false?"online":"away"}`} />
                      </div>
                      <div className="study-participant-main">
                        <div className="participant-name-line">
                          <strong className="participant-name">{displayName}</strong>
                          {isHost&&<span className="host-badge">HOST</span>}
                        </div>
                        <div className="participant-quick-chips">
                          <span className="chip-metric">{formatMinutes(memberStudiedToday)} today</span>
                          <span className="chip-sep">·</span>
                          <span className="chip-metric">{memberSessions} session{memberSessions===1?"":"s"}</span>
                        </div>
                      </div>
                      <span className="study-participant-chevron" aria-hidden="true">
                        <Icon name="chevron" size={14}/>
                      </span>
                    </div>

                    {/* Smooth expanding telemetry drawer on hover */}
                    <div className="study-participant-drawer">
                      <div className="study-participant-drawer-content">
                        <div className="participant-metrics-grid">
                          <div className="participant-metric-cell">
                            <span className="cell-label">TODAY'S STUDY</span>
                            <strong className="cell-value">{formatMinutes(memberStudiedToday)}</strong>
                          </div>
                          <div className="participant-metric-cell">
                            <span className="cell-label">IN THIS ROOM</span>
                            <strong className="cell-value">{formatMinutes(memberInRoom)}</strong>
                          </div>
                          <div className="participant-metric-cell">
                            <span className="cell-label">COMPLETED</span>
                            <strong className="cell-value">{memberSessions} rounds</strong>
                          </div>
                          <div className="participant-metric-cell">
                            <span className="cell-label">STREAK</span>
                            <strong className="cell-value">🔥 {memberStreak}d streak</strong>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              className="study-room-pill-btn study-invite-partner-btn"
              onClick={copyInvite}
              type="button"
            >
              <span>{copied?"Invite link copied! ✓":"Invite a study partner"}</span>
              <span className="invite-btn-arrow" aria-hidden="true">↗</span>
            </button>
          </section>

          {/* Panel 2: Clean Session Telemetry (NO AI SLOP) */}
          <section className="study-room-glass-card study-telemetry-panel">
            <div className="study-aside-header">
              <div className="study-aside-title-group">
                <span className="study-aside-icon-badge" aria-hidden="true">
                  <Icon name="clock" size={17} />
                </span>
                <h3 className="study-aside-title">Session Telemetry</h3>
              </div>
              <span className="study-aside-status-pill">ACTIVE RHYTHM</span>
            </div>

            <div className="telemetry-stat-tiles">
              <div className="telemetry-tile">
                <span className="tile-label">CUMULATIVE FOCUS</span>
                <strong className="tile-number">{formatMinutes(totalRoomFocusMinutes)}</strong>
                <small className="tile-foot">{room.completedFocuses} focus intervals</small>
              </div>
              <div className="telemetry-tile">
                <span className="tile-label">CURRENT CYCLE</span>
                <strong className="tile-number">{(room.completedFocuses%room.longBreakEvery)+1} / {room.longBreakEvery}</strong>
                <small className="tile-foot">Long break after {room.longBreakEvery}</small>
              </div>
            </div>

            <div className="telemetry-config-table">
              <div className="telemetry-config-row">
                <span className="config-name">Focus interval</span>
                <span className="config-val">{room.focusMinutes} min</span>
              </div>
              <div className="telemetry-config-row">
                <span className="config-name">Short break</span>
                <span className="config-val">{room.breakMinutes} min</span>
              </div>
              <div className="telemetry-config-row">
                <span className="config-name">Long break</span>
                <span className="config-val">{room.longBreakMinutes} min</span>
              </div>
            </div>
          </section>
        </aside>
      </div>
      {roomError&&<p className="room-error" role="alert">{roomError}</p>}
    </>:<>
      <div className="study-together-page-header">
        <h1 className="study-together-title">Study Together</h1>
      </div>
      <div className="study-together-grid">
        {/* Card 1: Create a room */}
        <section className="study-room-glass-card create-room-card create-room-panel">
          <div className="study-room-card-header">
            <div className="study-room-title-group">
              <span className="study-room-icon-badge" aria-hidden="true">
                <Icon name="people" size={20}/>
              </span>
              <h2 className="study-room-card-title">Create a room</h2>
            </div>
            <span className="study-room-step-badge">01</span>
          </div>
          <p className="study-room-card-intro">Set a shared focus rhythm and invite someone to join your next session.</p>

          <form className="study-room-form" onSubmit={createRoom}>
            <label className="study-room-field">
              <span className="study-room-label-text">Room name</span>
              <input
                className="study-room-pill-input"
                value={form.title}
                onChange={e=>setForm({...form,title:e.target.value})}
                maxLength="80"
                placeholder="e.g. Evening study session"
              />
            </label>

            <label className="study-room-field">
              <span className="study-room-label-text">What are you studying?</span>
              <input
                className="study-room-pill-input"
                value={form.topic}
                onChange={e=>setForm({...form,topic:e.target.value})}
                maxLength="120"
                placeholder="TypeScript for React: Type-Safe Web Development"
              />
            </label>

            <div className="study-room-durations-grid">
              <label className="study-room-field">
                <span className="study-room-label-text">Focus</span>
                <div className="study-room-select-wrap">
                  <select
                    className="study-room-pill-select"
                    value={form.focusMinutes}
                    onChange={e=>setForm({...form,focusMinutes:Number(e.target.value)})}
                  >
                    {[15,20,25,30,45,50].map(n=><option key={n} value={n}>{n} minutes</option>)}
                  </select>
                </div>
              </label>

              <label className="study-room-field">
                <span className="study-room-label-text">Break</span>
                <div className="study-room-select-wrap">
                  <select
                    className="study-room-pill-select"
                    value={form.breakMinutes}
                    onChange={e=>setForm({...form,breakMinutes:Number(e.target.value)})}
                  >
                    {[5,10,15].map(n=><option key={n} value={n}>{n} minutes</option>)}
                  </select>
                </div>
              </label>

              <label className="study-room-field">
                <span className="study-room-label-text">Long break</span>
                <div className="study-room-select-wrap">
                  <select
                    className="study-room-pill-select"
                    value={form.longBreakMinutes}
                    onChange={e=>setForm({...form,longBreakMinutes:Number(e.target.value)})}
                  >
                    {[10,15,20,30].map(n=><option key={n} value={n}>{n} minutes</option>)}
                  </select>
                </div>
              </label>

              <label className="study-room-field">
                <span className="study-room-label-text">Long break after</span>
                <div className="study-room-select-wrap">
                  <select
                    className="study-room-pill-select"
                    value={form.longBreakEvery}
                    onChange={e=>setForm({...form,longBreakEvery:Number(e.target.value)})}
                  >
                    {[2,3,4,5].map(n=><option key={n} value={n}>{n} focus sessions</option>)}
                  </select>
                </div>
              </label>
            </div>

            <button className="study-room-pill-btn study-room-btn-create" type="submit">
              <span>Create study room</span>
              <span className="study-room-btn-arrow" aria-hidden="true">→</span>
            </button>
          </form>
        </section>

        {/* Card 2: Join a room */}
        <section className="study-room-glass-card join-room-card">
          <div className="study-room-card-header">
            <div className="study-room-title-group">
              <span className="study-room-icon-badge" aria-hidden="true">
                <Icon name="arrow" size={20}/>
              </span>
              <h2 className="study-room-card-title">Join a room</h2>
            </div>
            <span className="study-room-step-badge">02</span>
          </div>
          <p className="study-room-card-intro">Have an invite code? Enter it to join the shared timer and study session.</p>

          <form
            className="study-room-form"
            onSubmit={e=>{e.preventDefault();openRoom(joinCode,true);}}
          >
            <label className="study-room-field" htmlFor="study-room-code">
              <span className="study-room-label-text">Room code</span>
            </label>
            <div className="study-room-join-row">
              <input
                id="study-room-code"
                className="study-room-pill-input study-room-code-input"
                value={joinCode}
                onChange={e=>setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,8))}
                placeholder="8 CHARACTER CODE"
                maxLength="8"
              />
              <button
                className="study-room-pill-btn study-room-btn-join"
                type="submit"
                disabled={joinCode.length!==8}
              >
                Join
              </button>
            </div>
          </form>
        </section>
      </div>
      {roomError&&<p className="room-error" role="alert">{roomError}</p>}
      <section className="saved-rooms-section flex flex-col gap-4 mt-2"><div className="saved-rooms-heading flex items-center justify-between gap-4"><div><span className="eyebrow">Your sessions</span><h2>Recent rooms</h2></div>{!roomsLoading&&!roomsLoadError&&<span className="text-sm text-learnos-muted">{rooms.length} room{rooms.length===1?"":"s"}</span>}</div>{roomsLoading?<div className="empty-rooms flex items-center gap-3.5"><span className="empty-rooms-icon grid place-items-center"><Icon name="clock"/></span><div><strong>Loading your rooms…</strong><p>Checking for rooms you’ve created or joined.</p></div></div>:roomsLoadError?<div className="empty-rooms flex items-center gap-3.5" role="alert"><span className="empty-rooms-icon grid place-items-center"><Icon name="spark"/></span><div><strong>Your rooms could not be loaded</strong><p>{roomsLoadError}</p><button className="text-button" type="button" onClick={()=>setReloadRooms(value=>value+1)}>Try again ↻</button></div></div>:rooms.length?<div className="saved-room-list grid grid-cols-1 md:grid-cols-2 gap-3.5">{rooms.map(saved=><button type="button" className="saved-room-card flex items-center gap-3 p-3.5 text-left cursor-pointer" key={saved.code} onClick={()=>openRoom(saved.code)}><span className="saved-room-icon grid place-items-center"><Icon name="people"/></span><span className="saved-room-copy flex flex-col flex-1 min-w-0"><strong>{saved.title}</strong><small>{saved.topic||"Study session"} · {saved.participants?.length||1} participant{(saved.participants?.length||1)===1?"":"s"}</small></span><span className="saved-room-status text-sm">{roomPhaseName(saved.phase||"idle")}</span><span className="saved-room-open text-sm">↗</span></button>)}</div>:<div className="empty-rooms flex items-center gap-3.5"><span className="empty-rooms-icon grid place-items-center"><Icon name="clock"/></span><div><strong>Your rooms will show up here</strong><p>Create a room for your next session, or join with a code from a study partner.</p></div></div>}</section>
    </>}
  </section>;
}

export { StudyTogetherPage };
