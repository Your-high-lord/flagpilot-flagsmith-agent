import {createHash} from "node:crypto";
export interface ExperimentProposal {
  experimentName: string; featureName: string; hypothesis: string; timeframeDays: number;
  targetAudience: "all"; rolloutPercentage: number; controlLabel: string;
  treatment: { key: string; value: string; allocation: number };
  metric: { name: string; eventName: string };
}
export class ProposalValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ProposalValidationError"; }
}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function requiredString(v: unknown, name: string, max: number): string {
  if (typeof v !== "string") throw new ProposalValidationError(`${name} must be text.`);
  const s=v.trim(); if (!s) throw new ProposalValidationError(`${name} is required.`);
  if (s.length>max) throw new ProposalValidationError(`${name} must be ${max} characters or fewer.`); return s;
}
function integer(v: unknown,name:string,min:number,max:number):number {
  if(typeof v!=="number"||!Number.isInteger(v)||v<min||v>max) throw new ProposalValidationError(`${name} must be a whole number between ${min} and ${max}.`);
  return v;
}
export function validateProposal(v: unknown): ExperimentProposal {
  if(!isRecord(v)) throw new ProposalValidationError("The AI response must be a JSON object.");
  const allowed=new Set(["experimentName","featureName","hypothesis","timeframeDays","targetAudience","rolloutPercentage","controlLabel","treatment","metric"]);
  const extras=Object.keys(v).filter(k=>!allowed.has(k)); if(extras.length) throw new ProposalValidationError(`Unexpected fields: ${extras.join(", ")}.`);
  const experimentName=requiredString(v.experimentName,"experimentName",100);
  const rawFeature=requiredString(v.featureName,"featureName",60);
  if(!/^[a-z][a-z0-9_]*$/.test(rawFeature)) throw new ProposalValidationError("featureName must use lowercase letters, numbers and underscores, and start with a letter.");
  const featureName=rawFeature.startsWith("fp_")?rawFeature:`fp_${rawFeature}`;
  const hypothesis=requiredString(v.hypothesis,"hypothesis",500);
  const timeframeDays=integer(v.timeframeDays,"timeframeDays",1,90);
  if(v.targetAudience!=="all") throw new ProposalValidationError("This first version supports the all-users audience only. Do not invent segment targeting.");
  const rolloutPercentage=integer(v.rolloutPercentage,"rolloutPercentage",1,100);
  const controlLabel=requiredString(v.controlLabel,"controlLabel",120);
  if(!isRecord(v.treatment)) throw new ProposalValidationError("treatment must be an object.");
  const key=requiredString(v.treatment.key,"treatment.key",40);
  if(!/^[a-z][a-z0-9_]*$/.test(key)||key==="control") throw new ProposalValidationError("treatment.key must be a unique lowercase key; 'control' is reserved.");
  const treatmentValue=requiredString(v.treatment.value,"treatment.value",120);
  if(treatmentValue==="control"||treatmentValue===controlLabel) throw new ProposalValidationError("The treatment value must differ from the control label/value.");
  const allocation=integer(v.treatment.allocation,"treatment.allocation",1,99);
  if(!isRecord(v.metric)) throw new ProposalValidationError("metric must be an object.");
  const metricName=requiredString(v.metric.name,"metric.name",100);
  const eventName=requiredString(v.metric.eventName,"metric.eventName",64);
  if(eventName.startsWith("$")) throw new ProposalValidationError("Metric event names beginning with '$' are reserved by Flagsmith.");
  if(!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(eventName)) throw new ProposalValidationError("metric.eventName contains unsupported characters.");
  return {experimentName,featureName,hypothesis,timeframeDays,targetAudience:"all",rolloutPercentage,controlLabel,treatment:{key,value:treatmentValue,allocation},metric:{name:metricName,eventName}};
}
export function withDeterministicNames(p:ExperimentProposal,request:string,version=""):ExperimentProposal {
  const identity=JSON.stringify([request,version]);
  const suffix=createHash("sha256").update(identity).digest("hex").slice(0,10);
  const featureBase=p.featureName.replace(/^fp_/,"").slice(0,45).replace(/_+$/g,"");
  const experimentPrefix="FlagPilot: ";
  const experimentSuffix=" ("+suffix+")";
  const experimentBase=p.experimentName.slice(0,100-experimentPrefix.length-experimentSuffix.length);
  const metricPrefix="FP ";
  const metricSuffix=" "+suffix;
  const metricBase=p.metric.name.slice(0,100-metricPrefix.length-metricSuffix.length);
  return {
    ...p,
    featureName:"fp_"+featureBase+"_"+suffix,
    experimentName:experimentPrefix+experimentBase+experimentSuffix,
    metric:{...p.metric,name:metricPrefix+metricBase+metricSuffix}
  };
}
