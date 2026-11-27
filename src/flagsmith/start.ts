import {FlagsmithApi,isRecord} from "./api.js";

export interface StartExperimentOptions {
  /** Allowed pre-start states for this specific caller. */
  allowedStatuses?:readonly string[];
  /** Validate the same fresh experiment read immediately before the write. */
  validateBeforeStart?:(experiment:Record<string,unknown>)=>Promise<void>|void;
  /** Revalidate the newest experiment read after all other live API checks. */
  validateFinalExperiment?:(experiment:Record<string,unknown>)=>void;
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
  const allowed=options.allowedStatuses??["created","draft"];
  if(!allowed.includes(previous)) {
    throw new Error(`Experiment is in '${previous}' state. Allowed pre-start states: ${allowed.join(", ")}. Refusing to start.`);
  }
  await options.validateBeforeStart?.(before);
  // Feature/metric checks can take additional network round-trips. Re-read the
  // experiment after them so a state change during those checks cannot slip
  // through to the start write.
  const finalExperiment=await api.getExperiment(id);
  if(!isRecord(finalExperiment))throw new Error("Could not re-read experiment immediately before starting.");
  const finalStatus=String(finalExperiment.status??"unknown").toLowerCase();
  if(!allowed.includes(finalStatus)) {
    throw new Error("Experiment changed to '"+finalStatus+"' during pre-start validation. Allowed states: "+allowed.join(", ")+". Refusing to start.");
  }
  options.validateFinalExperiment?.(finalExperiment);
  await api.startExperiment(id);
  const after=await api.getExperiment(id);
  if(!isRecord(after))throw new Error("Start request accepted but status could not be verified.");
  const status=String(after.status??"unknown").toLowerCase();
  if(status!=="running"&&status!=="active")throw new Error(`Experiment start was not verified. Flagsmith reports '${status}'.`);
  return{id,status,alreadyRunning:false};
}
