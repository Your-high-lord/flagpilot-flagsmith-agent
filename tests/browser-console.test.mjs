import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,extname} from "node:path";
import {chromium} from "playwright";
const root=resolve("demo");
const report={
 pullRequest:{url:"https://github.com/example/app/pull/12",title:"Example checkout change",changedFiles:["src/checkout.ts"],reportedChangedFileCount:1,truncated:false,headSha:"a".repeat(40),baseSha:"b".repeat(40)},
 review:{verdict:"ready_for_experiment",changeSummary:"A button label changed.",experimentOpportunity:"Test the copy.",hypothesis:"Clearer copy increases completed checkout.",flag:{name:"checkout_copy",purpose:"Choose checkout copy.",safeDefault:"control"},variants:[{key:"control",label:"Continue",allocation:50},{key:"treatment",label:"Review order",allocation:50}],metric:{name:"Checkout complete",eventName:"checkout_completed",trigger:"Successful checkout.",instrumentation:"present"},instrumentationPlan:{status:"verified",eventName:"checkout_completed",trigger:"Checkout success.",properties:[],recommendation:"Reuse event."},implementationPlan:{status:"manual_review_required",summary:"Manual review.",steps:[],tests:[],patch:"",patchNote:"Manual review."},codeTargets:[{file:"src/checkout.ts",reason:"Button.",suggestedChange:"Use a flag."}],risks:[],approvalQuestions:[],manualStepsSaved:1,nextStep:"Review."},
 instrumentationEvidence:{status:"verified_call_found",eventName:"checkout_completed",sourceSha:"a".repeat(40),scannedFiles:1,failedFiles:[],eventLiteralFound:true,trackingCallFound:true,matches:[{file:"src/checkout.ts",line:20,api:"trackevent"}],note:"Source match only."},
 createdAt:"2026-11-27T00:00:00.000Z",workflowRunUrl:"https://github.com/Your-high-lord/flagpilot-flagsmith-agent/actions/runs/12345"
};
test("dashboard loads, renders review, and parses the source run ID without browser errors",async()=>{
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,"http://localhost").pathname;
  if(path==="/reports/latest.json"){res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(report));return;}
  const file=path==="/"?"index.html":path.slice(1);
  try{const data=await readFile(resolve(root,file));const type=extname(file)===".js"?"text/javascript":extname(file)===".css"?"text/css":"text/html";res.writeHead(200,{"content-type":type});res.end(data);}catch{res.writeHead(404);res.end("not found");}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();assert.ok(address&&typeof address==="object");
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${address.port}/index.html`);
  await page.getByText("Example checkout change").waitFor();
  assert.equal(await page.locator("#review-run-id").inputValue(),"12345");
  assert.equal(await page.locator("#report-verdict").innerText(),"ready for experiment");
  assert.equal(await page.locator("#delivery-verified").count(),1);
  await page.locator("#pr-url").fill("https://github.com/example/app/pull/12");
  await page.locator("#pr-form button").click();
  await page.getByText("Connect GitHub first. The PR review request has not been sent.").waitFor();
  assert.deepEqual(errors,[]);
 }finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
 }
});
