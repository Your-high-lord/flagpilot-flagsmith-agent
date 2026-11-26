import {readFile} from "node:fs/promises";
import {validateProvisioningArtifact} from "../domain/provisioning-artifact.js";

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
const path=required("PROVISION_RESULT_PATH");
const artifact=JSON.parse(await readFile(path,"utf8")) as unknown;
const verified=validateProvisioningArtifact(artifact,{
  projectId:positiveInteger("FLAGSMITH_PROJECT_ID"),
  environmentKey:required("FLAGSMITH_ENVIRONMENT_KEY"),
  experimentId:positiveInteger("EXPERIMENT_ID")
});
console.log([
  "Verified successful provisioning evidence.",
  "Experiment: "+verified.result.experiment.name+" (ID "+verified.result.experiment.id+")",
  "Feature: "+verified.result.feature.name+" (ID "+verified.result.feature.id+")",
  "Metric: "+verified.result.metric.name+" / "+verified.result.metric.eventName,
  "Target environment and project match the current repository configuration.",
  "No Flagsmith write was performed."
].join("\n"));
