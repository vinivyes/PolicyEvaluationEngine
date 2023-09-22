const { getResourceById } = require('./azureApi');
const { IsFunction, ResolveFunctions, field, endswith } = require('./functions');
const { ParseFunction } = require('./parser');
const crypto = require("crypto");

const makeid = () => { return crypto.randomBytes(16).toString("hex"); }

const ResolveCondition = async (c, context, depth = 0, path) => {
      //console.log(`Resolving with Depth: ${depth}`)

      let condition = {
            rawCondition: c,
            rawOperation: {},
            result: null
      }

      if (path && context.countDepthMap) {
            condition.path = replaceAsterisksWithNumbers(path, context.countDepthMap)
            context.path = path;
      }
      if(context.countDepthMap)
            condition.rawOperation["Path"] = replaceAsterisksWithNumbers(context.path, context.countDepthMap)

            if (depth == 0) {
            context.applicability = {
                  type: false,
                  name: false,
                  kind: false
            };
            context.applicable = {
                  type: false,
                  name: false,
                  kind: false
            };
      }


      let keys = Object.keys(c);
      //console.log(`Condition Keys:`, JSON.stringify(keys));

      if (keys.length == 1) {
            condition.rawResult = await conditionRunner(operations[keys[0].toLowerCase()], c, context, depth)
            condition.rawOperation["OperationKey"] = keys[0];
            condition.rawOperation["OperationValue"] = condition.rawResult.result;
            condition.rawOperation["OperationValueRaw"] = condition.rawResult;
            condition.result = condition.rawResult.result;
      }
      else if (keys.length == 2) {
            let valueKey = keys.find(k => {
                  return `${k}`.toLocaleLowerCase() == "value" || `${k}`.toLocaleLowerCase() == "field" || `${k}`.toLocaleLowerCase() == "count"
            });
            let operationKey = keys.find(k => {
                  return `${k}`.toLocaleLowerCase() != "value" && `${k}`.toLocaleLowerCase() != "field" && `${k}`.toLocaleLowerCase() != "count"
            });

            if (!valueKey)
                  throw new Error(`Conditions should have either 'field', 'value' or 'count' operators`);

            if (!operationKey)
                  throw new Error(`Conditions should have an operation, such as 'equals','greater', etc...`);

            let arg0 = c[valueKey];
            let arg1 = c[operationKey];
            let rawArg0 = c[valueKey];
            let rawArg1 = c[operationKey];
            let isFunction0 = `${arg0}`[0] == "[" && `${arg0}`[`${arg0}`.length - 1] == "]";
            let isFunction1 = `${arg1}`[0] == "[" && `${arg1}`[`${arg1}`.length - 1] == "]";

            let resultHash = makeid();
            context.currentConditionHash = resultHash;

            if (valueKey != "count" && isFunction0 && IsFunction(`${arg0}`.substring(1, `${arg0}`.length - 1))) {
                  rawArg0 = await ResolveFunctions(
                        ParseFunction(`${arg0}`.substring(1, `${arg0}`.length - 1)),
                        context
                  );
                  arg0 = rawArg0.value;
            }

            if (isFunction1 && IsFunction(`${arg1}`.substring(1, `${arg1}`.length - 1))) {
                  rawArg1 = await ResolveFunctions(
                        ParseFunction(`${arg1}`.substring(1, `${arg1}`.length - 1)),
                        context
                  );
                  arg1 = rawArg1.value;
            }

            if (valueKey == "field") {
                  rawArg0 = await ResolveFunctions(
                        ParseFunction(`field('${arg0}')`),
                        context
                  );
                  arg0 = rawArg0.value;
            }

            if (valueKey == "count") {
                  if (!context.countStart) {
                        context.countStart = depth;
                  }

                  rawArg0 = await count(c["count"], context, depth);
                  arg0 = rawArg0.result;
            }

            //Reserved words
            switch (operationKey.toLowerCase()) {
                  case "in":
                        operationKey = "inFunction";
                        break;
            }

            condition.rawOperation["FieldKey"] = valueKey;
            condition.rawOperation["OperationKey"] = operationKey;

            condition.rawOperation["FieldValue"] = arg0;
            condition.rawOperation["FieldValueRaw"] = rawArg0;
            condition.rawOperation["OperationValue"] = arg1;
            condition.rawOperation["OperationValueRaw"] = rawArg1;

            condition.result = await conditionRunner(operations[operationKey.toLowerCase()], [arg0, arg1], context, depth);

            condition.rawOperation["Result"] = condition.result;

            ['type', 'name', 'kind'].forEach((applicableField) => {
                  if (context.applicability[applicableField] && context.applicable[applicableField] == resultHash) {
                        context.applicable[applicableField] = context.not ? !condition.result : condition.result;
                  }
            });

            context.not = false;
      }
      else {
            throw new Error('Unrecognized condition');
      }

      if (depth == 0) {
            Object.keys(context.applicable).forEach((applicableField) => {
                  if (context.applicable[applicableField] != true) {
                        context.applicable[applicableField] = false;
                  }
            });

            condition.applicable = Object.keys(context.applicable).filter((applicableField) => {
                  return context.applicability[applicableField] == context.applicable[applicableField] || context.applicability[applicableField] == false
            }).length == Object.keys(context.applicable).length;

            let overrides = {
                  id: await field(['id'],context, false, true),
                  name: await field(['name'],context, false, true),
                  location: await field(['location'],context, false, true),
                  type: await field(['type'],context, false, true),
                  kind: await field(['kind'],context, false, true),
                  tags: await field(['tags'],context, false, true),
                  identity: await field(['identity'],context, false, true)
            }

            context.fieldOverride = overrides;
            
            switch (context.effect) {
                  case "audit":
                  case "deny":
                  case "modify":
                  case "append":
                        condition.complianceState = condition.applicable ? (condition.result ? 'NonCompliant' : 'Compliant') : 'NotApplicable'
                        break;
                  case "deployifnotexists":
                  case "auditifnotexists":
                        condition.ifnotexists = condition.applicable ? await IfNotExists(context) : false;
                        condition.complianceState = condition.ifnotexists.result ? 'Compliant' : 'NonCompliant'

            }
      }


      return condition;
}

