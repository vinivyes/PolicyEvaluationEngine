const { IsFunction, ResolveFunctions, field, endsWith } = require('./functions');
const { ParseFunction } = require('./parser');

const ResolveCondition = (c, context, depth = 0) => {
      //console.log(`Resolving with Depth: ${depth}`)
      let condition = {
            rawCondition: c,
            rawOperation: {},
            result: null
      }
      
      let keys = Object.keys(c);
      //console.log(`Condition Keys:`, JSON.stringify(keys));

      if (keys.length == 1) {
            condition.rawResult = typeof operations[keys[0]] === "function"
            ? operations[keys[0]](c, context, depth)
            : new Error(`Function ${keys[0]} not found!`);
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
            let isFunction0 = `${arg0}`[0] == "[" && `${arg0}`[`${arg0}`.length - 1] == "]";
            let isFunction1 = `${arg1}`[0] == "[" && `${arg1}`[`${arg1}`.length - 1] == "]";


            if (valueKey != "count" && isFunction0 && IsFunction(`${arg0}`.substring(1, `${arg0}`.length - 1))) {
                  arg0 = ResolveFunctions(
                        ParseFunction(`${arg0}`.substring(1, `${arg0}`.length - 1)),
                        context
                  );
            }

            if (isFunction1 && IsFunction(`${arg1}`.substring(1, `${arg1}`.length - 1))) {
                  arg1 = ResolveFunctions(
                        ParseFunction(`${arg1}`.substring(1, `${arg1}`.length - 1)),
                        context
                  );
            }

            if (valueKey == "field") {
                  arg0 = ResolveFunctions(
                        ParseFunction(`field('${arg0}')`),
                        context
                  );
            }

            if(valueKey == "count"){
                  arg0 = count(c["count"], context, depth);
                  condition.rawOperation["_count"] = arg0; 
                  arg0 = arg0.result;
            }

            //Reserved words
            switch (operationKey) {
                  case "in":
                        operationKey = "inFunction";
                        break;
            }

            condition.rawOperation["_valueKey"] = valueKey; 
            condition.rawOperation["_opKey"] = operationKey;

            condition.rawOperation["_value"] = arg0; 
            condition.rawOperation["_op"] = arg1;

            condition.result = typeof operations[operationKey] === "function"
                  ? operations[operationKey]([arg0, arg1], context, depth)
                  : new Error(`Function ${operationKey} not found!`);

            if(depth == 0){
                  context.countDepthMap = null;
                  context.countContext = null;
                  //console.log('Resetting Count Map')
            }
      }
      else {
            throw new Error('Unrecognized condition');
      }

      //console.log(JSON.stringify(condition.rawCondition));

      return condition;
}

const getPropertyFromObject = (obj, properties) => {
      for (let prop of properties) {
            if(endsWith([prop,'[*]'])){
                  prop = prop.substring(0, prop.length-3)
            }

          // Check if prop contains an array access pattern, e.g., myProperty[0]
          const parts = prop.split('[');
  
          // Loop over each part to handle multiple indices, e.g., myProperty[0][1]
          for (let part of parts) {
              part = part.replace(']', ''); // Remove the closing bracket
              if (Number.isInteger(Number(part))) {
                  // If part is a number, treat it as an array index
                  obj = obj[Number(part)];
              } else if (obj && obj.hasOwnProperty(part)) {
                  // Otherwise, treat it as an object key
                  obj = obj[part];
              } else {
                  return undefined;
              }
          }
      }
      return obj;
  };

