import {mkdir,readFile,writeFile,appendFile} from "node:fs/promises";
import {prepareProposalFromReview} from "../domain/pr-review-promotion.js";

function required(name:string):string{const value=process.env[name]?.trim();if(!value)throw new Error(`${name} is required.`);return value;}
function numeric(name:string):number{const raw=required(name);if(!/^\d+$/.test(raw))throw new Error(`${name} must be a whole number.`);const value=Number(raw);if(!Number.isSafeInteger(value))throw new Error(`${name} is outside the safe integer range.`);return value;}
const repository=required("GITHUB_REPOSITORY");
const reviewRunId=numeric("REVIEW_RUN_ID");
const rolloutPercentage=numeric("ROLLOUT_PERCENTAGE");
const timeframeDays=numeric("TIMEFRAME_DAYS");
if(process.env.CONFIRM_PROVISION!=="true")throw new Error("Explicit confirmation is required before preparing a PR-derived Flagsmith draft.");
const reportPath="artifacts/source-review/pr-review.json";
const report=JSON.parse(await readFile(reportPath,"utf8")) as unknown;
if(!report||typeof report!=="object"||Array.isArray(report))throw new Error("The downloaded PR review report is invalid.");
const record=report as Record<string,unknown>;
const pr=record.pullRequest as Record<string,unknown>|undefined;
if(!pr||typeof pr.url!=="string"||typeof pr.headSha!=="string"||typeof pr.baseSha!=="string")throw new Error("The PR review is missing immutable source commit metadata.");
const target=new URL(pr.url);
const match=target.pathname.match(/^\\/([A-Za-z0-9_.-]+)\\/([A-Za-z0-9_.-]+)\\/pull\\/([1-9][0-9]*)\\/?$/);
if(target.hostname!=="github.com"||!match||`${match[1]}/${match[2]}`.toLowerCase()!==repository.toLowerCase())throw new Error("The source PR must belong to this FlagPilot repository's configured owner/repository context only when the promotion workflow is used for an owned repository.");
const apiBase=`https://api.github.com/repos/${match[1]}/${match[2]}/pulls/${match[3]}`;
const response=await fetch(apiBase,{headers:{Accept:"application/vnd.github+json","User-Agent":"FlagPilot-PR-Experiment-Agent","X-GitHub-Api-Version":"2022-11-28",Authorization:`Bearer ${required("GITHUB_TOKEN")}`},signal:AbortSignal.timeout(20000)});
if(!response.ok)throw new Error(`Could not recheck the source pull request (HTTP ${response.status}).`);
const current=await response.json() as {state?:string;head?:{sha?:string};base?:{sha?:string}};
if(current.state!=="open"||current.head?.sha!==pr.headSha||current.base?.sha!==pr.baseSha)throw new Error("FlagPilot refused promotion: the pull request is closed or its head/base commits changed since review. Run a fresh review.");
const evidence=record.instrumentationEvidence as import("../domain/instrumentation-evidence.js").InstrumentationSourceEvidence|undefined;
if(!evidence)throw new Error("The PR review report has no deterministic instrumentation source evidence.");
const prepared=prepareProposalFromReview(report,{reviewRunId,repositoryFullName:repository,rolloutPercentage,timeframeDays,currentHeadSha:current.head.sha!,currentBaseSha:current.base.sha!,sourceEvidence:evidence});
await mkdir("artifacts",{recursive:true});
await writeFile("artifacts/plan.json",JSON.stringify({proposal:prepared.proposal,source:prepared.source,preparedAt:new Date().toISOString()},null,2));
const lines=[
"## FlagPilot · PR review approved for Flagsmith provisioning",
`- **Source PR:** [${prepared.source.pullRequestTitle}](${prepared.source.pullRequestUrl})`,
`- **Review run:** [#${prepared.source.reviewRunId}](https://github.com/${repository}/actions/runs/${prepared.source.reviewRunId})`,
`- **Feature flag:** \`${prepared.proposal.featureName}\``,
`- **Control:** ${prepared.proposal.controlLabel}`,
`- **Treatment:** ${prepared.proposal.treatment.value} (${prepared.proposal.treatment.allocation}%)`,
`- **Metric:** ${prepared.proposal.metric.name} / \`${prepared.proposal.metric.eventName}\``,
`- **Experiment rollout:** ${prepared.proposal.rolloutPercentage}% of eligible identities`,
`- **Measurement window:** ${prepared.proposal.timeframeDays} days`,
"",
"> The plan is schema-validated. No Flagsmith resources have been written yet. The next job pauses for the protected flagsmith-create approval; experiment start remains a separate approval."
].join("\n");
console.log(lines);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,lines+"\n");