const IfNotExists = async (context) => {
      let resourceId = context.id;
      let scanType = getPropertyFromObject(context,'policyRule.then.details.type');
      let scanName = getPropertyFromObject(context,'policyRule.then.details.name')
      let scanRG = getPropertyFromObject(context,'policyRule.then.details.resourceGroupName')
      let scope = getPropertyFromObject(context,'policyRule.then.details.existenceScope') ? getPropertyFromObject(context,'policyRule.then.details.existenceScope') : 'ResourceGroup';
      let isFunctionScanRG = scanRG ? `${scanRG}`[0] == "[" && `${scanRG}`[`${scanRG}`.length - 1] == "]" : false;
      let isFunctionScanName = `${scanName}`[0] == "[" && `${scanName}`[`${scanName}`.length - 1] == "]";
      let isFunctionScanType = `${scanType}`[0] == "[" && `${scanType}`[`${scanType}`.length - 1] == "]";
      if (isFunctionScanName) {
            scanName = (await ResolveFunctions(
                  ParseFunction(`${scanName}`.substring(1, `${scanName}`.length - 1)),
                  context
            )).value;
      }
      if (isFunctionScanRG) {
            scanRG = (await ResolveFunctions(
                  ParseFunction(`${scanRG}`.substring(1, `${scanRG}`.length - 1)),
                  context
            )).value;
      }
      if (isFunctionScanType) {
            scanType = (await ResolveFunctions(
                  ParseFunction(`${scanType}`.substring(1, `${scanType}`.length - 1)),
                  context
            )).value;
      }

      let resourceScanId = null;

      if (`${scope}`.toLowerCase() == 'resourcegroup') {
            resourceScanId = `${scanType}`.toLowerCase() == `${getPropertyFromObject(context,'resource.type')}`.toLowerCase() || 
                             (`${getPropertyFromObject(context,'resource.type')}`.toLowerCase().startsWith(`${scanType}`.toLowerCase()) && `${getPropertyFromObject(context,'resource.type')}`.toLowerCase() != `${scanType}`.toLowerCase()) ?
                  `${resourceId.split('/providers/')[0]}/providers/` + `${scanName ? `${buildResourceNameType(scanType, scanName)}` : scanType}` :
                  `${scanType}`.toLowerCase().startsWith(getPropertyFromObject(context,'resource.type').toLowerCase()) ?
                        `${resourceId}/${scanType.split('/').pop()}` + `${scanName ? `/${scanName.split('/').pop()}` : ''}` :
                        scanRG ?
                              (`${resourceId}`.split('/providers/')[0] + `/providers/${buildResourceNameType(scanType, scanName)}`) :
                              `${resourceId}/providers/${buildResourceNameType(scanType, scanName)}`

            if (scanRG) {
                  let segments = resourceScanId.split('/');
                  segments[4] = scanRG;
                  resourceScanId = segments.join('/');
            }
      }
      else {
            let segments = resourceId.split('/').slice(0,3);
            resourceScanId = `${segments.join('/')}/providers/${scanType}` + `${scanName ? `/${scanName}` : ''}`;
      }

      let existentResources = null;
      try{
            existentResources = await getResourceById(resourceScanId);
      }
      catch(err){
            if(`${err.message}`.startsWith('Resource cannot be read (403):'))
                  throw new Error(err.message);
      }
      
      if(!existentResources || !existentResources.resource){
            existentResources = [];
      }
      else if(existentResources.resource.value && Array.isArray(existentResources.resource.value)){
            existentResources = existentResources.resource.value;
      }
      else{
            existentResources = [existentResources.resource];
      }

      let isCompliant = false;
      let resourceEvaluation = [];

      for(let r of existentResources){
            if(isCompliant)
                  continue;

            let tempContext = JSON.parse(JSON.stringify(context));
            tempContext.effect = 'audit';
            tempContext.resource = r;

            let res = await ResolveCondition(getPropertyFromObject(context,'policyrule.then.details.existencecondition'), tempContext);
            resourceEvaluation.push({
                  evaluation:res,
                  resource:r
            });

            isCompliant = res.result;
      }

      return {
            result:isCompliant,
            rawEvaluation: resourceEvaluation
      }
}

