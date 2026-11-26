export interface InstrumentationSourceMatch {
  file: string;
  line: number;
  api: string;
}
export interface InstrumentationSourceEvidence {
  status: "verified_call_found" | "event_literal_only" | "not_found" | "incomplete";
  eventName: string;
  sourceSha: string;
  scannedFiles: number;
  failedFiles: string[];
  eventLiteralFound: boolean;
  trackingCallFound: boolean;
  matches: InstrumentationSourceMatch[];
  note: string;
}
export function scanInstrumentationEvidence(input:{
  eventName:string;
  sourceSha:string;
  files:Record<string,string>;
  failedFiles?:string[];
}):InstrumentationSourceEvidence {
  const eventName=input.eventName.trim();
  if(!eventName||eventName.length>64)throw new Error("Instrumentation event name must contain between 1 and 64 characters.");
  if(!/^[0-9a-f]{40}$/i.test(input.sourceSha))throw new Error("Instrumentation source SHA must be a 40-character Git commit SHA.");
  const failedFiles=[...(input.failedFiles??[])];
  const escaped=eventName.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const literalPattern=new RegExp("(['\\\"\\x60])"+escaped+"\\1","g");
  const callPattern=new RegExp("(?:[A-Za-z_$][\\w$]*\\s*\\.\\s*)?(trackEvent|track|capture|logEvent|recordEvent|sendEvent)\\s*\\(\\s*(['\\\"\\x60])"+escaped+"\\2","gi");
  const matches:InstrumentationSourceMatch[]=[];
  let eventLiteralFound=false;
  let trackingCallFound=false;
  for(const [file,source] of Object.entries(input.files)){
    if(typeof source!=="string")continue;
    for(const _ of source.matchAll(literalPattern))eventLiteralFound=true;
    for(const match of source.matchAll(callPattern)){
      trackingCallFound=true;
      const offset=match.index??0;
      const line=source.slice(0,offset).split("\n").length;
      matches.push({file,line,api:(match[1]??"unknown").toLowerCase()});
      if(matches.length>=20)break;
    }
    if(matches.length>=20)break;
  }
  const complete=failedFiles.length===0&&Object.keys(input.files).length>0;
  const status:InstrumentationSourceEvidence["status"]=!complete
    ?"incomplete"
    :trackingCallFound
      ?"verified_call_found"
      :eventLiteralFound
        ?"event_literal_only"
        :"not_found";
  const note=status==="verified_call_found"
    ?"A known tracking-call pattern passes the exact event-name literal in a changed source file at the reviewed PR head. This is code evidence only; it does not prove that an event reached Flagsmith or the warehouse."
    :status==="event_literal_only"
      ?"The event-name literal exists in scanned source, but no supported tracking-call pattern was found around it."
      :status==="not_found"
        ?"The exact event-name literal and a supported tracking call were not found in the scanned changed source files."
        :"The source scan was incomplete. No instrumentation verification can be claimed.";
  return{status,eventName,sourceSha:input.sourceSha,scannedFiles:Object.keys(input.files).length,failedFiles,eventLiteralFound,trackingCallFound,matches,note};
}
