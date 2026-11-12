import test,{before,after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "vite";

let vite,retrieveLearnerContext,state;
const learnerId="55555555-5555-4555-8555-555555555555";

before(async()=>{
  const plugin={name:"retrieval-db-test",enforce:"pre",resolveId(source,importer){return importer?.includes("server/retrieval.js")&&source==="./db.js"?"\0learnos-retrieval-db":null;},load(id){if(id==="\0learnos-retrieval-db")return `export async function query(sql,values){return globalThis.__learnosRetrievalTest.query(sql,values);}`;}};
  vite=await createServer({configFile:"./vite.config.js",logLevel:"silent",plugins:[plugin],server:{middlewareMode:true},appType:"custom"});
  ({retrieveLearnerContext}=await vite.ssrLoadModule("/server/retrieval.js"));
});
beforeEach(()=>{state={queries:[],query:async(sql,values)=>{state.queries.push({sql,values});if(sql.includes("FROM notes"))return {rows:[{id:"n1",title:"Saved note",excerpt:"Keyboard access matters."}]};if(sql.includes("FROM lessons"))return {rows:[{id:"l1",title:"Accessible controls",course_title:"Web basics",excerpt:"Use semantic buttons."}]};if(sql.includes("FROM practice_attempts"))return {rows:[{id:"a1",title:"Keyboard task",score:80,excerpt:"Tab through the form."}]};return {rows:[]};}};globalThis.__learnosRetrievalTest=state;});
after(async()=>{await vite?.close();delete globalThis.__learnosRetrievalTest;});

test("retrieval is learner-scoped and returns source IDs with bounded excerpts",async()=>{
  const result=await retrieveLearnerContext(learnerId,"keyboard accessible forms",{limit:8});
  assert.deepEqual(result.map(item=>item.id),["note:n1","lesson:l1","attempt:a1"]);
  assert.ok(state.queries.length===3);
  for(const query of state.queries){assert.equal(query.values[0],learnerId);assert.match(query.values[1],/keyboard:\* \| accessible:\* \| forms:\*/);assert.match(query.sql,/to_tsvector/);}
  assert.ok(result.every(item=>item.excerpt.length<=1800));
});

test("retrieval skips empty or punctuation-only searches",async()=>{
  assert.deepEqual(await retrieveLearnerContext(learnerId," !!! "),[]);
  assert.equal(state.queries.length,0);
});
