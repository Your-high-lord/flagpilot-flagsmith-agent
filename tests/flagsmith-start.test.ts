import test from "node:test";
import assert from "node:assert/strict";
import {startExperiment} from "../src/flagsmith/start.js";
import type {FlagsmithApi} from "../src/flagsmith/api.js";
import {verifyMetricConfiguration} from "../src/domain/metric-verification.js";

function fakeApi(statuses:string[]) {
  let reads=0;
  let writes=0;
  const api={
    async getExperiment(_id:number) {
      const status=statuses[Math.min(reads,statuses.length-1)]!;
      reads++;
      return {id:596,status};
    },
    async startExperiment(_id:number) {
      writes++;
      return {};
    }
  } as unknown as FlagsmithApi;
  return {api,get reads(){return reads;},get writes(){return writes;}};
}
const draftOnly={allowedStatuses:["created","draft"] as const};

test("starts a newly created experiment after a fresh status read",async()=>{
 const f=fakeApi(["created","running"]);
 const result=await startExperiment(f.api,596,draftOnly);
 assert.equal(f.reads,2);assert.equal(f.writes,1);
 assert.equal(result.status,"running");
});
test("starts a draft after a fresh status read",async()=>{
 const f=fakeApi(["draft","active"]);
 const result=await startExperiment(f.api,596,draftOnly);
 assert.equal(f.reads,2);assert.equal(f.writes,1);
 assert.equal(result.status,"active");
});
test("defaults to rejecting stopped and paused states without a Flagsmith write",async()=>{ for(const status of ["stopped","paused"]){const f=fakeApi([status]);await assert.rejects(()=>startExperiment(f.api,596),/Allowed pre-start states: created, draft/);assert.equal(f.writes,0);} });
test("rejects stopped status on the final pre-start read without writing",async()=>{
 const f=fakeApi(["stopped"]);
 await assert.rejects(()=>startExperiment(f.api,596,draftOnly),/Allowed pre-start states: created, draft/);
 assert.equal(f.reads,1);assert.equal(f.writes,0);
});
test("rejects paused status on the final pre-start read without writing",async()=>{
 const f=fakeApi(["paused"]);
 await assert.rejects(()=>startExperiment(f.api,596,draftOnly),/Allowed pre-start states: created, draft/);
 assert.equal(f.reads,1);assert.equal(f.writes,0);
});
test("rejects an experiment that became paused after earlier validation",async()=>{
 const f=fakeApi(["paused"]);
 await assert.rejects(()=>startExperiment(f.api,596,draftOnly),/paused/);
 assert.equal(f.writes,0);
});
test("rejects running or active status instead of treating it as a valid draft start",async()=>{
 for(const status of ["running","active"]){
  const f=fakeApi([status]);
  await assert.rejects(()=>startExperiment(f.api,596,draftOnly),/Allowed pre-start states/);
  assert.equal(f.writes,0);
 }
});
test("rejects unknown or completed status without a Flagsmith write",async()=>{
 for(const status of ["completed","unknown","archived"]){
  const f=fakeApi([status]);
  await assert.rejects(()=>startExperiment(f.api,596,draftOnly),/Allowed pre-start states/);
  assert.equal(f.writes,0);
 }
});
test("rejects invalid experiment IDs before reading or writing",async()=>{
 const f=fakeApi(["created"]);
 await assert.rejects(()=>startExperiment(f.api,0,draftOnly),/positive safe integer/);
 assert.equal(f.reads,0);assert.equal(f.writes,0);
});
test("rejects when the post-start status cannot be verified",async()=>{
 const f=fakeApi(["created","paused"]);
 await assert.rejects(()=>startExperiment(f.api,596,draftOnly),/start was not verified/i);
 assert.equal(f.writes,1);
});

test("runs final configuration validation against the fresh experiment before writing",async()=>{
 const f=fakeApi(["created","running"]);let validatedStatus:string|undefined;
 await startExperiment(f.api,596,{...draftOnly,validateBeforeStart:experiment=>{validatedStatus=String(experiment.status);}});
 assert.equal(validatedStatus,"created");assert.equal(f.writes,1);
});
test("aborts without a Flagsmith write when final configuration validation detects drift",async()=>{
 const f=fakeApi(["created"]);
 await assert.rejects(()=>startExperiment(f.api,596,{...draftOnly,validateBeforeStart:()=>{throw new Error("live feature configuration drift");}}),/configuration drift/);
 assert.equal(f.reads,1);assert.equal(f.writes,0);
});

test("blocks the start write when the live metric event definition has drifted",async()=>{
 const f=fakeApi(["created"]);
 const wrongMetric={id:589,name:"Signup completed",definition:{version:1,event:"checkout_completed"},aggregation:"occurrence",direction:"up"};
 await assert.rejects(()=>startExperiment(f.api,596,{
  ...draftOnly,
  validateBeforeStart:()=>{
   verifyMetricConfiguration(wrongMetric,{id:589,name:"Signup completed",eventName:"demo_signup_completed"});
  }
 }),/event definition/);
 assert.equal(f.reads,1);
 assert.equal(f.writes,0);
});
test("blocks the start write when the live metric ID has drifted",async()=>{
 const f=fakeApi(["created"]);
 const wrongMetric={id:590,name:"Signup completed",definition:{version:1,event:"demo_signup_completed"},aggregation:"occurrence",direction:"up"};
 await assert.rejects(()=>startExperiment(f.api,596,{
  ...draftOnly,
  validateBeforeStart:()=>{
   verifyMetricConfiguration(wrongMetric,{id:589,name:"Signup completed",eventName:"demo_signup_completed"});
  }
 }),/metric ID/);
 assert.equal(f.writes,0);
});
