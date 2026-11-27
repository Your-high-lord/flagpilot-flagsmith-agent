import {appendFile,readFile} from "node:fs/promises";
import {FlagsmithApi,isRecord} from "../flagsmith/api.js";
import {startExperiment} from "../flagsmith/start.js";
import {verifyExistingExperimentConfiguration} from "../domain/experiment-reuse.js";
import {validateProvisioningArtifact} from "../domain/provisioning-artifact.js";
import {fetchAndVerifyLiveMetric} from "../domain/metric-verification.js";

function required(name:string):string {
  const value=process.env[name]?.trim();
  if(!value)throw new Error(name+" is required.");
  return value;
}
function positiveInteger(name:string):number {
  const raw=required(name);
  if(!/^[1-9][0-9]*$/.test(raw))throw new Error(name+" must be a positive integer.");
  const value=Number(raw);
  if(!Number.isSafeInteger(value))throw new Error(name+" is outside the safe integer range.");
  return value;
}
const apiKey=required("FLAGSMITH_API_KEY");
const environmentKey=required("FLAGSMITH_ENVIRONMENT_KEY");
const projectId=positiveInteger("FLAGSMITH_PROJECT_ID");
const id=positiveInteger("EXPERIMENT_ID");
const artifactPath=required("PROVISION_RESULT_PATH");
const raw=JSON.parse(await readFile(artifactPath,"utf8")) as unknown;
const artifact=validateProvisioningArtifact(raw,{projectId,environmentKey,experimentId:id});
const api=new FlagsmithApi({apiKey,environmentKey,...(process.env.FLAGSMITH_API_URL?{apiUrl:process.env.FLAGSMITH_API_URL}:{})});

// The helper's final live experiment read is passed through this callback.
// Validate the experiment, project-level feature and treatment immediately before
// the single start write; any drift aborts without changing Flagsmith.
const result=await startExperiment(api,id,{
  allowedStatuses:["created","draft"],
  validateBeforeStart:async experiment=>{
    const feature=await api.getProjectFeature(projectId,artifact.result.feature.id);
    if(!isRecord(feature)||Number(feature.id)!==artifact.result.feature.id||feature.name!==artifact.result.feature.name||feature.type!=="MULTIVARIATE"||feature.initial_value!=="control"||feature.default_enabled!==false) {
      throw new Error("The provisioned feature no longer matches its identity or safe project-level defaults. Refusing to start.");
    }
    const variations=Array.isArray(feature.multivariate_options)?feature.multivariate_options.filter(isRecord):[];
    const treatment=variations.find(option=>Number(option.id)===artifact.result.treatment.id);
    if(!treatment||treatment.key!==artifact.result.treatment.key||treatment.string_value!==artifact.result.treatment.value||treatment.default_percentage_allocation!==0) {
      throw new Error("The treatment variation identity, value or project-level default allocation changed after provisioning. Refusing to start.");
    }
    // Make the metric read the final live configuration read before the start write.
    // The attached metric ID in the experiment is not sufficient: the metric's
    // event definition can be edited without changing that ID or display name.
    await fetchAndVerifyLiveMetric(api,{
      id:artifact.result.metric.id,
      name:artifact.proposal.metric.name,
      eventName:artifact.proposal.metric.eventName
    });
  },
  validateFinalExperiment:experiment=>{
    verifyExistingExperimentConfiguration({
      experiment,
      proposal:artifact.proposal,
      featureId:artifact.result.feature.id,
      treatmentOptionId:artifact.result.treatment.id,
      metricId:artifact.result.metric.id,
      allowedStatuses:["created","draft"]
    });
  }
});
const summary=[
  "## FlagPilot · Verified experiment start",
  "- **Provisioning run:** "+required("PROVISION_RUN_ID"),
  "- **Experiment ID:** "+result.id,
  "- **Experiment name:** "+artifact.result.experiment.name,
  "- **Flagsmith project:** "+projectId,
  "- **Environment:** verified against provisioning artifact",
  "- **Status:** "+result.status,
  "- **Already running:** "+(result.alreadyRunning?"yes":"no"),
  "",
  "> The experiment was matched to its successful provisioning artifact and its live Flagsmith configuration was checked after the protected start approval."
].join("\n");
console.log(summary);
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,summary+"\n");
