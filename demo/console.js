(()=>{const $=id=>document.getElementById(id),REPO="Your-high-lord/flagpilot-flagsmith-agent";let token=sessionStorage.getItem("flagpilot-gh-token")||"",latestReport=null,latestProvisioning=null,refreshBusy=false,lastLiveMarkup="",monitorTimer=null,monitorGeneration=0,lastSuccessfulStartNotified=0,lastReportSignature=null,lastProposalSignature=null,lastProvisioningSignature=null,lastCreationJobsRunId=null,lastCreationJobsFetchedAt=0,lastCreationJobs=null,lastEvidenceSignature=null;const liveFeedback=$("live-feedback");const requestedReviewAt=()=>Number(sessionStorage.getItem("flagpilot-review-requested-at")||0);const form=$("plan-form"),request=$("request"),count=$("count"),notice=$("notice"),live=$("live-status");function headers(){return{Accept:"application/vnd.github+json",Authorization:"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"}}async function gh(path,options={}){if(!token)throw Error("Connect a GitHub fine-grained token first.");const r=await fetch("https://api.github.com"+path,{...options,headers:{...headers(),...(options.headers||{})}});if(!r.ok)throw Error("GitHub API "+r.status+": "+(await r.text()).slice(0,220));return r.status===204?null:r.json()}function expectedReviewIsStale(requestedAt,reportTime,reportUrl,expectedUrl){return requestedAt>0&&(!Number.isFinite(reportTime)||reportTime<requestedAt||Boolean(expectedUrl&&reportUrl!==expectedUrl));}
async function loadReport(){
 const box=$("report-content"),badge=$("report-verdict"),actions=$("report-actions");
 const expectedAt=requestedReviewAt(),expectedUrl=sessionStorage.getItem("flagpilot-review-requested-url");
 if(!expectedAt||!expectedUrl){
  const signature="no-pr-submitted-in-this-session";
  latestReport=null;
  if(lastReportSignature!==signature){
   lastReportSignature=signature;actions.hidden=true;$("review-run-id").value="";$("patch-download").hidden=true;
   badge.textContent="No current PR review";badge.className="pill";
   box.textContent="Paste a pull request URL and click Analyse this PR. Previous reports from other browser sessions are not reused or offered for promotion.";
  }
  return;
 }
 try{const r=await fetch("reports/latest.json?ts="+Date.now(),{cache:"no-store"});if(!r.ok)throw Error("No published review yet.");const d=await r.json(),v=d.review,expectedAt=requestedReviewAt(),expectedUrl=sessionStorage.getItem("flagpilot-review-requested-url"),reportTime=Date.parse(d.createdAt||"");const signature=JSON.stringify([d,expectedAt,expectedUrl]);latestReport=d;if(signature===lastReportSignature)return;lastReportSignature=signature;const staleReport=expectedAt>0&&( !Number.isFinite(reportTime)||reportTime<expectedAt||(expectedUrl&&d.pullRequest?.url!==expectedUrl));if(staleReport){latestReport=null;actions.hidden=true;$("review-run-id").value="";badge.textContent="Waiting for this report";badge.className="pill";box.textContent="A newer PR review was requested. The published report is older or belongs to a different pull request, so it is hidden and cannot be promoted. Check the latest GitHub Actions run; this request has not produced a report yet.";return}latestReport=d;if(!v)throw Error("Report format is not recognised.");badge.textContent=String(v.verdict||"review complete").replaceAll("_"," ");const pill=v.verdict==="ready_for_experiment"?"green":v.verdict==="needs_engineering_work"?"amber":"purple-pill";badge.className="pill "+pill;const list=a=>Array.isArray(a)&&a.length?a.map(x=>"<li>"+esc(x)+"</li>").join(""):"<li>None recorded.</li>";const variants=(v.variants||[]).map(x=>"<div class='report-variant'><b>"+esc(x.key)+" · "+esc(x.allocation)+"%</b><span>"+esc(x.label)+"</span></div>").join("");box.innerHTML="<div class='report-meta'><a href='"+esc(d.pullRequest.url)+"' target='_blank' rel='noreferrer'>"+esc(d.pullRequest.title||d.pullRequest.url)+" ↗</a><span>"+esc(new Date(d.createdAt).toLocaleString())+"</span></div><h3>What changed</h3><p>"+esc(v.changeSummary)+"</p><h3>Experiment opportunity</h3><p>"+esc(v.experimentOpportunity)+"</p><h3>Hypothesis</h3><blockquote>"+esc(v.hypothesis)+"</blockquote><h3>Suggested flag · "+esc(v.flag.name)+"</h3><div class='report-variants'>"+variants+"</div><h3>Metric · "+esc(v.metric.eventName)+"</h3><p>"+esc(v.metric.name)+" — "+esc(v.metric.trigger)+"</p><p><b>Instrumentation:</b> "+esc(v.metric.instrumentation)+"</p><h3>Instrumentation plan · "+esc(v.instrumentationPlan.status)+"</h3><p>"+esc(v.instrumentationPlan.recommendation)+"</p><p><b>Trigger:</b> "+esc(v.instrumentationPlan.trigger)+"</p><p><b>Properties:</b> "+esc((v.instrumentationPlan.properties||[]).join(", ")||"Not specified")+"</p><h3>Implementation plan · "+esc(v.implementationPlan.status)+"</h3><p>"+esc(v.implementationPlan.summary)+"</p><ul>"+list(v.implementationPlan.steps)+"</ul><p><b>Patch note:</b> "+esc(v.implementationPlan.patchNote)+"</p><h3>Tests to add</h3><ul>"+list(v.implementationPlan.tests)+"</ul><h3>Code locations</h3><ul>"+list((v.codeTargets||[]).map(x=>x.file+" — "+x.reason+" Suggested: "+x.suggestedChange))+"</ul><h3>Risks</h3><ul>"+list(v.risks)+"</ul><h3>Human approval questions</h3><ul>"+list(v.approvalQuestions)+"</ul><p><b>Next step:</b> "+esc(v.nextStep)+"</p><p class='report-foot'>Analysis only. This report does not edit the pull request or change Flagsmith resources.</p>";const source=d.instrumentationEvidence||{};box.innerHTML+="<h3>Independent source-code check</h3><p><b>"+esc(source.status||"not available")+"</b> — "+esc(source.note||"No source evidence recorded.")+"</p><p><b>Reviewed commit:</b> <code>"+esc(source.sourceSha||"not recorded")+"</code></p><p class='report-foot'>A source-code match is not proof of event delivery. Verify actual event ingestion separately before requesting promotion.</p>";actions.hidden=false;const run=$("report-run");run.hidden=true;if(d.workflowRunUrl){const match=d.workflowRunUrl.match(/\/actions\/runs\/(\d+)$/);if(match)$("review-run-id").value=match[1]}const patch=$("patch-download");if(v.implementationPlan.patch){patch.href="data:text/plain;charset=utf-8,"+encodeURIComponent(v.implementationPlan.patch);patch.hidden=false}else patch.hidden=true}catch(e){
  const requestedAt=requestedReviewAt(),currentTime=Date.parse(latestReport?.createdAt||"");
  const mustHide=expectedReviewIsStale(requestedAt,currentTime,latestReport?.pullRequest?.url,sessionStorage.getItem("flagpilot-review-requested-url"));
  if(mustHide||lastReportSignature===null){
   lastReportSignature="unavailable";
   latestReport=null;actions.hidden=true;$("review-run-id").value="";
   badge.textContent=mustHide?"Waiting for this report":"Waiting for report";badge.className="pill";
   box.textContent=mustHide?"A new PR review was submitted. The previous report is hidden until the fresh report for the selected PR is published.":"No published review report is available. Submit a PR review and refresh after the workflow completes.";
  }
 }}async function loadProvisioning(){
 const box=$("latest-provisioning");
 try{
  const response=await fetch("data/latest-provisioning.json?ts="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw Error("No provisioning result.");
  const data=await response.json(),a=data.artifact||{},result=a.result||{},exp=result.experiment||{},feature=result.feature||{},metric=result.metric||{},runId=Number(data.run&&data.run.id),signature=JSON.stringify(data);if(signature===lastProvisioningSignature)return;lastProvisioningSignature=signature;
  if(!Number.isSafeInteger(runId)||runId<=0||!Number.isSafeInteger(Number(exp.id))||!Number.isSafeInteger(Number(a.target&&a.target.projectId)))throw Error("Provisioning result incomplete.");
  const previousRun=latestProvisioning?.run?.id;latestProvisioning=data;if(previousRun&&Number(previousRun)!==runId){$("demo-verified").checked=false;}$("provision-run-id").value=String(runId);$("start-experiment-id").value=String(exp.id);
  $("start-form").querySelector("button[type=submit]").disabled=false;
  box.innerHTML="<b>Latest verified provisioning result</b><p>"+esc(exp.name)+" · Experiment #"+esc(exp.id)+" · "+esc(exp.status||"created")+"</p><p>Feature: <code>"+esc(feature.name||"")+"</code></p><p>Metric: <code>"+esc(metric.eventName||"")+"</code></p><p>Provisioning run #"+esc(runId)+" · Project "+esc(a.target.projectId)+"</p><small>Start approval revalidates the original artifact and live Flagsmith configuration.</small>";
  const resourceLinks=$("latest-resource-links");
  const safeUrl=value=>typeof value==="string"&&value.startsWith("https://app.flagsmith.com/")?value:null;
  const featureUrl=safeUrl(feature.url),experimentUrl=safeUrl(exp.url);
  resourceLinks.hidden=false;
  resourceLinks.innerHTML="<div class='resource'><b>Feature flag</b><code>#"+esc(result.feature?.id)+"</code><span>"+esc(feature.name||"")+"</span>"+(featureUrl?" <a href='"+esc(featureUrl)+"' target='_blank' rel='noreferrer'>Open in Flagsmith ↗</a>":"")+"</div><div class='resource'><b>Treatment variation</b><code>#"+esc(result.treatment?.id)+"</code><span>"+esc(result.treatment?.value||"")+" · "+esc(result.treatment?.key||"")+"</span></div><div class='resource'><b>Primary metric</b><code>#"+esc(metric.id)+"</code><span>"+esc(metric.name||"")+" · "+esc(metric.eventName||"")+"</span></div><div class='resource'><b>Experiment</b><code>#"+esc(exp.id)+"</code><span>"+esc(exp.name||"")+" · "+esc(exp.status||"")+"</span>"+(experimentUrl?" <a href='"+esc(experimentUrl)+"' target='_blank' rel='noreferrer'>Open in Flagsmith ↗</a>":"")+"</div>";
 }catch(e){
  if(!latestProvisioning){lastProvisioningSignature="unavailable";$("provision-run-id").value="";$("start-experiment-id").value="";$("start-form").querySelector("button[type=submit]").disabled=true;box.textContent="No current successful provisioning result is available. FlagPilot will populate these details automatically after it creates and verifies a draft. Historical experiment IDs are not selected.";}else{box.textContent="Could not refresh provisioning status; keeping the last verified result. "+e.message;}
 }
}
async function loadProposal(){
 const box=$("latest-proposal");
 try{
  const response=await fetch("data/latest-proposal.json?ts="+Date.now(),{cache:"no-store"});
  if(!response.ok)throw Error("No generated proposal is published yet.");
  const raw=await response.json(),p=raw.proposal||raw,signature=JSON.stringify(raw);if(signature===lastProposalSignature)return;lastProposalSignature=signature;
  if(!p.experimentName||!p.featureName||!p.hypothesis||!p.metric||!p.treatment)throw Error("Proposal artifact is incomplete.");
  box.innerHTML="<b>Latest AI-generated proposal · review before approval</b><p><strong>"+esc(p.experimentName)+"</strong></p><p>"+esc(p.hypothesis)+"</p><p>Feature: <code>"+esc(p.featureName)+"</code> · Rollout: "+esc(p.rolloutPercentage)+"% · Window: "+esc(p.timeframeDays)+" days</p><div class='proposal-variants'><div><b>Control</b><span>"+esc(p.controlLabel)+" · "+esc(100-p.treatment.allocation)+"%</span></div><div><b>Treatment</b><span>"+esc(p.treatment.value)+" · "+esc(p.treatment.allocation)+"%</span></div></div><p>Metric: <code>"+esc(p.metric.eventName)+"</code> · "+esc(p.metric.name)+"</p><small>Review this proposal before approving the protected Flagsmith creation step. No resource is created by displaying this proposal.</small>";
 }catch(e){if(lastProposalSignature===null){lastProposalSignature="unavailable";box.textContent="No new proposal yet. After you submit a request, the generated proposal will appear here.";} }
}
function stopMonitoring(){
 monitorGeneration++;
 if(monitorTimer){clearTimeout(monitorTimer);monitorTimer=null;}
}
function startMonitoring(){
 stopMonitoring();
 const generation=monitorGeneration;
 const tick=async()=>{
  if(generation!==monitorGeneration||!token||document.visibilityState==="hidden")return;
  await refresh();
  if(generation===monitorGeneration&&token&&document.visibilityState==="visible")monitorTimer=setTimeout(tick,12000);
 };
 void tick();
}
function setTimelineStage(id,state,title,detail,label){
 const node=$(id);if(!node)return;
 node.className=state;
 node.querySelector("b").textContent=title;
 node.querySelector("small").textContent=detail;
 node.querySelector("span").textContent=label;
}
async function updateCreationTimeline(runs){
 const candidates=runs.filter(run=>run.path===".github/workflows/plan-and-create.yml"&&run.head_branch==="main").sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
 const provisionTime=Date.parse(latestProvisioning?.run?.publishedAt||latestProvisioning?.artifact?.createdAt||"");
 const newerActive=candidates.find(run=>run.status!=="completed"&&Number.isFinite(provisionTime)&&Date.parse(run.created_at)>provisionTime);
 const latestPlan=newerActive||candidates.find(run=>String(run.id)===String(latestProvisioning?.run?.id))||candidates[0];
 if(!latestPlan){
  if(latestProvisioning){
   ["stage-plan-request","stage-plan-generated","stage-plan-published","stage-create-approval","stage-resources-created","stage-resources-verified"].forEach((id,i)=>setTimelineStage(id,"done",["Request received","Gemini plan generated","Validation & preflight","Human approval to create","Create feature, variation, metric and draft","Verify resources"][i],"Verified provisioning result is available.","Complete"));
  }
  return;
 }
 let jobs=lastCreationJobs;
 if(lastCreationJobsRunId!==latestPlan.id||Date.now()-lastCreationJobsFetchedAt>12000){
  try{
   const result=await gh("/repos/"+REPO+"/actions/runs/"+latestPlan.id+"/jobs?per_page=30");
   jobs=result.jobs||[];lastCreationJobs=jobs;lastCreationJobsRunId=latestPlan.id;lastCreationJobsFetchedAt=Date.now();
  }catch(error){
   if(!jobs)throw error;
  }
 }
 const byName=name=>jobs.find(job=>job.name===name);
 const ai=byName("AI plan (no Flagsmith writes)");
 const publish=byName("Publish validated experiment proposal in FlagPilot");
 const create=byName("Create feature, metric and draft experiment");
 const result=byName("Publish verified provisioning result to FlagPilot");
 const status=(job,successTitle,waitingTitle,failureTitle,waitingDetail)=>{
  if(!job)return{state:"",title:waitingTitle,detail:waitingDetail,label:"Pending"};
  if(job.conclusion==="success")return{state:"done",title:successTitle,detail:"Verified in workflow Run #"+latestPlan.run_number+".",label:"Passed"};
  if(job.conclusion&&job.conclusion!=="success")return{state:"failed",title:failureTitle,detail:"Workflow reported "+job.conclusion+" in Run #"+latestPlan.run_number+".",label:job.conclusion};
  if(job.status==="waiting")return{state:"wait",title:waitingTitle,detail:"Waiting for the protected environment approval in Run #"+latestPlan.run_number+".",label:"Awaiting"};
  return{state:"",title:waitingTitle,detail:waitingDetail,label:job.status||"Pending"};
 };
 const first= latestPlan.status==="completed"&&latestPlan.conclusion==="success";
 setTimelineStage("stage-plan-request", "done","Request received","Experiment request captured by Run #"+latestPlan.run_number+".","Received");
 const a=status(ai,"Gemini plan generated","Gemini planning in progress","Gemini planning failed","Waiting for the structured proposal.");
 setTimelineStage("stage-plan-generated",a.state,a.title,a.detail,a.label);
 const publishState=status(publish,"Proposal validated & published","Proposal validation and publication","Proposal publication failed","Waiting for schema validation and publication to the console.");
 const preflight=(create?.steps||[]).find(step=>/read-only Flagsmith preflight/i.test(step.name||""));
 const preflightPassed=preflight?.conclusion==="success";
 const stage3Passed=publishState.label==="Passed"&&preflightPassed;
 const stage3State=publishState.state;
 const stage3Detail=publishState.label==="Passed"?"Gemini proposal passed schema validation and was published to FlagPilot in Run #"+latestPlan.run_number+".":publishState.detail;
 setTimelineStage("stage-plan-published",stage3State,"Proposal validation & publication",stage3Detail,publishState.label);
 const c=status(create,"Flagsmith creation approved","Human approval to create","Flagsmith creation failed","Waiting for the protected flagsmith-create approval.");
 setTimelineStage("stage-create-approval",c.state,c.title,c.detail,c.label);
 const createStep=(create?.steps||[]).find(step=>step.name==="Provision real Flagsmith resources");
 const created= createStep?.conclusion==="success";
 setTimelineStage("stage-resources-created",created?"done":createStep?.conclusion&&createStep.conclusion!=="success"?"failed":create?.status==="waiting"?"wait":"",created?"Flagsmith resources created":"Read-only preflight & resource creation",created?"Read-only preflight passed; feature, treatment, metric and draft were created and read back.":"After approval, FlagPilot checks the target before creating resources.",created?"Created":createStep?.conclusion||"Pending");
 const verified=result?.conclusion==="success"||Boolean(latestProvisioning);
 setTimelineStage("stage-resources-verified",verified?"done":result?.conclusion&&result.conclusion!=="success"?"failed":"",verified?"Verify resources":"Verify resources",verified?"Management API read-back and provisioning artifact publication succeeded.":"Waiting for resource read-back and publication.",verified?"Passed":result?.conclusion||"Pending");
 if(!first&&latestProvisioning&&latestProvisioning.run?.id===latestPlan.id){
  ["stage-plan-request","stage-plan-generated","stage-plan-published","stage-create-approval","stage-resources-created","stage-resources-verified"].forEach((id,i)=>setTimelineStage(id,"done",["Request received","Gemini plan generated","Proposal validated & published","Human approval to create","Flagsmith resources created","Verify resources"][i],"Confirmed by successful provisioning Run #"+latestPlan.run_number+".","Complete"));
 }
}
function updateEvidence(runs,startRuns){
 const box=$("latest-evidence");if(!box)return;
 const ci=runs.filter(run=>run.path===".github/workflows/ci.yml"&&run.head_branch==="main").sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
 const deploy=runs.filter(run=>run.path===".github/workflows/deploy-demo.yml"&&run.head_branch==="main").sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
 const started=startRuns.find(run=>run.status==="completed"&&run.conclusion==="success");
 const pending=startRuns.find(run=>run.status!=="completed");
 const evidence={
  ci:ci?{id:ci.id,conclusion:ci.conclusion,sha:ci.head_sha}:null,
  deploy:deploy?{id:deploy.id,conclusion:deploy.conclusion}:null,
  provision:latestProvisioning?{run:latestProvisioning.run?.id,experiment:latestProvisioning.artifact?.result?.experiment?.id,feature:latestProvisioning.artifact?.result?.feature?.id,metric:latestProvisioning.artifact?.result?.metric?.id}:null,
  start:started?{id:started.id,run:started.run_number}:null,
  pending:pending?{id:pending.id,run:pending.run_number}:null
 };
 const signature=JSON.stringify(evidence);if(signature===lastEvidenceSignature)return;lastEvidenceSignature=signature;
 const row=(label,value)=>"<div class='evidence-row'><span>"+esc(label)+"</span><b>"+esc(value)+"</b></div>";
 const rows=[];
 rows.push(row("Main CI",ci?(ci.conclusion==="success"?"Passed · Run #"+ci.run_number:""+(ci.conclusion||ci.status)+" · Run #"+ci.run_number):"No run found"));
 rows.push(row("Pages deployment",deploy?(deploy.conclusion==="success"?"Published · Run #"+deploy.run_number:""+(deploy.conclusion||deploy.status)+" · Run #"+deploy.run_number):"No run found"));
 rows.push(row("Flagsmith provisioning",latestProvisioning?"Verified · Run #"+latestProvisioning.run.id:"Not yet verified"));
 if(latestProvisioning){
  rows.push(row("Experiment / Feature / Metric","#"+latestProvisioning.artifact.result.experiment.id+" / #"+latestProvisioning.artifact.result.feature.id+" / #"+latestProvisioning.artifact.result.metric.id));
 }
 rows.push(row("Experiment start",started?"Running verified · Run #"+started.run_number:pending?"Awaiting start approval · Run #"+pending.run_number:"Not started"));
 rows.push(row("Conversion delivery","Not yet verified — confirm warehouse ingestion after a synthetic enrolled conversion"));
 box.innerHTML=rows.join("");
}
function relevantStartRuns(runs){
 const since=Date.parse(latestProvisioning?.artifact?.createdAt||latestProvisioning?.run?.publishedAt||"");
 if(!Number.isFinite(since))return [];
 return runs.filter(run=>run.path===".github/workflows/start-experiment.yml"&&Date.parse(run.created_at)>=since).sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at));
}
function updateTimeline(startRuns){
 const success=startRuns.find(run=>run.status==="completed"&&run.conclusion==="success");
 const pending=startRuns.find(run=>run.status!=="completed");
 const approval=$("stage-start-approval"),result=$("stage-start-result");
 const set=(node,cls,title,detail,status)=>{
  if(!node)return;node.className=cls;node.querySelector("b").textContent=title;node.querySelector("small").textContent=detail;node.querySelector("span").textContent=status;
 };
 if(success){
  set(approval,"done","Second approval accepted","GitHub completed the protected flagsmith-start deployment (Run #"+success.run_number+").","Complete");
  set(result,"done","Experiment running","Flagsmith's live read-back confirmed experiment #"+(latestProvisioning?.artifact?.result?.experiment?.id||"")+" is running.","Running");
 }else if(pending){
  set(approval,"wait","Second approval to start","Protected flagsmith-start approval is waiting on Run #"+pending.run_number+".","Awaiting");
  set(result,"","Start & verify running status","The workflow has not completed the live start check yet.","Pending");
 }else{
  set(approval,"wait","Second approval to start","Request the start approval after confirming the Development SDK response.","Ready");
  set(result,"","Start & verify running status","Awaiting the protected start workflow and Flagsmith running-state read-back.","Pending");
 }
 return {success,pending};
}
function updateStartFormState(startRuns){
 const button=$("start-form").querySelector("button[type=submit]");
 const notice=$("start-notice");
 if(!button)return;
 if(!latestProvisioning){
  button.disabled=true;button.textContent="Waiting for verified provisioning";return;
 }
 const {success,pending}=updateTimeline(startRuns);
 if(success){
  const duplicate=pending&&Date.parse(pending.created_at)>Date.parse(success.created_at)?pending:null;
  button.disabled=true;button.textContent="Experiment already running";
  notice.textContent="Experiment #"+latestProvisioning.artifact.result.experiment.id+" was successfully started by Run #"+success.run_number+". Do not submit another start request."+(duplicate?" Duplicate Run #"+duplicate.run_number+" is still waiting for flagsmith-start approval; cancel that duplicate instead of approving it.":"");
  return;
 }
 if(pending){
  button.disabled=true;button.textContent="Start request already submitted";
  notice.textContent="A start request (Run #"+pending.run_number+") is already active. Wait for its protected approval and completion; do not submit another request.";
  return;
 }
 const key="flagpilot-start-request:"+latestProvisioning.run.id+":"+latestProvisioning.artifact.result.experiment.id;
 const requestedAt=Number(sessionStorage.getItem(key)||0);
 if(requestedAt&&Date.now()-requestedAt<5*60*1000){
  button.disabled=true;button.textContent="Start request submitted";
  notice.textContent="FlagPilot submitted the start request. Waiting for GitHub to register its workflow run. Refreshing this page will not submit another request.";
  return;
 }
 if(requestedAt)sessionStorage.removeItem(key);
 button.disabled=false;button.textContent="Request protected start approval";
}
async function refresh(){
 if(refreshBusy||!token)return;
 refreshBusy=true;
 try{
  const data=await gh("/repos/"+REPO+"/actions/runs?branch=main&per_page=50");
  const allowed=new Set([".github/workflows/ci.yml",".github/workflows/review-pull-request.yml",".github/workflows/promote-pr-review.yml",".github/workflows/plan-and-create.yml",".github/workflows/start-experiment.yml",".github/workflows/plan-only.yml",".github/workflows/setup-flagsmith.yml",".github/workflows/deploy-demo.yml"]);
  const runs=(data.workflow_runs||[]).filter(run=>allowed.has(run.path)&&run.head_branch==="main");
  const visibleRuns=runs.slice(0,15);
  await Promise.all([loadReport(),loadProposal(),loadProvisioning()]);
  await updateCreationTimeline(runs);
  const startRuns=relevantStartRuns(runs);
  const {success:successfulStart}=updateTimeline(startRuns);
  const pendingStart=startRuns.find(run=>run.status!=="completed");
  const duplicateStart=successfulStart&&pendingStart&&Date.parse(pendingStart.created_at)>Date.parse(successfulStart.created_at)?pendingStart:null;
  const cards=await Promise.all(visibleRuns.map(async run=>{
   let pending=[],jobText="";
   if(run.status!=="completed"){
    try{pending=await gh("/repos/"+REPO+"/actions/runs/"+run.id+"/pending_deployments");if(!Array.isArray(pending))pending=[];}
    catch(error){jobText="Approval status unavailable: "+error.message;}
    try{const jobs=await gh("/repos/"+REPO+"/actions/runs/"+run.id+"/jobs?per_page=20");const current=(jobs.jobs||[]).find(job=>job.status==="in_progress"||job.status==="queued"||job.status==="waiting");if(current)jobText=current.name+" · "+current.status;}
    catch(error){if(!jobText)jobText="Workflow is running";}
   }
   const label=run.path.includes("/ci.yml")?"Main CI":run.path.includes("review-pull-request")?"AI engineering review":run.path.includes("promote-pr-review")?"Create draft from PR review":run.path.includes("start-experiment")?"Start verified experiment":run.path.includes("plan-and-create")?"Plan and create experiment":run.path.includes("plan-only")?"Generate AI proposal":run.path.includes("setup-flagsmith")?"Set up Flagsmith":"Deploy FlagPilot console";
   const duplicate=duplicateStart&&run.id===duplicateStart.id;
   const state=duplicate?"Duplicate request · earlier start succeeded":run.status==="completed"?(run.conclusion==="success"?"Completed successfully":"Completed · "+String(run.conclusion||"unknown")):pending.length?"Waiting for protected approval":run.status;
   const approvals=pending.map(item=>{
    const env=item.environment||{},name=String(env.name||""),id=Number(env.id);
    if(!["flagsmith-create","flagsmith-start"].includes(name)||!Number.isSafeInteger(id))return "<p class='workflow-error'>Protected deployment pending; unsupported environment.</p>";
    if(duplicate&&name==="flagsmith-start")return "<div class='approval-inline duplicate-warning'><b>Duplicate start request</b><p>An earlier start run already verified this experiment as running. Do not approve this second request. Cancel the duplicate workflow.</p></div>";
    if(item.current_user_can_approve===true)return "<div class='approval-inline'><b>Approval required · "+esc(name)+"</b><p>This button submits a real GitHub Environment approval; it does not bypass protection.</p><button class='button primary' data-approve-run='"+esc(run.id)+"' data-environment-id='"+esc(id)+"' data-environment-name='"+esc(name)+"'>Approve "+esc(name)+"</button></div>";
    return "<div class='approval-inline'><b>Waiting for an eligible reviewer · "+esc(name)+"</b></div>";
   }).join("");
   return "<article class='workflow-card'><div class='workflow-card-head'><b>"+esc(label)+"</b><span class='workflow-state "+(run.conclusion==="success"?"ok":run.status==="completed"?"bad":duplicate?"wait":"running")+"'>"+esc(state)+"</span></div><small>Run #"+esc(run.run_number||run.id)+" · "+esc(new Date(run.created_at).toLocaleString())+"</small>"+(jobText?"<p class='workflow-current'>"+esc(jobText)+"</p>":"")+approvals+"</article>";
  }));
  const markup=cards.join("")||"No FlagPilot workflow activity found. Submit a PR analysis or experiment request above; progress will appear here.";
  if(markup!==lastLiveMarkup){live.innerHTML=markup;lastLiveMarkup=markup;}
  updateStartFormState(startRuns);
  updateEvidence(runs,startRuns);
  if(successfulStart&&successfulStart.id!==lastSuccessfulStartNotified){
   lastSuccessfulStartNotified=successfulStart.id;
   const frame=$("live-demo-frame");
   frame?.contentWindow?.postMessage({type:"flagpilot-refresh-demo"},window.location.origin);
  }
 }catch(error){
  const feedback=$("live-feedback");
  if(feedback)feedback.textContent="Refresh failed: "+error.message;
  else live.textContent="Refresh failed: "+error.message;
 }finally{refreshBusy=false;}
}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&token)startMonitoring();else if(document.visibilityState==="hidden")stopMonitoring();});
live.addEventListener("click",async event=>{
 const button=event.target.closest("[data-approve-run]");
 if(!button)return;
 const name=button.dataset.environmentName;
 if(!["flagsmith-create","flagsmith-start"].includes(name)){liveFeedback.textContent="Only FlagPilot's protected creation and start environments can be approved here.";return;}
 button.disabled=true;button.textContent="Approving…";liveFeedback.textContent="Submitting the real GitHub Environment approval…";
 try{
  await gh("/repos/"+REPO+"/actions/runs/"+button.dataset.approveRun+"/pending_deployments",{method:"POST",body:JSON.stringify({environment_ids:[Number(button.dataset.environmentId)],state:"approved",comment:"Approved in FlagPilot after reviewing the experiment proposal and target configuration."})});
  liveFeedback.textContent="GitHub accepted the approval request. Waiting for the protected workflow to continue.";
  lastLiveMarkup="";
  await refresh();
 }catch(error){
  button.disabled=false;button.textContent="Approve "+name;
  liveFeedback.textContent="Approval failed: "+error.message+". Check Actions read/write and Deployments write permissions, and confirm this account is an eligible environment reviewer.";
 }
});
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}$("pr-form").addEventListener("submit",async e=>{e.preventDefault();const value=$("pr-url").value.trim();if(!token){$("pr-notice").textContent="Connect GitHub first. The PR review request has not been sent.";return}const b=$("pr-form").querySelector("button");b.disabled=true;b.textContent="Submitting PR for analysis…";const requestedAt=Date.now();sessionStorage.setItem("flagpilot-review-requested-at",String(requestedAt));sessionStorage.setItem("flagpilot-review-requested-url",value.replace(/\/+$/,""));latestReport=null;try{await gh("/repos/"+REPO+"/actions/workflows/review-pull-request.yml/dispatches",{method:"POST",body:JSON.stringify({ref:"main",inputs:{pull_request_url:value}})});$("pr-notice").textContent="PR analysis submitted. FlagPilot is monitoring Gemini’s engineering review here. The report and any protected approval will appear in this console; you do not need to open GitHub Actions.";startMonitoring();await refresh()}catch(err){sessionStorage.removeItem("flagpilot-review-requested-at");sessionStorage.removeItem("flagpilot-review-requested-url");$("pr-notice").textContent=err.message}finally{b.disabled=false;b.textContent="✦ Analyse this PR"}});request.addEventListener("input",()=>count.textContent=request.value.length+" / 2000");count.textContent=request.value.length+" / 2000";form.addEventListener("submit",async e=>{e.preventDefault();if(!token){notice.textContent="Connect GitHub first. Your request has not been sent.";return}const b=form.querySelector("button");b.disabled=true;b.textContent="Submitting…";try{await gh("/repos/"+REPO+"/actions/workflows/plan-and-create.yml/dispatches",{method:"POST",body:JSON.stringify({ref:"main",inputs:{experiment_request:request.value.trim()}})});notice.textContent="Request submitted. FlagPilot will show the validated proposal and protected flagsmith-create approval here. You do not need to open GitHub Actions.";startMonitoring();await refresh()}catch(err){notice.textContent=err.message}finally{b.disabled=false;b.textContent="✦ Generate AI proposal"}});$("promote-form").addEventListener("submit",async e=>{e.preventDefault();if(!token){$("promote-notice").textContent="Connect GitHub first. No workflow was submitted.";return}if(!$("promotion-confirm").checked)return;const report=latestReport,review=report?.review,evidence=report?.instrumentationEvidence,metric=review?.metric;const eligible=report?.pullRequest?.truncated===false&&report.pullRequest.reportedChangedFileCount===report.pullRequest.changedFiles?.length&&/^[0-9a-f]{40}$/i.test(report.pullRequest.headSha||"")&&/^[0-9a-f]{40}$/i.test(report.pullRequest.baseSha||"")&&review?.verdict==="ready_for_experiment"&&metric?.instrumentation==="present"&&review.instrumentationPlan?.status==="verified"&&review.instrumentationPlan?.eventName===metric.eventName&&Array.isArray(review.codeTargets)&&review.codeTargets.length>0&&review.implementationPlan?.status!=="not_applicable"&&evidence?.status==="flagsmith_sdk_call_found"&&evidence.eventName===metric.eventName&&evidence.sourceSha===report.pullRequest.headSha&&Array.isArray(evidence.failedFiles)&&evidence.failedFiles.length===0&&Array.isArray(evidence.matches)&&evidence.matches.length>0;if(!eligible){$("promote-notice").textContent="Not eligible: require a complete current report, ready verdict, verified matching metric plan, changed-code location, applicable implementation, and exact Flagsmith SDK source evidence.";return}const runId=$("review-run-id").value.trim(),rollout=$("promote-rollout").value,days=$("promote-days").value;if(!/^[1-9][0-9]*$/.test(runId)||Number(rollout)<1||Number(rollout)>100||Number(days)<1||Number(days)>90){$("promote-notice").textContent="Enter a valid run ID, rollout from 1–100%, and measurement window from 1–90 days.";return}const b=$("promote-form").querySelector("button");b.disabled=true;b.textContent="Submitting protected promotion request…";try{await gh("/repos/"+REPO+"/actions/workflows/promote-pr-review.yml/dispatches",{method:"POST",body:JSON.stringify({ref:"main",inputs:{review_run_id:runId,rollout_percentage:rollout,timeframe_days:days,confirm_event_delivery:"true",confirm_provision:"true"}})});$("promote-notice").textContent="Draft-creation request submitted. FlagPilot is monitoring review verification and will show the protected flagsmith-create approval here. No experiment has been started.";startMonitoring();await refresh()}catch(err){$("promote-notice").textContent="Promotion request failed: "+err.message}finally{b.disabled=false;b.textContent="Request protected Flagsmith draft creation"}});$("refresh").addEventListener("click",async()=>{const button=$("refresh"),label=button.textContent;button.disabled=true;button.textContent="Refreshing…";try{await refresh();}finally{button.disabled=false;button.textContent=label;}});$("start-form").addEventListener("submit",async e=>{
 e.preventDefault();
 const startNotice=$("start-notice"),button=$("start-form").querySelector("button[type=submit]");
 if(!token){startNotice.textContent="Connect GitHub before requesting experiment start. No workflow was submitted.";return;}
 if(!latestProvisioning){startNotice.textContent="No verified provisioning result is available. No workflow was submitted.";return;}
 if(!$("demo-verified").checked){startNotice.textContent="Confirm the Development SDK connection and expected feature response before requesting start. Exposure and conversion delivery must be verified after the workflow reports that the experiment is running.";return;}
 const provisionRunId=$("provision-run-id").value.trim(),experimentId=$("start-experiment-id").value.trim();
 if(!/^[1-9][0-9]*$/.test(provisionRunId)||!/^[1-9][0-9]*$/.test(experimentId)){startNotice.textContent="The verified provisioning run and experiment IDs are incomplete. No workflow was submitted.";return;}
 const requestKey="flagpilot-start-request:"+provisionRunId+":"+experimentId;
 const requestedAt=Number(sessionStorage.getItem(requestKey)||0);
 if(requestedAt&&Date.now()-requestedAt<5*60*1000){startNotice.textContent="A start request was already submitted for this provisioning result. FlagPilot will not submit a duplicate.";return;}
 button.disabled=true;button.textContent="Checking existing start requests…";startNotice.textContent="Checking GitHub for an existing start request before dispatch…";
 let submitted=false;
 try{
  const data=await gh("/repos/"+REPO+"/actions/runs?branch=main&per_page=100");
  const since=Date.parse(latestProvisioning.artifact.createdAt||latestProvisioning.run.publishedAt||"");
  const existing=(data.workflow_runs||[]).filter(run=>run.path===".github/workflows/start-experiment.yml"&&run.head_branch==="main"&&Number.isFinite(since)&&Date.parse(run.created_at)>=since);
  const completed=existing.find(run=>run.status==="completed"&&run.conclusion==="success");
  const active=existing.find(run=>run.status!=="completed");
  if(completed){startNotice.textContent="Experiment #"+experimentId+" is already running (verified by start Run #"+completed.run_number+"). No second start request was sent.";button.textContent="Experiment already running";return;}
  if(active){startNotice.textContent="A start request (Run #"+active.run_number+") is already active or waiting for approval. No duplicate was submitted.";button.textContent="Start request already active";return;}
  sessionStorage.setItem(requestKey,String(Date.now()));
  await gh("/repos/"+REPO+"/actions/workflows/start-experiment.yml/dispatches",{method:"POST",body:JSON.stringify({ref:"main",inputs:{provision_run_id:provisionRunId,experiment_id:experimentId,demo_verified:"true"}})});
  submitted=true;button.textContent="Start request submitted";
  startNotice.textContent="Start request submitted. FlagPilot is monitoring the artifact check and will show the protected flagsmith-start approval here. The form will remain locked until this experiment's start result is known.";
  startMonitoring();await refresh();
 }catch(error){
  startNotice.textContent="Start request failed: "+error.message;
  button.textContent="Request protected start approval";
 }finally{
  if(!submitted)button.disabled=false;
 }
});
const liveDemoFrame=$("live-demo-frame");
window.addEventListener("message",event=>{
 if(!liveDemoFrame||event.origin!==window.location.origin||event.source!==liveDemoFrame.contentWindow||event.data?.type!=="flagpilot-store-height")return;
 const height=Number(event.data.height);
 if(Number.isFinite(height)&&height>=600&&height<=4000)liveDemoFrame.style.height=Math.ceil(height)+"px";
});
const connect=document.createElement("button");connect.className="button ghost";connect.textContent=token?"GitHub connected":"Connect GitHub";document.querySelector(".top-actions").prepend(connect);connect.addEventListener("click",()=>{$("token").value="";$("token-dialog").showModal()});$("token-form").addEventListener("submit",async e=>{e.preventDefault();token=$("token").value.trim();try{const me=await gh("/repos/"+REPO);sessionStorage.setItem("flagpilot-gh-token",token);$("token-dialog").close();connect.textContent="GitHub connected";notice.textContent="GitHub connected in this browser tab. FlagPilot can submit workflows, monitor progress and present eligible protected approvals here.";await refresh();startMonitoring()}catch(err){token="";sessionStorage.removeItem("flagpilot-gh-token");notice.textContent="GitHub connection failed: "+err.message}});loadReport();loadProposal();loadProvisioning();if(token){connect.textContent="GitHub connected";refresh();startMonitoring()}})();