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
  assert.equal(await page.locator("#delivery-verified").count(),1);
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
  await page.getByRole("button",{name:"Connect GitHub"}).click();
  await page.locator("#token").fill("github_pat_test_only");
  await page.locator("#save-token").click();
  await page.locator("#delivery-verified").check();await page.locator("#promote-confirm").check();
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
  await page.locator("#delivery-verified").check();await page.locator("#promote-confirm").check();
  await page.locator("#promote-form button").click();
  await page.getByText(/Not eligible:/).waitFor();
  assert.equal(dispatchCount,0);
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
