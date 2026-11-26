import {parsePullRequestUrl,validatePrReview,type PrReview} from "./pr-review.js";
import {validateProposal,withDeterministicNames,type ExperimentProposal} from "./proposal.js";
import type {InstrumentationSourceEvidence} from "./instrumentation-evidence.js";

const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==="object"&&value!==null&&!Array.isArray(value);
function positiveInteger(value:number,name:string,min:number,max:number):number{
  if(!Number.isInteger(value)||value<min||value>max)throw new Error(`${name} must be a whole number between ${min} and ${max}.`);
  return value;
}
export interface PrReviewPromotionOptions{
  reviewRunId:number;
  repositoryFullName:string;
  rolloutPercentage:number;
  timeframeDays:number;
  currentHeadSha:string;
  currentBaseSha:string;
  sourceEvidence:InstrumentationSourceEvidence;
}
export interface PreparedPrProposal{
  proposal:ExperimentProposal;
  source:{
    pullRequestUrl:string;
    pullRequestTitle:string;
    reviewRunId:number;
    verdict:"ready_for_experiment";
    instrumentationStatus:"source_call_found";
    sourceHeadSha:string;
    sourceBaseSha:string;
    sourceEvidence:InstrumentationSourceEvidence;
    implementationStatus:PrReview["implementationPlan"]["status"];
    manualStepsSaved:number;
  };
}
export function prepareProposalFromReview(value:unknown,options:PrReviewPromotionOptions):PreparedPrProposal{
  if(!isRecord(value)||!isRecord(value.pullRequest))throw new Error("The PR review artifact is missing pullRequest metadata.");
  const runId=positiveInteger(options.reviewRunId,"reviewRunId",1,Number.MAX_SAFE_INTEGER);
  const rolloutPercentage=positiveInteger(options.rolloutPercentage,"rolloutPercentage",1,100);
  const timeframeDays=positiveInteger(options.timeframeDays,"timeframeDays",1,90);
  const repository=options.repositoryFullName.trim();
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))throw new Error("repositoryFullName must use owner/repository format.");
  if(typeof value.pullRequest.url!=="string")throw new Error("The PR review artifact is missing the source pull request URL.");
  const pullRequest=parsePullRequestUrl(value.pullRequest.url);
  if(!Array.isArray(value.pullRequest.changedFiles)||!value.pullRequest.changedFiles.every(x=>typeof x==="string"))throw new Error("The PR review artifact has an invalid changed-file list.");
  const changedFiles=value.pullRequest.changedFiles as string[];
  if(!changedFiles.length)throw new Error("The PR review has no changed files.");
  if(typeof value.pullRequest.title!=="string"||!value.pullRequest.title.trim())throw new Error("The PR review artifact is missing the pull request title.");
  if(typeof value.workflowRunUrl!=="string")throw new Error("The PR review artifact is missing its originating GitHub Actions run URL.");
  let sourceRunUrl:URL;
  try{sourceRunUrl=new URL(value.workflowRunUrl);}catch{throw new Error("The originating review workflow URL is invalid.");}
  const expectedPath=`/${repository}/actions/runs/${runId}`;
  if(sourceRunUrl.protocol!=="https:"||sourceRunUrl.hostname!=="github.com"||sourceRunUrl.pathname!==expectedPath||sourceRunUrl.search||sourceRunUrl.hash)throw new Error("The review artifact does not belong to the selected successful run in this repository.");
  if(value.pullRequest.truncated!==false)throw new Error("FlagPilot refused promotion: the source review diff was truncated or its completeness is unknown. Run a fresh complete review.");
  if(typeof value.pullRequest.reportedChangedFileCount!=="number"||value.pullRequest.reportedChangedFileCount!==changedFiles.length)throw new Error("FlagPilot refused promotion: the reviewed changed-file count is incomplete.");
  const headSha=value.pullRequest.headSha,baseSha=value.pullRequest.baseSha;
  if(typeof headSha!=="string"||!/^[0-9a-f]{40}$/i.test(headSha)||typeof baseSha!=="string"||!/^[0-9a-f]{40}$/i.test(baseSha))throw new Error("FlagPilot refused promotion: the report is missing valid source head/base commit SHAs.");
  if(options.currentHeadSha!==headSha||options.currentBaseSha!==baseSha)throw new Error("FlagPilot refused promotion: the pull request changed after review. Run a fresh review against the current head and base commits.");
  const evidence=options.sourceEvidence;
  const rawReview=isRecord(value.review)?value.review:{};
  const rawMetric=isRecord(rawReview.metric)?rawReview.metric:{};
  if(evidence.status!=="tracking_call_found"||evidence.eventName!==rawMetric.eventName||evidence.sourceSha!==headSha||evidence.failedFiles.length>0||evidence.matches.length===0)throw new Error("FlagPilot refused promotion: deterministic source evidence did not find the exact metric event passed to a supported tracking call at the reviewed head commit.");
  const review=validatePrReview(value.review,changedFiles);
  if(review.verdict!=="ready_for_experiment")throw new Error(`FlagPilot refused provisioning: the AI verdict is '${review.verdict}'. Only ready_for_experiment reviews can be promoted.`);
  if(review.metric.instrumentation!=="present"||review.instrumentationPlan.status!=="verified")throw new Error("FlagPilot refused provisioning: the metric event must be present in Gemini's review and the instrumentation plan must be verified; deterministic source evidence is checked independently.");
  if(review.codeTargets.length===0)throw new Error("FlagPilot refused provisioning: the review did not identify a concrete changed code location.");
  if(review.implementationPlan.status==="not_applicable")throw new Error("FlagPilot refused provisioning: the AI marked implementation as not applicable.");
  const title=value.pullRequest.title.trim().replace(/\s+/g," ").slice(0,75);
  const rawProposal={
    experimentName:`PR #${pullRequest.number}: ${title}`.slice(0,100),
    featureName:review.flag.name,
    hypothesis:review.hypothesis,
    timeframeDays,
    targetAudience:"all",
    rolloutPercentage,
    controlLabel:review.variants[0]!.label,
    treatment:{
      key:review.variants[1]!.key,
      value:review.variants[1]!.label,
      allocation:review.variants[1]!.allocation
    },
    metric:{name:review.metric.name,eventName:review.metric.eventName}
  };
  const proposal=withDeterministicNames(validateProposal(rawProposal),pullRequest.url);
  return{
    proposal,
    source:{
      pullRequestUrl:pullRequest.url,
      pullRequestTitle:title,
      reviewRunId:runId,
      verdict:"ready_for_experiment",
      instrumentationStatus:"source_call_found",
      sourceHeadSha:headSha,
      sourceBaseSha:baseSha,
      sourceEvidence:evidence,
      implementationStatus:review.implementationPlan.status,
      manualStepsSaved:review.manualStepsSaved
    }
  };
}