function buildResourceNameType (type, name){

      let segmentsTypes = type.split('/').slice(1);
      let segmentNames = name.split('/');

      let result = type.split('/')[0];

      for(let s = 0; s < segmentsTypes.length; s++){
            result += `/${segmentsTypes[s]}/${segmentNames[s]}`;
      }

      return result
}


// Dynamic function handler
async function conditionRunner(func, args, context, depth) {
      return await new Promise((resolve, reject) => {
            try {
                  const result = func(args, context, depth);

                  if (result instanceof Promise) {
                        result.then(resolve).catch(reject);
                  } else {
                        resolve(result);
                  }
            } catch (error) {
                  reject(error);
            }
      });
}

const getPropertyFromObject = (obj, properties) => {
      if(!Array.isArray(properties)){
            properties = `${properties}`.split('.');
      }

      for (let prop of properties) {
            if (endswith([prop, '[*]'])) {
                  prop = prop.substring(0, prop.length - 3)
            }

            // Check if prop contains an array access pattern, e.g., myProperty[0]
            const parts = prop.split('[');

            // Loop over each part to handle multiple indices, e.g., myProperty[0][1]
            for (let part of parts) {
                  part = part.replace(']', ''); // Remove the closing bracket
                  if (Number.isInteger(Number(part))) {
                        // If part is a number, treat it as an array index
                        obj = obj[Number(part)];
                  } else if (obj && Object.keys(obj).find((p) => `${p}`.toLowerCase() == `${part}`.toLowerCase())) {
                        // Otherwise, treat it as an object key
                        obj = obj[Object.keys(obj).find((p) => `${p}`.toLowerCase() == `${part}`.toLowerCase())];
                  } else {
                        return undefined;
                  }
            }
      }
      return obj;
};

