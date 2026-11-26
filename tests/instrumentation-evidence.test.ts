import test from "node:test";
import assert from "node:assert/strict";
import {scanInstrumentationEvidence} from "../src/domain/instrumentation-evidence.js";
const sha="a".repeat(40);
const scan=(source:string,eventName="CheckoutStarted")=>scanInstrumentationEvidence({eventName,sourceSha:sha,files:{"src/checkout.ts":source}});
test("accepts exact event on imported Flagsmith client",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"flagsmith_sdk_call_found");assert.equal(r.matches[0]?.api,"trackEvent");assert.equal(r.matches[0]?.line,1);
});
test("accepts official SDK factory client",()=>{
 const r=scan('import { createFlagsmithInstance as makeClient } from "@flagsmith/flagsmith"; const client=makeClient(); client.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"flagsmith_sdk_call_found");
});
test("accepts namespace factory and safe aliases",()=>{
 const r=scan('import * as sdk from "@flagsmith/flagsmith"; const client=sdk.createFlagsmithInstance(); const alias=client; alias.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"flagsmith_sdk_call_found");
});
test("accepts documented browser global",()=>{
 const r=scan('window.flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"flagsmith_sdk_call_found");assert.equal(r.matches[0]?.sdk,"window.flagsmith");
});
test("rejects commented-out tracking calls",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; // flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"not_found");assert.equal(r.trackingCallFound,false);
});
test("rejects strings containing fake tracking calls",()=>{
 const r=scan("import flagsmith from \"@flagsmith/flagsmith\"; const docs=\'flagsmith.trackEvent(\"CheckoutStarted\")\';");
 assert.equal(r.status,"not_found");assert.equal(r.trackingCallFound,false);
});
test("rejects unrelated analytics.trackEvent",()=>{
 const r=scan('const analytics={trackEvent:()=>{}}; analytics.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"event_literal_only");assert.equal(r.trackingCallFound,false);
});
test("rejects unrelated otherService.sendEvent",()=>{
 const r=scan('const otherService={sendEvent:()=>{}}; otherService.sendEvent("CheckoutStarted");');
 assert.equal(r.status,"event_literal_only");assert.equal(r.trackingCallFound,false);
});
test("rejects incorrect event capitalization",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("checkoutstarted");');
 assert.equal(r.status,"not_found");assert.equal(r.trackingCallFound,false);
});
test("rejects generic track even on Flagsmith client",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.track("CheckoutStarted");');
 assert.equal(r.status,"event_literal_only");assert.equal(r.trackingCallFound,false);
});
test("rejects dynamic event arguments",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent(EVENT_NAME);');
 assert.equal(r.status,"not_found");assert.equal(r.trackingCallFound,false);
});
test("rejects locally shadowed window",()=>{
 const r=scan('const window={flagsmith:{trackEvent(){}}}; window.flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"event_literal_only");
});
test("syntax errors make the scan incomplete",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("CheckoutStarted"');
 assert.equal(r.status,"incomplete");assert.deepEqual(r.failedFiles,["src/checkout.ts"]);
});
test("unsupported languages fail closed",()=>{
 const r=scanInstrumentationEvidence({eventName:"CheckoutStarted",sourceSha:sha,files:{"src/checkout.py":"flagsmith.track_event('CheckoutStarted')"}});
 assert.equal(r.status,"incomplete");assert.deepEqual(r.failedFiles,["src/checkout.py"]);
});
test("partial source scan remains incomplete",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("CheckoutStarted");');
 const result=scanInstrumentationEvidence({eventName:"CheckoutStarted",sourceSha:sha,files:{"src/checkout.ts":'import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("CheckoutStarted");'},failedFiles:["src/other.ts"]});
 assert.equal(result.status,"incomplete");
});
test("rejects invalid source commit SHAs",()=>assert.throws(()=>scanInstrumentationEvidence({eventName:"CheckoutStarted",sourceSha:"main",files:{"src/a.ts":"x"}}),/40-character Git commit SHA/));

test("rejects a mutable let alias even when initially assigned from Flagsmith",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; let client=flagsmith; client.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects a mutable alias reassigned to an unrelated service",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; let client=flagsmith; client=otherService; client.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects reassignment of a const alias through semantic diagnostics",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; const client=flagsmith; client=otherService; client.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"incomplete");assert.equal(r.trackingCallFound,false);
});
test("rejects a type-only default Flagsmith import",()=>{
 const r=scan('import type flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects a type-only named factory import",()=>{
 const r=scan('import { type createFlagsmithInstance } from "@flagsmith/flagsmith"; const client=createFlagsmithInstance(); client.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects a type-only namespace import",()=>{
 const r=scan('import type * as sdk from "@flagsmith/flagsmith"; sdk.default.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects direct replacement of the SDK trackEvent method",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent=otherService.trackEvent; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
 assert.match(r.note,/mutation|replacement/i);
});
test("rejects computed replacement of the SDK trackEvent method",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith["trackEvent"]=otherService.trackEvent; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects deletion of the SDK trackEvent method",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; delete flagsmith.trackEvent; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Object.defineProperty replacement of trackEvent",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; Object.defineProperty(flagsmith,"trackEvent",{value:otherService.sendEvent}); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Object.assign replacement of trackEvent",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; Object.assign(flagsmith,{trackEvent:otherService.sendEvent}); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("semantic diagnostics make source evidence incomplete",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; const broken: MissingType = 1; flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"incomplete");assert.equal(r.trackingCallFound,false);
});
