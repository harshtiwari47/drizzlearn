import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { generatePlan, tutorReply, resetModelManager } from "../server/ai.js";
import { safeError } from "../server/http.js";

test.beforeEach(() => {
  resetModelManager();
});

const goal={topic:"SQL analytics",desired_outcome:"Write analytical SQL queries against realistic data.",current_level:"Beginner",purpose:"Prepare for an interview",weekly_minutes:180,target_weeks:6,target_date:null};
const source={id:"note:owned-note",type:"note",title:"Learner's SQL notes",excerpt:"Joins combine related rows from tables."};

function validOutline(){
  const modules=[
    {position:1,title:"Query foundations",objective:"Select and filter records.",rationale:"Build query basics.",prerequisites:[],sourceRefs:[source.id,"note:invented"],lessons:[{position:1,title:"Filter a table",objective:"Use SELECT and WHERE to answer a simple data question.",prerequisites:[]}]},
    {position:2,title:"Relational queries",objective:"Combine related records.",rationale:"Support realistic analysis.",prerequisites:[1],lessons:[{position:1,title:"Join two tables",objective:"Use a join to combine matching records.",prerequisites:["Filter a table"]}]},
    {position:3,title:"Analysis project",objective:"Answer a question with a repeatable query.",rationale:"Demonstrate the outcome.",prerequisites:[2],lessons:[{position:1,title:"Build an analysis",objective:"Write and explain an analytical query.",prerequisites:["Join two tables"]}]},
  ];
  return {title:"SQL analytics",summary:goal.desired_outcome,durationWeeks:6,assumptions:["Assumes basic computer use."],modules};
}
function validLessonDraft(){return {lessons:[
  {modulePosition:1,lessonPosition:1,content:"Read a small table, choose the needed columns, and filter rows using a condition. Compare the result with the question before moving on.",workedExample:"Filter orders to show only rows where status equals shipped.",estimatedMinutes:20,sourceRefs:[source.id,"note:invented"]},
  {modulePosition:2,lessonPosition:1,content:"A join matches rows using a relationship between tables. Check key uniqueness and inspect unmatched records before trusting the result.",workedExample:"Join orders to customers using the shared customer_id field.",estimatedMinutes:25},
  {modulePosition:3,lessonPosition:1,content:"Combine filters, joins, and grouping to answer one defined question. Validate totals and explain how the query supports its conclusion.",workedExample:"Group paid orders by region and compare counts with the source rows.",estimatedMinutes:30},
]};}
function validAssessments(){return {checkpoints:[
  {modulePosition:1,lessonPosition:1,question:"Which clause filters rows?",options:["WHERE","ORDER BY","SELECT"],answerIndex:0,explanation:"WHERE keeps only rows that satisfy a condition."},
  {modulePosition:2,lessonPosition:1,question:"What should an ON clause connect?",options:["Related keys","Two unrelated totals","Column aliases"],answerIndex:0,explanation:"The ON condition describes which records are related."},
  {modulePosition:3,lessonPosition:1,question:"What helps validate an analysis query?",options:["Compare its totals to the source rows","Rename every column","Remove all filters"],answerIndex:0,explanation:"Comparing expected totals can reveal missing or duplicated rows."},
]};}

function withEnvironment(values,work){
  const keys=[
    "NVIDIA_API_KEY",
    "AI_API_KEY",
    "NVIDIA_BASE_URL",
    "AI_BASE_URL",
    "NVIDIA_MODEL",
    "AI_MODEL",
    "NVIDIA_FALLBACK_MODELS",
    "NVIDIA_TIMEOUT_MS",
    "NVIDIA_REQUEST_BUDGET_MS",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GEMINI_BASE_URL",
    "GEMINI_MODEL",
    "GEMINI_FALLBACK_MODELS",
    "GEMINI_TIMEOUT_MS",
    "AI_TIMEOUT_MS",
    "AI_ATTEMPT_TIMEOUT_MS",
    "AI_REQUEST_BUDGET_MS",
    "AI_TTFT_TIMEOUT_MS",
    "AI_CHUNK_IDLE_TIMEOUT_MS",
    "AI_BATCH_MODULES",
    "AI_PROVIDER",
  ],before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  for(const key of keys)delete process.env[key];
  for(const [key,value] of Object.entries(values))if(value!==undefined)process.env[key]=String(value);
  return Promise.resolve().then(work).finally(()=>{for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}});
}
function providerResponse(content,status=200,headers={}){
  if(status!==200)return new Response("provider detail must not leak",{status,headers});
  return new Response(JSON.stringify({choices:[{message:{content:typeof content==="string"?content:JSON.stringify(content)}}]}),{status,headers:{"content-type":"application/json",...headers}});
}
function installFetch(t,handler){const original=globalThis.fetch;globalThis.fetch=handler;t.after(()=>{globalThis.fetch=original;});}
function responseForAgent(system){
  if(system.includes("curriculum and prerequisite planner"))return validOutline();
  if(system.includes("lesson-content designer"))return validLessonDraft();
  if(system.includes("assessment designer"))return validAssessments();
  if(system.includes("Repair this Drizzlearn course proposal"))return validOutline();
  throw new Error("Unexpected AI role in test: "+system.slice(0,80));
}

