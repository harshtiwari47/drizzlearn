import crypto from "node:crypto";
import { withTransaction, query, getPoolMockState } from "./db.js";
import { generatePlan } from "./ai.js";
import { retrieveLearnerContext } from "./retrieval.js";
import { logger } from "./logger.js";
import { generateCourseMaterials } from "./materials-generator.js";

async function insertCourseModules(client,courseId,plan){
  const savedModules=[];
  for(const [moduleIndex,module] of plan.modules.entries()){
    const moduleId=crypto.randomUUID(),savedLessons=[];
    await client.query(`INSERT INTO course_modules(id,course_id,position,title,objective,rationale,prerequisite_positions,estimated_minutes,source_refs)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[moduleId,courseId,moduleIndex+1,module.title,module.objective,module.rationale,module.prerequisites,module.estimatedMinutes,JSON.stringify(module.sourceRefs||[])]);
    for(const [lessonIndex,lesson] of module.lessons.entries()){
      const lessonId=crypto.randomUUID();
      await client.query(`INSERT INTO lessons(id,course_id,module_id,position,title,objective,prerequisites,content_markdown,worked_example,checkpoint,source_refs,estimated_minutes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[lessonId,courseId,moduleId,lessonIndex+1,lesson.title,lesson.objective,lesson.prerequisites,lesson.content,lesson.workedExample,JSON.stringify(lesson.checkpoint),JSON.stringify(lesson.sourceRefs||[]),lesson.estimatedMinutes]);
      savedLessons.push({...lesson,id:lessonId});
    }
    savedModules.push({...module,id:moduleId,lessons:savedLessons});
  }
  return savedModules;
}

function withFeasibility(course,goal,plan){
  const weeklyMinutes=Number(goal.weekly_minutes)||360,weeksAvailable=Math.max(1,Number(plan.durationWeeks)||1),neededPerWeek=Math.ceil(plan.estimatedMinutes/weeksAvailable);
  return {...course,feasibility:{weeklyMinutes,neededPerWeek,fits:neededPerWeek<=weeklyMinutes}};
}

export async function generateCourseProposal(userId,goalId,{onProgress}={}){
  const result=await query("SELECT * FROM learning_goals WHERE id=$1 AND user_id=$2",[goalId,userId]),goal=result.rows[0];if(!goal)return null;
  const memory=await retrieveLearnerContext(userId,`${goal.topic} ${goal.desired_outcome}`,{limit:10,deepRag:true}),plan=await generatePlan(goal,{memory,onProgress}),courseId=crypto.randomUUID();
  const course=await withTransaction(async client=>{
    await client.query(`INSERT INTO ai_jobs(user_id,job_type,status,input_ref,output_ref,finished_at) VALUES($1,'course_plan','succeeded',$2,$3,NOW())`,[userId,JSON.stringify({goalId,memorySourceCount:memory.length}),JSON.stringify({title:plan.title,modules:plan.modules.length,lessons:plan.modules.reduce((n,module)=>n+module.lessons.length,0),generationMode:plan.generationMode,modelUsed:plan.modelUsed||null,providerUsed:plan.providerUsed||null,failoverCount:plan.failoverCount||0})]);
    await client.query(`INSERT INTO courses(id,user_id,goal_id,title,summary,status,estimated_minutes,assumptions) VALUES($1,$2,$3,$4,$5,'proposal',$6,$7)`,[courseId,userId,goalId,plan.title,plan.summary,plan.estimatedMinutes,JSON.stringify(plan.assumptions)]);
    const modules=await insertCourseModules(client,courseId,plan);
    return {id:courseId,goalId,...plan,modules,status:"proposal"};
  });
  return withFeasibility(course,goal,plan);
}

