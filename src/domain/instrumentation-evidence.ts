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
const ASSIGNMENT_OPERATORS=new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,ts.SyntaxKind.PlusEqualsToken,ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken
]);
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
function propertyName(node:ts.Expression):string|undefined{
  node=unwrap(node);
  if(ts.isPropertyAccessExpression(node))return node.name.text;
  if(ts.isElementAccessExpression(node)&&node.argumentExpression&&
    (ts.isStringLiteral(node.argumentExpression)||ts.isNoSubstitutionTemplateLiteral(node.argumentExpression)))return node.argumentExpression.text;
  return undefined;
}
function hasTrackEventMutation(sourceFile:ts.SourceFile):boolean{
  let mutated=false;
  const visit=(node:ts.Node):void=>{
    if(ts.isBinaryExpression(node)&&ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)&&
      (ts.isPropertyAccessExpression(node.left)||ts.isElementAccessExpression(node.left))&&
      propertyName(node.left)==="trackEvent")mutated=true;
    if(ts.isDeleteExpression(node)&&
      (ts.isPropertyAccessExpression(node.expression)||ts.isElementAccessExpression(node.expression))&&
      propertyName(node.expression)==="trackEvent")mutated=true;
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)){
      const receiver=unwrap(node.expression.expression),method=node.expression.name.text;
      const args=node.arguments;
      const keyArg=args[1];
      const keyIsTrackEvent=!!keyArg&&(ts.isStringLiteral(keyArg)||ts.isNoSubstitutionTemplateLiteral(keyArg))&&keyArg.text==="trackEvent";
      const globalObject=ts.isIdentifier(receiver)&&["Object","Reflect"].includes(receiver.text);
      const descriptorMapHasTrackEvent=!!keyArg&&ts.isObjectLiteralExpression(unwrap(keyArg))&&
        (unwrap(keyArg) as ts.ObjectLiteralExpression).properties.some(property=>
          (ts.isPropertyAssignment(property)||ts.isMethodDeclaration(property)||ts.isGetAccessorDeclaration(property)||ts.isSetAccessorDeclaration(property))&&
          (ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)||ts.isNumericLiteral(property.name))&&property.name.text==="trackEvent");
      if(globalObject&&(
        ((method==="defineProperty"||method==="set"||method==="deleteProperty")&&keyIsTrackEvent)||
        (method==="defineProperties"&&descriptorMapHasTrackEvent)||
        (method==="assign"&&args.slice(1).some(arg=>{
          const value=unwrap(arg);
          return ts.isObjectLiteralExpression(value)&&value.properties.some(property=>
            (ts.isPropertyAssignment(property)||ts.isMethodDeclaration(property)||ts.isGetAccessorDeclaration(property)||ts.isSetAccessorDeclaration(property))&&
            (ts.isIdentifier(property.name)||ts.isStringLiteral(property.name)||ts.isNumericLiteral(property.name))&&property.name.text==="trackEvent");
        }))
      ))mutated=true;
    }
    ts.forEachChild(node,visit);
  };
  visit(sourceFile);
  return mutated;
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
  const virtualFiles=new Map<string,{path:string;source:string}>();
  for(const [index,[path,source]] of Object.entries(input.files).entries()){
    if(!JS_TS_EXTENSION.test(path)){failedFiles.add(path);continue;}
    if(typeof source!=="string"||source.length>500_000){failedFiles.add(path);continue;}
    const ext=path.toLowerCase().split(".").pop()??"ts";
    virtualFiles.set("/__flagpilot_source__/"+index+"."+ext,{path,source});
  }

  // A declaration shim lets TypeScript check the SDK value/type distinction
  // without executing or installing the repository under review.
  const shimPath="/__flagpilot_source__/flagpilot-sdk-shim.d.ts";
  const shimSource=[
    'declare module "@flagsmith/flagsmith" {',
    '  export interface FlagsmithClient { trackEvent(event: string, opts?: unknown): unknown; }',
    '  const flagsmith: FlagsmithClient;',
    '  export default flagsmith;',
    '  export function createFlagsmithInstance(): FlagsmithClient;',
    '}',
    'declare module "*";'
  ].join("\n");
  const options:ts.CompilerOptions={
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
    moduleResolution:ts.ModuleResolutionKind.Node10,allowJs:true,checkJs:true,
    noResolve:false,skipLibCheck:true,noEmit:true,strict:false,
    allowSyntheticDefaultImports:true,types:[]
  };
  const host=ts.createCompilerHost(options);
  const originalGetSourceFile=host.getSourceFile.bind(host);
  host.getSourceFile=(fileName,languageVersion,onError,shouldCreateNewSourceFile)=>{
    if(fileName===shimPath)return ts.createSourceFile(fileName,shimSource,languageVersion,true,ts.ScriptKind.TS);
    const entry=virtualFiles.get(fileName);
    return entry?ts.createSourceFile(fileName,entry.source,languageVersion,true,scriptKind(entry.path)):originalGetSourceFile(fileName,languageVersion,onError,shouldCreateNewSourceFile);
  };
  const originalFileExists=host.fileExists.bind(host);
  host.fileExists=fileName=>fileName===shimPath||virtualFiles.has(fileName)||originalFileExists(fileName);
  const originalReadFile=host.readFile.bind(host);
  host.readFile=fileName=>fileName===shimPath?shimSource:virtualFiles.get(fileName)?.source??originalReadFile(fileName);
  const program=ts.createProgram([...virtualFiles.keys(),shimPath],options,host);
  const checker=program.getTypeChecker();
  let eventLiteralFound=false;
  let sdkMethodMutated=false;
  const matches:InstrumentationSourceMatch[]=[];

  for(const [virtualName,entry] of virtualFiles){
    const sourceFile=program.getSourceFile(virtualName);
    if(!sourceFile){failedFiles.add(entry.path);continue;}
    const syntactic=program.getSyntacticDiagnostics(sourceFile);
    const semantic=program.getSemanticDiagnostics(sourceFile);
    if(syntactic.length>0||semantic.length>0){failedFiles.add(entry.path);continue;}
    if(hasTrackEventMutation(sourceFile))sdkMethodMutated=true;

    const defaultImports=new Set<ts.Symbol>();
    const factoryImports=new Set<ts.Symbol>();
    const namespaceImports=new Set<ts.Symbol>();
    for(const statement of sourceFile.statements){
      if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)||statement.moduleSpecifier.text!==SDK_PACKAGE)continue;
      const clause=statement.importClause;
      if(!clause||clause.isTypeOnly)continue;
      if(clause.name){const symbol=checker.getSymbolAtLocation(clause.name);if(symbol)defaultImports.add(symbol);}
      const bindings=clause.namedBindings;
      if(bindings&&ts.isNamespaceImport(bindings)){
        const symbol=checker.getSymbolAtLocation(bindings.name);if(symbol)namespaceImports.add(symbol);
      }
      if(bindings&&ts.isNamedImports(bindings)){
        for(const specifier of bindings.elements){
          if(specifier.isTypeOnly)continue;
          const imported=(specifier.propertyName??specifier.name).text;
          if(imported==="createFlagsmithInstance"){
            const symbol=checker.getSymbolAtLocation(specifier.name);if(symbol)factoryImports.add(symbol);
          }
        }
      }
    }

    const symbolOf=(node:ts.Identifier)=>checker.getSymbolAtLocation(node);
    const isNamespace=(node:ts.Expression):boolean=>{
      node=unwrap(node);
      if(!ts.isIdentifier(node))return false;
      const symbol=symbolOf(node);
      return !!symbol&&namespaceImports.has(symbol);
    };
    const isFactoryCall=(node:ts.Expression):boolean=>{
      node=unwrap(node);
      if(ts.isIdentifier(node)){
        const symbol=symbolOf(node);
        return !!symbol&&factoryImports.has(symbol);
      }
      return ts.isPropertyAccessExpression(node)&&node.name.text==="createFlagsmithInstance"&&isNamespace(node.expression);
    };
    const isStandardGlobal=(node:ts.Identifier):boolean=>{
      const symbol=symbolOf(node);
      if(!symbol)return false;
      const declarations=symbol.declarations??[];
      return declarations.length>0&&declarations.every(declaration=>
        declaration.getSourceFile().isDeclarationFile&&
        (declaration.getSourceFile().fileName===shimPath||
          /(?:^|[\\/])lib\.(?:dom|es20\d\d|esnext).*\.d\.ts$/i.test(declaration.getSourceFile().fileName)));
    };
    const sdkOfClient=(node:ts.Expression,seen=new Set<ts.Symbol>()):InstrumentationSourceMatch["sdk"]|undefined=>{
      node=unwrap(node);
      if(ts.isPropertyAccessExpression(node)){
        if(node.name.text==="default"&&isNamespace(node.expression))return SDK_PACKAGE;
        if(node.name.text==="flagsmith"&&ts.isIdentifier(node.expression)&&
          ["window","globalThis"].includes(node.expression.text)&&isStandardGlobal(node.expression))return "window.flagsmith";
        return undefined;
      }
      if(ts.isCallExpression(node)&&isFactoryCall(node.expression))return SDK_PACKAGE;
      if(!ts.isIdentifier(node))return undefined;
      const symbol=symbolOf(node);
      if(!symbol||seen.has(symbol))return undefined;
      if(defaultImports.has(symbol))return SDK_PACKAGE;
      seen.add(symbol);
      for(const declaration of symbol.declarations??[]){
        if(!ts.isVariableDeclaration(declaration)||!declaration.initializer)continue;
        const declarationList=declaration.parent;
        // Only immutable const aliases are followed; let/var aliases fail closed.
        if(!ts.isVariableDeclarationList(declarationList)||(declarationList.flags&ts.NodeFlags.Const)===0)continue;
        const initializer=unwrap(declaration.initializer);
        if(ts.isCallExpression(initializer)&&isFactoryCall(initializer.expression))return SDK_PACKAGE;
        const resolved=sdkOfClient(initializer,seen);
        if(resolved)return resolved;
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

  // Conservatively invalidate all positive evidence if any inspected file mutates
  // a trackEvent property; this also protects against cross-file import aliases.
  if(sdkMethodMutated)matches.length=0;
  const failed=[...failedFiles].sort();
  const complete=failed.length===0&&virtualFiles.size>0;
  const status:InstrumentationSourceEvidence["status"]=!complete?"incomplete":matches.length?"flagsmith_sdk_call_found":eventLiteralFound?"event_literal_only":"not_found";
  const note=status==="flagsmith_sdk_call_found"
    ?"The exact case-sensitive event literal is passed to trackEvent on an SDK client imported from @flagsmith/flagsmith, created by its documented factory, or obtained from the standard browser global. Only immutable const aliases are followed and detected trackEvent mutation is rejected. This is source-code evidence only; it does not prove delivery to Flagsmith or warehouse ingestion."
    :sdkMethodMutated
      ?"A trackEvent method mutation or replacement was detected in the inspected source set. No Flagsmith instrumentation call is considered verified."
      :status==="event_literal_only"
        ?"The exact event-name literal exists in parsed source, but no supported Flagsmith SDK trackEvent call was found."
        :status==="not_found"
          ?"No exact event-name literal or supported Flagsmith SDK trackEvent call was found in the parsed JavaScript/TypeScript source."
          :"The instrumentation scan is incomplete ("+failed.length+" unsupported, unreadable, syntactically invalid or semantically invalid source file(s)). No source verification can be claimed.";
  return{status,eventName,sourceSha:input.sourceSha,scannedFiles:virtualFiles.size,failedFiles:failed,eventLiteralFound,trackingCallFound:matches.length>0,matches,note};
}
