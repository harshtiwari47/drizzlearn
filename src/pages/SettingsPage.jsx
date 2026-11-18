import React, { useState, useMemo } from "react";
import { Icon, Panel, emptyWorkspace, LOCAL_STORAGE_KEY, LEGACY_STORAGE_KEY } from "../components/common.jsx";
import { AiEngineRagPanel } from "./TutorPage.jsx";

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

export { SettingsPage };
