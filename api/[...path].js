import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { query, withTransaction } from "../server/db.js";
import { readJson, sendError, sendJson, safeError, methodNotAllowed } from "../server/http.js";
import { createSessionCookie, clearSessionCookie, requireUser, sessionUserId } from "../server/auth.js";
import { validateSignup, normalizeEmail } from "../server/auth-validation.js";
import { sendEmail } from "../server/email.js";
import { generateCourseProposal, improveCourseProposal, approveCourse } from "../server/plan-service.js";
import { getCourseMaterialsStatus } from "../server/materials-generator.js";
import { getModelPoolStatus } from "../server/model-manager.js";
import { tutorReply, generatePracticeExercises, generateFlashcards } from "../server/ai.js";
import { scheduleFlashcardReview } from "../src/srs.js";
import { retrieveLearnerContext } from "../server/retrieval.js";
import { indexUserSource, deleteUserSourceChunks, reindexUserCorpus, getRagStatus } from "../server/rag-service.js";

const idPattern = /^[0-9a-f-]{36}$/i;
const roomCodePattern = /^[A-HJ-NP-Z2-9]{8}$/i;
const hashToken = (value) => crypto.createHash("sha256").update(value).digest("hex");
const userDto = (user) => ({ id:user.id, email:user.email, fullName:user.full_name, timezone:user.timezone, preferredStudyDays:user.preferred_study_days, sessionMinutes:user.session_minutes, weeklyMinutes:user.weekly_minutes, notificationPreferences:user.notification_preferences });
const bodyOf = async (req) => { try { return await readJson(req); } catch { const error = new Error("Request body must be valid JSON."); error.status = 400; error.code = "INVALID_JSON"; throw error; } };
const owned = async (user, res) => await requireUser(user, res);
const notFound = (res, type="Resource") => sendError(res,404,"NOT_FOUND",`${type} was not found.`);
const method = (req,res,allowed) => { if (!allowed.includes(req.method)) { methodNotAllowed(res,allowed); return false; } return true; };
async function safeRagSync(work) { try { await work(); } catch {} }

function formatStreamError(error) {
  if (error?.code === "DATABASE_NOT_CONFIGURED") {
    return { status: 503, code: error.code, message: error.message, retryable: false };
  }
  if (
    error?.code === "DATABASE_UNAVAILABLE" ||
    error?.code === "ECONNREFUSED" ||
    error?.code === "ETIMEDOUT" ||
    error?.name === "MongoServerSelectionError" ||
    error?.name === "MongoNetworkTimeoutError" ||
    error?.name === "MongoNetworkError"
  ) {
    return {
      status: 503,
      code: "DATABASE_UNAVAILABLE",
      message: "The database service is temporarily unavailable. Please try again shortly.",
      retryable: true,
    };
  }
  if (String(error?.code || "").startsWith("AI_")) {
    const code = error.code;
    const status =
      code === "AI_RATE_LIMIT"
        ? 429
        : code === "AI_TIMEOUT"
        ? 504
        : [
            "AI_PROVIDER_AUTH",
            "AI_PROVIDER_ERROR",
            "AI_PROVIDER_RESPONSE",
            "AI_EMPTY_RESPONSE",
            "AI_INVALID_JSON",
            "AI_INVALID_PLAN",
            "AI_INVALID_LESSON",
            "AI_INVALID_CHECKPOINT",
            "AI_INVALID_PREREQUISITE",
          ].includes(code)
        ? 502
        : 503;
    return {
      status,
      code,
      message: error.message || "The AI provider is temporarily unavailable.",
      retryable: error.retryable !== false,
    };
  }
  if (error?.code === "COURSE_NOT_PROPOSAL") {
    return { status: 409, code: error.code, message: error.message, retryable: false };
  }
  if (error?.status) {
    return { status: error.status, code: error.code || "BAD_REQUEST", message: error.message, retryable: false };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "The request could not be completed.", retryable: false };
}

/**
 * Execute a proposal generation or improvement request as NDJSON stream or standard JSON response.
 */
async function handleProposalStreamOrJson(req, res, work, { status = 200, resourceType = "Resource" } = {}) {
  const url = new URL(req.url, "http://localhost");
  const wantsStream =
    url.searchParams.get("stream") === "1" ||
    String(req.headers?.accept || "").includes("application/x-ndjson");

  if (!wantsStream) {
    const result = await work(null);
    if (!result) return notFound(res, resourceType);
    return sendJson(res, status, { course: result });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") res.flushHeaders();

  const streamChunks = [];
  const canWrite = typeof res.write === "function";
  const writeLine = (payload) => {
    if (res.writableEnded || res.destroyed) return;
    const line = `${JSON.stringify(payload)}\n`;
    if (canWrite) res.write(line);
    else streamChunks.push(line);
  };

  writeLine({
    type: "progress",
    stage: "initializing",
    percent: 5,
    message: "Analyzing learning goal & workspace knowledge...",
  });

  const heartbeat = setInterval(() => {
    writeLine({ type: "heartbeat", ts: Date.now() });
  }, 2_500);
  heartbeat.unref?.();

  if (typeof res.on === "function") {
    res.on("close", () => clearInterval(heartbeat));
  }

  try {
    const onProgress = (evt) => {
      if (!evt || typeof evt !== "object") return;
      writeLine({ type: "progress", ...evt });
    };
    const result = await work(onProgress);
    if (!result) {
      writeLine({
        type: "error",
        status: 404,
        error: { code: "NOT_FOUND", message: `${resourceType} was not found.` },
      });
    } else {
      writeLine({ type: "complete", course: result });
    }
  } catch (error) {
    const formatted = formatStreamError(error);
    writeLine({
      type: "error",
      status: formatted.status,
      error: {
        code: formatted.code,
        message: formatted.message,
        details: { retryable: formatted.retryable },
      },
    });
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      if (canWrite) res.end();
      else res.end(streamChunks.join(""));
    }
  }
}

async function authRoutes(req,res,parts) {
  const action=parts[1], verb=req.method;
  if (action==="signup" && verb==="POST") {
    const validation=validateSignup(await bodyOf(req)); if(validation.error) return sendError(res,400,"INVALID_SIGNUP",validation.error);
    const {fullName,email,password}=validation.value;
    const passwordHash=await bcrypt.hash(password,12);
    const created=await query("INSERT INTO users(email,full_name,password_hash,email_verified_at) VALUES($1,$2,$3,NOW()) ON CONFLICT(email) DO NOTHING RETURNING id,email,full_name,timezone,preferred_study_days,session_minutes,weekly_minutes,notification_preferences",[email,fullName,passwordHash]);
    if(!created.rows[0]) return sendError(res,409,"EMAIL_EXISTS","An account already uses this email address.");
    return sendJson(res,201,{user:userDto(created.rows[0])},{"Set-Cookie":createSessionCookie(created.rows[0].id)});
  }
  if (action==="login" && verb==="POST") {
    const b=await bodyOf(req),email=normalizeEmail(b.email),password=String(b.password||"");
    const result=await query("SELECT id,email,full_name,password_hash,timezone,preferred_study_days,session_minutes,weekly_minutes,notification_preferences FROM users WHERE email=$1",[email]);
    if(!result.rows[0]||!(await bcrypt.compare(password,result.rows[0].password_hash))) return sendError(res,401,"INVALID_CREDENTIALS","Email or password is incorrect.");
    return sendJson(res,200,{user:userDto(result.rows[0])},{"Set-Cookie":createSessionCookie(result.rows[0].id)});
  }
  if(action==="logout"&&verb==="POST") return sendJson(res,200,{ok:true},{"Set-Cookie":clearSessionCookie()});
  if(action==="me"&&verb==="GET") { const user=await owned(req,res); if(!user)return; return sendJson(res,200,{user:userDto(user)}); }
  if(action==="verify"&&verb==="POST") {
    const token=String((await bodyOf(req)).token||""); if(token.length<20)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    const verified = await withTransaction(async (client) => {
      const result = await client.query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='verify_email' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
      if(!result.rows[0]) return false;
      await client.query("UPDATE users SET email_verified_at=NOW(),updated_at=NOW() WHERE id=$1",[result.rows[0].user_id]);
      return true;
    });
    if(!verified)return sendError(res,400,"INVALID_TOKEN","This verification link is invalid or expired.");
    return sendJson(res,200,{verified:true});
  }
  if(action==="forgot-password"&&verb==="POST") {
    const email=normalizeEmail((await bodyOf(req)).email),result=await query("SELECT id FROM users WHERE email=$1",[email]);
    if(result.rows[0]) { const token=crypto.randomBytes(32).toString("base64url"); await query("INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'reset_password',$2,NOW()+INTERVAL '1 hour')",[result.rows[0].id,hashToken(token)]); const link=`${process.env.APP_URL||"http://localhost:3000"}/reset-password?token=${encodeURIComponent(token)}`; await sendEmail({to:email,subject:"Reset your Drizzlearn password",text:`Reset your password: ${link}`,html:`<p><a href="${link}">Reset your password</a></p>`}); }
    return sendJson(res,200,{ok:true,message:"If the account exists, a reset link has been sent."});
  }
  if(action==="reset-password"&&verb==="POST") {
    const b=await bodyOf(req),token=String(b.token||""),password=String(b.password||"");
    if(password.length<10||password.length>200)return sendError(res,400,"INVALID_PASSWORD","Use a password between 10 and 200 characters.");
    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await withTransaction(async (client) => {
      const result = await client.query("UPDATE auth_tokens SET consumed_at=NOW() WHERE token_hash=$1 AND purpose='reset_password' AND consumed_at IS NULL AND expires_at>NOW() RETURNING user_id",[hashToken(token)]);
      if(!result.rows[0]) return false;
      await client.query("UPDATE users SET password_hash=$1,updated_at=NOW() WHERE id=$2",[passwordHash,result.rows[0].user_id]);
      return true;
    });
    if(!updated)return sendError(res,400,"INVALID_TOKEN","This reset link is invalid or expired.");
    return sendJson(res,200,{ok:true});
  }
  return sendError(res,404,"NOT_FOUND","Authentication action was not found.");
}