test("course planning and tutoring fail with actionable typed errors when NVIDIA is unconfigured",async()=>{
  await withEnvironment({},async()=>{
    await assert.rejects(generatePlan(goal),error=>error.code==="AI_NOT_CONFIGURED"&&/NVIDIA_API_KEY/.test(error.message));
    await assert.rejects(tutorReply({context:{title:"Join two tables"},mode:"Hint",prompt:"Help"}),error=>error.code==="AI_NOT_CONFIGURED"&&/NVIDIA_API_KEY/.test(error.message));
  });
});

test("course plan uses the three specialist outputs and keeps only retrieved source references",async t=>{
  await withEnvironment({NVIDIA_API_KEY:"test-only-secret",NVIDIA_BASE_URL:"https://nvidia.test/v1",NVIDIA_MODEL:"test/model"},async()=>{
    const requests=[];installFetch(t,async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return providerResponse(responseForAgent(JSON.parse(options.body).messages[0].content));});
    const plan=await generatePlan(goal,{memory:[source]});
    assert.equal(requests.length,3);
    assert.ok(requests.every(request=>request.url==="https://nvidia.test/v1/chat/completions"));
    assert.ok(requests.every(request=>request.options.headers.Authorization==="Bearer test-only-secret"));
    assert.ok(requests.every(request=>request.body.model==="test/model"&&request.body.max_tokens<=6500));
    assert.equal(plan.generationMode,"multi-agent");
    assert.equal(plan.modules.length,3);
    assert.equal(plan.estimatedMinutes,75);
    assert.deepEqual(plan.modules[0].sourceRefs.map(item=>item.id),[source.id]);
    assert.deepEqual(plan.modules[0].lessons[0].sourceRefs.map(item=>item.id),[source.id]);
  });
});

test("provider 429 is retried once and returns a validated course",async t=>{
  await withEnvironment({NVIDIA_API_KEY:"test-only-secret"},async()=>{
    let calls=0;installFetch(t,async(_url,options)=>{calls++;if(calls===1)return providerResponse("",429);return providerResponse(responseForAgent(JSON.parse(options.body).messages[0].content));});
    const plan=await generatePlan(goal);
    assert.equal(plan.modules.length,3);
    assert.equal(calls,4,"one transient rate limit should cause exactly one extra provider call");
  });
});

test("planner-wide deadline stays within Vercel maxDuration, including stalled provider calls",async t=>{
  const vercel=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.equal(vercel.functions["api/[...path].js"].maxDuration,60);
  await withEnvironment({NVIDIA_API_KEY:"test-only-secret",NVIDIA_REQUEST_BUDGET_MS:"1000"},async()=>{
    let calls=0;
    installFetch(t,async(_url,{signal})=>{
      calls++;
      return new Promise((_resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error("Mock provider did not honor timeout.")),10_000);
        signal.addEventListener("abort",()=>{clearTimeout(timer);const error=new Error("aborted");error.name="AbortError";reject(error);},{once:true});
      });
    });
    const started=Date.now();
    await assert.rejects(generatePlan(goal),error=>error.code==="AI_TIMEOUT");
    assert.ok(Date.now()-started<2_500,"the provider call must be aborted by the shared deadline");
    assert.equal(calls,1,"a timed-out planner must not start its parallel specialists or repair call");
  });
});

test("shared deadline caps specialist retries and the single repair request",async t=>{
  await withEnvironment({NVIDIA_API_KEY:"test-only-secret",NVIDIA_REQUEST_BUDGET_MS:"1000"},async()=>{
    let calls=0,lessonAttempts=0;
    installFetch(t,async(_url,{signal,body})=>{
      calls++;const system=JSON.parse(body).messages[0].content;
      if(system.includes("curriculum and prerequisite planner"))return providerResponse(validOutline());
      if(system.includes("lesson-content designer")){
        lessonAttempts++;
        if(lessonAttempts===1)return new Response("temporarily unavailable",{status:503});
        const draft=validLessonDraft();draft.lessons[0].content="too short";return providerResponse(draft);
      }
      if(system.includes("assessment designer"))return providerResponse(validAssessments());
      if(system.includes("Repair this Drizzlearn course proposal")){
        return new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>{const error=new Error("aborted");error.name="AbortError";reject(error);},{once:true}));
      }
      throw new Error("Unexpected AI role.");
    });
    const started=Date.now();
    await assert.rejects(generatePlan(goal),error=>error.code==="AI_TIMEOUT");
    assert.ok(Date.now()-started<2_500,"all retries and repair must share one deadline");
    assert.equal(calls,5,"outline + specialist retry + parallel assessor + one repair only");
  });
});

