import {mkdir,writeFile,appendFile} from "node:fs/promises";
import {parsePullRequestUrl} from "../domain/pr-review.js";
import {reviewPullRequest} from "../ai/pr-reviewer.js";
import {scanInstrumentationEvidence} from "../domain/instrumentation-evidence.js";
import {createGitHubApiClient,fetchPublicSourceFile,selectGitHubApiToken} from "../domain/github-api.js";

const input=process.env.PULL_REQUEST_URL?.trim();
if(!input)throw new Error("PULL_REQUEST_URL is required.");
const target=parsePullRequestUrl(input);
const workflowRepository=process.env.GITHUB_REPOSITORY?.trim();
const targetRepository=`${target.owner}/${target.repo}`;
const token=selectGitHubApiToken({
  workflowRepository,targetRepository,
  workflowToken:process.env.GITHUB_TOKEN,
  publicToken:process.env.PUBLIC_GITHUB_TOKEN
});
if(!token)console.warn("Reviewing an external public repository without credentials. GitHub's unauthenticated API rate limit is low; configure PUBLIC_GITHUB_TOKEN as a fine-grained read-only token for the target repository if rate-limited.");
const base=`https://api.github.com/repos/${target.owner}/${target.repo}/pulls/${target.number}`;
const githubGet=createGitHubApiClient(token);
type PullRequest={
  title?:string;body?:string|null;html_url?:string;state?:string;
  head?:{ref?:string;sha?:string};base?:{ref?:string;sha?:string};
  changed_files?:number;
};
type ChangedFile={filename?:string;patch?:string;status?:string;additions?:number;deletions?:number};

const pr=await githubGet<PullRequest>(base);
if(pr.state!=="open")throw new Error("This pull request is not open. Review an open PR so the base/head context is current.");
if(!pr.head?.sha||!pr.base?.sha)throw new Error("GitHub did not return both PR head and base commit SHAs.");

async function getAllFiles():Promise<ChangedFile[]>{
  const all:ChangedFile[]=[];
  for(let page=1;page<=31;page++){
    const rows=await githubGet<ChangedFile[]>(`${base}/files?per_page=100&page=${page}`);
    if(!Array.isArray(rows))throw new Error("GitHub returned an invalid changed-file page.");
    all.push(...rows);
    if(rows.length<100)return all;
  }
  throw new Error("PR changed-file pagination exceeded the safety limit of 3,100 files. Review is incomplete.");
}
const fileRows=await getAllFiles();
if(fileRows.length===0)throw new Error("GitHub returned no changed files for this pull request.");
const changedFiles=fileRows.map(file=>file.filename).filter((name):name is string=>typeof name==="string"&&name.length>0);
if(changedFiles.length!==fileRows.length||new Set(changedFiles).size!==changedFiles.length)
  throw new Error("GitHub returned missing or duplicate changed-file names; refusing an incomplete review.");
const reportedCount=pr.changed_files??changedFiles.length;
const countMismatch=fileRows.length!==reportedCount;
const rawDiff=fileRows.map(file=>[
  `FILE: ${file.filename} (${file.status??"modified"}, +${file.additions??0}/-${file.deletions??0})`,
  file.patch??"[No textual patch available for this file.]"
].join("\n\n")).join("\n\n");
const diffTruncated=rawDiff.length>36000;
const missingPatch=fileRows.some(file=>typeof file.patch!=="string");
const truncated=diffTruncated||missingPatch||countMismatch;
const diff=diffTruncated
  ?rawDiff.slice(0,36000)+"\n[DIFF TRUNCATED: review only the supplied portion; do not infer omitted changes.]"
  :rawDiff;