async function getHome(user) {
  const [course,tasks,reviews,counts,evidence]=await Promise.all([
    query(`SELECT c.id,c.title,c.summary,c.status,c.estimated_minutes,g.current_level,g.target_weeks,
      (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id=c.id) AS lesson_count,
      (SELECT COUNT(*)::int FROM study_tasks t WHERE t.course_id=c.id AND t.status='completed') AS completed_tasks
      FROM courses c JOIN learning_goals g ON g.id=c.goal_id WHERE c.user_id=$1 AND c.status='active' ORDER BY c.approved_at DESC LIMIT 1`,[user.id]),
    query(`SELECT id,title,task_type,scheduled_at,estimated_minutes,status,lesson_id FROM study_tasks
      WHERE user_id=$1 AND status IN ('due','in_progress','upcoming','overdue') ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'due' THEN 1 WHEN 'overdue' THEN 2 ELSE 3 END,scheduled_at NULLS FIRST LIMIT 8`,[user.id]),
    query("SELECT COUNT(*)::int AS count FROM flashcards WHERE user_id=$1 AND due_at<=NOW()",[user.id]),
    query(`SELECT (SELECT COUNT(*)::int FROM notes WHERE user_id=$1) notes,
      (SELECT COUNT(*)::int FROM flashcards WHERE user_id=$1) flashcards,
      (SELECT COUNT(*)::int FROM practice_attempts WHERE user_id=$1) attempts,
      (SELECT COUNT(*)::int FROM study_tasks WHERE user_id=$1 AND status='completed') completed,
      (SELECT COUNT(*)::int FROM study_tasks WHERE user_id=$1) total`,[user.id]),
    query(`SELECT COUNT(DISTINCT concept)::int AS concepts FROM practice_attempts WHERE user_id=$1 AND score>=70 AND concept<>'' AND created_at>NOW()-INTERVAL '30 days'`,[user.id]),
  ]);
  return {course:course.rows[0]||null,tasks:tasks.rows,reviewsDue:reviews.rows[0].count,counts:counts.rows[0],recentUnderstanding:evidence.rows[0].concepts};
}

const roomDto=(room,participants=[])=>({
  id:room.id,code:room.room_code,title:room.title,topic:room.topic,
  focusMinutes:Number(room.focus_minutes),breakMinutes:Number(room.break_minutes),longBreakMinutes:Number(room.long_break_minutes),longBreakEvery:Number(room.long_break_every),
  phase:room.phase,pausedPhase:room.paused_phase,completedFocuses:Number(room.completed_focuses),pausedRemainingSeconds:Number(room.paused_remaining_seconds),
  phaseStartedAt:room.phase_started_at,phaseEndsAt:room.phase_ends_at,createdAt:room.created_at,updatedAt:room.updated_at,participants,
});

function advanceRoom(room, now=new Date()) {
  let current={...room}, changed=false, guard=0;
  while(["focus","short_break","long_break"].includes(current.phase)&&current.phase_ends_at&&new Date(current.phase_ends_at)<=now&&guard++<100){
    const transitionAt=new Date(current.phase_ends_at);
    if(current.phase==="focus"){
      current.completed_focuses=Number(current.completed_focuses)+1;
      current.phase=current.completed_focuses%Number(current.long_break_every)===0?"long_break":"short_break";
      const minutes=current.phase==="long_break"?Number(current.long_break_minutes):Number(current.break_minutes);
      current.phase_started_at=transitionAt;current.phase_ends_at=new Date(transitionAt.getTime()+minutes*60_000);
    }else{
      current.phase="focus";current.phase_started_at=transitionAt;current.phase_ends_at=new Date(transitionAt.getTime()+Number(current.focus_minutes)*60_000);
    }
    current.paused_phase=null;current.paused_remaining_seconds=0;changed=true;
  }
  if(guard>=100&&current.phase_ends_at&&new Date(current.phase_ends_at)<=now){current.phase_started_at=now;current.phase_ends_at=new Date(now.getTime()+(current.phase==="focus"?Number(current.focus_minutes):Number(current.break_minutes))*60_000);changed=true;}
  return {room:current,changed};
}

async function studyRoomSnapshot(roomCode,userId,{join=false,action=null}={}) {
  return withTransaction(async tx=>{
    const found=await tx.query("SELECT * FROM study_rooms WHERE room_code=$1 FOR UPDATE",[roomCode]);
    let room=found.rows[0];if(!room)return null;
    if(join)await tx.query("INSERT INTO study_room_members(room_id,user_id,role) VALUES($1,$2,CASE WHEN $3 THEN 'owner' ELSE 'member' END) ON CONFLICT(room_id,user_id) DO UPDATE SET last_seen_at=NOW()",[room.id,userId,room.owner_user_id===userId]);
    else await tx.query("UPDATE study_room_members SET last_seen_at=NOW() WHERE room_id=$1 AND user_id=$2",[room.id,userId]);
    const membership=await tx.query("SELECT role FROM study_room_members WHERE room_id=$1 AND user_id=$2",[room.id,userId]);
    if(!membership.rows[0])return null;
    let {room:advanced,changed}=advanceRoom(room);
    if(changed){
      room=advanced;
      await tx.query("UPDATE study_rooms SET phase=$1,paused_phase=$2,completed_focuses=$3,paused_remaining_seconds=$4,phase_started_at=$5,phase_ends_at=$6,updated_at=NOW() WHERE id=$7",[room.phase,room.paused_phase,room.completed_focuses,room.paused_remaining_seconds,room.phase_started_at,room.phase_ends_at,room.id]);
    }
    let timerError=null;
    if(action){
      const now=new Date();
      if(action==="start"){
        if(room.phase!=="idle")timerError="Only a ready room can start a focus session.";
        else {room.phase="focus";room.phase_started_at=now;room.phase_ends_at=new Date(now.getTime()+Number(room.focus_minutes)*60_000);}
      }else if(action==="pause"){
        if(!["focus","short_break","long_break"].includes(room.phase))timerError="The running timer cannot be paused right now.";
        else {room.paused_phase=room.phase;room.paused_remaining_seconds=Math.max(0,Math.ceil((new Date(room.phase_ends_at)-now)/1000));room.phase="paused";room.phase_ends_at=null;}
      }else if(action==="resume"){
        if(room.phase!=="paused")timerError="The room timer is not paused.";
        else {room.phase=room.paused_phase||"focus";room.paused_phase=null;room.phase_started_at=now;room.phase_ends_at=new Date(now.getTime()+Number(room.paused_remaining_seconds)*1000);}
      }else if(action==="reset"){
        room.phase="idle";room.paused_phase=null;room.completed_focuses=0;room.paused_remaining_seconds=0;room.phase_started_at=null;room.phase_ends_at=null;
      }else if(action==="skip"){
        if(room.phase==="focus"){
          room.completed_focuses=Number(room.completed_focuses)+1;room.phase=room.completed_focuses%Number(room.long_break_every)===0?"long_break":"short_break";
          const minutes=room.phase==="long_break"?Number(room.long_break_minutes):Number(room.break_minutes);room.paused_phase=null;room.paused_remaining_seconds=0;room.phase_started_at=now;room.phase_ends_at=new Date(now.getTime()+minutes*60_000);
        }else if(["short_break","long_break"].includes(room.phase)){room.phase="focus";room.paused_phase=null;room.paused_remaining_seconds=0;room.phase_started_at=now;room.phase_ends_at=new Date(now.getTime()+Number(room.focus_minutes)*60_000);}
        else timerError="Start a focus session before skipping a phase.";
      }
      if(!timerError)await tx.query("UPDATE study_rooms SET phase=$1,paused_phase=$2,completed_focuses=$3,paused_remaining_seconds=$4,phase_started_at=$5,phase_ends_at=$6,updated_at=NOW() WHERE id=$7",[room.phase,room.paused_phase,room.completed_focuses,room.paused_remaining_seconds,room.phase_started_at,room.phase_ends_at,room.id]);
    }
    const members=await tx.query(`SELECT m.user_id,m.role,u.full_name,m.last_seen_at,m.last_seen_at>NOW()-INTERVAL '30 seconds' AS is_online
      FROM study_room_members m JOIN users u ON u.id=m.user_id WHERE m.room_id=$1 ORDER BY m.joined_at`,[room.id]);
    return {room:roomDto(room,members.rows.map(m=>({id:m.user_id,name:m.full_name,role:m.role,isOnline:m.is_online}))),timerError};
  });
}

