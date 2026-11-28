import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,extname} from "node:path";
import {chromium} from "playwright";
const root=resolve("demo");
const sha="a".repeat(40);
const report={
 pullRequest:{url:"https://github.com/example/app/pull/12",title:"Example checkout change",changedFiles:["src/checkout.ts"],reportedChangedFileCount:1,truncated:false,headSha:sha,baseSha:"b".repeat(40)},
 review:{verdict:"ready_for_experiment",changeSummary:"A button label changed.",experimentOpportunity:"Test the copy.",hypothesis:"Clearer copy increases completed checkout.",flag:{name:"checkout_copy",purpose:"Choose checkout copy.",safeDefault:"control"},variants:[{key:"control",label:"Continue",allocation:50},{key:"treatment",label:"Review order",allocation:50}],metric:{name:"Checkout complete",eventName:"checkout_completed",trigger:"Successful checkout.",instrumentation:"present"},instrumentationPlan:{status:"verified",eventName:"checkout_completed",trigger:"Checkout success.",properties:[],recommendation:"Reuse event."},implementationPlan:{status:"manual_review_required",summary:"Manual review.",steps:[],tests:[],patch:"",patchNote:"Manual review."},codeTargets:[{file:"src/checkout.ts",reason:"Button.",suggestedChange:"Use a flag."}],risks:[],approvalQuestions:[],manualStepsSaved:1,nextStep:"Review."},
 instrumentationEvidence:{status:"flagsmith_sdk_call_found",eventName:"checkout_completed",sourceSha:sha,scannedFiles:1,failedFiles:[],eventLiteralFound:true,trackingCallFound:true,matches:[{file:"src/checkout.ts",line:20,api:"trackEvent",sdk:"@flagsmith/flagsmith",receiver:"flagsmith"}],note:"Source match only."},
 createdAt:"2026-11-27T00:00:00.000Z",workflowRunUrl:"https://github.com/Your-high-lord/flagpilot-flagsmith-agent/actions/runs/12345"
};
const provisioning={run:{id:45912345678},artifact:{target:{projectId:55341},result:{feature:{id:305244,name:"fp_checkout"},metric:{id:589,eventName:"checkout_completed"},experiment:{id:596,name:"Checkout test",status:"created"}}}};\nasync function fixtureServer(reportData=report,provisioningData=provisioning){
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(path==="/reports/latest.json"){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(reportData));return;}\n  if(path==="/data/latest-provisioning.json"){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(provisioningData));return;}
  const file=path==="/"?"index.html":path.slice(1);
  try{const data=await readFile(resolve(root,file));const type=extname(file)===".js"?"text/javascript":extname(file)===".css"?"text/css":"text/html";res.writeHead(200,{"content-type":type});res.end(data);}catch{res.writeHead(404);res.end("not found");}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();assert.ok(address&&typeof address==="object");
 return{server,url:"http://127.0.0.1:"+address.port+"/index.html"};
}
test("dashboard loads, renders report, and parses workflow run ID without browser errors",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(url);await page.getByText("Example checkout change").waitFor();
  assert.equal(await page.locator("#review-run-id").inputValue(),"12345");
  assert.equal(await page.locator("#report-verdict").innerText(),"ready for experiment");
  assert.equal(await page.locator("#promotion-confirm").count(),1);
  assert.equal(await page.locator("#delivery-verified").count(),0);
  await page.locator("#pr-url").fill("https://github.com/example/app/pull/12");
  await page.locator("#pr-form button").click();
  await page.getByText("Connect GitHub first. The PR review request has not been sent.").waitFor();
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("dashboard submits a fully eligible authenticated promotion with explicit confirmations",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let dispatchBody=null;
  await page.route("https://api.github.com/**",async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==="/repos/Your-high-lord/flagpilot-flagsmith-agent"&&request.method()==="GET"){await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({full_name:"Your-high-lord/flagpilot-flagsmith-agent"})});return;}
   if(path.endsWith("/actions/workflows/promote-pr-review.yml/dispatches")&&request.method()==="POST"){dispatchBody=request.postDataJSON();await route.fulfill({status:204,body:""});return;}
   await route.fulfill({status:404,body:"not found"});
  });
  await page.goto(url);await page.getByText("Example checkout change").waitFor();
  assert.equal(await page.locator("#promote-form input[type=checkbox]").count(),1,"promotion UI must contain exactly one checkbox");
  assert.equal(await page.locator("#promotion-confirm").count(),1);
  assert.equal(await page.locator("#promote-form #delivery-verified, #promote-form #promote-confirm").count(),0,"legacy separate confirmation checkboxes must be absent");
  assert.match(await page.locator("#promote-form").innerText(),/independently tested.*exact conversion event reached Flagsmith/s);
  assert.match(await page.locator("#promote-form").innerText(),/reviewed the complete PR report and authorize/s);
  await page.getByRole("button",{name:"Connect GitHub"}).click();
  await page.locator("#token").fill("github_pat_test_only");
  await page.locator("#save-token").click();
  await page.locator("#promotion-confirm").check();
  await page.locator("#promote-form button").click();
  await page.getByText(/Request submitted/).waitFor();
  assert.equal(dispatchBody?.inputs?.review_run_id,"12345");
  assert.equal(dispatchBody?.inputs?.confirm_event_delivery,"true");
  assert.equal(dispatchBody?.inputs?.confirm_provision,"true");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("dashboard blocks promotion when deterministic source evidence is missing",async()=>{
 const badReport=structuredClone(report);badReport.instrumentationEvidence.status="event_literal_only";
 const {server,url}=await fixtureServer(badReport);const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let dispatchCount=0;
  await page.addInitScript(()=>sessionStorage.setItem("flagpilot-gh-token","fake-token"));
  await page.route("https://api.github.com/**",async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==="/repos/Your-high-lord/flagpilot-flagsmith-agent"){await route.fulfill({status:200,contentType:"application/json",body:"{}"});return;}
   if(path.endsWith("/dispatches"))dispatchCount++;
   await route.fulfill({status:204,body:""});
  });
  await page.goto(url);await page.getByText("Example checkout change").waitFor();
  await page.locator("#promotion-confirm").check();
  await page.locator("#promote-form button").click();
  await page.getByText(/Not eligible:/).waitFor();
  assert.equal(dispatchCount,0);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("dashboard blocks missing metric, incomplete AI evidence, and inapplicable implementation",async()=>{
 const badReport=structuredClone(report);const {server,url}=await fixtureServer(badReport);const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let dispatchCount=0;
  await page.addInitScript(()=>sessionStorage.setItem("flagpilot-gh-token","fake-token"));
  await page.route("https://api.github.com/**",async route=>{
   const path=new URL(route.request().url()).pathname;
   if(path==="/repos/Your-high-lord/flagpilot-flagsmith-agent"){await route.fulfill({status:200,contentType:"application/json",body:"{}"});return;}
   if(path.endsWith("/dispatches"))dispatchCount++;
   await route.fulfill({status:204,body:""});
  });
  const cases=[
   ()=>{badReport.review.verdict="needs_engineering_work";},
   ()=>{badReport.review.metric.instrumentation="missing";},
   ()=>{badReport.review.instrumentationPlan.status="unclear";},
   ()=>{badReport.review.codeTargets=[];},
   ()=>{badReport.review.implementationPlan.status="not_applicable";},
   ()=>{badReport.instrumentationEvidence.eventName="different_event";},
   ()=>{badReport.pullRequest.reportedChangedFileCount=2;}
  ];
  for(const mutate of cases){
   mutate();await page.goto(url);
   await page.getByText("Example checkout change").waitFor();
   await page.locator("#promotion-confirm").check();
   await page.locator("#promote-form button").click();
   await page.getByText(/Not eligible:/).waitFor();
  }
  assert.equal(dispatchCount,0);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("start request uses explicit provisioning run and experiment IDs instead of a hardcoded ID",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let dispatchBody=null;
  await page.addInitScript(()=>sessionStorage.setItem("flagpilot-gh-token","fake-token"));
  await page.route("https://api.github.com/**",async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==="/repos/Your-high-lord/flagpilot-flagsmith-agent"){await route.fulfill({status:200,contentType:"application/json",body:"{}"});return;}
   if(path.endsWith("/actions/workflows/start-experiment.yml/dispatches")&&request.method()==="POST"){dispatchBody=request.postDataJSON();await route.fulfill({status:204,body:""});return;}
   if(path.endsWith("/actions/runs")){await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({workflow_runs:[]})});return;}
   await route.fulfill({status:404,body:"not found"});
  });
  await page.goto(url);
  const startFormCopy=await page.locator("#start-form").innerText();
  assert.match(startFormCopy,/Development client-side Environment Key/);
  assert.match(startFormCopy,/returns the expected feature value/);
  assert.match(startFormCopy,/verify experiment exposure and conversion delivery only after the workflow reports that the experiment is running/);
  assert.match(await page.locator("#start-form .start-warning").innerText(),/A draft cannot record experiment exposure or conversion events/);
  assert.doesNotMatch(startFormCopy,/tested SDK exposure and conversion-event delivery using a real test identity/);
  await page.waitForFunction(()=>document.querySelector("#provision-run-id")?.value==="45912345678"&&document.querySelector("#start-experiment-id")?.value==="596");
  await page.locator("#demo-verified").check();
  await page.locator("#start-form button").click();
  await page.locator("#start-notice").getByText(/Start request submitted/).waitFor();
  assert.match(await page.locator("#start-notice").textContent(),/Start request submitted/);
  assert.equal(dispatchBody?.inputs?.provision_run_id,"45912345678");
  assert.equal(dispatchBody?.inputs?.experiment_id,"596");
  assert.equal(dispatchBody?.inputs?.demo_verified,"true");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("dashboard hides an older published report after a newer PR review is requested",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   sessionStorage.setItem("flagpilot-review-requested-at",String(Date.parse("2026-11-27T12:00:00.000Z")));
   sessionStorage.setItem("flagpilot-review-requested-url","https://github.com/example/app/pull/12");
  });
  await page.goto(url);
  await page.getByText(/A newer PR review was requested/).waitFor();
  assert.equal(await page.locator("#report-actions").isHidden(),true);
  assert.equal(await page.locator("#review-run-id").inputValue(),"");
  assert.equal(await page.getByText("Example checkout change").count(),0);
  assert.equal(await page.locator("#promote-form").count(),1);
  assert.equal(await page.locator("#promotion-confirm").count(),1);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});