export async function improveCourseProposal(userId,courseId,feedback,{onProgress}={}){
  const courseResult=await query(`SELECT c.*,g.topic,g.desired_outcome,g.current_level,g.purpose,g.weekly_minutes,g.target_weeks,g.target_date
    FROM courses c JOIN learning_goals g ON g.id=c.goal_id WHERE c.id=$1 AND c.user_id=$2 AND c.status='proposal'`,[courseId,userId]);
  const course=courseResult.rows[0];if(!course)return null;
  const moduleResult=await query(`SELECT m.*,COALESCE(json_agg(json_build_object('title',l.title,'objective',l.objective,'prerequisites',l.prerequisites,'content',l.content_markdown,'workedExample',l.worked_example,'checkpoint',l.checkpoint,'estimatedMinutes',l.estimated_minutes,'sourceRefs',l.source_refs) ORDER BY l.position) FILTER(WHERE l.id IS NOT NULL),'[]') lessons
    FROM course_modules m LEFT JOIN lessons l ON l.module_id=m.id WHERE m.course_id=$1 GROUP BY m.id ORDER BY m.position`,[courseId]);
  const previousPlan={title:course.title,summary:course.summary,durationWeeks:course.target_weeks,assumptions:course.assumptions,modules:moduleResult.rows.map(module=>({...module,sourceRefs:module.source_refs}))};
  const memory=await retrieveLearnerContext(userId,`${course.topic} ${course.desired_outcome} ${feedback}`,{limit:10,courseId,deepRag:true});
  const plan=await generatePlan(course,{memory,previousPlan,feedback,onProgress});
  const improved=await withTransaction(async client=>{
    const locked=await client.query("SELECT id,status FROM courses WHERE id=$1 AND user_id=$2 FOR UPDATE",[courseId,userId]);
    if(!locked.rows[0]||locked.rows[0].status!=="proposal")throw Object.assign(new Error("This proposal was already approved or is no longer available."),{code:"COURSE_NOT_PROPOSAL"});
    await client.query("UPDATE courses SET title=$1,summary=$2,estimated_minutes=$3,assumptions=$4,updated_at=NOW() WHERE id=$5 AND user_id=$6 AND status='proposal'",[plan.title,plan.summary,plan.estimatedMinutes,JSON.stringify(plan.assumptions),courseId,userId]);
    await client.query("DELETE FROM course_modules WHERE course_id=$1",[courseId]);
    const modules=await insertCourseModules(client,courseId,plan);
    await client.query(`INSERT INTO ai_jobs(user_id,job_type,status,input_ref,output_ref,finished_at) VALUES($1,'course_plan_improvement','succeeded',$2,$3,NOW())`,[userId,JSON.stringify({courseId,feedbackLength:String(feedback).length,memorySourceCount:memory.length}),JSON.stringify({title:plan.title,modules:modules.length,lessons:modules.reduce((n,module)=>n+module.lessons.length,0),generationMode:plan.generationMode,modelUsed:plan.modelUsed||null,providerUsed:plan.providerUsed||null,failoverCount:plan.failoverCount||0})]);
    return {id:courseId,goalId:course.goal_id,...plan,modules,status:"proposal"};
  });
  return withFeasibility(improved,course,plan);
}

