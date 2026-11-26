export interface FlagsmithApiOptions{apiKey:string;apiUrl?:string;environmentKey:string}
export class FlagsmithApiError extends Error{constructor(message:string,readonly status:number,readonly path:string){super(message);this.name="FlagsmithApiError";}}
export class FlagsmithApi{
 private readonly baseUrl:string;
 constructor(private readonly options:FlagsmithApiOptions){if(!options.apiKey.trim())throw new Error("FLAGSMITH_API_KEY is required.");if(!options.environmentKey.trim())throw new Error("FLAGSMITH_ENVIRONMENT_KEY is required.");this.baseUrl=(options.apiUrl||"https://api.flagsmith.com").replace(/\/+$/,"");}
 private async request<T>(path:string,method:"GET"|"POST",body?:unknown):Promise<T>{
  const url=/^https?:\\/\\//.test(path)?path:this.baseUrl+"/api/v1/"+path.replace(/^\/+/,"");
  const headers:Record<string,string>={Authorization:"Api-Key "+this.options.apiKey,Accept:"application/json"};if(body!==undefined)headers["Content-Type"]="application/json";
  let response:Response;try{response=await fetch(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});}catch(e){throw new Error("Flagsmith "+method+" "+path+" failed before receiving a response: "+(e instanceof Error?e.message:String(e)));}
  const text=await response.text();let data:unknown=null;if(text){try{data=JSON.parse(text);}catch{data=text;}}
  if(!response.ok)throw new FlagsmithApiError("Flagsmith "+method+" "+path+" returned "+response.status+": "+(typeof data==="string"?data:JSON.stringify(data).slice(0,900)),response.status,path);
  return data as T;
 }
 get<T>(path:string):Promise<T>{return this.request(path,"GET");}
 post<T>(path:string,body:unknown):Promise<T>{return this.request(path,"POST",body);}
 async getAll(path:string):Promise<Record<string,unknown>[]>{
  let next=this.baseUrl+"/api/v1/"+path.replace(/^\/+/,"");
  const records:Record<string,unknown>[]=[];
  const seen=new Set<string>();
  for(let page=0;page<100;page++){
   const url=new URL(next);
   const base=new URL(this.baseUrl);
   if(url.protocol!==base.protocol||url.origin!==base.origin||!url.pathname.startsWith("/api/v1/"))throw new Error("Flagsmith pagination returned an unsafe next-page URL; refusing to forward credentials.");
   if(seen.has(url.href))throw new Error("Flagsmith pagination repeated a page URL; refusing an incomplete list.");
   seen.add(url.href);
   const data=await this.request<unknown>(url.href,"GET");
   if(Array.isArray(data)){records.push(...data.filter(isRecord));return records;}
   if(!isRecord(data))throw new Error("Flagsmith paginated endpoint returned an unexpected response shape.");
   if(Array.isArray(data.results))records.push(...data.results.filter(isRecord));
   else if(Array.isArray(data.data))records.push(...data.data.filter(isRecord));
   else throw new Error("Flagsmith paginated endpoint omitted its results array.");
   const following=data.next;
   if(following===null||following===undefined||following==="")return records;
   if(typeof following!=="string")throw new Error("Flagsmith pagination next link is invalid.");
   next=new URL(following,url).href;
  }
  throw new Error("Flagsmith pagination exceeded 100 pages; refusing an incomplete resource lookup.");
 }
 createProjectFeature(projectId:number,body:unknown):Promise<unknown>{return this.post("projects/"+projectId+"/features/",body);}
 getProjectFeature(projectId:number,featureId:number):Promise<unknown>{return this.get("projects/"+projectId+"/features/"+featureId+"/");}
 createFeatureVariant(projectId:number,featureId:number,body:unknown):Promise<unknown>{return this.post("projects/"+projectId+"/features/"+featureId+"/mv-options/",body);}
 private env(path:string):string{return "environments/"+encodeURIComponent(this.options.environmentKey)+"/"+path;}
 warehouseConnections():Promise<unknown>{return this.get(this.env("warehouse-connections/"));}
 experimentMetrics():Promise<unknown>{return this.getAll(this.env("experiment-metrics/"));}
 createMetric(body:unknown):Promise<unknown>{return this.post(this.env("experiment-metrics/"),body);}
 getMetric(id:number):Promise<unknown>{return this.get(this.env("experiment-metrics/"+id+"/"));}
 experiments():Promise<unknown>{return this.getAll(this.env("experiments/"));}
 createExperiment(body:unknown):Promise<unknown>{return this.post(this.env("experiments/"),body);}
 experimentMetricsForExperiment(id:number):Promise<unknown>{return this.get(this.env("experiments/"+id+"/metrics/"));}
 startExperiment(id:number):Promise<unknown>{return this.request(this.env("experiments/"+id+"/start/"),"POST");}
 getExperiment(id:number):Promise<unknown>{return this.get(this.env("experiments/"+id+"/"));}
}
export function isRecord(v:unknown):v is Record<string,unknown>{return typeof v==="object"&&v!==null&&!Array.isArray(v);}
export function asList(v:unknown):Record<string,unknown>[]{
 if(Array.isArray(v))return v.filter(isRecord);
 if(isRecord(v)){for(const k of ["results","data","items","objects","warehouse_connections","experiment_metrics","experiments","features","environments"])if(Array.isArray(v[k]))return (v[k] as unknown[]).filter(isRecord);}
 return [];
}