test("invalid structure gets one repair attempt, then remains an error",async t=>{
  await withEnvironment({NVIDIA_API_KEY:"test-only-secret"},async()=>{
    let calls=0;installFetch(t,async(_url,options)=>{calls++;const system=JSON.parse(options.body).messages[0].content;if(system.includes("curriculum and prerequisite planner"))return providerResponse({modules:[{title:"Incomplete"}]});return providerResponse({modules:[{title:"Still incomplete"}]});});
    await assert.rejects(generatePlan(goal),error=>error.code==="AI_INVALID_PLAN");
    assert.equal(calls,2,"malformed outline should stop the other specialists and allow only one repair");
  });
});

test("provider auth errors do not expose upstream response text or secrets",async t=>{
  await withEnvironment({NVIDIA_API_KEY:"test-only-secret"},async()=>{
    installFetch(t,async()=>new Response("upstream detail test-only-secret",{status:401}));
    await assert.rejects(tutorReply({context:{title:"Lesson"},mode:"Explain",prompt:"Explain"}),error=>{
      assert.equal(error.code,"AI_PROVIDER_AUTH");
      assert.doesNotMatch(error.message,/test-only-secret|upstream detail/);
      return true;
    });
  });
});

test("tutor citations and returned source list are limited to retrieved learner-owned items",async t=>{
  await withEnvironment({NVIDIA_API_KEY:"test-only-secret"},async()=>{
    installFetch(t,async()=>providerResponse(`Your note says this [${source.id}]. Unknown [note:other-user-id] https://unverified.example.test/page`));
    const reply=await tutorReply({context:{title:"SQL joins"},mode:"Explain",prompt:"Explain joins",memory:[source]});
    assert.match(reply.text,/\[note:owned-note\]/);
    assert.doesNotMatch(reply.text,/other-user-id|https:\/\//);
    assert.deepEqual(reply.sources,[{id:source.id,type:"note",title:source.title,courseTitle:null}]);
  });
});

test("safe AI errors return only typed, actionable messages",()=>{
  const headers=new Map(),res={setHeader(name,value){headers.set(name.toLowerCase(),value);},end(body){this.body=body;}};
  safeError(res,Object.assign(new Error("Set NVIDIA_API_KEY in the server environment."),{code:"AI_NOT_CONFIGURED",retryable:false}));
  const payload=JSON.parse(res.body);
  assert.equal(res.statusCode,503);
  assert.equal(payload.error.code,"AI_NOT_CONFIGURED");
  assert.equal(payload.error.details.retryable,false);
  assert.match(payload.error.message,/NVIDIA_API_KEY/);
  assert.equal(headers.get("cache-control"),"no-store");
});

test("AI generation failures leave new goals and existing proposals untouched",async()=>{
  let vite;
  const replacements=new Map([["./db.js","db"],["./ai.js","ai"],["./retrieval.js","retrieval"]]);
  const plugin={
    name:"learnos-plan-preservation-test",
    enforce:"pre",
    resolveId(importee,importer){const replacement=importer?.includes("server/plan-service.js")&&replacements.get(importee);return replacement?`\0learnos-plan-test:${replacement}`:null;},
    load(id){
      if(!id.startsWith("\0learnos-plan-test:"))return null;
      const name=id.slice("\0learnos-plan-test:".length);
      if(name==="db")return `export async function query(...args){return globalThis.__learnosPlanTest.query(...args)};export async function withTransaction(work){globalThis.__learnosPlanTest.transactions++;return work({query:(...args)=>globalThis.__learnosPlanTest.query(...args)})}`;
      if(name==="ai")return `export async function generatePlan(...args){return globalThis.__learnosPlanTest.generatePlan(...args)}`;
      if(name==="retrieval")return `export async function retrieveLearnerContext(...args){return globalThis.__learnosPlanTest.retrieveLearnerContext(...args)}`;
      return null;
    },
  };
  try{
    vite=await createServer({configFile:"./vite.config.js",logLevel:"silent",plugins:[plugin],server:{middlewareMode:true},appType:"custom"});
    const {generateCourseProposal,improveCourseProposal}=await vite.ssrLoadModule("/server/plan-service.js");
    const course={id:"course-proposal",goal_id:"goal-1",title:"Existing proposal",summary:"Existing summary",target_weeks:6,assumptions:[],topic:"SQL",desired_outcome:goal.desired_outcome,current_level:"Beginner",purpose:"Interview prep",weekly_minutes:180,target_date:null};
    const module={id:"module-1",position:1,title:"Existing module",objective:"Existing objective",rationale:"",prerequisites:[],source_refs:[],lessons:[{title:"Existing lesson",objective:"Existing objective",prerequisites:[],content:"Saved content remains unchanged.",workedExample:"A saved example.",checkpoint:{question:"Q?",options:["A","B"],answerIndex:0,explanation:"Because."},estimatedMinutes:20,sourceRefs:[]} ]};
    const state={transactions:0,mutations:[],generatePlan:async()=>{throw Object.assign(new Error("Add NVIDIA_API_KEY."),{code:"AI_NOT_CONFIGURED",retryable:false});},retrieveLearnerContext:async()=>[],query:async(sql)=>{
      if(sql.includes("SELECT * FROM learning_goals"))return {rows:[{...goal,id:"goal-1"}]};
      if(sql.includes("SELECT c.*,g.topic"))return {rows:[course]};
      if(sql.includes("SELECT m.*,COALESCE"))return {rows:[module]};
      if(/^(INSERT|UPDATE|DELETE)/i.test(sql.trim()))state.mutations.push(sql.trim().split(/\s+/).slice(0,3).join(" "));
      return {rows:[]};
    }};
    globalThis.__learnosPlanTest=state;
    await assert.rejects(generateCourseProposal("learner-1","goal-1"),error=>error.code==="AI_NOT_CONFIGURED");
    await assert.rejects(improveCourseProposal("learner-1","course-proposal","Add a better interview exercise."),error=>error.code==="AI_NOT_CONFIGURED");
    assert.equal(state.transactions,0,"generation must finish and validate before persistence begins");
    assert.deepEqual(state.mutations,[],"a failed AI request must not alter saved proposal/course data");
  }finally{
    await vite?.close();
    delete globalThis.__learnosPlanTest;
  }
});

test("course generation and tutoring fall back to Gemini when NVIDIA fails", async (t) => {
  await withEnvironment({
    NVIDIA_API_KEY: "nvidia-secret",
    NVIDIA_BASE_URL: "https://nvidia.test/v1",
    GEMINI_API_KEY: "gemini-secret",
    GEMINI_BASE_URL: "https://gemini.test/v1beta/openai",
    GEMINI_MODEL: "gemini-flash-latest"
  }, async () => {
    const urls = [];
    installFetch(t, async (url, options) => {
      urls.push(url);
      if (url.includes("nvidia.test")) {
        return new Response("NVIDIA rate limit", { status: 429 });
      }
      if (url.includes("gemini.test")) {
        const body = JSON.parse(options.body);
        assert.equal(options.headers.Authorization, "Bearer gemini-secret");
        assert.equal(body.model, "gemini-flash-latest");
        const system = body.messages[0].content;
        if (system.includes("curriculum and prerequisite planner")) return providerResponse(validOutline());
        if (system.includes("lesson-content designer")) return providerResponse(validLessonDraft());
        if (system.includes("assessment designer")) return providerResponse(validAssessments());
        if (system.includes("learning tutor")) return providerResponse("Gemini tutor answer [note:owned-note]");
        throw new Error("Unexpected system prompt: " + system);
      }
      throw new Error("Unexpected URL: " + url);
    });

    const plan = await generatePlan(goal, { memory: [source] });
    assert.ok(urls.some(u => u.includes("nvidia.test")), "NVIDIA should have been attempted first");
    assert.ok(urls.some(u => u.includes("gemini.test")), "Gemini should have received fallback calls");
    assert.equal(plan.modules.length, 3);

    const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain", memory: [source] });
    assert.equal(reply.source, "gemini");
    assert.match(reply.text, /Gemini tutor answer/);
  });
});

test("course generation works with standalone Gemini configuration when NVIDIA is absent", async (t) => {
  await withEnvironment({
    GEMINI_API_KEY: "gemini-only-secret",
    GEMINI_BASE_URL: "https://gemini.test/v1beta/openai",
    GEMINI_MODEL: "gemini-flash-latest"
  }, async () => {
    const urls = [];
    installFetch(t, async (url, options) => {
      urls.push(url);
      const body = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, "Bearer gemini-only-secret");
      assert.equal(body.model, "gemini-flash-latest");
      const system = body.messages[0].content;
      if (system.includes("curriculum and prerequisite planner")) return providerResponse(validOutline());
      if (system.includes("lesson-content designer")) return providerResponse(validLessonDraft());
      if (system.includes("assessment designer")) return providerResponse(validAssessments());
      if (system.includes("learning tutor")) return providerResponse("Gemini direct answer");
      throw new Error("Unexpected system prompt: " + system);
    });

    const plan = await generatePlan(goal);
    assert.equal(urls.length, 3);
    assert.ok(urls.every(u => u.includes("gemini.test")));
    assert.equal(plan.modules.length, 3);

    const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain" });
    assert.equal(reply.source, "gemini");
    assert.match(reply.text, /Gemini direct answer/);
  });
});

