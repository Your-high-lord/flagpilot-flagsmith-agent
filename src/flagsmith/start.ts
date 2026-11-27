import {FlagsmithApi,isRecord} from "./api.js";

export interface StartExperimentOptions {
  /** Allowed pre-start states for this specific caller. */
  allowedStatuses?:readonly string[];
}

export async function startExperiment(
  api:FlagsmithApi,
  id:number,
  options:StartExperimentOptions={}
):Promise<Record<string,unknown>> {
  if(!Number.isSafeInteger(id)||id<=0)throw new Error("Experiment ID must be a positive safe integer.");
  // This is deliberately the final live read immediately before the write. Callers
  // handling a newly provisioned draft must pass ["created","draft"].
  const before=await api.getExperiment(id);
  if(!isRecord(before))throw new Error("Could not read experiment immediately before starting.");
  const previous=String(before.status??"unknown").toLowerCase();
  const allowed=options.allowedStatuses??["draft","created","stopped","paused"];
  if(!allowed.includes(previous)) {
    throw new Error(`Experiment is in '${previous}' state. Allowed pre-start states: ${allowed.join(", ")}. Refusing to start.`);
  }
  await api.startExperiment(id);
  const after=await api.getExperiment(id);
  if(!isRecord(after))throw new Error("Start request accepted but status could not be verified.");
  const status=String(after.status??"unknown").toLowerCase();
  if(status!=="running"&&status!=="active")throw new Error(`Experiment start was not verified. Flagsmith reports '${status}'.`);
  return{id,status,alreadyRunning:false};
}