const count = async (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null,
            context: null
      }

      if(!context.countDepth)
            context.countDepth = 0;

      context.countDepth++;

      let keys = Object.keys(c);
      let valueKey = keys.find(k => {
            return `${k}`.toLocaleLowerCase() == "value" || `${k}`.toLocaleLowerCase() == "field"
      });

      let results = [];

      if (valueKey == "field") {
            let path = await field([c["field"]], context, true);
            let loadPath = replaceAsterisksWithNumbers(path, context.countDepthMap)
            let array = getPropertyFromObject(context.resource, loadPath.split('.'));
            if (!context.countDepthMap) {
                  context.countDepthMap = [0]
            }
            else if (context.countDepthMap.length < context.countDepth) {
                  context.countDepthMap.push(0);
            }

            if (array && Array.isArray(array)) {
                  let maxCount = array.length;

                  for (let r = 0; r < maxCount; r++) {
                        context.countDepthMap[context.countDepth - 1] = r;
                        let result = await ResolveCondition(c["where"], context, depth + 1, path);
                        results.push(result);
                  }
                  context.countDepthMap[context.countDepth - 1] = 0;
            }

            condition.context = array;
            context.countDepthMap.pop();
      }


      if (valueKey == "value") {
            if (!context.countContext) {
                  context.countContext = {}
            }

            let arg0 = c[valueKey];
            let isFunction0 = `${arg0}`[0] == "[" && `${arg0}`[`${arg0}`.length - 1] == "]";

            context.countContext[`${c["name"] ? c["name"] : 'global'}`] = isFunction0 ? (await ResolveFunctions(
                  ParseFunction(`${arg0}`.substring(1, `${arg0}`.length - 1)),
                  context
            )).value : arg0

            let array = context.countContext[`${c["name"] ? c["name"] : 'global'}`];

            if (!Array.isArray(array)) {
                  throw new Error('Value does not return an array inside count');
            }

            let maxCount = array.length;

            for (let r = 0; r < maxCount; r++) {
                  context.countContextIndex = r;
                  let result = await ResolveCondition(c["where"], context, depth + 1);
                  results.push(result);
            }
            condition.context = array;
            context.countContextIndex = null;
      }


      /* TODO: Return number of matches */
      //context.countResource = 

      condition.result = results.filter(r => r.result).length;
      condition.rawResults = results;

      context.countDepth--;

      if(context.countDepth == 0){
            context.countContext = null;
            context.countDepthMap = null;
            context.countStart = null;
      }

      return condition;
}

function replaceAsterisksWithNumbers(str, arr) {
      if (!arr)
            arr = [];

      if (!str || typeof str !== 'string')
            return str;



      let index = 0;
      return str.replace(/\[\*\]/g, (match) => {
            if (index < arr.length) {
                  return `[${arr[index++]}]`;
            }
            return match; // In case there are more [*] than array elements (shouldn't happen based on your problem description)
      });
}

const allof = async (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null
      }

      let keys = Object.keys(c);
      let allOfKey = keys.find(k => k.toLowerCase() == "allof");

      let results = [];

      for (let node of c[allOfKey]) {
            let resolution = await ResolveCondition(node, context, depth + 1);
            results.push(resolution);
            if (!resolution.result)
                  break;
      }

      condition.rawResults = results;
      condition.result = results.every(r => r.result == true);

      return condition;
}