function multiModuleOutline(moduleCount = 4, lessonsPerModule = 2) {
  const modules = [];
  let prevLessonTitle = null;
  for (let m = 1; m <= moduleCount; m++) {
    const lessons = [];
    for (let l = 1; l <= lessonsPerModule; l++) {
      const title = `Module ${m} Lesson ${l}`;
      lessons.push({
        position: l,
        title,
        objective: `Demonstrate ${title.toLowerCase()} against real SQL tables.`,
        prerequisites: prevLessonTitle ? [prevLessonTitle] : [],
      });
      prevLessonTitle = title;
    }
    modules.push({
      position: m,
      title: `Module ${m}: Analytics Step ${m}`,
      objective: `Master analytical patterns for stage ${m}.`,
      rationale: `Builds sequentially toward end-to-end SQL mastery in stage ${m}.`,
      prerequisites: m > 1 ? [m - 1] : [],
      sourceRefs: [source.id],
      lessons,
    });
  }
  return {
    title: "SQL analytics",
    summary: goal.desired_outcome,
    durationWeeks: 6,
    assumptions: ["Basic spreadsheet familiarity."],
    modules,
  };
}

function validModuleLessons(modulePayload) {
  return {
    lessons: modulePayload.module.lessons.map((lesson) => ({
      lessonPosition: lesson.lessonPosition,
      content: `Mental model for ${lesson.title}: focus on relational grain first, then build filters step by step while avoiding cartesian row multiplication.`,
      workedExample: `Step 1: inspect keys for ${lesson.title}. Step 2: verify row totals before and after aggregation.`,
      estimatedMinutes: 25,
      sourceRefs: [source.id],
      checkpoint: {
        question: `Which verification step prevents silent errors in ${lesson.title}?`,
        options: ["Compare row counts before and after joins", "Skip filtering null keys", "Remove GROUP BY clauses"],
        answerIndex: 0,
        explanation: "Reconciling row counts catches unexpected duplicates or dropped rows immediately.",
      },
    })),
  };
}

