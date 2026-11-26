import {mkdir,writeFile,appendFile} from "node:fs/promises";
import {parsePullRequestUrl} from "../domain/pr-review.js";
import {reviewPullRequest} from "../ai/pr-reviewer.js";
import {scanInstrumentationEvidence} from "../domain/instrumentation-evidence.js";
const input=process.env.PULL_REQUEST_URL?.trim();if(!input)throw new Error("PULL_REQUEST_URL is required.");
const target=parsePullRequestUrl(input),base=`https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}`;
const headers={Accept:"application/vnd.github+json","User-Agent":"FlagPilot-PR-Experiment-Agent","X-GitHub-Api-Version":"2022-11-28"};
async function get(url:string,accept?:string):Promise<Response>{const r=await fetch(url,{headers:{...headers,...(accept?{Accept:accept}:{})},signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`GitHub returned HTTP ${r.status} for ${url.replace(/https:\/\/api.github.com/,"")}. Only public pull requests are supported by this workflow.`);return r;}
const pr=await (await get(base)).json() as {title?:string;body?:string|null;html_url?:string;state?:string;head?:{ref?:string;sha?:string};base?:{ref?:string;sha?:string};changed_files?:number};
if(pr.state!=="open")throw new Error("This pull request is not open. Review an open PR so the base/head context is current.");
if(!pr.head?.sha||!pr.base?.sha)throw new Error("GitHub did not return both PR head and base commit SHAs.");
async function getAllFiles():Promise<Array<{filename?:string;patch?:string;status?:string;additions?:number;deletions?:number}>>{
 const all:Array<{filename?:string;patch?:string;status?:string;additions?:number;deletions?:number}>=[];
 for(let page=1;page<=30;page++){
  const response=await get(`${base}/files?per_page=100&page=${page}`);
  const rows=await response.json() as typeof all;
  if(!Array.isArray(rows))throw new Error("GitHub returned an invalid changed-file page.");
  all.push(...rows);
  if(rows.length<100)return all;
 }
 throw new Error("PR changed-file pagination exceeded the safety limit of 3,000 files. Review is incomplete.");
}
const fileRows=await getAllFiles();
if(!Array.isArray(fileRows)||fileRows.length===0)throw new Error("GitHub returned no changed files for this pull request.");
const changedFiles=fileRows.map(x=>x.filename).filter((x):x is string=>typeof x==="string");
if(changedFiles.length!==fileRows.length||new Set(changedFiles).size!==changedFiles.length)throw new Error("GitHub returned missing or duplicate changed-file names; refusing an incomplete review.");
const rawDiff=fileRows.map(x=>[`FILE: ${x.filename} (${x.status??"modified"}, +${x.additions??0}/-${x.deletions??0})`,x.patch??"[No textual patch available for this file.]"].join("\n\n")).join("\n\n");
const diffTruncated=rawDiff.length>36000;
const missingPatch=fileRows.some(x=>typeof x.patch!=="string");
const truncated=diffTruncated||missingPatch||fileRows.length!==(pr.changed_files??fileRows.length);
const diff=diffTruncated?rawDiff.slice(0,36000)+"\n[DIFF TRUNCATED: review only the supplied portion.]":rawDiff;
const sourceExtensions=/\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|fs|vue|svelte)$/i;
const sourceFiles=fileRows.filter(x=>typeof x.filename==="string"&&sourceExtensions.test(x.filename));
const sourceContents:Record<string,string>={};
const failedSourceFiles:string[]=[];
for(const file of sourceFiles){
 const path=file.filename!;
 const rawUrl=`https://raw.githubusercontent.com/${target.owner}/${target.repo}/${pr.head.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
 try{
  const response=await get(rawUrl);
  const body=await response.text();
  if(body.length>500000)throw new Error("Source file exceeds 500 KB scan limit.");
  sourceContents[path]=body;
 }catch{failedSourceFiles.push(path);}
}
const review=await reviewPullRequest({title:pr.title??"Untitled pull request",body:pr.body??"",url:pr.html_url??target.url,head:pr.head.ref??"unknown",base:pr.base.ref??"unknown",diff,changedFiles,truncated});
const instrumentationEvidence=scanInstrumentationEvidence({eventName:review.metric.eventName,sourceSha:pr.head.sha,files:sourceContents,failedFiles:failedSourceFiles});
await mkdir("artifacts",{recursive:true});await mkdir("demo/reports",{recursive:true});const report={pullRequest:{url:target.url,title:pr.title??"",changedFiles,reportedChangedFileCount:pr.changed_files??changedFiles.length,truncated,headSha:pr.head.sha,baseSha:pr.base.sha},review,instrumentationEvidence,createdAt:new Date().toISOString(),workflowRunUrl:process.env.GITHUB_SERVER_URL&&process.env.GITHUB_REPOSITORY&&process.env.GITHUB_RUN_ID?`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`:""};
await writeFile("artifacts/pr-review.json",JSON.stringify(report,null,2));await writeFile("demo/reports/latest.json",JSON.stringify(report,null,2));
const lines=["## FlagPilot · PR to Experiment Review",`**Pull request:** [${target.owner}/${target.repo} #${target.number}](${target.url})`,`**Files analysed:** ${changedFiles.length}`,`**Agent verdict:** ${review.verdict}`,"",`### What changed\n${review.changeSummary}`,`### Experiment opportunity\n${review.experimentOpportunity}`,`### Hypothesis\n> ${review.hypothesis}`,`### Suggested Flagsmith setup\n- **Flag:** \`${review.flag.name}\` — ${review.flag.purpose}\n- **Control:** ${review.variants[0]!.label} (${review.variants[0]!.allocation}%)\n- **Treatment:** ${review.variants[1]!.label} (${review.variants[1]!.allocation}%)\n- **Metric:** ${review.metric.name} / \`${review.metric.eventName}\`\n- **Trigger:** ${review.metric.trigger}\n- **Instrumentation:** ${review.metric.instrumentation}`,"### Code locations to review",...review.codeTargets.map(x=>`- \`${x.file}\` — ${x.reason} Suggested change: ${x.suggestedChange}`),"### Instrumentation plan",`- **Status:** ${review.instrumentationPlan.status}\n- **Event:** \`${review.instrumentationPlan.eventName}\`\n- **Trigger:** ${review.instrumentationPlan.trigger}\n- **Properties:** ${review.instrumentationPlan.properties.join(", ")||"None specified"}\n- **Recommendation:** ${review.instrumentationPlan.recommendation}`,"### Implementation plan",`- **Status:** ${review.implementationPlan.status}\n- **Summary:** ${review.implementationPlan.summary}\n- **Patch note:** ${review.implementationPlan.patchNote}`, ...review.implementationPlan.steps.map(x=>`- Step: ${x}`),...review.implementationPlan.tests.map(x=>`- Test: ${x}`),"### Risks",...review.risks.map(x=>`- ${x}`),"### Human approval questions",...review.approvalQuestions.map(x=>`- [ ] ${x}`),`**Estimated manual steps avoided:** ${review.manualStepsSaved}`,`**Next step:** ${review.nextStep}`,"","> This workflow is read-only. Any patch is a downloadable suggestion, not applied to the pull request. No Flagsmith resources are created or started.",""].join("\n");
console.log(lines);if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,lines);
