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
async function fixtureServer(reportData=report){
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(path==="/reports/latest.json"){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(reportData));return;}
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
  await page.locator("#provision-run-id").fill("45912345678");
  await page.locator("#start-experiment-id").fill("98765");
  await page.locator("#demo-verified").check();
  await page.locator("#start-form button").click();
  await page.locator("#start-notice").getByText(/Start request submitted/).waitFor();
  assert.match(await page.locator("#start-notice").textContent(),/45912345678.*98765/);
  assert.equal(dispatchBody?.inputs?.provision_run_id,"45912345678");
  assert.equal(dispatchBody?.inputs?.experiment_id,"98765");
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
    getExperimentFlag(name){window.__flagpilotSdkCalls.push(["getExperimentFlag",name]);return{enabled:true,value:"Try it free",experiment:{inExperiment:true}};},
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
  await page.getByText("ENROLLED").waitFor();
  await page.locator("#conversion-button").click();
  await page.getByText("Synthetic conversion 'demo_signup_completed' passed to Flagsmith").waitFor();
  const calls=await page.evaluate(()=>window.__flagpilotSdkCalls);
  assert.deepEqual(calls.find(call=>call[0]==="trackEvent"),["trackEvent","demo_signup_completed",{metadata:{source:"flagpilot_demo",synthetic:true}}]);
  assert.ok(calls.some(call=>call[0]==="flushEvents"));
  assert.equal(calls.filter(call=>call[0]==="trackEvent").length,1);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});

test("controlled store demo never sends a conversion for an identity outside the experiment",async()=>{
 const {server,url}=await fixtureServer();const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>{
   window.__flagpilotSdkCalls=[];
   window.flagsmith={async init(){},async identify(){},getExperimentFlag(){return{enabled:true,value:"Start free trial",experiment:{inExperiment:false}};},trackEvent(name){window.__flagpilotSdkCalls.push(name);},async flushEvents(){}};
  });
  await page.route("https://cdn.jsdelivr.net/npm/@flagsmith/flagsmith@12.5.0/index.js",route=>route.fulfill({status:200,contentType:"text/javascript",body:""}));
  await page.goto(new URL("store.html",url).href);
  await page.locator("#environment-key").fill("public-development-sdk-key");
  await page.locator("#connect-form button[type=submit]").click();
  await page.getByText("CONNECTED · NOT ENROLLED").waitFor();
  assert.equal(await page.locator("#conversion-button").isDisabled(),true);
  assert.deepEqual(await page.evaluate(()=>window.__flagpilotSdkCalls),[]);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});