async function route(req,res) {
  const url=new URL(req.url,"http://localhost");
  const rawParts=url.pathname.split("/").filter(Boolean);
  let parts=rawParts[0]==="api"?rawParts.slice(1):rawParts;
  if(parts[0]==="handler"||parts[0]==="handler.js") parts=parts.slice(1);
  if(parts.length===0&&url.searchParams.has("path")) {
    parts=String(url.searchParams.get("path")).split("/").filter(Boolean);
  }
  const methodName=req.method;
  if(parts.length===0||parts[0]==="health") return sendJson(res,200,{ok:true,service:"learnos-api",runtime:"nodejs"});
  if(parts[0]==="auth") return authRoutes(req,res,parts);
  const user=await owned(req,res); if(!user)return;
  if(parts[0]==="home"&&methodName==="GET") return sendJson(res,200,await getHome(user));

  if(parts[0]==="study-rooms"){
    if(parts.length===1&&methodName==="GET"){
      const result=await query(`SELECT r.*,COALESCE(json_agg(json_build_object('id',m.user_id,'name',u.full_name,'role',m.role,'isOnline',m.last_seen_at>NOW()-INTERVAL '30 seconds') ORDER BY m.joined_at) FILTER(WHERE m.user_id IS NOT NULL),'[]') AS participants
        FROM study_rooms r JOIN study_room_members mine ON mine.room_id=r.id AND mine.user_id=$1
        LEFT JOIN study_room_members m ON m.room_id=r.id LEFT JOIN users u ON u.id=m.user_id
        GROUP BY r.id ORDER BY r.updated_at DESC LIMIT 40`,[user.id]);
      return sendJson(res,200,{rooms:result.rows.map(row=>roomDto(row,row.participants))});
    }
    if(parts.length===1&&methodName==="POST"){
      const b=await bodyOf(req),title=String(b.title||"").trim().slice(0,80),topic=String(b.topic||"").trim().slice(0,120),focus=Number(b.focusMinutes??25),pause=Number(b.breakMinutes??5),longPause=Number(b.longBreakMinutes??15),every=Number(b.longBreakEvery??4);
      if(title.length<2)return sendError(res,400,"ROOM_TITLE_REQUIRED","Give your room a name with at least two characters.");
      if(!Number.isInteger(focus)||focus<5||focus>90||!Number.isInteger(pause)||pause<3||pause>30||!Number.isInteger(longPause)||longPause<5||longPause>60||!Number.isInteger(every)||every<2||every>8)return sendError(res,400,"INVALID_POMODORO","Choose valid focus, break, and long break durations.");
      const roomCode=Array.from(crypto.randomBytes(8),byte=>"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[byte%32]).join("");
      const created=await withTransaction(async tx=>{
        const inserted=await tx.query(`INSERT INTO study_rooms(room_code,owner_user_id,title,topic,focus_minutes,break_minutes,long_break_minutes,long_break_every)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[roomCode,user.id,title,topic,focus,pause,longPause,every]);
        await tx.query("INSERT INTO study_room_members(room_id,user_id,role) VALUES($1,$2,'owner')",[inserted.rows[0].id,user.id]);
        return inserted.rows[0];
      });
      return sendJson(res,201,{room:roomDto(created,[{id:user.id,name:user.full_name,role:"owner",isOnline:true}])});
    }
    if(parts.length===2&&roomCodePattern.test(parts[1])){
      const code=parts[1].toUpperCase();
      if(methodName==="GET"){
        const result=await studyRoomSnapshot(code,user.id);
        if(!result)return notFound(res,"Study room");return sendJson(res,200,{room:result.room});
      }
      if(methodName==="POST"){
        const result=await studyRoomSnapshot(code,user.id,{join:true});
        if(!result)return notFound(res,"Study room");return sendJson(res,200,{room:result.room});
      }
    }
    if(parts.length===3&&roomCodePattern.test(parts[1])&&parts[2]==="join"&&methodName==="POST"){
      const result=await studyRoomSnapshot(parts[1].toUpperCase(),user.id,{join:true});
      if(!result)return notFound(res,"Study room");return sendJson(res,200,{room:result.room});
    }
    if(parts.length===3&&roomCodePattern.test(parts[1])&&parts[2]==="timer"&&methodName==="POST"){
      const action=String((await bodyOf(req)).action||"");if(!["start","pause","resume","reset","skip"].includes(action))return sendError(res,400,"INVALID_TIMER_ACTION","Choose a valid shared timer action.");
      const result=await studyRoomSnapshot(parts[1].toUpperCase(),user.id,{action});
      if(!result)return notFound(res,"Study room");if(result.timerError)return sendError(res,409,"TIMER_STATE_CONFLICT",result.timerError);
      return sendJson(res,200,{room:result.room});
    }
    return methodName==="GET"||methodName==="POST"?notFound(res,"Study room"):methodNotAllowed(res,["GET","POST"]);
  }

  if(parts[0]==="goals") {
    if(parts.length===1&&methodName==="GET") { const r=await query("SELECT * FROM learning_goals WHERE user_id=$1 ORDER BY created_at DESC",[user.id]); return sendJson(res,200,{goals:r.rows}); }
    if(parts.length===1&&methodName==="POST") {
      const b=await bodyOf(req),topic=String(b.topic||"").trim().slice(0,120),outcome=String(b.desiredOutcome||"").trim().slice(0,1000),level=String(b.currentLevel||"Beginner").trim().slice(0,80);
      const weekly=Number(b.weeklyMinutes||user.weekly_minutes),weeks=b.targetWeeks?Number(b.targetWeeks):null;
      if(topic.length<2||outcome.length<8)return sendError(res,400,"INVALID_GOAL","Add a topic and describe the outcome you want to reach.");
      if(!Number.isInteger(weekly)||weekly<30||weekly>2400)return sendError(res,400,"INVALID_SCHEDULE","Weekly study time must be between 30 and 2400 minutes.");
      if(weeks!==null&&(!Number.isInteger(weeks)||weeks<1||weeks>104))return sendError(res,400,"INVALID_DURATION","Choose a duration between 1 and 104 weeks.");
      const r=await query(`INSERT INTO learning_goals(user_id,topic,desired_outcome,current_level,purpose,target_date,target_weeks,weekly_minutes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[user.id,topic,outcome,level,String(b.purpose||"").slice(0,400),b.targetDate||null,weeks,weekly]);
      return sendJson(res,201,{goal:r.rows[0]});
    }
    if(parts.length===3&&parts[2]==="proposal"&&methodName==="POST") { if(!idPattern.test(parts[1]))return notFound(res,"Goal"); return handleProposalStreamOrJson(req,res,(onProgress)=>generateCourseProposal(user.id,parts[1],onProgress?{onProgress}:undefined),{status:201,resourceType:"Goal"}); }
    if(parts.length===3&&parts[2]==="approve"&&methodName==="POST") { const b=await bodyOf(req); if(!idPattern.test(parts[1]))return notFound(res,"Course"); const result=await approveCourse(user.id,parts[1],Boolean(b.acceptOverload),user); if(!result)return notFound(res,"Course"); if(result.requiresOverride)return sendJson(res,409,{error:{code:"PLAN_OVER_BUDGET",message:"This plan exceeds the weekly study budget.",details:result}}); return sendJson(res,200,result); }
  }

  if(parts[0]==="courses") {
    if(parts.length===1&&methodName==="GET") { const r=await query(`SELECT c.*,g.topic,g.current_level,g.weekly_minutes,g.target_weeks,
      (SELECT COUNT(*)::int FROM course_modules m WHERE m.course_id=c.id) module_count,
      (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id=c.id) lesson_count,
      (SELECT COUNT(*)::int FROM study_tasks t WHERE t.course_id=c.id AND t.status='completed') completed_tasks
      FROM courses c JOIN learning_goals g ON g.id=c.goal_id WHERE c.user_id=$1 ORDER BY c.created_at DESC`,[user.id]); return sendJson(res,200,{courses:r.rows}); }
    if(parts.length===3&&parts[2]==="materials-status"&&methodName==="GET") {
      if(!idPattern.test(parts[1]))return notFound(res,"Course");
      const course=await query("SELECT id FROM courses WHERE id=$1 AND user_id=$2",[parts[1],user.id]);
      if(!course.rows[0])return notFound(res,"Course");
      const statusInfo=await getCourseMaterialsStatus(user.id,parts[1],{queryFn:query});
      return sendJson(res,200,statusInfo);
    }
    if(parts.length===3&&parts[2]==="approve"&&methodName==="POST") { const b=await bodyOf(req); if(!idPattern.test(parts[1]))return notFound(res,"Course"); const result=await approveCourse(user.id,parts[1],Boolean(b.acceptOverload),user); if(!result)return notFound(res,"Course"); if(result.requiresOverride)return sendJson(res,409,{error:{code:"PLAN_OVER_BUDGET",message:"This plan exceeds the weekly study budget.",details:result}}); return sendJson(res,200,result); }
    if(parts.length===3&&parts[2]==="improve"&&methodName==="POST") { if(!idPattern.test(parts[1]))return notFound(res,"Course"); const feedback=String((await bodyOf(req)).feedback||"").trim().slice(0,1200); if(feedback.length<8)return sendError(res,400,"IMPROVEMENT_FEEDBACK_REQUIRED","Describe what you want to improve in at least eight characters."); return handleProposalStreamOrJson(req,res,(onProgress)=>improveCourseProposal(user.id,parts[1],feedback,onProgress?{onProgress}:undefined),{status:200,resourceType:"Course proposal"}); }
    if(parts.length===2&&methodName==="GET") {
      if(!idPattern.test(parts[1]))return notFound(res,"Course");
      const r=await query(`SELECT c.*,g.topic,g.desired_outcome,g.current_level,g.weekly_minutes,g.target_weeks FROM courses c JOIN learning_goals g ON g.id=c.goal_id WHERE c.id=$1 AND c.user_id=$2`,[parts[1],user.id]);
      if(!r.rows[0])return notFound(res,"Course");
      const modules=await query(`SELECT m.*,COALESCE(json_agg(json_build_object('id',l.id,'title',l.title,'objective',l.objective,'estimated_minutes',l.estimated_minutes,'reading_only',l.reading_only,'prerequisites',l.prerequisites,'checkpoint',l.checkpoint,'content_markdown',l.content_markdown,'worked_example',l.worked_example,'sourceRefs',l.source_refs) ORDER BY l.position) FILTER(WHERE l.id IS NOT NULL),'[]') lessons FROM course_modules m LEFT JOIN lessons l ON l.module_id=m.id WHERE m.course_id=$1 GROUP BY m.id ORDER BY m.position`,[parts[1]]);
      const materialsStatus=await getCourseMaterialsStatus(user.id,parts[1],{queryFn:query});
      return sendJson(res,200,{course:{...r.rows[0],materials_status:materialsStatus.status,materialsStatus:materialsStatus.status},modules:modules.rows,materialsStatus:materialsStatus.status});
    }
    if(parts.length===2&&methodName==="PUT") {
      if(!idPattern.test(parts[1]))return notFound(res,"Course");
      const b=await bodyOf(req),title=String(b.title||"").trim().slice(0,120),summary=String(b.summary||"").trim().slice(0,1000);
      if(!title||!summary)return sendError(res,400,"INVALID_COURSE","Course title and outcome are required.");
      const status=["proposal","active","paused","completed","archived"].includes(b.status)?b.status:null;
      const course = await withTransaction(async (client) => {
        const r = await client.query(`UPDATE courses SET title=$1,summary=$2,status=COALESCE($3,status),updated_at=NOW() WHERE id=$4 AND user_id=$5 RETURNING *`,[title,summary,status,parts[1],user.id]);
        if(!r.rows[0]) return null;
        if(status) await client.query("UPDATE learning_goals SET status=$1,updated_at=NOW() WHERE id=$2 AND user_id=$3",[status==="proposal"?"draft":status,r.rows[0].goal_id,user.id]);
        return r.rows[0];
      });
      if(!course)return notFound(res,"Course");
      return sendJson(res,200,{course});
    }
    if(parts.length===2&&methodName==="DELETE") {
      if(!idPattern.test(parts[1]))return notFound(res,"Course");
      const deleted=await withTransaction(async(client)=>{
        const r=await client.query("DELETE FROM courses WHERE id=$1 AND user_id=$2 RETURNING id,goal_id,title",[parts[1],user.id]);
        if(!r.rows[0])return null;
        await client.query("DELETE FROM rag_chunks WHERE user_id=$1 AND source_type=$2 AND course_id=$3",[user.id,"lesson",parts[1]]);
        return r.rows[0];
      });
      if(!deleted)return notFound(res,"Course");
      return sendJson(res,200,{deleted:true,id:parts[1]});
    }
  }

  if(parts[0]==="modules"&&parts.length===2&&methodName==="PUT") { if(!idPattern.test(parts[1]))return notFound(res,"Module"); const b=await bodyOf(req),r=await query(`UPDATE course_modules m SET title=$1,objective=$2 FROM courses c WHERE m.id=$3 AND m.course_id=c.id AND c.user_id=$4 RETURNING m.*`,[String(b.title||"").trim().slice(0,120),String(b.objective||"").trim().slice(0,600),parts[1],user.id]); if(!r.rows[0])return notFound(res,"Module"); return sendJson(res,200,{module:r.rows[0]}); }

  if(parts[0]==="lessons"&&parts.length===2&&methodName==="GET") { const r=await query(`SELECT l.*,c.title AS course_title,m.title AS module_title FROM lessons l JOIN courses c ON c.id=l.course_id JOIN course_modules m ON m.id=l.module_id WHERE l.id=$1 AND c.user_id=$2`,[parts[1],user.id]); if(!r.rows[0])return notFound(res,"Lesson"); return sendJson(res,200,{lesson:r.rows[0]}); }

  if(parts[0]==="tasks") {
    if(parts.length===1&&methodName==="GET") {
      const from=url.searchParams.get("from"),to=url.searchParams.get("to");
      if(from!==null&&Number.isNaN(Date.parse(from))) return sendError(res,400,"INVALID_DATE","Choose a valid date and time.");
      if(to!==null&&Number.isNaN(Date.parse(to))) return sendError(res,400,"INVALID_DATE","Choose a valid date and time.");
      await query("UPDATE study_tasks SET status='overdue' WHERE user_id=$1 AND status IN ('upcoming','due','rescheduled') AND scheduled_at<NOW()-INTERVAL '1 day'",[user.id]);
      const r=await query(`SELECT t.*,l.objective,c.title AS course_title FROM study_tasks t LEFT JOIN lessons l ON l.id=t.lesson_id JOIN courses c ON c.id=t.course_id WHERE t.user_id=$1 AND ($2::timestamptz IS NULL OR t.scheduled_at >= $2) AND ($3::timestamptz IS NULL OR t.scheduled_at < $3) ORDER BY t.scheduled_at NULLS LAST LIMIT 200`,[user.id,from,to]);
      return sendJson(res,200,{tasks:r.rows});
    }
    if(parts.length===2&&["start","complete","reschedule"].includes(parts[1])&&methodName==="POST") return sendError(res,400,"TASK_ID_REQUIRED","Provide a task ID.");
    if(parts.length===3&&["start","complete","reschedule"].includes(parts[2])&&methodName==="POST") {
      const [taskId,action]=[parts[1],parts[2]],b=await bodyOf(req); if(!idPattern.test(taskId))return notFound(res,"Task");
      const ownedTask=await query("SELECT * FROM study_tasks WHERE id=$1 AND user_id=$2",[taskId,user.id]); if(!ownedTask.rows[0])return notFound(res,"Task");
      if(action==="start") { const r=await query("UPDATE study_tasks SET status='in_progress',started_at=COALESCE(started_at,NOW()) WHERE id=$1 RETURNING *",[taskId]); return sendJson(res,200,{task:r.rows[0]}); }
      if(action==="reschedule") { if(!b.scheduledAt||Number.isNaN(Date.parse(b.scheduledAt)))return sendError(res,400,"INVALID_DATE","Choose a valid date and time."); const r=await query("UPDATE study_tasks SET scheduled_at=$1,status='rescheduled' WHERE id=$2 RETURNING *",[new Date(b.scheduledAt).toISOString(),taskId]); return sendJson(res,200,{task:r.rows[0]}); }
      if(ownedTask.rows[0].lesson_id) { const evidence=await query("SELECT id FROM practice_attempts WHERE user_id=$1 AND lesson_id=$2 AND score>=70 ORDER BY created_at DESC LIMIT 1",[user.id,ownedTask.rows[0].lesson_id]); if(!evidence.rows[0])return sendError(res,409,"EVIDENCE_REQUIRED","Pass the lesson checkpoint before completing this task."); }
      const r=await query("UPDATE study_tasks SET status='completed',completed_at=NOW(),actual_minutes=$1 WHERE id=$2 RETURNING *",[Math.max(1,Math.min(720,Number(b.actualMinutes)||ownedTask.rows[0].estimated_minutes)),taskId]); return sendJson(res,200,{task:r.rows[0]});
    }
  }

  if(parts[0]==="notes") {
    if(parts.length===1&&methodName==="GET") { const r=await query(`SELECT n.*,c.title course_title,l.title lesson_title FROM notes n LEFT JOIN courses c ON c.id=n.course_id LEFT JOIN lessons l ON l.id=n.lesson_id WHERE n.user_id=$1 ORDER BY n.updated_at DESC`,[user.id]); return sendJson(res,200,{notes:r.rows}); }
    if(parts.length===1&&methodName==="POST") {
      const b=await bodyOf(req);
      const title=String(b.title||"").trim().slice(0,160),body=String(b.body||"").slice(0,30000);
      if(!title)return sendError(res,400,"TITLE_REQUIRED","Give your note a title.");
      let courseId=b.courseId||null;
      if(courseId){
        const ownedCourse=await query("SELECT id FROM courses WHERE id=$1 AND user_id=$2",[courseId,user.id]);
        if(!ownedCourse.rows[0])return notFound(res,"Course");
      }
      if(b.lessonId){
        const ownedLesson=await query("SELECT l.id,l.course_id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2",[b.lessonId,user.id]);
        if(!ownedLesson.rows[0])return notFound(res,"Lesson");
        if(courseId&&courseId!==ownedLesson.rows[0].course_id)return sendError(res,400,"COURSE_LESSON_MISMATCH","The selected lesson is not part of that course.");
        courseId=ownedLesson.rows[0].course_id;
      }
      const origin=b.origin==="ai_draft"?"ai_draft":b.origin==="imported_source"?"imported_source":"learner";
      let r;
      // If saving an ai_draft note for a lesson, ensure only 1 AI draft note exists for that lesson (idempotent upsert)
      if(origin==="ai_draft"&&b.lessonId){
        const existing=await query("SELECT id FROM notes WHERE user_id=$1 AND lesson_id=$2 AND origin='ai_draft' LIMIT 1",[user.id,b.lessonId]);
        if(existing.rows[0]){
          r=await query(`UPDATE notes SET title=$1,body=$2,source_ref=$3,course_id=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 RETURNING *`,[title,body,String(b.sourceRef||"").slice(0,240),courseId,existing.rows[0].id,user.id]);
        }
      }
      if(!r){
        r=await query(`INSERT INTO notes(user_id,course_id,lesson_id,title,body,source_ref,origin) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[user.id,courseId,b.lessonId||null,title,body,String(b.sourceRef||"").slice(0,240),origin]);
      }
      if(r.rows[0]){
        const note=r.rows[0];
        await safeRagSync(()=>indexUserSource(user.id,{sourceType:"note",sourceId:note.id,courseId:note.course_id,lessonId:note.lesson_id,title:note.title,body:note.body},{queryFn:query}));
      }
      return sendJson(res,201,{note:r.rows[0]});
    }
    if(parts.length===2) {
      if(!idPattern.test(parts[1])) return notFound(res,"Note");
      if(methodName==="GET") { const r=await query(`SELECT n.*,c.title course_title,l.title lesson_title FROM notes n LEFT JOIN courses c ON c.id=n.course_id LEFT JOIN lessons l ON l.id=n.lesson_id WHERE n.id=$1 AND n.user_id=$2`,[parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); return sendJson(res,200,{note:r.rows[0]}); }
      if(methodName==="PUT") { const b=await bodyOf(req),r=await query(`UPDATE notes SET title=$1,body=$2,updated_at=NOW() WHERE id=$3 AND user_id=$4 RETURNING *`,[String(b.title||"").trim().slice(0,160),String(b.body||"").slice(0,30000),parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); const note=r.rows[0]; await safeRagSync(()=>indexUserSource(user.id,{sourceType:"note",sourceId:note.id,courseId:note.course_id,lessonId:note.lesson_id,title:note.title,body:note.body},{queryFn:query})); return sendJson(res,200,{note:r.rows[0]}); }
      if(methodName==="DELETE") { const r=await query("DELETE FROM notes WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]); if(!r.rows[0])return notFound(res,"Note"); await safeRagSync(()=>deleteUserSourceChunks(user.id,"note",parts[1],{queryFn:query})); return sendJson(res,200,{deleted:true}); }
    }
  }

  if(parts[0]==="flashcards") {
    const VALID_CARD_TYPES = new Set(["qa", "cloze", "formula", "application"]);
    const ensureCardColumns = async (runner = query) => {
      await runner("ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS hint TEXT NOT NULL DEFAULT ''");
      await runner("ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS card_type TEXT NOT NULL DEFAULT 'qa'");
      await runner("ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'learner'");
      await runner("ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'new'");
      await runner("ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS lapses INTEGER NOT NULL DEFAULT 0");
      await runner("ALTER TABLE flashcards ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ");
      await runner("ALTER TABLE review_events ADD COLUMN IF NOT EXISTS interval_before INTEGER");
      await runner("ALTER TABLE review_events ADD COLUMN IF NOT EXISTS interval_after INTEGER");
      await runner("ALTER TABLE review_events ADD COLUMN IF NOT EXISTS ease_after NUMERIC(4,2)");
    };
    const validateCardRefs = async (courseIdIn, lessonIdIn) => {
      let resolvedCourseId = courseIdIn || null;
      const resolvedLessonId = lessonIdIn || null;
      if (resolvedCourseId) {
        const ownedCourse = await query("SELECT id FROM courses WHERE id=$1 AND user_id=$2", [resolvedCourseId, user.id]);
        if (!ownedCourse.rows[0]) return { error: () => notFound(res, "Course") };
      }
      if (resolvedLessonId) {
        const ownedLesson = await query("SELECT l.id,l.course_id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2", [resolvedLessonId, user.id]);
        if (!ownedLesson.rows[0]) return { error: () => notFound(res, "Lesson") };
        if (resolvedCourseId && resolvedCourseId !== ownedLesson.rows[0].course_id) {
          return { error: () => sendError(res, 400, "COURSE_LESSON_MISMATCH", "The selected lesson is not part of that course.") };
        }
        resolvedCourseId = ownedLesson.rows[0].course_id;
      }
      return { courseId: resolvedCourseId, lessonId: resolvedLessonId };
    };

    if(parts.length===1&&methodName==="GET") {
      const r=await query(`SELECT f.*,l.title lesson_title FROM flashcards f LEFT JOIN lessons l ON l.id=f.lesson_id WHERE f.user_id=$1 ORDER BY f.due_at,f.created_at`,[user.id]);
      return sendJson(res,200,{flashcards:r.rows});
    }

    if(parts.length===1&&methodName==="POST") {
      const b=await bodyOf(req),front=String(b.front||"").trim().slice(0,2000),back=String(b.back||"").trim().slice(0,4000);
      if(!front||!back)return sendError(res,400,"CARD_REQUIRED","Add both a question and an answer.");
      const hint=String(b.hint||"").trim().slice(0,1000);
      const rawType=String(b.cardType||b.card_type||"qa").trim().toLowerCase();
      const cardType=VALID_CARD_TYPES.has(rawType)?rawType:"qa";
      const origin=b.origin==="ai_generated"?"ai_generated":"learner";
      const refs=await validateCardRefs(b.courseId||b.course_id,b.lessonId||b.lesson_id);
      if(refs.error)return refs.error();
      let r;
      try{
        r=await query("INSERT INTO flashcards(user_id,course_id,lesson_id,front,back,hint,card_type,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[user.id,refs.courseId,refs.lessonId,front,back,hint,cardType,origin]);
      }catch(err){
        if(err?.code==="42703"){await ensureCardColumns();r=await query("INSERT INTO flashcards(user_id,course_id,lesson_id,front,back,hint,card_type,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[user.id,refs.courseId,refs.lessonId,front,back,hint,cardType,origin]);}
        else throw err;
      }
      if(r.rows[0]){
        const card=r.rows[0];
        await safeRagSync(()=>indexUserSource(user.id,{sourceType:"flashcard",sourceId:card.id,courseId:card.course_id,lessonId:card.lesson_id,title:card.front,body:`Question: ${card.front}\nAnswer: ${card.back}`},{queryFn:query}));
      }
      return sendJson(res,201,{flashcard:r.rows[0]});
    }

    if(parts.length===2&&parts[1]==="generate"&&methodName==="POST") {
      const b=await bodyOf(req);
      const topic=String(b.topic||"").trim().slice(0,300);
      const sourceText=String(b.sourceText||"").trim().slice(0,3500);
      const noteId=b.noteId?String(b.noteId).trim():"";
      const courseIdIn=b.courseId?String(b.courseId).trim():"";
      const lessonIdIn=b.lessonId?String(b.lessonId).trim():"";
      if(!topic&&!sourceText&&!noteId&&!lessonIdIn&&!courseIdIn){
        return sendError(res,400,"FLASHCARD_CONTEXT_REQUIRED","Enter a topic, paste study text, or select a note or lesson.");
      }
      const refs=await validateCardRefs(courseIdIn||null,lessonIdIn||null);
      if(refs.error)return refs.error();

      let note=null;
      if(noteId){
        if(!idPattern.test(noteId))return notFound(res,"Note");
        const nr=await query("SELECT id,title,body,course_id,lesson_id FROM notes WHERE id=$1 AND user_id=$2",[noteId,user.id]);
        if(!nr.rows[0])return notFound(res,"Note");
        note=nr.rows[0];
      }

      let lesson=null,courseTitle="";
      if(refs.lessonId){
        const lr=await query("SELECT l.id,l.title,l.objective,l.content_markdown,l.worked_example,c.title course_title FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2",[refs.lessonId,user.id]);
        lesson=lr.rows[0]||null;
        courseTitle=lesson?.course_title||"";
      }else if(refs.courseId){
        const cr=await query("SELECT title FROM courses WHERE id=$1 AND user_id=$2",[refs.courseId,user.id]);
        courseTitle=cr.rows[0]?.title||"";
      }

      const existingRes=await query("SELECT front FROM flashcards WHERE user_id=$1",[user.id]);
      const existingFronts=(existingRes.rows||[]).map(r=>r.front).filter(Boolean);

      let memory=[];
      try{
        const retrieved=await retrieveLearnerContext(user.id,topic||lesson?.title||note?.title||courseTitle||"flashcards",{limit:5});
        memory=retrieved.sources||[];
      }catch{}

      const generated=await generateFlashcards({
        topic,
        sourceText,
        note,
        lesson,
        courseTitle,
        existingFronts,
        count:b.count,
        includeMath:b.includeMath!==false,
        cardStyle:b.cardStyle||"mixed",
        focusHint:b.focusHint||"",
        memory,
      });

      if(b.save===true){
        const savedCards=[];
        for(const item of generated.flashcards){
          let ins;
          try{
            ins=await query("INSERT INTO flashcards(user_id,course_id,lesson_id,front,back,hint,card_type,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[user.id,refs.courseId,refs.lessonId,item.front,item.back,item.hint||"",item.cardType||"qa","ai_generated"]);
          }catch(err){
            if(err?.code==="42703"){await ensureCardColumns();ins=await query("INSERT INTO flashcards(user_id,course_id,lesson_id,front,back,hint,card_type,origin) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[user.id,refs.courseId,refs.lessonId,item.front,item.back,item.hint||"",item.cardType||"qa","ai_generated"]);}
            else throw err;
          }
          if(ins.rows[0]){
            const card=ins.rows[0];
            savedCards.push(card);
            await safeRagSync(()=>indexUserSource(user.id,{sourceType:"flashcard",sourceId:card.id,courseId:card.course_id,lessonId:card.lesson_id,title:card.front,body:`Question: ${card.front}\nAnswer: ${card.back}`},{queryFn:query}));
          }
        }
        return sendJson(res,201,{flashcards:savedCards,saved:true,model:generated.model,source:generated.source,failoverCount:generated.failoverCount});
      }

      return sendJson(res,200,{flashcards:generated.flashcards,saved:false,courseId:refs.courseId,lessonId:refs.lessonId,model:generated.model,source:generated.source,failoverCount:generated.failoverCount});
    }

    if(parts.length===2&&methodName==="PUT") {
      if(!idPattern.test(parts[1]))return notFound(res,"Flashcard");
      const b=await bodyOf(req),front=String(b.front||"").trim().slice(0,2000),back=String(b.back||"").trim().slice(0,4000);
      if(!front||!back)return sendError(res,400,"CARD_REQUIRED","Add both a question and an answer.");
      const hint=String(b.hint||"").trim().slice(0,1000);
      const rawType=String(b.cardType||b.card_type||"qa").trim().toLowerCase();
      const cardType=VALID_CARD_TYPES.has(rawType)?rawType:"qa";
      const refs=await validateCardRefs(b.courseId??b.course_id??null,b.lessonId??b.lesson_id??null);
      if(refs.error)return refs.error();
      let updated;
      try{
        updated=await query("UPDATE flashcards SET front=$1,back=$2,hint=$3,card_type=$4,course_id=$5,lesson_id=$6 WHERE id=$7 AND user_id=$8 RETURNING *",[front,back,hint,cardType,refs.courseId,refs.lessonId,parts[1],user.id]);
      }catch(err){
        if(err?.code==="42703"){await ensureCardColumns();updated=await query("UPDATE flashcards SET front=$1,back=$2,hint=$3,card_type=$4,course_id=$5,lesson_id=$6 WHERE id=$7 AND user_id=$8 RETURNING *",[front,back,hint,cardType,refs.courseId,refs.lessonId,parts[1],user.id]);}
        else throw err;
      }
      if(!updated.rows[0])return notFound(res,"Flashcard");
      const card=updated.rows[0];
      await safeRagSync(()=>indexUserSource(user.id,{sourceType:"flashcard",sourceId:card.id,courseId:card.course_id,lessonId:card.lesson_id,title:card.front,body:`Question: ${card.front}\nAnswer: ${card.back}`},{queryFn:query}));
      return sendJson(res,200,{flashcard:card});
    }

    if(parts.length===3&&parts[2]==="review"&&methodName==="POST") {
      if(!idPattern.test(parts[1])) return notFound(res,"Flashcard");
      const b=await bodyOf(req),rating=String(b.rating||"");
      if(!["Again","Hard","Good","Easy"].includes(rating))return sendError(res,400,"INVALID_RATING","Choose Again, Hard, Good, or Easy.");
      const out=await withTransaction(async(client)=>{
        const found=await client.query("SELECT * FROM flashcards WHERE id=$1 AND user_id=$2 FOR UPDATE",[parts[1],user.id]);
        if(!found.rows[0])return null;
        const card=found.rows[0];
        const next=scheduleFlashcardReview(card,rating);
        const due=new Date(next.due_at);
        try{
          await client.query("INSERT INTO review_events(user_id,flashcard_id,rating,next_due_at,interval_before,interval_after,ease_after) VALUES($1,$2,$3,$4,$5,$6,$7)",[user.id,card.id,rating,due,Number(card.interval_days)||0,next.interval_days,next.ease]);
        }catch(err){
          if(err?.code==="42703"){
            await ensureCardColumns(client.query.bind(client));
            await client.query("INSERT INTO review_events(user_id,flashcard_id,rating,next_due_at,interval_before,interval_after,ease_after) VALUES($1,$2,$3,$4,$5,$6,$7)",[user.id,card.id,rating,due,Number(card.interval_days)||0,next.interval_days,next.ease]);
          }else{throw err;}
        }
        let updated;
        try{
          updated=await client.query("UPDATE flashcards SET due_at=$1,interval_days=$2,repetitions=repetitions+1,ease=$3,state=$5,lapses=$6,last_reviewed_at=NOW() WHERE id=$4 RETURNING *",[due,next.interval_days,next.ease,card.id,next.state,next.lapses]);
        }catch(err){
          if(err?.code==="42703"){
            await ensureCardColumns(client.query.bind(client));
            updated=await client.query("UPDATE flashcards SET due_at=$1,interval_days=$2,repetitions=repetitions+1,ease=$3,state=$5,lapses=$6,last_reviewed_at=NOW() WHERE id=$4 RETURNING *",[due,next.interval_days,next.ease,card.id,next.state,next.lapses]);
          }else{throw err;}
        }
        return updated.rows[0];
      });
      if(!out)return notFound(res,"Flashcard");
      return sendJson(res,200,{flashcard:out});
    }

    if(parts.length===2&&methodName==="DELETE") {
      if(!idPattern.test(parts[1])) return notFound(res,"Flashcard");
      const r=await query("DELETE FROM flashcards WHERE id=$1 AND user_id=$2 RETURNING id",[parts[1],user.id]);
      if(!r.rows[0])return notFound(res,"Flashcard");
      await safeRagSync(()=>deleteUserSourceChunks(user.id,"flashcard",parts[1],{queryFn:query}));
      return sendJson(res,200,{deleted:true});
    }
  }

  const VALID_PRACTICE_MODES = ["fill_blank", "quiz", "order", "word_scramble", "mixed"];
  const STUDIO_EXERCISE_TYPES = ["fill_blank", "quiz", "order", "word_scramble"];

  if (parts[0] === "practice" && parts[1] === "generate" && parts.length === 2 && methodName === "POST") {
    const b = await bodyOf(req);
    const lessonId = String(b.lessonId || "").trim();
    const mode = String(b.mode || "mixed").trim();
    if (!idPattern.test(lessonId)) return notFound(res, "Lesson");
    if (!VALID_PRACTICE_MODES.includes(mode)) {
      return sendError(res, 400, "INVALID_PRACTICE_MODE", "Choose fill_blank, quiz, order, word_scramble, or mixed.");
    }
    const r = await query(
      `SELECT l.*, c.title AS course_title FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2`,
      [lessonId, user.id]
    );
    const lesson = r.rows[0];
    if (!lesson) return notFound(res, "Lesson");

    const excludeQuestions = Array.isArray(b.excludeQuestions)
      ? b.excludeQuestions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 20)
      : [];

    let memory = [];
    try {
      const queryText = [lesson.title, lesson.objective, lesson.course_title].filter(Boolean).join(" ");
      memory = await retrieveLearnerContext(user.id, queryText, {
        limit: 5,
        lessonId: lesson.id,
        courseId: lesson.course_id,
        queryFn: query,
      });
    } catch {
      memory = [];
    }

    const result = await generatePracticeExercises({
      lesson,
      courseTitle: lesson.course_title || "",
      mode,
      excludeQuestions,
      memory,
    });
    return sendJson(res, 200, result);
  }

  if (parts[0] === "practice" && parts.length === 1 && methodName === "POST") {
    const b = await bodyOf(req);
    const answer = String(b.answer || "").trim();
    if (!answer) return sendError(res, 400, "ANSWER_REQUIRED", "Submit an answer to save evidence.");

    let lesson = null;
    let score = null;
    let result = {};
    const exerciseType = typeof b.exerciseType === "string" ? b.exerciseType.trim() : "";
    const isStudioExercise = STUDIO_EXERCISE_TYPES.includes(exerciseType);

    if (b.taskId) {
      const task = await query("SELECT id,lesson_id FROM study_tasks WHERE id=$1 AND user_id=$2", [b.taskId, user.id]);
      if (!task.rows[0]) return notFound(res, "Task");
      if (b.lessonId && task.rows[0].lesson_id !== b.lessonId) {
        return sendError(res, 400, "TASK_LESSON_MISMATCH", "The task and lesson do not match.");
      }
    }

    if (b.lessonId) {
      const r = await query(
        "SELECT l.id,l.course_id,l.title,l.objective,l.checkpoint FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2",
        [b.lessonId, user.id]
      );
      lesson = r.rows[0];
      if (!lesson) return notFound(res, "Lesson");
    }

    if (isStudioExercise) {
      const correct = typeof b.correct === "boolean" ? b.correct : null;
      const hasNumericScore =
        b.score !== null && b.score !== undefined && b.score !== "" && Number.isFinite(Number(b.score));
      score = hasNumericScore
        ? Math.max(0, Math.min(100, Math.round(Number(b.score))))
        : correct === true
        ? 100
        : correct === false
        ? 0
        : null;
      result = {
        exerciseType,
        correct,
        explanation: String(b.explanation || "").slice(0, 600),
      };
    } else if (lesson) {
      if (lesson.checkpoint && Array.isArray(lesson.checkpoint.options)) {
        const selected = Number(b.selectedIndex);
        const correct = selected === Number(lesson.checkpoint.answerIndex);
        score = correct ? 100 : 0;
        result = {
          correct,
          explanation: lesson.checkpoint.explanation || "Review the lesson objective and try again.",
        };
      } else {
        result = { feedback: "Answer saved as learning evidence. Use the tutor to review your reasoning." };
      }
    }

    const r = await query(
      `INSERT INTO practice_attempts(user_id,task_id,lesson_id,concept,prompt,submitted_answer,result,score) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        user.id,
        b.taskId || null,
        b.lessonId || null,
        String(b.concept || lesson?.title || "").slice(0, 160),
        String(b.prompt || lesson?.objective || "Practice response").slice(0, 2000),
        answer,
        JSON.stringify(result),
        score,
      ]
    );

    if (r.rows[0]) {
      const attempt = r.rows[0];
      await safeRagSync(() =>
        indexUserSource(
          user.id,
          {
            sourceType: "practice_attempt",
            sourceId: attempt.id,
            courseId: lesson?.course_id || null,
            lessonId: attempt.lesson_id,
            title: attempt.concept || lesson?.title || "Practice attempt",
            body: [attempt.prompt, attempt.submitted_answer, result?.explanation].filter(Boolean).join("\n"),
            metadata: { score: attempt.score, correct: result?.correct ?? null },
          },
          { queryFn: query }
        )
      );
    }

    return sendJson(res, 201, { attempt: r.rows[0], result });
  }

  if(parts[0]==="tutor"&&methodName==="POST") {
    const b=await bodyOf(req),mode=String(b.mode||"Explain"),prompt=String(b.prompt||"").trim().slice(0,3000);
    if(!["Explain","Hint","Quiz me","Review my work"].includes(mode))return sendError(res,400,"INVALID_MODE","Choose a tutor mode.");
    if(b.lessonId){
      const l=await query("SELECT l.title,l.objective,l.content_markdown,l.worked_example,c.title course_title FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=$1 AND c.user_id=$2",[b.lessonId,user.id]);
      if(!l.rows[0])return notFound(res,"Lesson");
      b.context=l.rows[0];
      if(!b.context.course_id && b.courseId) b.context.course_id = b.courseId;
      if(!b.context.id) b.context.id = b.lessonId;
    }
    const targetCourseId=b.context?.course_id||b.courseId||null;
    const memory=await retrieveLearnerContext(user.id,[prompt,b.context?.title,b.context?.objective,String(b.attempt||"").slice(0,300)].filter(Boolean).join(" "),{limit:8,lessonId:b.lessonId||null,courseId:targetCourseId,mode,deepRag:true,queryFn:query});
    const reply=await tutorReply({context:b.context||"Learner workspace",mode,prompt,attempt:String(b.attempt||"").slice(0,5000),memory});
    const memoryById=new Map((Array.isArray(memory)?memory:[]).map(item=>[item.id,item]));
    const enrichedSources=(Array.isArray(reply.sources)?reply.sources:[]).map(src=>{
      if(!src||typeof src!=="object")return src;
      const hit=memoryById.get(src.id);
      if(!hit)return src;
      return {
        ...src,
        ...(hit.excerpt?{excerpt:String(hit.excerpt).slice(0,420)}:{}),
        ...(hit.relevance!==undefined?{relevance:hit.relevance}:{}),
        ...(hit.matchType?{matchType:hit.matchType}:{}),
      };
    });
    return sendJson(res,200,{reply:reply.text,structured:reply.structured||null,mode,source:reply.source,model:reply.model||null,failoverCount:reply.failoverCount||0,sources:enrichedSources});
  }

  if(parts[0]==="ai"&&parts.length===2&&parts[1]==="status"&&methodName==="GET") {
    return sendJson(res,200,getModelPoolStatus());
  }

  if(parts[0]==="rag") {
    if(parts.length===2&&parts[1]==="status"&&methodName==="GET") return sendJson(res,200,await getRagStatus(user.id,{queryFn:query}));
    if(parts.length===2&&parts[1]==="reindex"&&methodName==="POST") return sendJson(res,200,await reindexUserCorpus(user.id,{queryFn:query}));
  }

  if(parts[0]==="progress"&&methodName==="GET") { const [course,tasks,attempts,weekly,allAttempts]=await Promise.all([
    query(`SELECT c.id,c.title,COUNT(t.id)::int total_tasks,COUNT(t.id) FILTER(WHERE t.status='completed')::int completed_tasks FROM courses c LEFT JOIN study_tasks t ON t.course_id=c.id AND t.user_id=$1 WHERE c.user_id=$1 GROUP BY c.id ORDER BY c.created_at DESC`,[user.id]),
    query(`SELECT status,COUNT(*)::int count FROM study_tasks WHERE user_id=$1 GROUP BY status`,[user.id]),
    query(`SELECT concept,COUNT(*)::int attempts,ROUND(AVG(score))::int average_score,MAX(created_at) last_evidence FROM practice_attempts WHERE user_id=$1 AND concept<>'' GROUP BY concept ORDER BY last_evidence DESC LIMIT 12`,[user.id]),
    query(`SELECT date_trunc('week',scheduled_at)::date week,COUNT(*)::int scheduled,COUNT(*) FILTER(WHERE status='completed')::int completed FROM study_tasks WHERE user_id=$1 AND scheduled_at>NOW()-INTERVAL '8 weeks' GROUP BY week ORDER BY week`,[user.id]),
    query(`SELECT id,lesson_id,concept,score,result,created_at FROM practice_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,[user.id]),
  ]); return sendJson(res,200,{courses:course.rows,tasks:tasks.rows,evidence:attempts.rows,weekly:weekly.rows,attempts:allAttempts.rows}); }

  if(parts[0]==="search"&&methodName==="GET") { const term=`%${String(url.searchParams.get("q")||"").slice(0,100)}%`; const [lessons,notes,courses]=await Promise.all([query(`SELECT l.id,l.title,l.objective,c.title course_title FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.user_id=$1 AND (l.title ILIKE $2 OR l.objective ILIKE $2) LIMIT 8`,[user.id,term]),query("SELECT id,title,body FROM notes WHERE user_id=$1 AND (title ILIKE $2 OR body ILIKE $2) LIMIT 8",[user.id,term]),query("SELECT id,title,status FROM courses WHERE user_id=$1 AND title ILIKE $2 LIMIT 5",[user.id,term])]); return sendJson(res,200,{lessons:lessons.rows,notes:notes.rows,courses:courses.rows}); }

  if(parts[0]==="settings") {
    if(parts[1]==="export"&&methodName==="GET") { const [goals,courses,notes,cards,tasks,attempts]=await Promise.all([query("SELECT * FROM learning_goals WHERE user_id=$1",[user.id]),query("SELECT * FROM courses WHERE user_id=$1",[user.id]),query("SELECT * FROM notes WHERE user_id=$1",[user.id]),query("SELECT * FROM flashcards WHERE user_id=$1",[user.id]),query("SELECT * FROM study_tasks WHERE user_id=$1",[user.id]),query("SELECT * FROM practice_attempts WHERE user_id=$1",[user.id])]); return sendJson(res,200,{exportedAt:new Date().toISOString(),user:userDto(user),goals:goals.rows,courses:courses.rows,notes:notes.rows,flashcards:cards.rows,tasks:tasks.rows,practiceAttempts:attempts.rows}); }
    if(parts[1]==="account"&&methodName==="DELETE") { const b=await bodyOf(req); const check=await query("SELECT password_hash FROM users WHERE id=$1",[user.id]); if(!(await bcrypt.compare(String(b.password||""),check.rows[0].password_hash)))return sendError(res,401,"INVALID_CREDENTIALS","Password confirmation did not match."); await query("DELETE FROM users WHERE id=$1",[user.id]); return sendJson(res,200,{deleted:true},{"Set-Cookie":clearSessionCookie()}); }
    if(parts.length===1&&methodName==="GET")return sendJson(res,200,{user:userDto(user)});
    if(methodName==="PUT") { const b=await bodyOf(req),name=String(b.fullName||user.full_name).trim().slice(0,100),timezone=String(b.timezone||user.timezone).slice(0,80),days=Array.isArray(b.preferredStudyDays)?b.preferredStudyDays.map(Number).filter(d=>Number.isInteger(d)&&d>=0&&d<=6):user.preferred_study_days,session=Number(b.sessionMinutes||user.session_minutes),weekly=Number(b.weeklyMinutes||user.weekly_minutes); if(name.length<2||session<15||session>240||weekly<30||weekly>2400)return sendError(res,400,"INVALID_SETTINGS","Check your name and study budget values."); const prefs={...user.notification_preferences,...(b.notificationPreferences||{})}; const r=await query(`UPDATE users SET full_name=$1,timezone=$2,preferred_study_days=$3,session_minutes=$4,weekly_minutes=$5,notification_preferences=$6,updated_at=NOW() WHERE id=$7 RETURNING id,email,full_name,timezone,preferred_study_days,session_minutes,weekly_minutes,notification_preferences`,[name,timezone,days,session,weekly,JSON.stringify(prefs),user.id]); return sendJson(res,200,{user:userDto(r.rows[0])}); }
  }
  return sendError(res,404,"NOT_FOUND","API route was not found.");
}

export default async function handler(req,res) {
  try { await route(req,res); }
  catch(error) {
    if(error?.status) return sendError(res,error.status,error.code||"BAD_REQUEST",error.message);
    if(error?.code==="COURSE_NOT_PROPOSAL") return sendError(res,409,error.code,error.message);
    return safeError(res,error);
  }
}
