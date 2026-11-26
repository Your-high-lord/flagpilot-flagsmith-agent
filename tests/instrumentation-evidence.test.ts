import test from "node:test";
import assert from "node:assert/strict";
import {scanInstrumentationEvidence} from "../src/domain/instrumentation-evidence.js";
const sha="a".repeat(40);
test("finds an exact event passed to a tracking call",()=>{
  const result=scanInstrumentationEvidence({eventName:"checkout_started",sourceSha:sha,files:{"src/checkout.ts":"flagsmith.trackEvent('checkout_started');"}});
  assert.equal(result.status,"tracking_call_found");
  assert.equal(result.matches[0]?.api,"trackevent");
  assert.equal(result.matches[0]?.line,1);
});
test("does not treat an event-name string alone as verified instrumentation",()=>{
  const result=scanInstrumentationEvidence({eventName:"checkout_started",sourceSha:sha,files:{"src/checkout.ts":"const eventName = 'checkout_started';"}});
  assert.equal(result.status,"event_literal_only");
  assert.equal(result.trackingCallFound,false);
});
test("does not infer an event name from unrelated tracking calls",()=>{
  const result=scanInstrumentationEvidence({eventName:"checkout_started",sourceSha:sha,files:{"src/checkout.ts":"analytics.track('page_view');"}});
  assert.equal(result.status,"not_found");
});
test("marks a partial source scan incomplete even when a call is found",()=>{
  const result=scanInstrumentationEvidence({eventName:"checkout_started",sourceSha:sha,files:{"src/checkout.ts":"track('checkout_started');"},failedFiles:["src/other.ts"]});
  assert.equal(result.status,"incomplete");
});
test("rejects invalid source commit SHAs",()=>assert.throws(()=>scanInstrumentationEvidence({eventName:"checkout_started",sourceSha:"main",files:{"src/a.ts":"track('checkout_started')"}}),/40-character Git commit SHA/));
