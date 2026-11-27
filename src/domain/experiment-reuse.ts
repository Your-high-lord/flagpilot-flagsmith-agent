import type {ExperimentProposal} from "./proposal.js";
import {isRecord} from "../flagsmith/api.js";

function equalNumber(a:unknown,b:number):boolean{return typeof a==="number"&&Number.isFinite(a)&&a===b;}
function requiredRecord(value:unknown,label:string):Record<string,unknown>{
 if(!isRecord(value))throw new Error("Existing Flagsmith experiment has no readable "+label+"; refusing unsafe reuse.");
 return value;
}
export function verifyExistingExperimentConfiguration(input:{
 experiment:Record<string,unknown>;
 proposal:ExperimentProposal;
 featureId:number;
 treatmentOptionId:number;
 metricId:number;
 allowedStatuses?:string[];
}):void{
 const {experiment:e,proposal:p,featureId,treatmentOptionId,metricId}=input;
 if(e.name!==p.experimentName)throw new Error("Existing experiment name differs from the approved proposal.");
 if(e.hypothesis!==p.hypothesis)throw new Error("Existing experiment hypothesis differs from the approved proposal.");
 const status=String(e.status??"").toLowerCase();
 const allowed=input.allowedStatuses??["created"];
 if(!allowed.includes(status))throw new Error("Existing experiment status is not allowed for this operation; refusing unsafe reuse.");
 const feature=requiredRecord(e.feature,"nested feature");
 if(Number(feature.id)!==featureId)throw new Error("Existing experiment references a different feature.");
 if(feature.type!=="MULTIVARIATE"||feature.initial_value!=="control")throw new Error("Existing experiment feature type or control default does not match the approved configuration.");
 const options=Array.isArray(feature.multivariate_options)?feature.multivariate_options.filter(isRecord):[];
 const option=options.find(x=>Number(x.id)===treatmentOptionId);
 if(!option||option.key!==p.treatment.key||option.string_value!==p.treatment.value)throw new Error("Existing experiment treatment variation ID, key or value differs from the approved proposal.");
 const rollout=requiredRecord(e.experiment_rollout,"stored rollout configuration");
 if(rollout.enabled!==true)throw new Error("Existing experiment rollout is disabled.");
 if(!equalNumber(rollout.rollout_percentage,p.rolloutPercentage))throw new Error("Existing experiment rollout percentage differs from the approved proposal.");
 const control=requiredRecord(rollout.feature_state_value,"control feature state value");
 if(control.type!=="string"||control.value!=="control")throw new Error("Existing experiment control value is not the expected string 'control'.");
 if(!Array.isArray(rollout.multivariate_feature_state_values))throw new Error("Existing experiment has no readable treatment allocations.");
 const allocations=rollout.multivariate_feature_state_values.filter(isRecord);
 if(allocations.length!==1||Number(allocations[0]!.multivariate_feature_option)!==treatmentOptionId||!equalNumber(allocations[0]!.percentage_allocation,p.treatment.allocation))throw new Error("Existing experiment treatment allocation differs from the approved proposal.");
 const audience=requiredRecord(rollout.audience,"audience configuration");
 if(audience.match!=="any"||!Array.isArray(audience.segments)||audience.segments.length!==0)throw new Error("Existing experiment audience is not the approved all-identities audience.");
 if(!Array.isArray(e.metrics))throw new Error("Existing experiment has no readable metric attachments.");
 const metrics=e.metrics.filter(isRecord);
 if(metrics.length!==1)throw new Error("Existing experiment must have exactly one primary metric.");
 const metric=metrics[0]!;
 if(Number(metric.metric)!==metricId||metric.metric_name!==p.metric.name||metric.expected_direction!=="increase"||metric.direction!=="up"||metric.aggregation!=="occurrence")throw new Error("Existing experiment metric ID, name, aggregation, direction or expected direction differs from the approved proposal.");
}