export async function approveCourse(userId, courseId, acceptOverload = false, userPreferences = {}, options = {}) {
  const mockState = getPoolMockState();
  const approval = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT c.*,g.weekly_minutes,g.target_weeks,g.user_id AS goal_user_id
       FROM courses c JOIN learning_goals g ON g.id=c.goal_id
       WHERE c.id=$1 AND c.user_id=$2 FOR UPDATE`, [courseId, userId],
    );
    const course = result.rows[0];
    if (!course) return null;
    if (course.status !== "proposal") throw Object.assign(new Error("This course is no longer awaiting approval."), { code: "COURSE_NOT_PROPOSAL" });
    const moduleRows = await client.query("SELECT id,position,estimated_minutes FROM course_modules WHERE course_id=$1 ORDER BY position", [courseId]);
    const totalWeeks = Math.max(1, Number(course.target_weeks) || 8);
    const weeklyMinutes = Number(course.weekly_minutes) || 360;
    const perWeek = Math.ceil(Number(course.estimated_minutes) / totalWeeks);
    if (perWeek > weeklyMinutes && !acceptOverload) return { requiresOverride: true, weeklyMinutes, neededPerWeek: perWeek };
    await client.query("UPDATE courses SET status='active',approved_at=NOW(),updated_at=NOW() WHERE id=$1", [courseId]);
    await client.query("UPDATE learning_goals SET status='active',updated_at=NOW() WHERE id=$1 AND user_id=$2", [course.goal_id, userId]);
    const lessonRows = await client.query("SELECT id,title,estimated_minutes,module_id FROM lessons WHERE course_id=$1 ORDER BY position", [courseId]);
    const modulePosMap = new Map(
      moduleRows.rows.map((m, idx) => [m.id, Number(m.position) || idx + 1])
    );
    const orderedLessons = [...lessonRows.rows].sort((a, b) => {
      const modDiff =
        (modulePosMap.get(a.module_id) ?? Number.MAX_SAFE_INTEGER) -
        (modulePosMap.get(b.module_id) ?? Number.MAX_SAFE_INTEGER);
      if (modDiff !== 0) return modDiff;
      const posA = Number(a.position);
      const posB = Number(b.position);
      if (Number.isFinite(posA) && Number.isFinite(posB) && posA !== posB) return posA - posB;
      return 0;
    });
    const days = Array.isArray(userPreferences.preferred_study_days) && userPreferences.preferred_study_days.length
      ? userPreferences.preferred_study_days.map(Number) : [1,3,5];
    const scheduleWeeklyMinutes = Number(course.weekly_minutes) || Number(userPreferences.weekly_minutes) || 360;
    const sessionMinutes = Math.max(15, Math.min(Number(userPreferences.session_minutes) || 120, scheduleWeeklyMinutes));
    const sessionsPerWeek = Math.max(1, Math.min(days.length, Math.floor(scheduleWeeklyMinutes / sessionMinutes)));
    let scheduledCount = 0;
    let sessionIndex = 0;
    let minutesInSession = 0;
    for (const lesson of orderedLessons) {
      const duration = Math.max(5, Number(lesson.estimated_minutes) || 25);
      if (minutesInSession && minutesInSession + duration > sessionMinutes) { sessionIndex++; minutesInSession = 0; }
      const targetDay = days[sessionIndex % sessionsPerWeek];
      const date = new Date();
      date.setHours(18, 0, 0, 0);
      let daysAhead = (targetDay - date.getDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7;
      daysAhead += Math.floor(sessionIndex / sessionsPerWeek) * 7;
      date.setDate(date.getDate() + daysAhead);
      const scheduledAt = new Date(date.getTime() + scheduledCount * 1000).toISOString();
      await client.query(
        `INSERT INTO study_tasks(user_id,course_id,lesson_id,task_type,title,scheduled_at,status,estimated_minutes)
         VALUES($1,$2,$3,'lesson',$4,$5,'upcoming',$6)`,
        [userId, courseId, lesson.id, lesson.title, scheduledAt, Math.min(sessionMinutes, duration)],
      );
      scheduledCount++;
      minutesInSession += duration;
    }
    return { approved: true, tasksCreated: scheduledCount, modules: moduleRows.rows.length };
  });

  // Skip spawning real-DB background tasks when only transaction client connect() is unit-mocked.
  const onlyConnectMocked = mockState.connectMocked && !mockState.queryMocked;
  if (approval?.approved && !onlyConnectMocked && options.skipBackgroundMaterials !== true) {
    const genOptions = mockState.queryMocked
      ? { queryFn: mockState.pinnedQuery, skipAi: options.skipAi ?? true }
      : {};
    // Fire-and-forget: run background AI materials generation separately
    generateCourseMaterials(userId, courseId, genOptions).catch((err) => {
      logger.error(`Background materials generation failed for course ${courseId}: ${err?.message || err}`, "drizzlearn:materials", {
        courseId,
        userId,
        error: err?.message,
      });
    });
  }

  return approval;
}