const anyof = async (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null
      }

      let results = [];

      let keys = Object.keys(c);
      let anyOfKey = keys.find(k => k.toLowerCase() == "anyof");


      for (let node of c[anyOfKey]) {
            let resolution = results.push(await ResolveCondition(node, context, depth + 1))
            if (resolution.result)
                  break;
      }

      condition.rawResults = results;
      condition.result = results.some(r => r.result == true);

      return condition;
}

const not = async (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null
      }
      
      context.not = true;
      let resolve = await ResolveCondition(c['not'], context, depth + 1);
      condition.rawResult = resolve;
      condition.result = !resolve.result
      //console.log(JSON.stringify(resolve), !resolve.result)
      return condition;
}

const exists = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'exists', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;


      arg1 = JSON.parse(`${arg1}`.toLowerCase());

      if (typeof arg1 !== 'boolean') {
            throw new Error('Argument for exists should be a boolean');
      }

      if (Array.isArray(arg0)) {
            return arg1 ? arg0.length > 0 : arg0.length == 0;
      }
      else {
            return arg1 ? typeof arg0 != "undefined" && arg0 != null : typeof arg0 == "undefined" || arg0 == null ;
      }
}

const infunction = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'in', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;


      if (!Array.isArray(arg1))
            throw new Error("Argument for 'in' function should be an Array");

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => arg1.some((a1) => equals([a0, a1])));
      }
      else {
            return arg1.some((a1) => equals([arg0, a1]));
      }
}


const contains = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'in', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;

      arg0 = typeof arg0 != "undefined" ? arg0 : '';
      arg1 = typeof arg1 != "undefined" ? arg1 : '';


      if (Array.isArray(arg0)) {
            return arg0.every((a0) => a0.toLocaleLowerCase().includes(arg1.toLocaleLowerCase()));
      }
      else {
            return arg0.toLocaleLowerCase().includes(arg1.toLocaleLowerCase());
      }
}

const like = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'like', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;

      if (arg1.split('*').length > 2) {
            throw new Error(`Function 'like' only supports one wildcard`);
      }

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => likeMatch(a0, arg1));
      }
      else {
            return likeMatch(arg0, arg1);
      }
};

const match = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'match', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }
      return patternMatch(args[0], args[1]);
};

const matchinsensitively = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'matchInsensitively', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      return patternMatch(args[0].toLowerCase(), args[1].toLowerCase());
};

const containskey = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'containsKey', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      if (typeof args[0] !== 'object') {
            throw new Error("Expected object type for 'containsKey'");
      }
      return args[0].hasOwnProperty(args[1]);
};

const equals = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'equals', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;

      arg0 = typeof arg0 != "undefined" ? arg0 : '';
      arg1 = typeof arg1 != "undefined" ? arg1 : '';

      if (Array.isArray(arg0)) {
            return arg0.length == 0 ? false : arg0.every((a0) => 
                                    String(a0).toLowerCase() == String(arg1).toLowerCase() || 
                                    (String(a0).toLowerCase() == "microsoft.resources/resourcegroups" && String(arg1).toLowerCase() == "microsoft.resources/subscriptions/resourcegroups") || 
                                    (String(a0).toLowerCase() == "microsoft.resources/subscriptions/resourcegroups" && String(arg1).toLowerCase() == "microsoft.resources/resourcegroups")
                                    );
      }
      else {
            return String(arg0).toLowerCase() == String(arg1).toLowerCase()  || 
            (String(arg0).toLowerCase() == "microsoft.resources/resourcegroups" && String(arg1).toLowerCase() == "microsoft.resources/subscriptions/resourcegroups") || 
            (String(arg0).toLowerCase() == "microsoft.resources/subscriptions/resourcegroups" && String(arg1).toLowerCase() == "microsoft.resources/resourcegroups");
      }
}

