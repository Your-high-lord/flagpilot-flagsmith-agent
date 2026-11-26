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
const prepared=prepareProposalFromReview(report,{reviewRunId,repositoryFullName:repository,rolloutPercentage,timeframeDays});
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
