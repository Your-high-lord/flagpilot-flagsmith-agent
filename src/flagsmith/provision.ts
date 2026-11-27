import {FlagsmithApi,asList,isRecord} from "./api.js";import {asNumericId,findFeature,findVariant,parseCliJson,runFlagsmith} from "./cli.js";import {validateProposal,type ExperimentProposal} from "../domain/proposal.js";import {verifyExistingExperimentConfiguration} from "../domain/experiment-reuse.js";import {verifyMetricConfiguration} from "../domain/metric-verification.js";
export interface ProvisionResult{feature:{id:number;name:string;url:string};treatment:{id:number;key:string;value:string;allocation:number};metric:{id:number;name:string;eventName:string};experiment:{id:number;name:string;status:string;url:string};reused:{feature:boolean;variant:boolean;metric:boolean;experiment:boolean}}
function requiredEnv(n:string):string{const v=process.env[n]?.trim();if(!v)throw new Error(`${n} is missing.`);return v;}
function context():string[]{return["--organisation",requiredEnv("FLAGSMITH_ORGANISATION"),"--project",requiredEnv("FLAGSMITH_PROJECT"),"--environment",requiredEnv("FLAGSMITH_ENVIRONMENT_KEY"),"--no-input","--json"];}
function findName(raw:unknown,name:string){return asList(raw).find(x=>x.name===name);}
function idOf(r:Record<string,unknown>,label:string){return asNumericId(r.id,label);}
function dashboard(project:string,env:string,kind:string,id:number){return `https://app.flagsmith.com/project/${encodeURIComponent(project)}/environment/${encodeURIComponent(env)}/${kind}/${id}`;}
function sameId(v:unknown,id:number){return Number(v)===id;}
function verifyExperiment(e:Record<string,unknown>,p:ExperimentProposal,featureId:number){const actualFeatureId=isRecord(e.feature)?e.feature.id:e.feature;if(!sameId(actualFeatureId,featureId))throw new Error("Experiment read-back points to a different feature.");if(e.name!==p.experimentName)throw new Error("Experiment read-back name differs from approved proposal.");const s=String(e.status??"").toLowerCase();if(s==="running"||s==="active")throw new Error("Experiment is already running; refusing to accept a pre-started experiment.");if(s&&!["created","draft","paused"].includes(s))throw new Error(`Unexpected experiment status '${s}'.`);}
export async function provisionExperiment(api:FlagsmithApi,p:ExperimentProposal):Promise<ProvisionResult>{
 const ctx=context(),projectId=Number(requiredEnv("FLAGSMITH_PROJECT_ID")),env=requiredEnv("FLAGSMITH_ENVIRONMENT_KEY");
 if(!Number.isSafeInteger(projectId)||projectId<=0)throw new Error("FLAGSMITH_PROJECT_ID must be a positive numeric project ID.");
 const list=parseCliJson(await runFlagsmith(["feature","list",...ctx]));
 let feature=findFeature(list,p.featureName),featureReused=Boolean(feature);
 let featureId:number,projectFeature:Record<string,unknown>;
 if(feature){
  featureId=idOf(feature,"feature");
  const raw=await api.getProjectFeature(projectId,featureId);
  if(!isRecord(raw))throw new Error("Flagsmith project feature read-back did not return an object.");
  projectFeature=raw;
  if(projectFeature.type!=="MULTIVARIATE")throw new Error("A feature with this name already exists but is not MULTIVARIATE. FlagPilot will not silently convert or overwrite an existing feature.");
 }else{
  const raw=await api.createProjectFeature(projectId,{
   name:p.featureName,
   type:"MULTIVARIATE",
   initial_value:"control",
   default_enabled:false,
   description:`FlagPilot experiment: ${p.experimentName}`
  });
  if(!isRecord(raw))throw new Error("Flagsmith did not return the created multivariate feature.");
  featureId=idOf(raw,"feature");
  const confirmed=await api.getProjectFeature(projectId,featureId);
  if(!isRecord(confirmed))throw new Error("New feature could not be verified through the Management API.");
  projectFeature=confirmed;
 }
 if(projectFeature.type!=="MULTIVARIATE")throw new Error("Feature read-back is not MULTIVARIATE; experiment creation would be rejected.");
 if(projectFeature.initial_value!=="control")throw new Error("Feature initial value is not exactly 'control'; no overwrite attempted.");
 if(projectFeature.default_enabled!==false)throw new Error("Feature must be disabled by default at project scope so the experiment cannot unintentionally expose the flag in other environments.");

 let detail=parseCliJson(await runFlagsmith(["feature","get",p.featureName,...ctx]));
 let variant=findVariant(detail,p.treatment.key),variantReused=Boolean(variant);
 if(variant){
  if(String(variant.value)!==p.treatment.value)throw new Error("Existing treatment key has a different value.");
  const defaultAllocation=variant.default_percentage_allocation??variant.weight;if(defaultAllocation===undefined||Number(defaultAllocation)!==0)throw new Error("Existing treatment key must have a verified zero default allocation; refusing reuse.");
 }else{
  const raw=await api.createFeatureVariant(projectId,featureId,{
   feature:featureId,
   type:"unicode",
   string_value:p.treatment.value,
   default_percentage_allocation:0,
   key:p.treatment.key
  });
  if(!isRecord(raw))throw new Error("Flagsmith did not return the created treatment variation.");
  if(String(raw.string_value)!==p.treatment.value||raw.key!==p.treatment.key||Number(raw.default_percentage_allocation)!==0)throw new Error("Treatment variation response did not match the approved proposal.");
  detail=parseCliJson(await runFlagsmith(["feature","get",p.featureName,...ctx]));
  variant=findVariant(detail,p.treatment.key);
 }
 if(!variant)throw new Error("Treatment variation not confirmed by CLI read-back.");
 const variantId=idOf(variant,"variation");
 if(String(variant.value)!==p.treatment.value)throw new Error("Treatment variation read-back value does not match the approved proposal.");

 const metrics=await api.experimentMetrics();let metric=findName(metrics,p.metric.name),metricReused=Boolean(metric);
 if(metric){const d=metric.definition;const event=isRecord(d)?d.event:undefined;if(event!==p.metric.eventName||metric.aggregation!=="occurrence"||metric.direction!=="up")throw new Error("Same metric name exists with mismatched configuration.");}
 else metric=await api.createMetric({name:p.metric.name,aggregation:"occurrence",direction:"up",definition:{version:1,event:p.metric.eventName}}) as Record<string,unknown>;
 const metricId=idOf(metric,"metric");const metricRead=await api.getMetric(metricId);verifyMetricConfiguration(metricRead,{id:metricId,name:p.metric.name,eventName:p.metric.eventName});
 const experiments=await api.experiments();let experiment=findName(experiments,p.experimentName),experimentReused=Boolean(experiment);
 if(experiment){const existingFeatureId=isRecord(experiment.feature)?experiment.feature.id:experiment.feature;if(!sameId(existingFeatureId,featureId))throw new Error("Experiment name exists but references a different feature.");}
 else experiment=await api.createExperiment({feature:featureId,name:p.experimentName,hypothesis:p.hypothesis,metrics:[{metric:metricId,expected_direction:"increase"}],experiment_rollout:{enabled:true,rollout_percentage:p.rolloutPercentage,feature_state_value:{type:"string",value:"control"},multivariate_feature_state_values:[{multivariate_feature_option:variantId,percentage_allocation:p.treatment.allocation}]}}) as Record<string,unknown>;
 const experimentId=idOf(experiment,"experiment");const experimentRead=await api.getExperiment(experimentId);if(!isRecord(experimentRead))throw new Error("Experiment read-back did not return an object.");verifyExperiment(experimentRead,p,featureId);verifyExistingExperimentConfiguration({experiment:experimentRead,proposal:p,featureId,treatmentOptionId:variantId,metricId});
 const linked=asList(experimentRead.metrics);const linkedMetric=linked.find(x=>sameId(x.metric,metricId));if(!linkedMetric)throw new Error("Experiment read-back does not show the requested metric attached.");
 if(linkedMetric.expected_direction!==undefined&&linkedMetric.expected_direction!=="increase")throw new Error("Experiment primary metric direction does not match.");
 return{feature:{id:featureId,name:p.featureName,url:dashboard(projectId.toString(),env,"features",featureId)},treatment:{id:variantId,key:p.treatment.key,value:p.treatment.value,allocation:p.treatment.allocation},metric:{id:metricId,name:p.metric.name,eventName:p.metric.eventName},experiment:{id:experimentId,name:p.experimentName,status:String(experimentRead.status??"created"),url:dashboard(projectId.toString(),env,"experiments",experimentId)},reused:{feature:featureReused,variant:variantReused,metric:metricReused,experiment:experimentReused}};
}
export function readProposal(v:unknown):ExperimentProposal{if(!isRecord(v)||!isRecord(v.proposal))throw new Error("Plan artifact is missing proposal.");return validateProposal(v.proposal);}