test("integration status cards never overlap copy or overflow at desktop, tablet and mobile widths",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  for(const width of [390,768,1024,1280,1600,1920]){
   await page.setViewportSize({width,height:1000});
   await page.goto(url);
   await page.locator(".status-card").first().waitFor();
   const metrics=await page.locator(".status-card").evaluateAll(cards=>cards.map(card=>{
    const content=card.children[1],badge=card.querySelector(".pill");
    const cardRect=card.getBoundingClientRect();
    const contentRect=content.getBoundingClientRect();
    const badgeRect=badge.getBoundingClientRect();
    return {
     cardWidth:card.clientWidth,scrollWidth:card.scrollWidth,
     badgeLeft:badgeRect.left,cardLeft:cardRect.left,
     badgeRight:badgeRect.right,cardRight:cardRect.right,
     badgeTop:badgeRect.top,contentBottom:contentRect.bottom,
     badgeScrollWidth:badge.scrollWidth,badgeClientWidth:badge.clientWidth
    };
   }));
   assert.equal(metrics.length,4,"all four integration cards should render");
   for(const metric of metrics){
    assert.ok(metric.badgeTop>=metric.contentBottom-1,"status badge overlaps card copy at viewport "+width+"px");
    assert.ok(metric.badgeLeft>=metric.cardLeft-0.5,"status badge escapes left card edge at viewport "+width+"px");
    assert.ok(metric.badgeRight<=metric.cardRight+0.5,"status badge escapes right card edge at viewport "+width+"px");
    assert.ok(metric.scrollWidth<=metric.cardWidth,"integration card has horizontal overflow at viewport "+width+"px");
    assert.ok(metric.badgeScrollWidth<=metric.badgeClientWidth,"status label text is clipped at viewport "+width+"px");
   }
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("controlled store demo sends the exact fixed synthetic conversion event only after enrollment",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.__flagpilotSdkCalls=[];
   window.flagsmith={
    async init(options){window.__flagpilotSdkCalls.push(["init",options.enableEvents]);},
    async identify(identity){window.__flagpilotSdkCalls.push(["identify",identity]);},
    getExperimentFlag(name){window.__flagpilotSdkCalls.push(["getExperimentFlag",name]);return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};},
    trackEvent(name,options){window.__flagpilotSdkCalls.push(["trackEvent",name,options]);},
    async flushEvents(){window.__flagpilotSdkCalls.push(["flushEvents"]);}
   };
  });
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  assert.equal(await page.locator("#event-name").inputValue(),"demo_signup_completed");
  assert.equal(await page.locator("#event-name").isEditable(),false);
  await page.locator("#environment-key").fill("public-development-sdk-key");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("ENROLLED",{exact:true}).waitFor();
  assert.equal(await page.locator("#connection-badge").innerText(),"ENROLLED");
  await page.locator("#conversion-button").click();
  await page.getByText("One synthetic conversion attempt 'demo_signup_completed' was flushed").waitFor();
  const calls=await page.evaluate(()=>window.__flagpilotSdkCalls);
  assert.deepEqual(calls.find(call=>call[0]==="trackEvent"),["trackEvent","demo_signup_completed",{metadata:{source:"flagpilot_demo",synthetic:true}}]);
  assert.ok(calls.some(call=>call[0]==="flushEvents"));
  assert.equal(calls.filter(call=>call[0]==="trackEvent").length,1);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("controlled store demo permits only one conversion attempt per enrolled identity",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{window.__trackCount=0;window.__flushCount=0;window.flagsmith={async init(){},async identify(){},getExperimentFlag(){return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};},trackEvent(){window.__trackCount++;},async flushEvents(){window.__flushCount++;}};});
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);await page.locator("#environment-key").fill("public-development-sdk-key");await page.locator("#connect-form button[type=submit]").click();
  await page.locator("#conversion-button").waitFor();await page.locator("#conversion-button").click();await page.locator("#conversion-button").evaluate(button=>button.dispatchEvent(new MouseEvent("click",{bubbles:true})));await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>window.__trackCount),1);assert.equal(await page.evaluate(()=>window.__flushCount),1);assert.equal(await page.locator("#conversion-button").isDisabled(),true);
  await page.locator("#new-visitor").click();await page.waitForFunction(()=>document.querySelector("#conversion-button")&&!document.querySelector("#conversion-button").disabled);await page.locator("#conversion-button").click();await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>window.__trackCount),2,"a new synthetic identity gets one new attempt");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("conversion reservation survives a page reload for the same persisted identity",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.flagsmith={async init(){},async identify(){},getExperimentFlag(){return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};},
    trackEvent(){localStorage.setItem("__fp_reload_tracks",String(Number(localStorage.getItem("__fp_reload_tracks")||"0")+1));},
    async flushEvents(){localStorage.setItem("__fp_reload_flushes",String(Number(localStorage.getItem("__fp_reload_flushes")||"0")+1));}};
  });
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  const identityBefore=await page.evaluate(()=>localStorage.getItem("flagpilot-demo-identity-v1"));
  assert.ok(identityBefore,"the first generated visitor identity must be persisted immediately");
  await page.locator("#environment-key").fill("public-development-sdk-key");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("ENROLLED",{exact:true}).waitFor();
  await page.locator("#conversion-button").click();
  await page.getByText(/One synthetic conversion attempt/).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem("__fp_reload_tracks")),"1");
  await page.reload();
  assert.equal(await page.evaluate(()=>localStorage.getItem("flagpilot-demo-identity-v1")),identityBefore,"reload must retain the same identity");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("ENROLLED",{exact:true}).waitFor();
  assert.equal(await page.locator("#conversion-button").isDisabled(),true,"the existing reservation must disable conversion after reconnect");
  await page.locator("#conversion-button").evaluate(button=>button.dispatchEvent(new MouseEvent("click",{bubbles:true})));
  assert.equal(await page.evaluate(()=>localStorage.getItem("__fp_reload_tracks")),"1","a reload must not allow a second event for the same identity");
  assert.equal(await page.evaluate(()=>localStorage.getItem("__fp_reload_flushes")),"1");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("uncertain SDK flush remains reserved after reload and is not retried",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.flagsmith={async init(){},async identify(){},getExperimentFlag(){return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};},
    trackEvent(){localStorage.setItem("__fp_uncertain_tracks",String(Number(localStorage.getItem("__fp_uncertain_tracks")||"0")+1));},
    async flushEvents(){throw new Error("simulated network timeout after SDK queueing");}};
  });
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  await page.locator("#environment-key").fill("public-development-sdk-key");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("ENROLLED",{exact:true}).waitFor();
  await page.locator("#conversion-button").click();
  await page.getByText(/Delivery uncertain · do not retry/).waitFor();
  assert.equal(await page.evaluate(()=>localStorage.getItem("__fp_uncertain_tracks")),"1");
  await page.reload();
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("ENROLLED",{exact:true}).waitFor();
  assert.equal(await page.locator("#conversion-button").isDisabled(),true,"uncertain flush must not clear the durable reservation");
  await page.locator("#conversion-button").evaluate(button=>button.dispatchEvent(new MouseEvent("click",{bubbles:true})));
  assert.equal(await page.evaluate(()=>localStorage.getItem("__fp_uncertain_tracks")),"1","uncertain delivery must not be retried for the same identity");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("IndexedDB reservation prevents duplicate conversion attempts across two tabs and permits a new identity",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});const context=await browser.newContext();
 const sdkCalls=[];
 try{
  await context.exposeBinding("__recordFlagpilotSdkCall",(_source,call)=>{sdkCalls.push(call);});
  await context.addInitScript(()=>{
   window.flagsmith={
    async init(){},
    async identify(identity){window.__flagpilotIdentity=identity;},
    getExperimentFlag(){return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};},
    trackEvent(name){return window.__recordFlagpilotSdkCall({kind:"trackEvent",name,identity:window.__flagpilotIdentity});},
    flushEvents(){return window.__recordFlagpilotSdkCall({kind:"flushEvents",identity:window.__flagpilotIdentity});}
   };
  });
  await context.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  const first=await context.newPage(),second=await context.newPage();
  await first.goto(new URL("store.html",url).href);
  let identity=await first.evaluate(()=>localStorage.getItem("flagpilot-demo-identity-v1"));
  assert.ok(identity,"the first visitor must be persisted on initial load");
  await second.goto(new URL("store.html",url).href);
  assert.equal(await second.evaluate(()=>localStorage.getItem("flagpilot-demo-identity-v1")),identity,"both tabs must share the same persisted identity");
  for(const page of [first,second]){
   await page.locator("#environment-key").fill("public-development-sdk-key");
   await page.locator("#connect-form button[type=submit]").click();
   await page.getByText("ENROLLED",{exact:true}).waitFor();
  }
  const waitForTerminal=page=>page.waitForFunction(()=>{
   const value=document.querySelector("#result-event")?.textContent;
   return value==="SDK flush completed"||value==="Already attempted for this identity"||
     value==="Persistent safety reservation failed"||value==="Delivery uncertain · do not retry";
  });
  for(let round=0;round<5;round++){
   if(round>0){
    const previousIdentity=identity;
    await first.locator("#new-visitor").click();
    await first.waitForFunction(previous=>document.querySelector("#identity-value")?.textContent!==previous&&
      document.querySelector("#connection-badge")?.textContent==="ENROLLED",previousIdentity);
    identity=await first.evaluate(()=>localStorage.getItem("flagpilot-demo-identity-v1"));
    await second.reload();
    await second.locator("#connect-form button[type=submit]").click();
    await second.getByText("ENROLLED",{exact:true}).waitFor();
    assert.equal(await second.evaluate(()=>localStorage.getItem("flagpilot-demo-identity-v1")),identity);
   }
   const before=sdkCalls.length;
   await Promise.all([first.locator("#conversion-button").click(),second.locator("#conversion-button").click()]);
   await Promise.all([waitForTerminal(first),waitForTerminal(second)]);
   const records=sdkCalls.slice(before);
   const tracked=records.filter(call=>call.kind==="trackEvent");
   const flushed=records.filter(call=>call.kind==="flushEvents");
   assert.equal(tracked.length,1,`round ${round+1}: exactly one SDK conversion may be sent for the shared identity`);
   assert.equal(flushed.length,1,`round ${round+1}: exactly one SDK flush must follow the conversion`);
   assert.equal(tracked[0].name,"demo_signup_completed");
   assert.equal(tracked[0].identity,identity);
   assert.equal(flushed[0].identity,identity);
  }
  assert.equal(sdkCalls.filter(call=>call.kind==="trackEvent").length,5,"five new identities must result in five SDK conversion calls total");
  assert.equal(new Set(sdkCalls.filter(call=>call.kind==="trackEvent").map(call=>call.identity)).size,5,"each SDK conversion must use a distinct identity");
 }finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("controlled store demo never sends a conversion for an identity outside the experiment",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.__flagpilotSdkCalls=[];
   window.flagsmith={async init(){},async identify(){},getExperimentFlag(){return{enabled:true,value:"Start free trial",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:false}};},trackEvent(name){window.__flagpilotSdkCalls.push(name);},async flushEvents(){}};
  });
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  await page.locator("#environment-key").fill("public-development-sdk-key");
  await page.locator("#connect-form button[type=submit]").click();
  await page.locator("#connection-badge").waitFor();
  assert.equal(await page.locator("#connection-badge").innerText(),"CONNECTED · NOT ENROLLED");
  assert.match(await page.locator("#result-exposure").innerText(),/Not enrolled · FlagPilot signup button test \(#596\)/);
  assert.match(await page.locator("#conversion-status").innerText(),/Confirm the experiment is running/);
  assert.equal(await page.locator("#conversion-button").isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.__flagpilotSdkCalls),[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("legacy saved event names cannot override the fixed demo metric or the event sent to Flagsmith",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   localStorage.setItem("flagpilot-demo-config-v1",JSON.stringify({
    environmentKey:"public-development-sdk-key",
    featureName:"fp_signup_button_label_8d4d6f",
    controlLabel:"Start free trial",
    eventName:"checkout_completed"
   }));
   window.__flagpilotSdkCalls=[];
   window.flagsmith={
    async init(){},
    async identify(){},
    getExperimentFlag(){return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};},
    trackEvent(name,options){window.__flagpilotSdkCalls.push([name,options]);},
    async flushEvents(){}
   };
  });
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  assert.equal(await page.locator("#event-name").inputValue(),"demo_signup_completed","legacy saved event name must not appear as the active metric");
  assert.equal(await page.locator("#event-name").isEditable(),false);
  assert.equal(await page.locator("#feature-name").inputValue(),"fp_signup_button_label_8d4d6f","other saved settings should still restore");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("ENROLLED",{exact:true}).waitFor();
  assert.equal(await page.locator("#connection-badge").innerText(),"ENROLLED");
  const savedConfig=await page.evaluate(()=>JSON.parse(localStorage.getItem("flagpilot-demo-config-v1")));
  assert.equal(savedConfig.eventName,"demo_signup_completed","connecting must overwrite the legacy event name with the fixed metric");
  await page.locator("#conversion-button").click();
  await page.getByText("One synthetic conversion attempt 'demo_signup_completed' was flushed").waitFor();
  const tracked=await page.evaluate(()=>window.__flagpilotSdkCalls);
  assert.deepEqual(tracked,[["demo_signup_completed",{metadata:{source:"flagpilot_demo",synthetic:true}}]],"the exact event shown in the UI must be the event actually tracked");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("rejects hidden Unicode in the Environment Key before calling the Flagsmith SDK",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{window.__initCalls=0;window.flagsmith={async init(){window.__initCalls++;},async identify(){},getExperimentFlag(){return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};}};});
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  await page.locator("#environment-key").fill("public-sdk-key-"+String.fromCharCode(0x200B)+"-hidden");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText(/Environment Key contains whitespace, hidden characters or non-ASCII text/).waitFor();
  assert.equal(await page.evaluate(()=>window.__initCalls),0,"invalid key must be rejected before an HTTP header is set");
  assert.equal(await page.locator("#connection-badge").innerText(),"ERROR");
  assert.equal(await page.locator("#conversion-button").isDisabled(),true);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("passes a clean printable-ASCII client key unchanged to Flagsmith",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{window.__initOptions=null;window.flagsmith={async init(options){window.__initOptions=options;},async identify(){},getExperimentFlag(){return{enabled:true,value:"Try it free",experiment:{id:596,name:"FlagPilot signup button test",inExperiment:true}};}};});
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  const validKey="client-side-KEY_1234567890-._~+/=";
  await page.locator("#environment-key").fill(validKey);
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("ENROLLED",{exact:true}).waitFor();
  const options=await page.evaluate(()=>({environmentID:window.__initOptions.environmentID,enableEvents:window.__initOptions.enableEvents,onErrorType:typeof window.__initOptions.onError}));
  assert.deepEqual(options,{environmentID:validKey,enableEvents:true,onErrorType:"function"});
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("surfaces Flagsmith SDK onError diagnostics in the connection panel",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{window.flagsmith={async init(options){options.onError(new Error("Flagsmith API rejected the Environment Key (HTTP 401)."));throw new Error("Flagsmith API rejected the Environment Key (HTTP 401).");},async identify(){},getExperimentFlag(){return null;}};});
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  await page.locator("#environment-key").fill("client-side-KEY_1234567890");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText(/Flagsmith API rejected the Environment Key/).waitFor();
  assert.equal(await page.locator("#connection-badge").innerText(),"ERROR");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("distinguishes an enabled feature with no active experiment metadata from an unenrolled identity",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.flagsmith={async init(){},async identify(){},getExperimentFlag(){return{enabled:true,value:"control"};},trackEvent(){throw new Error("must not track without enrolment");},async flushEvents(){}};
  });
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  await page.locator("#environment-key").fill("public-development-sdk-key");
  await page.locator("#connect-form button[type=submit]").click();
  await page.locator("#connection-badge").waitFor();
  assert.equal(await page.locator("#connection-badge").innerText(),"NO ACTIVE EXPERIMENT");
  assert.equal(await page.locator("#result-exposure").innerText(),"No experiment metadata returned");
  assert.match(await page.locator("#conversion-status").innerText(),/may still be a draft\/not running/);
  assert.equal(await page.locator("#conversion-button").isDisabled(),true);
  assert.equal(await page.locator("#new-visitor").isDisabled(),true,"new visitor cannot fix a missing or draft experiment");
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
test("fails closed for malformed experiment metadata even when inExperiment is true",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const invalidExperiments=[
   {inExperiment:true},
   {id:0,name:"Zero ID experiment",inExperiment:true},
   {id:"596",name:"String ID experiment",inExperiment:true},
   {id:596,name:"   ",inExperiment:true}
  ];
  for(const experiment of invalidExperiments){
   const page=await browser.newPage();
   await page.addInitScript(({experiment})=>{
    window.flagsmith={async init(){},async identify(){},getExperimentFlag(){return{enabled:true,value:"Try it free",experiment};},trackEvent(){throw new Error("must not track without valid experiment metadata");},async flushEvents(){}};
   },{experiment});
   await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
   await page.goto(new URL("store.html",url).href);
   await page.locator("#environment-key").fill("public-development-sdk-key");
   await page.locator("#connect-form button[type=submit]").click();
   await page.locator("#connection-badge").waitFor();
   assert.equal(await page.locator("#connection-badge").innerText(),"NO ACTIVE EXPERIMENT");
   assert.equal(await page.locator("#conversion-button").isDisabled(),true);
   await page.close();
  }
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("dashboard displays and submits a real protected Environment approval in FlagPilot",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();let approvalBody=null,approvalRecorded=false;
  await page.addInitScript(()=>sessionStorage.setItem("flagpilot-gh-token","fake-token"));
  await page.route("https://api.github.com/**",async route=>{
   const request=route.request(),path=new URL(request.url()).pathname;
   if(path==="/repos/Your-high-lord/flagpilot-flagsmith-agent"){await route.fulfill({status:200,contentType:"application/json",body:"{}"});return;}
   if(path==="/repos/Your-high-lord/flagpilot-flagsmith-agent/actions/runs"&&request.method()==="GET"){await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({workflow_runs:[{id:12345,run_number:77,name:"FlagPilot · Promote approved PR review to experiment",path:".github/workflows/promote-pr-review.yml",head_branch:"main",status:"in_progress",conclusion:null,created_at:"2026-11-27T01:00:00Z"}]})});return;}
   if(path.endsWith("/actions/runs/12345/pending_deployments")&&request.method()==="GET"){await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(approvalRecorded?[]:[{environment:{id:777,name:"flagsmith-create"},current_user_can_approve:true}])});return;}
   if(path.endsWith("/actions/runs/12345/jobs")&&request.method()==="GET"){await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({jobs:[{name:"Create Flagsmith draft after human approval",status:"waiting",steps:[]}]})});return;}
   if(path.endsWith("/actions/runs/12345/pending_deployments")&&request.method()==="POST"){approvalBody=request.postDataJSON();approvalRecorded=true;await route.fulfill({status:200,contentType:"application/json",body:"[]"});return;}
   await route.fulfill({status:404,body:"not found"});
  });
  await page.goto(url);
  await page.getByRole("button",{name:"Approve flagsmith-create"}).waitFor();
  await page.getByRole("button",{name:"Approve flagsmith-create"}).click();
  await page.getByText("Approval recorded").waitFor();
  assert.deepEqual(approvalBody,{environment_ids:[777],state:"approved",comment:"Approved in FlagPilot after reviewing the experiment proposal and target configuration."});
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
