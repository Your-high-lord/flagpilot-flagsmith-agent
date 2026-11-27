import test from "node:test";
import {readFile} from "node:fs/promises";
import assert from "node:assert/strict";
import {scanInstrumentationEvidence} from "../src/domain/instrumentation-evidence.js";
const sha="a".repeat(40);
const scan=(source:string,eventName="CheckoutStarted")=>scanInstrumentationEvidence({eventName,sourceSha:sha,files:{"src/checkout.ts":source}});
test("accepts a constant event-name passed to imported Flagsmith client",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; const DEMO_CONVERSION_EVENT="CheckoutStarted"; flagsmith.trackEvent(DEMO_CONVERSION_EVENT);');
 assert.equal(r.status,"flagsmith_sdk_call_found");assert.equal(r.matches[0]?.api,"trackEvent");
});
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
 const r=scan('declare const otherService:any; const service={sendEvent:()=>{}}; service.sendEvent("CheckoutStarted");');
 assert.equal(r.status,"event_literal_only");assert.equal(r.trackingCallFound,false);
});
test("rejects incorrect event capitalization",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("checkoutstarted");');
 assert.equal(r.status,"not_found");assert.equal(r.trackingCallFound,false);
});
test("rejects generic track even on Flagsmith client",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; const client:any=flagsmith; client.track("CheckoutStarted");');
 assert.equal(r.status,"event_literal_only");assert.equal(r.trackingCallFound,false);
});
test("rejects dynamic event arguments",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const EVENT_NAME:string; flagsmith.trackEvent(EVENT_NAME);');
 assert.equal(r.status,"not_found");assert.equal(r.trackingCallFound,false);
});
test("rejects locally shadowed window",()=>{
 const r=scan('export {}; const window={flagsmith:{trackEvent(){}}}; window.flagsmith.trackEvent("CheckoutStarted");');
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

test("rejects SDK method mutation through a mutable alias before direct SDK call",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const fake:any; let client=flagsmith; client.trackEvent=fake; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects reflective SDK method mutation through a mutable alias",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const fake:any; let client=flagsmith; Reflect.set(client,"trackEvent",fake); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
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
test("test fixtures cannot create positive instrumentation evidence",()=>{
 const r=scanInstrumentationEvidence({eventName:"CheckoutStarted",sourceSha:sha,files:{"tests/fake.test.ts":'window.flagsmith.trackEvent("CheckoutStarted");'}});
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);assert.equal(r.scannedFiles,0);
});
test("test fixtures cannot invalidate a genuine runtime instrumentation match",()=>{
 const r=scanInstrumentationEvidence({eventName:"CheckoutStarted",sourceSha:sha,files:{
  "src/checkout.ts":'window.flagsmith.trackEvent("CheckoutStarted");',
  "tests/fake.test.ts":'window.flagsmith={trackEvent(){}};'
 }});
 assert.equal(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,true);
});
test("rejects replacement of window.flagsmith before a call",()=>{
 const r=scan('declare const fake:any; window.flagsmith=fake; window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects replacement of globalThis.flagsmith before a call",()=>{
 const r=scan('declare const fake:any; globalThis.flagsmith=fake; globalThis.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects replacement of window.flagsmith through a global alias",()=>{
 const r=scan('declare const fake:any; const globalAlias=window; globalAlias.flagsmith=fake; window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects a global alias assigned after its declaration",()=>{
 const r=scan('declare const fake:any; let globalAlias:any={}; globalAlias=window; globalAlias.flagsmith=fake; window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Reflect mutation through an alias assigned after declaration",()=>{
 const r=scan('declare const fake:any; let root:any={}; root=globalThis; const alias=root; Reflect.set(alias,"flagsmith",fake); window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects replacement through a reassigned global alias",()=>{
 const r=scan('declare const fake:any, other:any; let globalAlias=window; globalAlias=other; globalAlias.flagsmith=fake; window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects reflective replacement through a chained global alias",()=>{
 const r=scan('declare const fake:any; const root=globalThis; const alias=root; Reflect.set(alias,"flagsmith",fake); window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Object.assign replacement through a global alias",()=>{
 const r=scan('declare const fake:any; const root=window; Object.assign(root,{flagsmith:fake}); window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("does not reject unrelated Object and Reflect operations",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; const unrelated:any={}; Object.assign(unrelated,{x:1}); Object.defineProperty(unrelated,"trackEvent",{value:()=>{}}); Reflect.set(unrelated,"trackEvent",()=>{}); flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,true);
});
test("rejects Object API mutation through an alias assigned after declaration",()=>{
 const r=scan('declare const fake:any; let objectApi:any={}; objectApi=Object; const alias=objectApi; alias.defineProperty(window,"flagsmith",{value:fake}); window.flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("does not reject harmless Object.assign on a verified SDK client",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; Object.assign(flagsmith,{metadata:"safe"}); flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,true);
});
test("rejects direct replacement of the SDK trackEvent method",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const otherService:any; flagsmith.trackEvent=otherService.trackEvent; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
 assert.match(r.note,/mutation|replacement/i);
});
test("rejects computed replacement of the SDK trackEvent method",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const otherService:any; flagsmith["trackEvent"]=otherService.trackEvent; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects deletion of the SDK trackEvent method",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; delete flagsmith.trackEvent; flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Object.defineProperty replacement of trackEvent",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const otherService:any; Object.defineProperty(flagsmith,"trackEvent",{value:otherService.sendEvent}); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Object.assign replacement of trackEvent",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const otherService:any; Object.assign(flagsmith,{trackEvent:otherService.sendEvent}); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("semantic diagnostics reject type-only SDK imports used as runtime values",()=>{
 const r=scan('import type flagsmith from "@flagsmith/flagsmith"; flagsmith.trackEvent("CheckoutStarted");');
 assert.equal(r.status,"incomplete");assert.equal(r.trackingCallFound,false);
});

test("rejects Object.defineProperties replacement of trackEvent",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const otherService:any; Object.defineProperties(flagsmith,{trackEvent:{value:otherService.sendEvent}}); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Reflect.set replacement of trackEvent",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; declare const otherService:any; Reflect.set(flagsmith,"trackEvent",otherService.sendEvent); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});
test("rejects Reflect.deleteProperty removal of trackEvent",()=>{
 const r=scan('import flagsmith from "@flagsmith/flagsmith"; Reflect.deleteProperty(flagsmith,"trackEvent"); flagsmith.trackEvent("CheckoutStarted");');
 assert.notEqual(r.status,"flagsmith_sdk_call_found");assert.equal(r.trackingCallFound,false);
});

test("recognizes the exact conversion event in the real controlled store demo source",async()=>{
 const source=await readFile("demo/app.js","utf8");
 const result=scanInstrumentationEvidence({eventName:"demo_signup_completed",sourceSha:sha,files:{"demo/app.js":source}});
 assert.equal(result.status,"flagsmith_sdk_call_found");
 assert.equal(result.trackingCallFound,true);
 assert.deepEqual(result.matches.map(match=>match.file),["demo/app.js"]);
});

test("does not accept a different event name for the controlled store demo",async()=>{
 const source=await readFile("demo/app.js","utf8");
 const result=scanInstrumentationEvidence({eventName:"demo_signup_clicked",sourceSha:sha,files:{"demo/app.js":source}});
 assert.equal(result.status,"not_found");
 assert.equal(result.trackingCallFound,false);
});