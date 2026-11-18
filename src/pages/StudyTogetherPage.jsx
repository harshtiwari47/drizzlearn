import React, { useEffect, useState, useTransition } from "react";
import { parseLocation } from "../router.js";
import { Icon, Panel, EmptyState } from "../components/common.jsx";

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

export { StudyTogetherPage };
