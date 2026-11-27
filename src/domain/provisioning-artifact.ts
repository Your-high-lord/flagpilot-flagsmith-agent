import {validateProposal,type ExperimentProposal} from "./proposal.js";
import {isRecord} from "../flagsmith/api.js";

export interface ValidatedProvisioningArtifact {
  target:{projectId:number;environmentKey:string};
  proposal:ExperimentProposal;
  result:{
    feature:{id:number;name:string};
    treatment:{id:number;key:string;value:string;allocation:number};
    metric:{id:number;name:string;eventName:string};
    experiment:{id:number;name:string;status:string};
  };
  createdAt:string;
}
function positiveId(value:unknown,label:string):number {
  if(typeof value!=="number"||!Number.isSafeInteger(value)||value<=0)throw new Error("Provisioning artifact has an invalid "+label+".");
  return value;
}
export function validateProvisioningArtifact(
  value:unknown,
  expected:{projectId:number;environmentKey:string;experimentId:number}
):ValidatedProvisioningArtifact {
  if(!isRecord(value)||!isRecord(value.target)||!isRecord(value.result))throw new Error("The selected run does not contain a complete FlagPilot provisioning artifact.");
  const target=value.target;
  if(target.projectId!==expected.projectId)throw new Error("Provisioning artifact belongs to a different Flagsmith project.");
  if(target.environmentKey!==expected.environmentKey)throw new Error("Provisioning artifact belongs to a different Flagsmith environment.");
  if(!isRecord(value.result.feature)||!isRecord(value.result.treatment)||!isRecord(value.result.metric)||!isRecord(value.result.experiment))throw new Error("Provisioning artifact is missing feature, treatment, metric or experiment evidence.");
  const proposal=validateProposal(value.proposal);
  const feature=value.result.feature,treatment=value.result.treatment,metric=value.result.metric,experiment=value.result.experiment;
  const featureId=positiveId(feature.id,"feature ID");
  positiveId(treatment.id,"treatment variation ID");
  positiveId(metric.id,"metric ID");
  const experimentId=positiveId(experiment.id,"experiment ID");
  if(experimentId!==expected.experimentId)throw new Error("The supplied experiment ID does not match the selected successful provisioning run.");
  if(feature.name!==proposal.featureName||experiment.name!==proposal.experimentName)throw new Error("Provisioning artifact resource names do not match its validated proposal.");
  if(treatment.key!==proposal.treatment.key||treatment.value!==proposal.treatment.value||treatment.allocation!==proposal.treatment.allocation)throw new Error("Provisioning artifact treatment does not match its validated proposal.");
  if(metric.name!==proposal.metric.name||metric.eventName!==proposal.metric.eventName)throw new Error("Provisioning artifact metric does not match its validated proposal.");
  if(typeof experiment.status!=="string"||!["created","draft"].includes(experiment.status.toLowerCase()))throw new Error("Only a newly provisioned draft experiment can be started through this workflow.");
  if(typeof value.createdAt!=="string"||!Number.isFinite(Date.parse(value.createdAt)))throw new Error("Provisioning artifact is missing a valid creation timestamp.");
  return {
    target:{projectId:expected.projectId,environmentKey:expected.environmentKey},
    proposal,
    result:{
      feature:{id:featureId,name:String(feature.name)},
      treatment:{id:Number(treatment.id),key:String(treatment.key),value:String(treatment.value),allocation:Number(treatment.allocation)},
      metric:{id:Number(metric.id),name:String(metric.name),eventName:String(metric.eventName)},
      experiment:{id:experimentId,name:String(experiment.name),status:String(experiment.status)}
    },
    createdAt:value.createdAt
  };
}
