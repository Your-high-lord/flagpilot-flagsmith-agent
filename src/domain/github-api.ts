export interface GitHubRequestOptions {
  method?: string;
  headers?: Record<string,string>;
  body?: string;
}
export type FetchLike=(input:string|URL|Request,init?:RequestInit)=>Promise<Response>;
export type SleepLike=(milliseconds:number)=>Promise<void>;
export class GitHubApiError extends Error {
  constructor(
    message:string,
    readonly status:number,
    readonly resource:string,
    readonly retryable:boolean
  ){super(message);this.name="GitHubApiError";}
}
const API_ORIGIN="https://api.github.com";
const RETRYABLE_STATUS=new Set([408,425,429,500,502,503,504]);
const MAX_ATTEMPTS=3;
const MAX_RETRY_DELAY_MS=15_000;
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function retryDelay(response:Response,attempt:number):number{
  const retryAfter=response.headers.get("retry-after");
  if(retryAfter){
    const seconds=Number(retryAfter);
    if(Number.isFinite(seconds)&&seconds>=0)return Math.min(seconds*1000,MAX_RETRY_DELAY_MS);
    const date=Date.parse(retryAfter);
    if(Number.isFinite(date))return Math.min(Math.max(0,date-Date.now()),MAX_RETRY_DELAY_MS);
  }
  const reset=Number(response.headers.get("x-ratelimit-reset"));
  if(response.headers.get("x-ratelimit-remaining")==="0"&&Number.isFinite(reset)&&reset>0)
    return Math.min(Math.max(0,reset*1000-Date.now()),MAX_RETRY_DELAY_MS);
  return Math.min(500*2**(attempt-1),4000);
}
function isRateLimit(response:Response,body:string):boolean{
  return response.status===429||
    (response.status===403&&(
      response.headers.get("x-ratelimit-remaining")==="0"||
      /rate.?limit|secondary rate limit|abuse detection/i.test(body)
    ));
}
function safeResource(url:URL):string{return url.pathname+url.search;}
export function createGitHubApiClient(
  token:string,
  fetchImpl:FetchLike=fetch,
  sleepImpl:SleepLike=sleep
){
  if(!token.trim())throw new Error("GITHUB_TOKEN is required for GitHub API access. Configure the workflow's read-only GITHUB_TOKEN permission.");
  return async function githubGet<T>(input:string,options:GitHubRequestOptions={}):Promise<T>{
    let url:URL;
    try{url=new URL(input);}catch{throw new Error("GitHub API URL is invalid.");}
    if(url.origin!==API_ORIGIN)throw new Error("GitHub API credentials may only be sent to https://api.github.com.");
    if(!url.pathname.startsWith("/repos/"))throw new Error("Only GitHub repository API endpoints are permitted.");
    const resource=safeResource(url);
    for(let attempt=1;attempt<=MAX_ATTEMPTS;attempt++){
      let response:Response;
      try{
        response=await fetchImpl(url.toString(),{
          method:options.method??"GET",
          headers:{
            Accept:"application/vnd.github+json",
            Authorization:"Bearer "+token,
            "User-Agent":"FlagPilot-PR-Experiment-Agent",
            "X-GitHub-Api-Version":"2022-11-28",
            ...(options.headers??{})
          },
          body:options.body,
          signal:AbortSignal.timeout(20_000),
          redirect:"error"
        });
      }catch(error){
        if(attempt===MAX_ATTEMPTS){
          const detail=error instanceof Error?error.message:"unknown network error";
          throw new Error(`GitHub API network request failed after ${MAX_ATTEMPTS} attempts for ${resource}: ${detail}`);
        }
        await sleepImpl(Math.min(500*2**(attempt-1),4000));
        continue;
      }
      if(response.ok)return await response.json() as T;
      const body=(await response.text()).slice(0,800);
      const rateLimited=isRateLimit(response,body);
      const retryable=rateLimited||RETRYABLE_STATUS.has(response.status);
      if(retryable&&attempt<MAX_ATTEMPTS){
        await sleepImpl(retryDelay(response,attempt));
        continue;
      }
      if(rateLimited){
        throw new GitHubApiError(
          `GitHub API rate limit blocked ${resource} after ${attempt} attempts. ${body||"Wait for the rate-limit window to reset and retry."}`,
          response.status,resource,true
        );
      }
      if(response.status===401||response.status===403){
        throw new GitHubApiError(
          `GitHub API denied ${resource} with HTTP ${response.status}. Check that GITHUB_TOKEN is present and the workflow grants the required read permission (pull-requests: read for PR metadata/files). GitHub response: ${body}`,
          response.status,resource,false
        );
      }
      throw new GitHubApiError(
        `GitHub API returned HTTP ${response.status} for ${resource}: ${body||response.statusText}`,
        response.status,resource,retryable
      );
    }
    throw new Error("GitHub API request ended unexpectedly.");
  };
}
export async function fetchPublicSourceFile(
  input:string,
  fetchImpl:FetchLike=fetch
):Promise<string>{
  let url:URL;
  try{url=new URL(input);}catch{throw new Error("Source URL is invalid.");}
  if(url.origin!=="https://raw.githubusercontent.com")throw new Error("Source file retrieval is restricted to raw.githubusercontent.com.");
  const response=await fetchImpl(url.toString(),{headers:{"User-Agent":"FlagPilot-PR-Experiment-Agent"},signal:AbortSignal.timeout(20_000),redirect:"error"});
  if(!response.ok)throw new Error(`Public source fetch returned HTTP ${response.status} for ${url.pathname}.`);
  return response.text();
}
