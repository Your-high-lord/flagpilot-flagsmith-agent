import ts from "typescript";

export interface InstrumentationSourceMatch {
  file: string;
  line: number;
  api: "trackEvent";
  sdk: "@flagsmith/flagsmith" | "window.flagsmith";
  receiver: string;
}
export interface InstrumentationSourceEvidence {
  status: "flagsmith_sdk_call_found" | "event_literal_only" | "not_found" | "incomplete";
  eventName: string;
  sourceSha: string;
  scannedFiles: number;
  failedFiles: string[];
  eventLiteralFound: boolean;
  trackingCallFound: boolean;
  matches: InstrumentationSourceMatch[];
  note: string;
}
const SDK_PACKAGE="@flagsmith/flagsmith";
const JS_TS_EXTENSION=/\.(?:[cm]?[jt]sx?)$/i;
function unwrap(node:ts.Expression):ts.Expression{
  while(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isTypeAssertionExpression(node)||ts.isNonNullExpression(node)||ts.isSatisfiesExpression(node))node=node.expression;
  return node;
}
function scriptKind(file:string):ts.ScriptKind{
  const ext=file.toLowerCase().split(".").pop();
  if(ext==="tsx")return ts.ScriptKind.TSX;
  if(ext==="jsx")return ts.ScriptKind.JSX;
  if(ext==="js"||ext==="mjs"||ext==="cjs")return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
export function scanInstrumentationEvidence(input:{
  eventName:string;
  sourceSha:string;
  files:Record<string,string>;
  failedFiles?:string[];
}):InstrumentationSourceEvidence{
  const eventName=input.eventName.trim();
  if(!eventName||eventName.length>64)throw new Error("Instrumentation event name must contain between 1 and 64 characters.");
  if(!/^[0-9a-f]{40}$/i.test(input.sourceSha))throw new Error("Instrumentation source SHA must be a 40-character Git commit SHA.");
  const failedFiles=new Set(input.failedFiles??[]);
  const entries=Object.entries(input.files);
  const virtualFiles=new Map<string,{path:string;source:string}>();
  entries.forEach(([path,source],index)=>{
    if(!JS_TS_EXTENSION.test(path)){failedFiles.add(path);return;}
    if(typeof source!=="string"||source.length>500_000){failedFiles.add(path);return;}
    const ext=path.toLowerCase().split(".").pop()??"ts";
    virtualFiles.set("/__flagpilot_source__/"+index+"."+ext,{path,source});
  });
  const options:ts.CompilerOptions={target:ts.ScriptTarget.ES2022,allowJs:true,checkJs:false,noResolve:true,noLib:true,skipLibCheck:true};
  const host=ts.createCompilerHost(options);
  const originalGetSourceFile=host.getSourceFile.bind(host);
  host.getSourceFile=(fileName,languageVersion,onError,shouldCreateNewSourceFile)=>{
    const entry=virtualFiles.get(fileName);
    return entry?ts.createSourceFile(fileName,entry.source,languageVersion,true,scriptKind(entry.path)):originalGetSourceFile(fileName,languageVersion,onError,shouldCreateNewSourceFile);
  };
  const originalFileExists=host.fileExists.bind(host);
  host.fileExists=fileName=>virtualFiles.has(fileName)||originalFileExists(fileName);
  const originalReadFile=host.readFile.bind(host);
  host.readFile=fileName=>virtualFiles.get(fileName)?.source??originalReadFile(fileName);
  const rootNames=[...virtualFiles.keys()];
  const program=rootNames.length?ts.createProgram(rootNames,options,host):undefined;
  const checker=program?.getTypeChecker();
  let eventLiteralFound=false;
  const matches:InstrumentationSourceMatch[]=[];
  for(const [virtualName,entry] of virtualFiles){
    const sourceFile=program?.getSourceFile(virtualName);
    if(!sourceFile||!checker){failedFiles.add(entry.path);continue;}
    if(program!.getSyntacticDiagnostics(sourceFile).length>0){failedFiles.add(entry.path);continue;}
    const defaultImports=new Set<ts.Symbol>();
    const factoryImports=new Set<ts.Symbol>();
    const namespaceImports=new Set<ts.Symbol>();
    for(const statement of sourceFile.statements){
      if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)||statement.moduleSpecifier.text!==SDK_PACKAGE)continue;
      const clause=statement.importClause;
      if(!clause)continue;
      if(clause.name){const symbol=checker.getSymbolAtLocation(clause.name);if(symbol)defaultImports.add(symbol);}
      const bindings=clause.namedBindings;
      if(bindings&&ts.isNamespaceImport(bindings)){const symbol=checker.getSymbolAtLocation(bindings.name);if(symbol)namespaceImports.add(symbol);}
      if(bindings&&ts.isNamedImports(bindings)){
        for(const specifier of bindings.elements){
          const imported=(specifier.propertyName??specifier.name).text;
          if(imported==="createFlagsmithInstance"){const symbol=checker.getSymbolAtLocation(specifier.name);if(symbol)factoryImports.add(symbol);}
        }
      }
    }
    const symbolOf=(node:ts.Identifier)=>checker.getSymbolAtLocation(node);
    const isNamespace=(node:ts.Expression):boolean=>{
      node=unwrap(node);
      return ts.isIdentifier(node)&&namespaceImports.has(symbolOf(node)!);
    };
    const isFactoryCall=(node:ts.Expression):boolean=>{
      node=unwrap(node);
      if(ts.isIdentifier(node))return factoryImports.has(symbolOf(node)!);
      return ts.isPropertyAccessExpression(node)&&node.name.text==="createFlagsmithInstance"&&isNamespace(node.expression);
    };
    const sdkOfClient=(node:ts.Expression,seen=new Set<ts.Symbol>()):InstrumentationSourceMatch["sdk"]|undefined=>{
      node=unwrap(node);
      if(ts.isPropertyAccessExpression(node)){
        if(node.name.text==="default"&&isNamespace(node.expression))return SDK_PACKAGE;
        if(node.name.text==="flagsmith"&&ts.isIdentifier(node.expression)&&["window","globalThis"].includes(node.expression.text)){
          const globalSymbol=symbolOf(node.expression);
          return !globalSymbol||!globalSymbol.declarations?.length?"window.flagsmith":undefined;
        }
        return undefined;
      }
      if(ts.isCallExpression(node)&&isFactoryCall(node.expression))return SDK_PACKAGE;
      if(!ts.isIdentifier(node))return undefined;
      const symbol=symbolOf(node);
      if(!symbol||seen.has(symbol))return undefined;
      if(defaultImports.has(symbol))return SDK_PACKAGE;
      seen.add(symbol);
      for(const declaration of symbol.declarations??[]){
        if(ts.isVariableDeclaration(declaration)&&declaration.initializer){
          const initializer=unwrap(declaration.initializer);
          if(ts.isCallExpression(initializer)&&isFactoryCall(initializer.expression))return SDK_PACKAGE;
          const resolved=sdkOfClient(initializer,seen);
          if(resolved)return resolved;
        }
      }
      return undefined;
    };
    const visit=(node:ts.Node):void=>{
      if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&node.text===eventName)eventLiteralFound=true;
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="trackEvent"&&node.arguments.length>0){
        const receiver=node.expression.expression;
        const argument=unwrap(node.arguments[0]!);
        const literal=(ts.isStringLiteral(argument)||ts.isNoSubstitutionTemplateLiteral(argument))?argument.text:undefined;
        const sdk=sdkOfClient(receiver);
        if(literal===eventName&&sdk){
          const line=sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line+1;
          matches.push({file:entry.path,line,api:"trackEvent",sdk,receiver:receiver.getText(sourceFile)});
        }
      }
      ts.forEachChild(node,visit);
    };
    visit(sourceFile);
  }
  const failed=[...failedFiles].sort();
  const complete=failed.length===0&&virtualFiles.size>0;
  const status:InstrumentationSourceEvidence["status"]=!complete?"incomplete":matches.length?"flagsmith_sdk_call_found":eventLiteralFound?"event_literal_only":"not_found";
  const note=status==="flagsmith_sdk_call_found"
    ?"The exact case-sensitive event literal is passed to trackEvent on a client imported from the official @flagsmith/flagsmith SDK or the documented window.flagsmith global. This is source-code evidence only; it does not prove delivery to Flagsmith or warehouse ingestion."
    :status==="event_literal_only"
      ?"The exact event-name literal exists in parsed source, but no supported Flagsmith SDK trackEvent call was found."
      :status==="not_found"
        ?"No exact event-name literal or supported Flagsmith SDK trackEvent call was found in the parsed JavaScript/TypeScript source."
        :"The instrumentation scan is incomplete ("+failed.length+" unsupported, unreadable or unparseable source file(s)). No source verification can be claimed.";
  return{status,eventName,sourceSha:input.sourceSha,scannedFiles:virtualFiles.size,failedFiles:failed,eventLiteralFound,trackingCallFound:matches.length>0,matches,note};
}