const count = (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null
      }            
      
      let keys = Object.keys(c);
      let valueKey = keys.find(k => {
            return `${k}`.toLocaleLowerCase() == "value" || `${k}`.toLocaleLowerCase() == "field"
      });

      let results = [];

      if(valueKey == "field"){
      
            let path = field([c["field"]], context, true);
            let loadPath = replaceAsterisksWithNumbers(path, context.countDepthMap)
            let array = getPropertyFromObject(context.resource, loadPath.split('.'));
            
            if(!context.countDepthMap){
                  context.countDepthMap = [0]
            }
            else if(context.countDepthMap.length < depth){
                  context.countDepthMap.push(0);
            }

            if(!array && !Array.isArray(array)){
                  throw new Error('Field does not return an array inside count');
            }
      
            let maxCount = array.length;
      
            for(let r = 0; r < maxCount; r++){
                  context.countDepthMap[context.countDepthMap.length-1] = r;
                  let result = ResolveCondition(c["where"], context, depth + 1);
                  //console.log(`copy index ${r}`,result);
                  results.push(result);
            }
            context.countDepthMap[context.countDepthMap.length-1] = 0;
      }

      if(valueKey == "value"){
            if(!context.countContext){
                  context.countContext = {}
            }

            let arg0 = c[valueKey];
            let isFunction0 = `${arg0}`[0] == "[" && `${arg0}`[`${arg0}`.length - 1] == "]";

            context.countContext[`${c["name"] ? c["name"] : 'global'}`] = isFunction0 ? ResolveFunctions(
                  ParseFunction(`${arg0}`.substring(1, `${arg0}`.length - 1)),
                  context
            ) : arg0

            let array = context.countContext[`${c["name"] ? c["name"] : 'global'}`];
      
            if(!Array.isArray(array)){
                  throw new Error('Value does not return an array inside count');
            }
      
            let maxCount = array.length;
      
            for(let r = 0; r < maxCount; r++){
                  context.countContextIndex = r;
                  let result = ResolveCondition(c["where"], context, depth + 1);
                  results.push(result);
            }
            context.countContextIndex = null;
      }


      /* TODO: Return number of matches */
      //context.countResource = 

      condition.result = results.filter(r => r.result).length;
      condition.rawResults = results;
      
      return condition;
}

function replaceAsterisksWithNumbers(str, arr) {
      if(!arr)
            arr = [];

      let index = 0;
      return str.replace(/\[\*\]/g, (match) => {
          if (index < arr.length) {
              return `[${arr[index++]}]`;
          }
          return match; // In case there are more [*] than array elements (shouldn't happen based on your problem description)
      });
  }

const allOf = (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null
      }

      let results = [];

      for (let node of c.allOf) {
            let resolution = ResolveCondition(node, context, depth);
            results.push(resolution);
            if(!resolution.result)
                  break;
      }

      condition.rawResults = results;
      condition.result = results.every(r => r.result == true);

      return condition;
}

const anyOf = (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null
      }

      let results = [];

      for (let node of c.anyOf) {
            let resolution = results.push(ResolveCondition(node, context, depth))
            if(resolution.result)
                  break;
      }

      condition.rawResults = results;
      condition.result = results.some(r => r.result == true);

      return condition;
}

const not = (c, context, depth = 0) => {
      let condition = {
            rawCondition: c,
            result: null
      }

      let resolve = ResolveCondition(c['not'], context, depth);
      condition.rawResult = resolve;
      condition.result = !resolve.result
      //console.log(JSON.stringify(resolve), !resolve.result)
      return condition;
}

const exists = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'equals', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let [arg0, arg1] = args;

      if (typeof Boolean(arg1) !== 'boolean') {
            throw new Error('Argument for exists should be a boolean');
      }

      if (Array.isArray(arg0)) {
            return Boolean(arg1) ? arg0.length > 0 : arg0.length == 0;
      }
      else {
            return Boolean(arg1) ? Boolean(arg0) : !arg0;
      }
}

const inFunction = (args) => {
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

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => a0.includes(arg1));
      }
      else {
            return arg0.includes(arg1);
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

const matchInsensitively = (args) => {
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

const containsKey = (args) => {
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

      if (Array.isArray(arg0)) {
            return arg0.every((a0) => String(a0) == String(arg1));
      }
      else {
            return String(arg0) == String(arg1);
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

const greaterOrEquals = (args) => {
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

const lessOrEquals = (args) => {
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

const notContainsKey = (args) => {
      return !containsKey(args);
};

const notMatch = (args) => {
      return !match(args);
};

const notMatchInsensitively = (args) => {
      return !matchInsensitively(args);
};
const notLike = (args) => {
      return !like(args);
}

const notEquals = (args) => {
      return !equals(args);
}

const notContains = (args) => {
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

const notIn = (args) => {
      return !inFunction(args);
}



const operations = {
      allOf,
      anyOf,
      count,
      contains,
      notContains,
      containsKey,
      notContainsKey,
      not,
      like,
      notLike,
      match,
      notMatch,
      matchInsensitively,
      notMatchInsensitively,
      equals,
      notEquals,
      exists,
      less,
      lessOrEquals,
      greater,
      greaterOrEquals,
      inFunction,
      notIn
}



module.exports = { ResolveCondition }