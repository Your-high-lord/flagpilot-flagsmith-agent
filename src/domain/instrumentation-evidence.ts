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
function propertyMayBe(node:ts.Expression|undefined,key:string):boolean{
  if(!node)return true;
  const name=propertyName(node);
  return name===undefined||name===key;
}
function objectMayContainProperty(node:ts.Expression|undefined,key:string):boolean{
  if(!node)return true;
  node=unwrap(node);
  if(!ts.isObjectLiteralExpression(node))return true;
  for(const property of node.properties){
    if(ts.isSpreadAssignment(property))return true;
    if(ts.isPropertyAssignment(property)||ts.isMethodDeclaration(property)||ts.isGetAccessorDeclaration(property)||ts.isSetAccessorDeclaration(property)){
      const name=property.name;
      if(ts.isComputedPropertyName(name)){
        const expression=unwrap(name.expression);
        if((ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression))&&expression.text===key)return true;
        if(!ts.isStringLiteral(expression)&&!ts.isNoSubstitutionTemplateLiteral(expression))return true;
      }else if((ts.isIdentifier(name)||ts.isStringLiteral(name)||ts.isNumericLiteral(name))&&name.text===key)return true;
    }else return true;
  }
  return false;
}
type ReflectionMutationMethod={api:"Object"|"Reflect";method:string};
function hasGlobalSdkReplacement(
  sourceFile:ts.SourceFile,
  isGlobalObject:(node:ts.Expression)=>boolean,
  reflectionMethod:(node:ts.Expression)=>ReflectionMutationMethod|undefined
):boolean{
  let replaced=false;
  const visit=(node:ts.Node):void=>{
    if(ts.isBinaryExpression(node)&&ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)&&
      (ts.isPropertyAccessExpression(node.left)||ts.isElementAccessExpression(node.left))&&
      propertyName(node.left)==="flagsmith"&&isGlobalObject(node.left.expression))replaced=true;
    if(ts.isDeleteExpression(node)&&
      (ts.isPropertyAccessExpression(node.expression)||ts.isElementAccessExpression(node.expression))&&
      propertyName(node.expression)==="flagsmith"&&isGlobalObject(node.expression.expression))replaced=true;
    if(ts.isCallExpression(node)){
      const resolved=reflectionMethod(node.expression),args=node.arguments,target=args[0];
      if(resolved&&target&&isGlobalObject(target)){
        const {api,method}=resolved;
        if(method==="*"||method==="setPrototypeOf")replaced=true;
        else if(api==="Object"&&method==="assign"&&args.slice(1).some(source=>objectMayContainProperty(source,"flagsmith")))replaced=true;
        else if((method==="defineProperty"||method==="set"||method==="deleteProperty")&&propertyMayBe(args[1],"flagsmith"))replaced=true;
        else if(method==="defineProperties"&&objectMayContainProperty(args[1],"flagsmith"))replaced=true;
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(sourceFile);
  return replaced;
}
function hasTrackEventMutation(
  sourceFile:ts.SourceFile,
  isSdkClient:(node:ts.Expression)=>boolean,
  reflectionMethod:(node:ts.Expression)=>ReflectionMutationMethod|undefined
):boolean{
  let mutated=false;
  const visit=(node:ts.Node):void=>{
    if(ts.isBinaryExpression(node)&&ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)&&
      (ts.isPropertyAccessExpression(node.left)||ts.isElementAccessExpression(node.left))&&
      propertyName(node.left)==="trackEvent"&&isSdkClient(node.left.expression))mutated=true;
    if(ts.isDeleteExpression(node)&&
      (ts.isPropertyAccessExpression(node.expression)||ts.isElementAccessExpression(node.expression))&&
      propertyName(node.expression)==="trackEvent"&&isSdkClient(node.expression.expression))mutated=true;
    if(ts.isCallExpression(node)){
      const resolved=reflectionMethod(node.expression),args=node.arguments,target=args[0];
      if(resolved&&target&&isSdkClient(target)){
        const {api,method}=resolved;
        if(method==="*"||method==="setPrototypeOf")mutated=true;
        else if(api==="Object"&&method==="assign"&&args.slice(1).some(source=>objectMayContainProperty(source,"trackEvent")))mutated=true;
        else if((method==="defineProperty"||method==="set"||method==="deleteProperty")&&propertyMayBe(args[1],"trackEvent"))mutated=true;
        else if(method==="defineProperties"&&objectMayContainProperty(args[1],"trackEvent"))mutated=true;
      }
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
    if(/(?:^|\/)(?:tests?|__tests__|specs?)(?:\/)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(path))continue;
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
  let sdkMethodMutated=false,globalSdkReplaced=false;
  const matches:InstrumentationSourceMatch[]=[];

  for(const [virtualName,entry] of virtualFiles){
    const sourceFile=program.getSourceFile(virtualName);
    if(!sourceFile){failedFiles.add(entry.path);continue;}
    const syntactic=program.getSyntacticDiagnostics(sourceFile);
    const semantic=program.getSemanticDiagnostics(sourceFile);
    // Fail closed on semantic errors that mean a type-only binding is used as a runtime value.
    const runtimeImportErrors=semantic.filter(diagnostic=>[1361,1362,1363,1364,1365,2588,2632,2693].includes(diagnostic.code));
    if(syntactic.length>0||runtimeImportErrors.length>0){failedFiles.add(entry.path);continue;}
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
    const literalValueOf=(node:ts.Expression,seen=new Set<ts.Symbol>()):string|undefined=>{
      node=unwrap(node);
      if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;
      if(!ts.isIdentifier(node))return undefined;
      const symbol=symbolOf(node);if(!symbol||seen.has(symbol))return undefined;seen.add(symbol);
      for(const declaration of symbol.declarations??[]){
        if(!ts.isVariableDeclaration(declaration)||!declaration.initializer)continue;
        const list=declaration.parent;
        if(!ts.isVariableDeclarationList(list)||(list.flags&ts.NodeFlags.Const)===0)continue;
        const value=literalValueOf(declaration.initializer,seen);if(value!==undefined)return value;
      }
      return undefined;
    };
    const staticallyKnownPropertyName=(node:ts.Expression):string|undefined=>{
      node=unwrap(node);
      if(ts.isPropertyAccessExpression(node))return node.name.text;
      if(ts.isElementAccessExpression(node)&&node.argumentExpression)return literalValueOf(node.argumentExpression);
      return undefined;
    };
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
          /(?:^|[\\/])lib\..*\.d\.ts$/i.test(declaration.getSourceFile().fileName)));
    };
    let globalThisShadowed=false;
    const findGlobalThisBinding=(node:ts.Node):void=>{
      if((ts.isVariableDeclaration(node)||ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)||ts.isParameter(node))&&
        node.name&&ts.isIdentifier(node.name)&&node.name.text==="globalThis")globalThisShadowed=true;
      ts.forEachChild(node,findGlobalThisBinding);
    };
    findGlobalThisBinding(sourceFile);
    const isGlobalObjectAlias=(node:ts.Expression,seen=new Set<ts.Symbol>()):boolean=>{
      node=unwrap(node);
      if(ts.isPropertyAccessExpression(node)&&node.name.text==="window"&&ts.isIdentifier(node.expression)&&
        node.expression.text==="globalThis"&&isStandardGlobal(node.expression))return true;
      if(!ts.isIdentifier(node))return false;
      if(["window","globalThis","self"].includes(node.text)){
        const symbol=symbolOf(node);
        // Some TypeScript lib versions do not expose globalThis through the
        // same declaration path as window. Accept the intrinsic global when
        // it is not locally shadowed; local bindings still fail closed.
        if(isStandardGlobal(node)||(node.text==="globalThis"&&!globalThisShadowed&&
          (!symbol||(symbol.declarations??[]).every(declaration=>declaration.getSourceFile().isDeclarationFile))))return true;
      }
      const symbol=symbolOf(node);
      if(!symbol||seen.has(symbol))return false;
      seen.add(symbol);
      // Treat any binding assigned from a global object as tainted, including
      // let aliases whose global assignment occurs after their declaration.
      const declaredGlobal=(symbol.declarations??[]).some(declaration=>
        ts.isVariableDeclaration(declaration)&&!!declaration.initializer&&isGlobalObjectAlias(declaration.initializer,new Set(seen)));
      if(declaredGlobal)return true;
      let assignedGlobal=false;
      const inspectAssignments=(node:ts.Node):void=>{
        if(ts.isBinaryExpression(node)&&ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)&&
          ts.isIdentifier(node.left)&&symbolOf(node.left)===symbol&&isGlobalObjectAlias(node.right,new Set(seen)))assignedGlobal=true;
        ts.forEachChild(node,inspectAssignments);
      };
      inspectAssignments(sourceFile);
      return assignedGlobal;
    };
    const reflectionApi=(node:ts.Expression,seen=new Set<ts.Symbol>()):"Object"|"Reflect"|undefined=>{
      node=unwrap(node);
      // Resolve static string expressions, including const identifiers, before
      // deciding whether a computed property is the trusted global API name.
      // Unknown computed keys deliberately do not resolve to Object/Reflect.
      if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
        const api=staticallyKnownPropertyName(node);
        if((api==="Object"||api==="Reflect")&&isGlobalObjectAlias(node.expression))return api;
      }
      if(!ts.isIdentifier(node))return undefined;
      if((node.text==="Object"||node.text==="Reflect")&&isStandardGlobal(node))return node.text;
      const symbol=symbolOf(node);
      if(!symbol||seen.has(symbol))return undefined;
      seen.add(symbol);
      for(const declaration of symbol.declarations??[]){
        if(ts.isVariableDeclaration(declaration)&&declaration.initializer){
          const api=reflectionApi(declaration.initializer,new Set(seen));if(api)return api;
        }
        if(ts.isBindingElement(declaration)&&declaration.dotDotDotToken&&ts.isIdentifier(declaration.name)&&symbolOf(declaration.name)===symbol){
          const bindingPattern=declaration.parent;
          const variable=bindingPattern.parent;
          if(ts.isObjectBindingPattern(bindingPattern)&&ts.isVariableDeclaration(variable)&&variable.initializer){
            const api=reflectionApi(variable.initializer,new Set(seen));if(api)return api;
          }
        }
      }
      // Also trace aliases assigned from Object/Reflect after declaration.
      let assignedApi:"Object"|"Reflect"|undefined;
      const inspectAssignments=(node:ts.Node):void=>{
        if(ts.isBinaryExpression(node)&&ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)&&
          ts.isIdentifier(node.left)&&symbolOf(node.left)===symbol){
          const api=reflectionApi(node.right,new Set(seen));if(api)assignedApi=api;
        }
        ts.forEachChild(node,inspectAssignments);
      };
      inspectAssignments(sourceFile);
      return assignedApi;
    };
    const reflectionMethod=(node:ts.Expression,seen=new Set<ts.Symbol>()):ReflectionMutationMethod|undefined=>{
      node=unwrap(node);
      const allowed=(api:"Object"|"Reflect",method:string):boolean=>api==="Object"
        ?["assign","defineProperty","defineProperties","setPrototypeOf"].includes(method)
        :["set","defineProperty","deleteProperty","setPrototypeOf"].includes(method);
      if(ts.isPropertyAccessExpression(node)||ts.isElementAccessExpression(node)){
        const api=reflectionApi(node.expression);
        const method=staticallyKnownPropertyName(node);
        if(api){
          // An unknown dynamic method on a trusted global API is treated as a
          // possible mutation. Only a statically resolved known method can be
          // classified more narrowly.
          if(method===undefined)return{api,method:"*"};
          if(allowed(api,method))return{api,method};
        }
      }
      if(!ts.isIdentifier(node))return undefined;
      const symbol=symbolOf(node);
      if(!symbol||seen.has(symbol))return undefined;
      seen.add(symbol);
      for(const declaration of symbol.declarations??[]){
        if(ts.isVariableDeclaration(declaration)&&declaration.initializer){
          const direct=reflectionMethod(declaration.initializer,new Set(seen));
          if(direct)return direct;
        }
        if(ts.isBindingElement(declaration)&&ts.isIdentifier(declaration.name)&&symbolOf(declaration.name)===symbol){
          const bindingPattern=declaration.parent;
          if(!ts.isObjectBindingPattern(bindingPattern))continue;
          const variable=bindingPattern.parent;
          if(!ts.isVariableDeclaration(variable)||!variable.initializer)continue;
          const api=reflectionApi(variable.initializer);
          if(!api)continue;
          const property=declaration.propertyName??declaration.name;
          let method:string|undefined;
          if(ts.isIdentifier(property)||ts.isStringLiteral(property)||ts.isNumericLiteral(property))method=property.text;
          else if(ts.isComputedPropertyName(property)){
            const expression=unwrap(property.expression);
            method=ts.isStringLiteral(expression)||ts.isNoSubstitutionTemplateLiteral(expression)
              ?expression.text:"*";
          }
          // Unknown computed destructuring keys fail closed when the resulting
          // function is later invoked against the global SDK or SDK client.
          if(method==="*"||method&&allowed(api,method))return{api,method:method??"*"};
        }
      }
      let assigned:ReflectionMutationMethod|undefined;
      const inspectAssignments=(current:ts.Node):void=>{
        if(ts.isBinaryExpression(current)&&ASSIGNMENT_OPERATORS.has(current.operatorToken.kind)&&
          ts.isIdentifier(current.left)&&symbolOf(current.left)===symbol){
          const resolved=reflectionMethod(current.right,new Set(seen));
          if(resolved)assigned=resolved;
        }
        ts.forEachChild(current,inspectAssignments);
      };
      inspectAssignments(sourceFile);
      return assigned;
    };
    const sdkOfClient=(node:ts.Expression,seen=new Set<ts.Symbol>(),allowMutableAlias=false):InstrumentationSourceMatch["sdk"]|undefined=>{
      node=unwrap(node);
      if(ts.isPropertyAccessExpression(node)){
        if(node.name.text==="default"&&isNamespace(node.expression))return SDK_PACKAGE;
        if(node.name.text==="flagsmith"&&isGlobalObjectAlias(node.expression))return "window.flagsmith";
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
        // Positive evidence follows only immutable const aliases. Mutation analysis
        // also follows let/var aliases because they can still mutate the same SDK object.
        if(!ts.isVariableDeclarationList(declarationList))continue;
        if(!allowMutableAlias&&(declarationList.flags&ts.NodeFlags.Const)===0)continue;
        const initializer=unwrap(declaration.initializer);
        if(ts.isCallExpression(initializer)&&isFactoryCall(initializer.expression))return SDK_PACKAGE;
        const resolved=sdkOfClient(initializer,seen,allowMutableAlias);
        if(resolved)return resolved;
      }
      return undefined;
    };

    if(hasTrackEventMutation(sourceFile,node=>!!sdkOfClient(node,new Set<ts.Symbol>(),true),reflectionMethod))sdkMethodMutated=true;
    if(hasGlobalSdkReplacement(sourceFile,isGlobalObjectAlias,reflectionMethod))globalSdkReplaced=true;

    const visit=(node:ts.Node):void=>{
      if((ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))&&node.text===eventName)eventLiteralFound=true;
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==="trackEvent"&&node.arguments.length>0){
        const receiver=node.expression.expression;
        const argument=unwrap(node.arguments[0]!);
        const literal=literalValueOf(argument);
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
  if(sdkMethodMutated||globalSdkReplaced)matches.length=0;
  const failed=[...failedFiles].sort();
  const complete=failed.length===0&&virtualFiles.size>0;
  const status:InstrumentationSourceEvidence["status"]=!complete?"incomplete":matches.length?"flagsmith_sdk_call_found":eventLiteralFound?"event_literal_only":"not_found";
  const note=status==="flagsmith_sdk_call_found"
    ?"The exact case-sensitive event literal is passed to trackEvent on an SDK client imported from @flagsmith/flagsmith, created by its documented factory, or obtained from the standard browser global. Only immutable const aliases are followed and detected trackEvent mutation is rejected. This is source-code evidence only; it does not prove delivery to Flagsmith or warehouse ingestion."
    :(sdkMethodMutated||globalSdkReplaced)
      ?(globalSdkReplaced?"A global Flagsmith SDK object replacement or reflective mutation was detected in the inspected source set. No Flagsmith instrumentation call is considered verified.":"A trackEvent method mutation or replacement was detected in the inspected source set. No Flagsmith instrumentation call is considered verified.")
      :status==="event_literal_only"
        ?"The exact event-name literal exists in parsed source, but no supported Flagsmith SDK trackEvent call was found."
        :status==="not_found"
          ?"No exact event-name literal or supported Flagsmith SDK trackEvent call was found in the parsed JavaScript/TypeScript source."
          :"The instrumentation scan is incomplete ("+failed.length+" unsupported, unreadable, syntactically invalid or semantically invalid source file(s)). No source verification can be claimed.";
  return{status,eventName,sourceSha:input.sourceSha,scannedFiles:virtualFiles.size,failedFiles:failed,eventLiteralFound,trackingCallFound:matches.length>0,matches,note};
}