const greater = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'greater', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'greater' must be numbers or strings");
      }

      let [arg0, arg1] = args;

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => {
                  if (typeof a0 === 'string' && typeof arg1 === 'string') {
                        return a0.localeCompare(arg1) > 0;
                  }

                  return a0 > arg1;
            });
      }
      else {
            if (typeof args[0] === 'string' && typeof args[1] === 'string') {
                  return args[0].localeCompare(arg1) > 0;
            }

            return arg0 > arg1;
      }

};

const greaterorequals = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'greaterOrEquals', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'greaterOrEquals' must be numbers or strings");
      }

      let [arg0, arg1] = args;

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => {
                  if (typeof a0 === 'string' && typeof arg1 === 'string') {
                        return a0.localeCompare(arg1) >= 0;
                  }

                  return a0 >= arg1;
            });
      }
      else {
            if (typeof args[0] === 'string' && typeof args[1] === 'string') {
                  return args[0].localeCompare(arg1) >= 0;
            }

            return arg0 >= arg1;
      }
};

const less = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'less', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'less' must be numbers or strings");
      }

      let [arg0, arg1] = args;

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => {
                  if (typeof a0 === 'string' && typeof arg1 === 'string') {
                        return a0.localeCompare(arg1) < 0;
                  }

                  return a0 < arg1;
            });
      }
      else {
            if (typeof args[0] === 'string' && typeof args[1] === 'string') {
                  return args[0].localeCompare(arg1) < 0;
            }

            return arg0 < arg1;
      }
};

const lessorequals = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'less', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'lessOrEquals' must be numbers or strings");
      }


      let [arg0, arg1] = args;

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => {
                  if (typeof a0 === 'string' && typeof arg1 === 'string') {
                        return a0.localeCompare(arg1) <= 0;
                  }

                  return a0 <= arg1;
            });
      }
      else {
            if (typeof args[0] === 'string' && typeof args[1] === 'string') {
                  return args[0].localeCompare(arg1) <= 0;
            }

            return arg0 <= arg1;
      }
};

const notcontainskey = (args) => {
      return !containskey(args);
};

const notmatch = (args) => {
      return !match(args);
};

const notmatchinsensitively = (args) => {
      return !matchinsensitively(args);
};
const notlike = (args) => {
      return !like(args);
}

const notequals = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'equals', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;

      arg0 = typeof arg0 != "undefined" ? arg0 : '';
      arg1 = typeof arg1 != "undefined" ? arg1 : '';

      if (Array.isArray(arg0)) {
            return arg0.length == 0 ? false : !arg0.some((a0) => String(a0).toLowerCase() == String(arg1).toLowerCase());
      }
      else {
            return String(arg0).toLowerCase() != String(arg1).toLowerCase();
      }
}

const notcontains = (args) => {
      return !contains(args);
}


// Helper function to match like patterns with wildcard *
const likeMatch = (str, pattern) => {
      const regex = new RegExp(`^${pattern.split('*').join('.*')}$`, 'i'); // Case insensitive
      return regex.test(str);
};

// Helper function to match patterns with #, ?, and .
const patternMatch = (str, pattern) => {
      const regex = new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\#/g, '\\d').replace(/\?/g, '\\w')}$`);
      return regex.test(str);
};

const notin = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'in', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;

      if((Array.isArray(arg0) && arg0.length == 0) || 
          arg0 == null || typeof arg0 == "undefined"){
            return true;
      }
      else{
            return !infunction(args);
      }

}



const operations = {
      allof,
      anyof,
      count,
      contains,
      notcontains,
      containskey,
      notcontainskey,
      not,
      like,
      notlike,
      match,
      notmatch,
      matchinsensitively,
      notmatchinsensitively,
      equals,
      notequals,
      exists,
      less,
      lessorequals,
      greater,
      greaterorequals,
      infunction,
      notin
}



module.exports = { ResolveCondition, getPropertyFromObject }