function sseCompletionResponse(content, { signal = null, chunks = null, chunkDelayMs = 0, headers = {} } = {}) {
  const text = typeof content === "string" ? content : JSON.stringify(content);
  const parts = chunks || [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, Math.ceil(text.length / 2)) } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(Math.ceil(text.length / 2)) } }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        const err = new Error("aborted");
        err.name = "AbortError";
        try { controller.error(err); } catch {}
      };
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        for (const item of parts) {
          if (aborted) return;
          if (typeof item === "object" && item !== null && "delayMs" in item) {
            await new Promise((r) => setTimeout(r, item.delayMs));
            if (aborted) return;
            if (item.raw !== undefined) controller.enqueue(encoder.encode(item.raw));
          } else {
            if (chunkDelayMs > 0) await new Promise((r) => setTimeout(r, chunkDelayMs));
            if (aborted) return;
            controller.enqueue(encoder.encode(String(item)));
          }
        }
        if (!aborted) controller.close();
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream; charset=utf-8", ...headers },
  });
}

test("reasoning_effort is sent on compatible Gemini thinking models, stripped on HTTP 400 retry, and timeouts decouple NVIDIA vs Gemini", async (t) => {
  // 1. Live thinking model sends reasoning_effort: "low", retries HTTP 400 without it, and succeeds
  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_FALLBACK_MODELS: "gemini-3.5-flash,gemini-3.6-flash",
    },
    async () => {
      const bodies = [];
      installFetch(t, async (url, options) => {
        assert.ok(url.includes("generativelanguage.googleapis.com"));
        const body = JSON.parse(options.body);
        bodies.push(body);
        if (bodies.length === 1) {
          return new Response("reasoning_effort unsupported", { status: 400 });
        }
        return providerResponse("Recovered without reasoning_effort");
      });

      const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain joins" });
      assert.equal(reply.text, "Recovered without reasoning_effort");
      assert.equal(reply.model, "gemini-3.5-flash");
      assert.equal(reply.failoverCount, 0);
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0].model, "gemini-3.5-flash");
      assert.equal(bodies[0].reasoning_effort, "low");
      assert.equal(bodies[0].stream, true);
      assert.equal(bodies[1].model, "gemini-3.5-flash");
      assert.equal("reasoning_effort" in bodies[1], false, "HTTP 400 retry must strip reasoning_effort inline without failover");
    }
  );

  resetModelManager();

  // 2. Non-thinking Gemini models (flash-lite, gemma) omit reasoning_effort
  await withEnvironment(
    {
      AI_PROVIDER: "gemini",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gemini-3.5-flash-lite",
      GEMINI_FALLBACK_MODELS: "gemma-4-31b-it",
    },
    async () => {
      const bodies = [];
      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        bodies.push(body);
        if (body.model === "gemini-3.5-flash-lite") return providerResponse("", 503);
        return providerResponse("Gemma answer");
      });

      const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain" });
      assert.equal(reply.model, "gemma-4-31b-it");
      assert.equal(bodies.length, 2);
      assert.equal("reasoning_effort" in bodies[0], false);
      assert.equal("reasoning_effort" in bodies[1], false);
    }
  );

  resetModelManager();

  // 3. Decoupled timeouts: 1000ms NVIDIA_TIMEOUT_MS aborts slow NVIDIA and succeeds on slower Gemini (1150ms) within 4000ms GEMINI_TIMEOUT_MS
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-1",
      NVIDIA_FALLBACK_MODELS: "nv-1",
      NVIDIA_TIMEOUT_MS: "1000",
      GEMINI_API_KEY: "AIza-test",
      GEMINI_MODEL: "gemini-3.5-flash",
      GEMINI_FALLBACK_MODELS: "gemini-3.5-flash",
      GEMINI_TIMEOUT_MS: "4000",
    },
    async () => {
      const seen = [];
      installFetch(t, async (url, options) => {
        const body = JSON.parse(options.body);
        seen.push(body.model);
        if (url.includes("nvidia.com")) {
          return new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => {
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true }
            );
          });
        }
        // Delay longer than NVIDIA's 1000ms timeout to prove Gemini's 4000ms timeout is decoupled
        await new Promise((r) => setTimeout(r, 1150));
        return providerResponse("Gemini survived past NVIDIA timeout");
      });

      const started = Date.now();
      const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain" });
      const elapsed = Date.now() - started;
      assert.deepEqual(seen, ["nv-1", "gemini-3.5-flash"]);
      assert.equal(reply.source, "gemini");
      assert.equal(reply.text, "Gemini survived past NVIDIA timeout");
      assert.ok(elapsed >= 2000, `expected NVIDIA 1s timeout + Gemini 1.15s response, got ${elapsed}ms`);
    }
  );
});

