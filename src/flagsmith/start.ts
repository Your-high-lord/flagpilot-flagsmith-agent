import {FlagsmithApi,isRecord} from "./api.js";
export async function startExperiment(api:FlagsmithApi,id:number):Promise<Record<string,unknown>>{
 const before=await api.getExperiment(id);if(!isRecord(before))throw new Error("Could not read experiment before starting.");
 const previous=String(before.status??"unknown").toLowerCase();if(previous==="running"||previous==="active")return{id,status:previous,alreadyRunning:true};
 if(!["draft","stopped","created","paused"].includes(previous))throw new Error(`Experiment is in '${previous}' state. Refusing to start automatically.`);
 await api.startExperiment(id);const after=await api.getExperiment(id);if(!isRecord(after))throw new Error("Start request accepted but status could not be verified.");
 const status=String(after.status??"unknown").toLowerCase();if(status!=="running"&&status!=="active")throw new Error(`Experiment start was not verified. Flagsmith reports '${status}'.`);
 return{id,status,alreadyRunning:false};
}