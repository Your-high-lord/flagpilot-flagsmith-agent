import test from "node:test";import assert from "node:assert/strict";import {asList} from "../src/flagsmith/api.js";import {runPreflight} from "../src/flagsmith/preflight.js";
test("response helper accepts arrays",()=>assert.equal(asList([{id:1},{id:2}]).length,2));
test("response helper accepts paginated results",()=>assert.equal(asList({count:2,results:[{id:1},{id:2}]}).length,2));
test("response helper fails closed on unknown shape",()=>assert.deepEqual(asList({unexpected:[{id:1}]}),[]));
test("preflight passes only when warehouse and experiment endpoints are ready",async()=>{const r=await runPreflight({warehouseConnections:async()=>[{status:"Connected"}],experimentMetrics:async()=>[],experiments:async()=>[]});assert.equal(r.warehouseConnected,true);assert.equal(r.metricsReadable,true);assert.equal(r.experimentsReadable,true);});
test("preflight blocks Pending Connection",async()=>{const r=await runPreflight({warehouseConnections:async()=>[{status:"Pending Connection"}],experimentMetrics:async()=>[],experiments:async()=>[]});assert.equal(r.warehouseConnected,false);assert.match(r.note,/not Connected/i);});
test("preflight blocks unavailable experimentation endpoint",async()=>{const r=await runPreflight({warehouseConnections:async()=>[{status:"Connected"}],experimentMetrics:async()=>{throw new Error("403 Forbidden");},experiments:async()=>[]});assert.equal(r.warehouseConnected,false);assert.equal(r.metricsReadable,false);assert.match(r.note,/unblock access/i);});

import {FlagsmithApi} from "../src/flagsmith/api.js";

test("Flagsmith resource lookup follows every same-origin pagination page",async()=>{
 const original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=async(input,init)=>{const url=String(input);urls.push(url);return new Response(JSON.stringify(urls.length===1?{results:[{id:1}],next:"https://api.flagsmith.com/api/v1/environments/env/experiments/?page=2"}:{results:[{id:2}],next:null}),{status:200,headers:{"content-type":"application/json"}});};
 try{const api=new FlagsmithApi({apiKey:"test",environmentKey:"env"});const result=await api.experiments();assert.deepEqual(result.map(x=>x.id),[1,2]);assert.equal(urls.length,2);}finally{globalThis.fetch=original;}
});
test("Flagsmith pagination refuses a cross-origin next link before sending credentials",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({results:[{id:1}],next:"https://attacker.example/steal"}),{status:200});};
 try{const api=new FlagsmithApi({apiKey:"test",environmentKey:"env"});await assert.rejects(api.experiments(),/unsafe next-page URL/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test("Flagsmith pagination rejects repeated next links",async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input)=>{calls++;return new Response(JSON.stringify({results:[{id:calls}],next:String(input)}),{status:200});};
 try{const api=new FlagsmithApi({apiKey:"test",environmentKey:"env"});await assert.rejects(api.experiments(),/repeated a page URL/);assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