test("generatePlan batches modules with concurrency 2, emits real progress stages, repairs a single failing module, and preserves classic 3-call mode when compact or disabled", async (t) => {
  // 1. Micro-batch mode (4 modules x 2 lessons = 8 lessons > 4 on non-custom URL)
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-1",
      NVIDIA_FALLBACK_MODELS: "nv-1",
    },
    async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const stages = [];
      const progressEvents = [];

      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        const system = body.messages[0].content;
        if (system.includes("curriculum and prerequisite planner")) {
          stages.push("outline");
          return providerResponse(multiModuleOutline(4, 2));
        }
        if (system.includes("lesson and assessment designer for one course module")) {
          const payload = JSON.parse(body.messages[1].content);
          stages.push(`module_${payload.modulePosition}`);
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            // Delay module 1 slightly longer than module 2 to confirm order preservation & concurrency = 2
            await new Promise((r) => setTimeout(r, payload.modulePosition === 1 ? 45 : 15));
            return providerResponse(validModuleLessons(payload));
          } finally {
            inFlight -= 1;
          }
        }
        throw new Error("Unexpected stage: " + system.slice(0, 80));
      });

      const plan = await generatePlan(goal, {
        memory: [source],
        onProgress: (evt) => progressEvents.push(evt),
      });

      assert.equal(maxInFlight, 2, "micro-batching must run with bounded concurrency of 2");
      assert.equal(stages.length, 5, "1 outline + 4 module calls");
      assert.equal(plan.modules.length, 4);
      assert.deepEqual(
        plan.modules.map((m) => m.position),
        [1, 2, 3, 4],
        "module ordering must match outline regardless of completion order"
      );
      assert.equal(plan.modules.reduce((n, m) => n + m.lessons.length, 0), 8);

      const stageNames = progressEvents.map((e) => e.stage);
      assert.equal(stageNames[0], "outline_ready");
      assert.equal(progressEvents[0].percent, 25);
      assert.equal(stageNames.filter((s) => s === "module_done").length, 4);
      assert.equal(stageNames[stageNames.length - 1], "finalizing");
      assert.equal(progressEvents[progressEvents.length - 1].percent, 96);
      for (let i = 1; i < progressEvents.length; i++) {
        assert.ok(progressEvents[i].percent >= progressEvents[i - 1].percent, "progress percent must be monotonic");
      }
    }
  );

  resetModelManager();

  // 2. Single-module targeted repair fixes only failing module 2 and keeps valid lesson slots & other modules intact
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-1",
      NVIDIA_FALLBACK_MODELS: "nv-1",
    },
    async () => {
      const calledModules = [];
      const repairedModules = [];

      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        const system = body.messages[0].content;
        if (system.includes("curriculum and prerequisite planner")) {
          return providerResponse(multiModuleOutline(4, 2));
        }
        if (system.includes("lesson and assessment designer for one course module")) {
          const payload = JSON.parse(body.messages[1].content);
          calledModules.push(payload.modulePosition);
          const draft = validModuleLessons(payload);
          if (payload.modulePosition === 2) {
            // Lesson 1 is valid, lesson 2 has invalid short content
            draft.lessons[1].content = "too short";
          }
          return providerResponse(draft);
        }
        if (system.includes("Repair this single course module's lessons and checkpoints")) {
          const payload = JSON.parse(body.messages[1].content);
          repairedModules.push(payload.modulePosition);
          assert.match(payload.validationError, /objective, explanation, or worked example/);
          // Repair returns ONLY lesson 2 fixed and omits lesson 1; valid lesson 1 from draft must survive
          const repaired = validModuleLessons(payload);
          return providerResponse({ lessons: [repaired.lessons[1]] });
        }
        throw new Error("Unexpected stage: " + system.slice(0, 80));
      });

      const plan = await generatePlan(goal, { memory: [source] });
      assert.deepEqual(calledModules.sort((a, b) => a - b), [1, 2, 3, 4]);
      assert.deepEqual(repairedModules, [2], "only module 2 should be repaired; modules 1, 3, 4 stay intact");
      assert.equal(plan.modules[1].lessons.length, 2);
      assert.match(plan.modules[1].lessons[0].content, /Mental model for Module 2 Lesson 1/);
      assert.match(plan.modules[1].lessons[1].content, /Mental model for Module 2 Lesson 2/);
    }
  );

  resetModelManager();

  // 3. Classic 3-call specialist flow stays active when AI_BATCH_MODULES=false (even with >4 lessons)
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-1",
      NVIDIA_FALLBACK_MODELS: "nv-1",
      AI_BATCH_MODULES: "false",
    },
    async () => {
      const outline = multiModuleOutline(3, 2); // 6 lessons (>4)
      const stages = [];
      const progressStages = [];

      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        const system = body.messages[0].content;
        if (system.includes("curriculum and prerequisite planner")) {
          stages.push("outline");
          return providerResponse(outline);
        }
        if (system.includes("lesson-content designer")) {
          stages.push("lesson_draft");
          const lessons = outline.modules.flatMap((m) =>
            m.lessons.map((l) => ({
              modulePosition: m.position,
              lessonPosition: l.position,
              content: `Detailed mental model, guided steps, and pitfalls for ${l.title} in ${m.title}.`,
              workedExample: `Concrete worked example walking through ${l.title} step by step.`,
              estimatedMinutes: 20,
              sourceRefs: [source.id],
            }))
          );
          return providerResponse({ lessons });
        }
        if (system.includes("assessment designer")) {
          stages.push("assessment_draft");
          const checkpoints = outline.modules.flatMap((m) =>
            m.lessons.map((l) => ({
              modulePosition: m.position,
              lessonPosition: l.position,
              question: `Applied reasoning check for ${l.title}?`,
              options: ["Verify grain and join keys", "Ignore nulls", "Skip validation"],
              answerIndex: 0,
              explanation: "Checking relational grain ensures accurate aggregations.",
            }))
          );
          return providerResponse({ checkpoints });
        }
        throw new Error("Unexpected stage: " + system.slice(0, 80));
      });

      const plan = await generatePlan(goal, {
        memory: [source],
        onProgress: (evt) => progressStages.push(evt.stage),
      });
      assert.deepEqual(stages, ["outline", "lesson_draft", "assessment_draft"]);
      assert.deepEqual(progressStages, ["outline_ready", "lessons_ready", "assessments_ready", "finalizing"]);
      assert.equal(plan.modules.length, 3);
      assert.equal(plan.modules.reduce((n, m) => n + m.lessons.length, 0), 6);
    }
  );

  resetModelManager();

  // 4. Classic 3-call specialist flow stays active when outlineLessonCount <= 4 on live non-custom URLs
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-1",
      NVIDIA_FALLBACK_MODELS: "nv-1",
    },
    async () => {
      const stages = [];
      installFetch(t, async (_url, options) => {
        const system = JSON.parse(options.body).messages[0].content;
        if (system.includes("curriculum and prerequisite planner")) stages.push("outline");
        else if (system.includes("lesson-content designer")) stages.push("lesson_draft");
        else if (system.includes("assessment designer")) stages.push("assessment_draft");
        return providerResponse(responseForAgent(system));
      });
      const plan = await generatePlan(goal, { memory: [source] });
      assert.deepEqual(stages, ["outline", "lesson_draft", "assessment_draft"]);
      assert.equal(plan.modules.length, 3);
    }
  );

  resetModelManager();

  // 5. Classic 3-call specialist flow stays active on custom URLs even when outlineLessonCount > 4
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_BASE_URL: "https://nvidia.test/v1",
      NVIDIA_MODEL: "custom-model",
    },
    async () => {
      const outline = multiModuleOutline(3, 2); // 6 lessons (>4)
      const stages = [];
      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        assert.equal("stream" in body, false, "custom URL must not send stream: true");
        const system = body.messages[0].content;
        if (system.includes("curriculum and prerequisite planner")) {
          stages.push("outline");
          return providerResponse(outline);
        }
        if (system.includes("lesson-content designer")) {
          stages.push("lesson_draft");
          return providerResponse({
            lessons: outline.modules.flatMap((m) =>
              m.lessons.map((l) => ({
                modulePosition: m.position,
                lessonPosition: l.position,
                content: `Mental model, steps, and pitfalls for ${l.title} in ${m.title}.`,
                workedExample: `Concrete worked example for ${l.title}.`,
                estimatedMinutes: 20,
              }))
            ),
          });
        }
        if (system.includes("assessment designer")) {
          stages.push("assessment_draft");
          return providerResponse({
            checkpoints: outline.modules.flatMap((m) =>
              m.lessons.map((l) => ({
                modulePosition: m.position,
                lessonPosition: l.position,
                question: `Applied check for ${l.title}?`,
                options: ["Check grain", "Skip check", "Drop keys"],
                answerIndex: 0,
                explanation: "Checking grain prevents duplicate counting.",
              }))
            ),
          });
        }
        throw new Error("Unexpected stage: " + system.slice(0, 80));
      });
      const plan = await generatePlan(goal, { memory: [source] });
      assert.deepEqual(stages, ["outline", "lesson_draft", "assessment_draft"]);
      assert.equal(plan.modules.reduce((n, m) => n + m.lessons.length, 0), 6);
    }
  );
});

