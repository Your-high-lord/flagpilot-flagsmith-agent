import test from "node:test";
import assert from "node:assert/strict";
import {verifyMetricConfiguration} from "../src/domain/metric-verification.js";

const expected={id:589,name:"Signup completed",eventName:"demo_signup_completed"};
const metric=()=>({
  id:589,
  name:"Signup completed",
  definition:{version:1,event:"demo_signup_completed"},
  aggregation:"occurrence",
  direction:"up"
});

test("accepts the exact live metric configuration",()=>{
  assert.doesNotThrow(()=>verifyMetricConfiguration(metric(),expected));
});
test("accepts a numeric-string API ID only when it is the exact safe ID",()=>{
  assert.doesNotThrow(()=>verifyMetricConfiguration({...metric(),id:"589"},expected));
});
test("rejects a different live metric ID",()=>{
  assert.throws(()=>verifyMetricConfiguration({...metric(),id:590},expected),/metric ID/);
});
test("rejects null, undefined and array metric responses",()=>{
  for(const value of [null,undefined,[]]) {
    assert.throws(()=>verifyMetricConfiguration(value,expected),/read-back did not return an object/);
  }
});
test("rejects an object without the expected metric ID",()=>{
  assert.throws(()=>verifyMetricConfiguration({},expected),/metric ID/);
});
test("rejects a different metric name",()=>{
  assert.throws(()=>verifyMetricConfiguration({...metric(),name:"Checkout completed"},expected),/metric name/);
});
test("rejects a different exact-case event definition",()=>{
  assert.throws(()=>verifyMetricConfiguration({...metric(),definition:{version:1,event:"Demo_signup_completed"}},expected),/event definition/);
});
test("rejects a metric with no event definition",()=>{
  assert.throws(()=>verifyMetricConfiguration({...metric(),definition:{}},expected),/event definition/);
});
test("rejects a different aggregation",()=>{
  assert.throws(()=>verifyMetricConfiguration({...metric(),aggregation:"unique"},expected),/aggregation/);
});
test("rejects a different metric direction",()=>{
  assert.throws(()=>verifyMetricConfiguration({...metric(),direction:"down"},expected),/direction/);
});
test("rejects an invalid expected metric ID",()=>{
  for(const id of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]) {
    assert.throws(()=>verifyMetricConfiguration(metric(),{...expected,id}),/positive safe integer/);
  }
});
