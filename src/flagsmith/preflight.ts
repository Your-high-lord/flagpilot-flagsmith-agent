import {asList,isRecord} from "./api.js";
export interface PreflightApi{warehouseConnections():Promise<unknown>;experimentMetrics():Promise<unknown>;experiments():Promise<unknown>}
export interface PreflightReport{warehouseStatus:string;warehouseConnected:boolean;connectionCount:number;metricsReadable:boolean;experimentsReadable:boolean;note:string;diagnostics:string[]}
async function canRead(label:string,call:()=>Promise<unknown>,diagnostics:string[]):Promise<boolean>{try{await call();diagnostics.push(`${label}: readable`);return true;}catch(e){const m=e instanceof Error?e.message:String(e);diagnostics.push(`${label}: unavailable (${m.slice(0,300)})`);return false;}}
export async function runPreflight(api:PreflightApi):Promise<PreflightReport>{
 const diagnostics:string[]=[];let raw:unknown;
 try{raw=await api.warehouseConnections();}catch(e){const m=e instanceof Error?e.message:String(e);return{warehouseStatus:"unavailable",warehouseConnected:false,connectionCount:0,metricsReadable:false,experimentsReadable:false,note:`Could not read the environment warehouse. Check environment key and Management API permissions. ${m.slice(0,300)}`,diagnostics:[`Warehouse endpoint unavailable: ${m.slice(0,300)}`]};}
 const connections=asList(raw);if(!connections.length&&isRecord(raw)&&typeof raw.status==="string")connections.push(raw);
 const statuses=connections.map(c=>String(c.status??"unknown").toLowerCase());const connected=connections.length>0&&statuses.every(s=>s==="connected");const status=connections.length?statuses.join(", "):"missing";
 diagnostics.push(connections.length?`Warehouse status: ${status}`:"No warehouse connection returned.");
 const metricsReadable=await canRead("Experiment metrics endpoint",()=>api.experimentMetrics(),diagnostics);
 const experimentsReadable=await canRead("Experiments endpoint",()=>api.experiments(),diagnostics);
 const ready=connected&&metricsReadable&&experimentsReadable;
 const note=!connections.length?"No warehouse connection is configured. Stop before creating resources.":!connected?"Warehouse is not Connected yet. Pending Connection may take time after the first event; rerun preflight later.":!metricsReadable||!experimentsReadable?"Experimentation endpoints are unavailable. Ask Toggle Wars support to unblock access; do not attempt writes.":"Warehouse and experimentation read endpoints are ready. Provisioning can proceed after approval.";
 return{warehouseStatus:status,warehouseConnected:ready,connectionCount:connections.length,metricsReadable,experimentsReadable,note,diagnostics};
}