const sourceExtensions=/\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|swift|rb|php|cs|fs|vue|svelte)$/i;
const sourceFiles=fileRows.filter(file=>typeof file.filename==="string"&&sourceExtensions.test(file.filename));
const sourceContents:Record<string,string>={};
const failedSourceFiles:string[]=[];
const sourceScanWarnings:string[]=[];
const MAX_SOURCE_FILES=100,MAX_SOURCE_FILE_BYTES=500_000,MAX_SOURCE_BYTES=5_000_000;
let scannedSourceBytes=0;
for(const [index,file] of sourceFiles.entries()){
  const path=file.filename!;
  if(index>=MAX_SOURCE_FILES){failedSourceFiles.push(path);sourceScanWarnings.push(`${path}: source scan limit of ${MAX_SOURCE_FILES} files reached.`);continue;}
  const rawUrl=`https://raw.githubusercontent.com/${target.owner}/${target.repo}/${pr.head.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
  try{
    const body=await fetchPublicSourceFile(rawUrl);
    const bytes=Buffer.byteLength(body,"utf8");
    if(bytes>MAX_SOURCE_FILE_BYTES)throw new Error("Source file exceeds 500 KB scan limit.");
    if(scannedSourceBytes+bytes>MAX_SOURCE_BYTES)throw new Error("Total source scan exceeds 5 MB safety limit.");
    scannedSourceBytes+=bytes;
    sourceContents[path]=body;
  }catch(error){
    failedSourceFiles.push(path);
    sourceScanWarnings.push(`${path}: ${error instanceof Error?error.message:"source retrieval failed"}`);
  }
}

const review=await reviewPullRequest({
  title:pr.title??"Untitled pull request",body:pr.body??"",
  url:pr.html_url??target.url,head:pr.head.ref??"unknown",base:pr.base.ref??"unknown",
  diff,changedFiles,truncated
});
const instrumentationEvidence=scanInstrumentationEvidence({
  eventName:review.metric.eventName,sourceSha:pr.head.sha,
  files:sourceContents,failedFiles:failedSourceFiles
});
await mkdir("artifacts",{recursive:true});
await mkdir("demo/reports",{recursive:true});
const report={
  pullRequest:{
    url:target.url,title:pr.title??"",changedFiles,
    reportedChangedFileCount:reportedCount,truncated,
    headSha:pr.head.sha,baseSha:pr.base.sha
  },
  review,instrumentationEvidence,sourceScanWarnings,
  createdAt:new Date().toISOString(),
  workflowRunUrl:process.env.GITHUB_SERVER_URL&&process.env.GITHUB_REPOSITORY&&process.env.GITHUB_RUN_ID
    ?`${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    :""
};
await writeFile("artifacts/pr-review.json",JSON.stringify(report,null,2));
await writeFile("demo/reports/latest.json",JSON.stringify(report,null,2));
const lines=[
  "## FlagPilot · PR to Experiment Review",
  `**Pull request:** [${target.owner}/${target.repo} #${target.number}](${target.url})`,
  `**Files analysed:** ${changedFiles.length} / ${reportedCount}`,
  `**Completeness:** ${truncated?"INCOMPLETE — promotion is blocked":"Complete"}`,
  `**Agent verdict:** ${review.verdict}`,"",
  `### What changed\n${review.changeSummary}`,
  `### Experiment opportunity\n${review.experimentOpportunity}`,
  `### Hypothesis\n> ${review.hypothesis}`,
  `### Suggested Flagsmith setup\n- **Flag:** \`${review.flag.name}\` — ${review.flag.purpose}\n- **Control:** ${review.variants[0]!.label} (${review.variants[0]!.allocation}%)\n- **Treatment:** ${review.variants[1]!.label} (${review.variants[1]!.allocation}%)\n- **Metric:** ${review.metric.name} / \`${review.metric.eventName}\`\n- **Trigger:** ${review.metric.trigger}\n- **Instrumentation:** ${review.metric.instrumentation}`,
  "### Code locations to review",
  ...review.codeTargets.map(item=>`- \`${item.file}\` — ${item.reason} Suggested change: ${item.suggestedChange}`),
  "### Instrumentation plan",
  `- **Status:** ${review.instrumentationPlan.status}\n- **Event:** \`${review.instrumentationPlan.eventName}\`\n- **Trigger:** ${review.instrumentationPlan.trigger}\n- **Properties:** ${review.instrumentationPlan.properties.join(", ")||"None specified"}\n- **Recommendation:** ${review.instrumentationPlan.recommendation}`,
  "### Independent source evidence",
  `- **Status:** ${instrumentationEvidence.status}\n- **Files scanned:** ${instrumentationEvidence.scannedFiles}\n- **Failed files:** ${instrumentationEvidence.failedFiles.length}\n- ${instrumentationEvidence.note}`,
  ...(sourceScanWarnings.length?["### Source scan warnings",...sourceScanWarnings.map(warning=>`- ${warning}`)]:[]),
  "### Implementation plan",
  `- **Status:** ${review.implementationPlan.status}\n- **Summary:** ${review.implementationPlan.summary}\n- **Patch note:** ${review.implementationPlan.patchNote}`,
  ...review.implementationPlan.steps.map(step=>`- Step: ${step}`),
  ...review.implementationPlan.tests.map(item=>`- Test: ${item}`),
  "### Risks",...review.risks.map(item=>`- ${item}`),
  "### Human approval questions",...review.approvalQuestions.map(item=>`- [ ] ${item}`),
  `**Estimated manual steps avoided:** ${review.manualStepsSaved}`,
  `**Next step:** ${review.nextStep}`,"",
  "> This workflow is read-only. Any patch is a downloadable suggestion, not applied to the pull request. No Flagsmith resources are created or started.",""
].join("\n");
console.log(lines);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,lines);