test("SSE stream:true decodes chunked frames, fails over on TTFT stall, survives slow chunks past TTFT window, and supports JSON fallback", async (t) => {
  // 1. Chunked SSE framing split across byte boundaries + keepalive empty delta + application/json fallback
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-1",
      NVIDIA_FALLBACK_MODELS: "nv-1",
    },
    async () => {
      const bodies = [];
      let call = 0;
      installFetch(t, async (_url, options) => {
        call += 1;
        const body = JSON.parse(options.body);
        bodies.push(body);
        assert.equal(body.stream, true, "live non-custom URL must send stream: true");
        const system = body.messages[0].content;
        if (system.includes("curriculum and prerequisite planner")) {
          const jsonStr = JSON.stringify(validOutline());
          const f1 = `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`;
          const f2 = `data: ${JSON.stringify({ choices: [{ delta: { content: jsonStr.slice(0, 40) } }] })}\n\n`;
          const f3 = `data: ${JSON.stringify({ choices: [{ delta: { content: jsonStr.slice(40) } }] })}\n\n`;
          // Split f2 intentionally across two stream chunks to verify line buffering
          return sseCompletionResponse(jsonStr, {
            signal: options.signal,
            chunks: [f1, f2.slice(0, 18), f2.slice(18), f3, "data: [DONE]\n\n"],
          });
        }
        if (system.includes("lesson-content designer")) {
          // Graceful fallback when upstream answers with application/json despite stream: true
          return providerResponse(validLessonDraft());
        }
        if (system.includes("assessment designer")) {
          return sseCompletionResponse(validAssessments(), { signal: options.signal });
        }
        throw new Error("Unexpected stage: " + system.slice(0, 80));
      });

      const plan = await generatePlan(goal, { memory: [source] });
      assert.equal(call, 3);
      assert.equal(plan.modules.length, 3);
      assert.equal(bodies.every((b) => b.stream === true), true);
    }
  );

  resetModelManager();

  // 2. TTFT stall aborts stalled SSE stream and immediately switches to fallback candidate
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-stalled",
      NVIDIA_FALLBACK_MODELS: "nv-fast",
      AI_TTFT_TIMEOUT_MS: "65",
      NVIDIA_TIMEOUT_MS: "5000",
    },
    async () => {
      const attemptedModels = [];
      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        attemptedModels.push(body.model);
        if (body.model === "nv-stalled") {
          // Send empty delta keepalive then stall past TTFT window -> must still trigger TTFT abort!
          return sseCompletionResponse("", {
            signal: options.signal,
            chunks: [
              `data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`,
              { delayMs: 500, raw: `data: ${JSON.stringify({ choices: [{ delta: { content: "too late" } }] })}\n\n` },
            ],
          });
        }
        return sseCompletionResponse("Fast fallback completion", { signal: options.signal });
      });

      const started = Date.now();
      const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain" });
      assert.ok(Date.now() - started < 1_000, "TTFT stall failover must abort fast without waiting for 5s attempt timeout");
      assert.deepEqual(attemptedModels, ["nv-stalled", "nv-fast"]);
      assert.equal(reply.model, "nv-fast");
      assert.equal(reply.failoverCount, 1);
      assert.equal(reply.text, "Fast fallback completion");
    }
  );

  resetModelManager();

  // 3. Active stream receives first token before TTFT, then pauses past TTFT window without false abort
  await withEnvironment(
    {
      NVIDIA_API_KEY: "nvapi-test",
      NVIDIA_MODEL: "nv-streaming",
      NVIDIA_FALLBACK_MODELS: "nv-backup",
      AI_TTFT_TIMEOUT_MS: "70",
      AI_CHUNK_IDLE_TIMEOUT_MS: "1000",
      NVIDIA_TIMEOUT_MS: "5000",
    },
    async () => {
      const attemptedModels = [];
      installFetch(t, async (_url, options) => {
        const body = JSON.parse(options.body);
        attemptedModels.push(body.model);
        return sseCompletionResponse("", {
          signal: options.signal,
          chunks: [
            { delayMs: 15, raw: `data: ${JSON.stringify({ choices: [{ delta: { content: "First chunk " } }] })}\n\n` },
            // 130ms pause is > 70ms AI_TTFT_TIMEOUT_MS, but < 1000ms chunkIdleTimeoutMs -> must NOT abort!
            { delayMs: 130, raw: `data: ${JSON.stringify({ choices: [{ delta: { content: "second chunk." } }] })}\n\n` },
            "data: [DONE]\n\n",
          ],
        });
      });

      const reply = await tutorReply({ context: { title: "SQL" }, mode: "Explain", prompt: "Explain" });
      assert.deepEqual(attemptedModels, ["nv-streaming"]);
      assert.equal(reply.failoverCount, 0);
      assert.equal(reply.text, "First chunk second chunk.");
    }
  );
});
