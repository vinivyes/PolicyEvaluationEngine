const crypto = require('crypto');
const {  getResourceById, RetrieveAliases } = require('./azureApi');
const fs = require('fs');

const IsFunction = (f) => {
      const getFunctionName = (str) => {
            let segments = str.split("(");

            return str.includes(")") && segments.length > 1 ? segments[0] : null;
      };
      let availableFunction = false;
      let functionName = `${getFunctionName(f)}`.toLocaleLowerCase();

      for (let af of availableFunctions()) {
            let availableFunctionName = af.toLocaleLowerCase();
            if (availableFunction)
                  continue;

            if (availableFunctionName == functionName || availableFunctionName == `${functionName}function`) {
                  availableFunction = true;
            }
      }

      //console.log(`${getFunctionName(f)}`, availableFunction);

      return availableFunction;
}

const getPropertyFromObject = (obj, properties) => {
      for (let prop of properties) {
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

const ResolveFunctions = async (functionTree, context, depth = 0) => {
      if (functionTree.type != "Function") {
            throw new Error(`Not a function...`);
      }
      
      let argValues = [];
      let argRawValues = [];

      if(functionTree.method.toLowerCase() == `iffunction`){
            let op = functionTree.args[0];
            let trueValue = functionTree.args[1];
            let falseValue = functionTree.args[2];

            if (op.type == "Function") {
                  op.rawValue = await ResolveFunctions(op, context, depth++);
                  op.value = op.rawValue.value;
            }

            argValues.push(op.value);
            argRawValues.push(op.rawValue);

            if(op.value == true){
                  if (trueValue.type == "Function") {
                        trueValue.rawValue = await ResolveFunctions(trueValue, context, depth++);
                        trueValue.value = trueValue.rawValue.value;
                  }
      
                  argValues.push(trueValue.value);
                  argValues.push(false);
                  argRawValues.push(trueValue.rawValue);
                  argRawValues.push(false);
            }
            else if(op.value == false){
                  if (falseValue.type == "Function") {
                        falseValue.rawValue = await ResolveFunctions(falseValue, context, depth++);
                        falseValue.value = falseValue.rawValue.value;
                  }
      
                  argValues.push(true);
                  argValues.push(falseValue.value);
                  argRawValues.push(true);
                  argRawValues.push(falseValue.rawValue);
            }
            else{
                  argValues.push(true);
                  argValues.push(false);   
                  argRawValues.push(trueValue);
                  argRawValues.push(falseValue);                     
            }
      }
      else{
                  
            for (let arg of functionTree.args) {
                  if (arg.type == "Function") {
                        arg.rawValue = await ResolveFunctions(arg, context, depth++);
                        arg.value = arg.rawValue.value;
                  }

                  argValues.push(arg.value);
                  argRawValues.push(arg.rawValue);
            }
      }

      functionTree.args = argValues;
      functionTree.argsRaw = argRawValues;
      //console.log(`Resolving Function:`, functionTree.method);
      const result = await functionRunner(operations[functionTree.method.toLowerCase()],argValues, context);
      functionTree.value = result;

      if (functionTree.properties) {
            let propertyValues = [];
            let propertyRawValues = [];
      
            for(let property of functionTree.properties) {
                  if(typeof property == "object"){
                        if(property.type == "Function" && availableFunctions().filter((f) => `${f}`.toLowerCase() == `${property.method}`.toLowerCase()).length > 0){
                              let result = await ResolveFunctions(property, context, depth++);
                              propertyValues.push(result.value);      
                              propertyRawValues.push(result);
                              continue;                  
                        }
                        else if(property.type == "Function" && !IsFunction(property.method)){
                              propertyValues.push(property.method)
                              propertyRawValues.push(property.method)
                              continue;
                        }
                  }
      
                  propertyValues.push(property);
                  propertyRawValues.push(property);
            };

            functionTree.properties = propertyValues;
            functionTree.propertiesRawValues = propertyRawValues;

            functionTree.value = getPropertyFromObject(result, functionTree.properties);
      }

      return functionTree;
}


// Dynamic function handler
async function functionRunner(func, args, context) {
      return await new Promise((resolve, reject) => {
          try {
              const result = func(args, context);
              
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

const equals = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'equals', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      args[0] = typeof args[0] != "undefined" ? args[0] : '';
      args[1] = typeof args[1] != "undefined" ? args[1] : '';

      return String(args[0]).toLowerCase() == String(args[1]).toLowerCase()
}

const not = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 1) {
                  throw new Error(`Expected 1 arguments on function 'not', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      return !Boolean(args[0])
}

const base64 = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 1) {
                  throw new Error(`Expected 1 arguments on function 'base64', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      return btoa(args[0])
}

const base64tostring = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 1) {
                  throw new Error(`Expected 1 arguments on function 'base64tostring', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      return atob(`${args[0]}`)
}

const base64tojson = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 1) {
                  throw new Error(`Expected 1 arguments on function 'base64tojson', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      return JSON.parse(atob(`${args[0]}`))
}

const concat = (args) => {
      if (Array.isArray(args)) {
            if (args.length == 0) {
                  throw new Error(`Expected at least 1 arguments on function 'concat', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let isArray = Array.isArray(args[0]);
      for (let arg of args) {
            if (Array.isArray(arg) != isArray)
                  throw new Error(`Either all arguments for 'concat' should be 'Array' or none.`);
      }



      if (isArray) {
            let merged = [];
            for (let arg of args) {
                  merged = merged.concat(arg);
            }

            return merged;
      }
      else {
            let mergedString = '';
            for (let arg of args) {
                  mergedString += `${arg}`;
            }

            return mergedString;
      }
}

const contains = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 2) {
                  throw new Error(`Expected 2 arguments on function 'contains', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let isArray = Array.isArray(args[0]);
      let isObject = typeof args[0] === 'object' && args[0] !== null

      if (isArray) {
            for (let item of args[0]) {
                  if (item == args[1])
                        return true;
            }
            return false;
      }
      else if (isObject) {
            for (let property in args[0]) {
                  if (property == args[1])
                        return true;
            }
            return false;
      }
      else {      
            args[0] = typeof args[0] != "undefined" ? args[0] : '';
            args[1] = typeof args[1] != "undefined" ? args[1] : '';
            return String(args[0]).toLocaleLowerCase().includes(String(args[1].toLocaleLowerCase()))
      }
}



const datauri = (args) => {
      if (Array.isArray(args) && args.length === 1) {
            const stringToConvert = args[0];

            // Convert the string to base64
            const base64String = Buffer.from(stringToConvert).toString('base64');

            // Return the formatted data URI
            return `data:text/plain;charset=utf8;base64,${base64String}`;
      } else {
            throw new Error(`Expected 1 argument for 'datauri' function, got ${args.length}`);
      }
}

// Helper function to convert a datauri back to a string
const datauritostring = (args) => {
      if (Array.isArray(args) && args.length === 1) {
            const datauri = args[0];

            // Extract the base64 part of the data URI
            const base64Match = datauri.match(/base64,(.*)$/);
            if (!base64Match) {
                  throw new Error('Invalid data URI format');
            }

            // Decode the base64 string to get the original string
            return Buffer.from(base64Match[1], 'base64').toString('utf8');
      } else {
            throw new Error(`Expected 1 argument for 'datauritostring' function, got ${args.length}`);
      }
}

const empty = (args) => {
      if (!Array.isArray(args) || args.length !== 1) {
            throw new Error(`Expected 1 argument for function 'empty', got ${args.length || 'none'}`);
      }

      const itemToTest = args[0];

      // Check if the item is an array and if it's empty
      if (Array.isArray(itemToTest)) {
            return itemToTest.length === 0;
      }
      // Check if the item is an object and if it's empty
      else if (typeof itemToTest === 'object' && itemToTest !== null) {
            return Object.keys(itemToTest).length === 0;
      }
      // Check if the item is a string and if it's empty
      else if (typeof itemToTest === 'string') {
            return itemToTest === '';
      }
      else if (!itemToTest){
            return true;
      } else {
            throw new Error(`Unsupported type for function 'empty'. Expected array, object, or string.`);
      }
}

const json = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 1) {
                  throw new Error(`Expected 1 arguments on function 'json', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      return JSON.parse(`${args[0]}`)
}

const startswith = (args) => {
      if (Array.isArray(args)) {
            if (args.length !== 2) {
                  throw new Error(`Expected 2 arguments for 'startswith', got ${args.length}`);
            }
      } else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let stringToSearch = String(args[0]);
      let stringToFind = String(args[1]);

      return stringToSearch.toLowerCase().startswith(stringToFind.toLowerCase());
}

const endswith = (args) => {
      if (Array.isArray(args)) {
            if (args.length !== 2) {
                  throw new Error(`Expected 2 arguments for 'endswith', got ${args.length}`);
            }
      } else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let stringToSearch = String(args[0]);
      let stringToFind = String(args[1]);

      return stringToSearch.toLowerCase().endsWith(stringToFind.toLowerCase());
}

const first = (args) => {
      if (!Array.isArray(args) || args.length !== 1) {
            throw new Error(`Expected 1 argument in 'args' array for function 'first', got ${args.length}`);
      }

      const value = args[0];

      if(!value)
            return null;

      if (typeof value === 'string') {
            return value.charAt(0);
      }

      if (Array.isArray(value) && value.length > 0) {
            return value[0];
      }

      throw new Error(`Unsupported type passed to 'first' function. Expected string or array, got ${typeof value}`);
}

const format = (args) => {
      if (!Array.isArray(args) || args.length < 2) {
            throw new Error("Invalid arguments for 'format' function.");
      }

      const formatString = args[0];
      const values = args.slice(1);

      // Helper function for formatting numbers
      const formatNumber = (num) => {
            return num.toLocaleString(); // Example: 8175133 becomes 8,175,133
      };

      return formatString.replace(/{(\d+)(?::([^\}]+))?}/g, (match, index, formatSpecifier) => {
            if (index < values.length) {
                  if (formatSpecifier === "N0") {
                        return formatNumber(values[index]);
                  }
                  return values[index];
            }
            return match;
      });
};

const guid = (args) => {
      throw new Error("Function 'guid' is unsupported")
};


const join = (args) => {
      if (!Array.isArray(args) || args.length != 2) {
            throw new Error("Invalid arguments provided to 'join' function");
      }
      return args[0].join(args[1]);
}

const last = (args) => {
      if (!Array.isArray(args) || args.length != 1) {
            throw new Error("Invalid arguments provided to 'last' function");
      }
      const inputValue = args[0];

      
      if(!inputValue)
            return null;

      if (typeof inputValue === 'string') {
            return inputValue.charAt(inputValue.length - 1);
      } else if (Array.isArray(inputValue)) {
            return inputValue[inputValue.length - 1];
      } 
      
      throw new Error("Invalid type provided to 'last' function. Expected string or array.");
      
}

const length = (args) => {
      if (typeof args[0] === 'string' || Array.isArray(args[0])) {
            return args[0].length;
      } else if (typeof args[0] === 'object' && args[0] !== null) {
            return Object.keys(args[0]).length;
      } else {
            throw new Error('Invalid argument type for length function.');
      }
}

const newGuid = () => {
      return [4, 2, 2, 2, 6].map((length) => {
            const bytes = crypto.randomBytes(length);
            return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');
      }).join('-');
}

const padLeft = (args) => {
      if (args.length < 2 || args.length > 3) {
            throw new Error('Invalid number of arguments for padLeft function.');
      }

      const valueToPad = String(args[0]);
      const totalLength = args[1];
      const paddingCharacter = args[2] || ' ';

      if (valueToPad.length >= totalLength) {
            return valueToPad;
      }

      return paddingCharacter.repeat(totalLength - valueToPad.length) + valueToPad;
}

const replace = (args) => {
      if (!Array.isArray(args) || args.length !== 3) {
            throw new Error(`Invalid arguments provided to 'replace' function`);
      }    

      const escapedOldString = args[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return args[0].replace(new RegExp(escapedOldString, 'g'), args[2]);
}

const skip = (args) => {
      if (!Array.isArray(args) || args.length !== 2) {
            throw new Error(`Invalid arguments provided to 'skip' function`);
      }

      if (typeof args[0] === 'string') {
            return args[0].substring(args[1]);
      } else if (Array.isArray(args[0])) {
            return args[0].slice(args[1]);
      } else {
            throw new Error(`Invalid type provided to 'skip' function`);
      }
}

const split = (args) => {
      if (!Array.isArray(args) || args.length !== 2) {
            throw new Error(`Invalid arguments provided to 'split' function`);
      }

      if (Array.isArray(args[1])) {
            let str = args[0];
            for (const delimiter of args[1]) {
                  str = str.split(delimiter).join("\0");
            }
            return str.split("\0");
      } else {
            return args[0].split(args[1]);
      }
}

const string = (args) => {
      if (args.length !== 1) {
            throw new Error(`Expected 1 argument for 'string', got ${args.length}`);
      }
      return JSON.stringify(args[0]);
};

const substring = (args) => {
      if (args.length < 2 || args.length > 3) {
            throw new Error(`Expected 2 or 3 arguments for 'substring', got ${args.length}`);
      }
      return args[0].substr(args[1], args[2]);
};

const take = (args) => {
      if (args.length !== 2) {
            throw new Error(`Expected 2 arguments for 'take', got ${args.length}`);
      }
      if (typeof args[0] === 'string') {
            return args[0].substring(0, args[1]);
      }
      return args[0].slice(0, args[1]);
};

const tolower = (args) => {
      if (args.length !== 1) {
            throw new Error(`Expected 1 argument for 'toLower', got ${args.length}`);
      }
      return args[0].toLowerCase();
};

const toupper = (args) => {
      if (args.length !== 1) {
            throw new Error(`Expected 1 argument for 'toUpper', got ${args.length}`);
      }
      return args[0].toUpperCase();
};

const trim = (args) => {
      if (args.length !== 1) {
            throw new Error(`Expected 1 argument for 'trim', got ${args.length}`);
      }
      return args[0].trim();
};

const uri = (args) => {
      if (!Array.isArray(args) || args.length !== 2) {
            throw new Error("Expected an array with 2 arguments for the 'uri' function.");
      }

      const [baseUri, relativeUri] = args;

      if (baseUri.endswith('/')) {
            return baseUri + relativeUri;
      } else if (!baseUri.includes('/') || baseUri.endswith('//')) {
            return baseUri + relativeUri;
      } else {
            return baseUri.substring(0, baseUri.lastindexof('/') + 1) + relativeUri;
      }
};

const uricomponent = (args) => {
      if (!Array.isArray(args) || args.length !== 1) {
            throw new Error("Expected an array with 1 argument for the 'uricomponent' function.");
      }

      return encodeuricomponent(args[0]);
};

const uricomponenttostring = (args) => {
      if (!Array.isArray(args) || args.length !== 1) {
            throw new Error("Expected an array with 1 argument for the 'uricomponenttostring' function.");
      }

      return decodeuricomponent(args[0]);
};

const subscription = async (args, context) => {
      if (args ? args.length !== 0 : false) {
            throw new Error("Expected 0 arguments for the 'subscription' function.");
      }
      if (!context ? true : !context.id) {
            throw new Error("Error getting context, contexts should have at least 'id' property.");
      }


      let id = take([context.id.split("/"), 3]).join('/')

      let sub = await getResourceById(id);

      return sub.resource
}

const resourcegroup = async (args, context) => {
      if (args ? args.length !== 0 : false) {
            throw new Error("Expected 0 arguments for the 'resourceGroup' function.");
      }
      if (!context ? true : !context.id) {
            throw new Error("Error getting context, contexts should have at least 'id' property.");
      }

      let id = take([context.id.split("/"), 5]).join('/')

      let rg = await getResourceById(id);

      return rg.resource
}

function createobject(args) {
      if (args.length % 2 !== 0) {
            throw new Error('The function expects an even number of parameters.');
      }
      const obj = {};
      for (let i = 0; i < args.length; i += 2) {
            obj[args[i]] = args[i + 1];
      }
      return obj;
}

function intersection(args) {
      if (!Array.isArray(args) || args.length < 2) {
            throw new Error("Expected at least 2 arguments for the 'intersection' function.");
      }
      // Check if the inputs are arrays or objects
      if (args.every(arg => Array.isArray(arg))) {
            return args.reduce((acc, arr) => acc.filter(item => arr.includes(item)));
      } else if (args.every(arg => typeof arg === 'object' && arg !== null)) {
            const firstObj = args[0];
            return Object.keys(firstObj)
                  .filter(key => args.every(obj => key in obj && obj[key] === firstObj[key]))
                  .reduce((acc, key) => {
                        acc[key] = firstObj[key];
                        return acc;
                  }, {});
      } else {
            throw new Error('All arguments must be of the same type, either all arrays or all objects.');
      }
}

function union(args) {
      if (!Array.isArray(args) || args.length < 2) {
            throw new Error("Expected at least 2 arguments for the 'union' function.");
      }
      // Check if the inputs are arrays or objects
      if (args.every(arg => Array.isArray(arg))) {
            const set = new Set(args.flat());
            return [...set];
      } else if (args.every(arg => typeof arg === 'object' && arg !== null)) {
            return Object.assign({}, ...args);
      } else {
            throw new Error('All arguments must be of the same type, either all arrays or all objects.');
      }
}

function items(args) {
      if (!Array.isArray(args) || args.length != 1) {
            throw new Error("Expected 1 argument for the 'items' function.");
      }

      return Object.keys(args[0]).map(key => ({
            key: key,
            value: args[0][key]
      }));
}

function add(args) {
      if (!Array.isArray(args) || args.length != 2) {
            throw new Error("Expected 2 arguments for the 'add' function.");
      }
      return args[0] + args[1];
}

function div(args) {
      if (!Array.isArray(args) || args.length != 2) {
            throw new Error("Expected 2 arguments for the 'div' function.");
      }
      if (args[1] === 0) throw new Error("Division by zero");
      return Math.floor(args[0] / args[1]);
}

function float(args) {
      if (!Array.isArray(args) || args.length != 1) {
            throw new Error("Expected 1 arguments for the 'float' function.");
      }
      return parseFloat(args[0]);
}

function int(args) {
      if (!Array.isArray(args) || args.length != 1) {
            throw new Error("Expected 1 arguments for the 'int' function.");
      }
      return parseInt(args[0]);
}

function max(args) {
      if (!Array.isArray(args) || args.length != 1) {
            throw new Error("Expected 1 arguments for the 'max' function.");
      }
      return Math.max(...args[0]);
}

function min(args) {
      if (!Array.isArray(args) || args.length != 1) {
            throw new Error("Expected 1 arguments for the 'min' function.");
      }
      return Math.min(...args[0]);
}

function mul(args) {
      if (!Array.isArray(args) || args.length != 2) {
            throw new Error("Expected 2 arguments for the 'mul' function.");
      }
      return args[0] * args[1];
}

function sub(args) {
      if (!Array.isArray(args) || args.length != 2) {
            throw new Error("Expected 2 arguments for the 'sub' function.");
      }
      return args[0] - args[1];
}

function and(args) {
      if (!Array.isArray(args) || args.length != 2) {
            throw new Error("Expected 2 arguments for the 'and' function.");
      }
      return args.every(val => val === true);
}
function bool(args) {
      if (!Array.isArray(args) || args.length != 1) {
            throw new Error("Expected 1 arguments for the 'bool' function.");
      }
      return !!args[0] && (args[0] !== "false");
}

function falsefunction() {
      return false;
}
function truefunction() {
      return true;
}

function iffunction(args) {
      if (!Array.isArray(args) || args.length != 3) {
            throw new Error("Expected 3 arguments for the 'if' function");
      }
      return args[0] ? args[1] : args[2];
}

function or(args) {
      if (!Array.isArray(args) || args.length != 2) {
            throw new Error("Expected 2 arguments for the 'or' function.");
      }
      return args.some(val => val === true);
}

const datetimeadd = (args) => {
      if (args.length < 2 || args.length > 3) {
            throw new Error(`Expected 2 or 3 arguments on function 'datetimeadd', got ${args.length}`);
      }

      const base = new Date(args[0]);
      const durationMatch = args[1].match(/(-)?P(\d+Y)?(\d+M)?(\d+D)?(T(\d+H)?(\d+M)?(\d+S)?)?/);
      const sign = durationMatch[1] === '-' ? -1 : 1;

      if (durationMatch) {
            const years = sign * (parseInt(durationMatch[2] || 0));
            const months = sign * (parseInt(durationMatch[3] || 0));
            const days = sign * (parseInt(durationMatch[4] || 0));
            const hours = sign * (parseInt(durationMatch[6] || 0));
            const minutes = sign * (parseInt(durationMatch[7] || 0));
            const seconds = sign * (parseInt(durationMatch[8] || 0));

            base.setFullYear(base.getFullYear() + years);
            base.setMonth(base.getMonth() + months);
            base.setDate(base.getDate() + days);
            base.setHours(base.getHours() + hours);
            base.setMinutes(base.getMinutes() + minutes);
            base.setSeconds(base.getSeconds() + seconds);
      }

      const format = args[2] || 'u';
      if (format === 'u') {
            return base.toISOString().replace(/\.\d{3}Z$/, 'Z');
      } else {
            // You can implement other format strings if needed
            throw new Error(`Format ${format} not supported`);
      }
};

function datetimefromepoch(args) {
      if (args.length !== 1) {
            console.error('Invalid number of parameters provided for datetimefromepoch function');
            return;
      }

      const date = new Date(args[0] * 1000); // Convert from seconds to milliseconds

      return date.toISOString();
}


function datetimetoepoch(args) {
      if (args.length !== 1) {
            console.error('Invalid number of parameters provided for datetimetoepoch function');
            return;
      }

      const date = new Date(args[0]);
      const epochTime = Math.floor(date.getTime() / 1000);

      return epochTime;
}


function utcnow(args) {
      if (args.length > 1) {
            console.error('Invalid number of parameters provided for utcnow function');
            return;
      }

      let format = args[0] || 'yyyy-MM-ddTHH:mm:ssZ'; // ISO 8601 format
      const currentDate = new Date();

      return currentDate.toISOString(); // Simple ISO conversion, more customization can be done using format.
}

const coalesce = (args) => {
      if (Array.isArray(args)) {
            if (args.length == 0) {
                  throw new Error(`Expected at least 1 arguments on function 'coalesce', got ${args.length}`);
            }
      }

      for (let arg of args) {
            if (arg !== null && typeof arg !== 'undefined') {
                  return arg;
            }
      }
      return null;
};

const greater = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'greater', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'greater' must be numbers or strings");
      }

      if (typeof args[0] === 'string' && typeof args[1] === 'string') {
            return args[0].localeCompare(args[1]) > 0;
      }

      return args[0] > args[1];
};

const greaterorequals = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'greaterorequals', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'greater' must be numbers or strings");
      }

      if (typeof args[0] === 'string' && typeof args[1] === 'string') {
            return args[0].localeCompare(args[1]) >= 0;
      }

      return args[0] >= args[1];
};

const less = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'less', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'greater' must be numbers or strings");
      }

      if (typeof args[0] === 'string' && typeof args[1] === 'string') {
            return args[0].localeCompare(args[1]) < 0;
      }

      return args[0] < args[1];
};

const lessorequals = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'less', but got " + args.length);
      }

      if ((typeof args[0] !== 'string' && typeof args[0] !== 'number') ||
            (typeof args[1] !== 'string' && typeof args[1] !== 'number')) {
            throw new Error("Arguments for 'greater' must be numbers or strings");
      }

      if (typeof args[0] === 'string' && typeof args[1] === 'string') {
            return args[0].localeCompare(args[1]) <= 0;
      }

      return args[0] <= args[1];
};

const array = (args) => {
      if (args.length !== 1) {
            throw new Error(`Expected 1 argument for function 'array', got ${args.length}`);
      }

      return [args[0]];
};

const createarray = (args) => {
      return args;
};

const indexof = (args) => {
      if (!Array.isArray(args)) {
            throw new Error("Expected an array argument for 'args'");
      }

      if (args.length !== 2) {
            throw new Error(`Expected 2 arguments for 'indexof', got ${args.length}`);
      }

      let [searchContainer, itemToFind] = args;

      if (Array.isArray(searchContainer)) {
            for (let i = 0; i < searchContainer.length; i++) {
                  if (JSON.stringify(searchContainer[i]) === JSON.stringify(itemToFind)) {
                        return i;
                  }
            }
      } else if (typeof searchContainer === "string" && typeof itemToFind === "string") {
            return searchContainer.toLowerCase().indexOf(itemToFind.toLowerCase());
      } else {
            throw new Error("Invalid argument types provided");
      }

      return -1;
}

const lastindexof = (args) => {
      if (!Array.isArray(args)) {
            throw new Error("Expected an array argument for 'args'");
      }

      if (args.length !== 2) {
            throw new Error(`Expected 2 arguments for 'lastindexof', got ${args.length}`);
      }

      let [searchContainer, itemToFind] = args;

      if (Array.isArray(searchContainer)) {
            for (let i = searchContainer.length - 1; i >= 0; i--) {
                  if (JSON.stringify(searchContainer[i]) === JSON.stringify(itemToFind)) {
                        return i;
                  }
            }
      } else if (typeof searchContainer === "string" && typeof itemToFind === "string") {
            return searchContainer.toLowerCase().lastIndexOf(itemToFind.toLowerCase());
      } else {
            throw new Error("Invalid argument types provided");
      }

      return -1;
}

const range = (args) => {
      if (!Array.isArray(args)) {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      if (args.length != 2) {
            throw new Error(`Expected 2 arguments for function 'range', got ${args.length}`);
      }

      let startIndex = args[0];
      let count = args[1];

      if (typeof startIndex !== 'number' || typeof count !== 'number') {
            throw new Error(`Both arguments of 'range' function must be of type 'number'`);
      }

      if (startIndex + count > 2147483647) {
            throw new Error(`The sum of startIndex and count must be no greater than 2147483647`);
      }

      if (count < 0 || count > 10000) {
            throw new Error(`The count must be a non-negative integer up to 10000`);
      }

      return Array.from({ length: count }, (_, i) => startIndex + i);
}


const parameters = (args, context) => {
      if (!Array.isArray(args))
            throw new Error("Expected an array argument for 'parameters'");

      if (args.length !== 1)
            throw new Error(`Expected 1 arguments for 'parameters', got ${args.length}`);

      if (!context)
            throw new Error(`Context missing for 'parameters' function.`);

      if (!context.parameters)
            throw new Error(`Context has no paramaters in 'parameters' function.`);

      //Make Parameters case insensitive
      let availableParameters = Object.keys(context.parameters);
      let selectedParameter = availableParameters.find((p) => p.toLocaleLowerCase() == `${args[0]}`.toLocaleLowerCase());

      if (!context.parameters[selectedParameter])
            throw new Error(`Context has parameters has no value for '${args[0]}' to resolve 'parameters' function.`);


      return context.parameters[selectedParameter];
}

const inMemory = {
      aliases: null
}

const field = async (args, context, pathOnly = false) => {
      if (!Array.isArray(args)) {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      if (args.length != 1) {
            throw new Error(`Expected 1 arguments for function 'field', got ${args.length}`);
      }

      if (!context.resource) {
            throw new Error(`Expected resource in the context for function 'field'`);
      }

      if(context.fieldOverride && context.fieldOverride[args[0].toLowerCase()]){
            return context.fieldOverride[args[0].toLowerCase()];
      }

      if (!inMemory.aliases) {
            if (fs.existsSync('./aliases.json'))
                  inMemory.aliases = JSON.parse(fs.readFileSync('./aliases.json', 'utf-8'))
            else {
                  let aliases = await RetrieveAliases();
                  inMemory.aliases = aliases;
                  fs.writeFileSync('./aliases.json', JSON.stringify(aliases), { encoding: 'utf-8' });
            }
      }
      let path = null;
      for (let alias of inMemory.aliases) {
            if (alias.name.toLowerCase() === args[0].toLowerCase()) {
                  //console.log(alias)
                  path = `${alias.defaultPath}`
            }
      }

      if (!path && !`${args[0]}`.toLowerCase().startsWith('tags['))
            throw new Error(`Alias '${args[0]}' was not`);
      else if(`${args[0]}`.toLowerCase().startsWith('tags[')){
            let tagName = `${`${args[0]}`.split('[')[1]}`.split(']')[0];
            return getPropertyFromObject(context.resource, ['tags',tagName]);
      }

      Object.keys(context.applicable).forEach((applicableField) => {
            if(args[0].toLowerCase() == applicableField){
                  context.applicability[applicableField] = true;
                  if(context.applicable[applicableField] != true){
                        context.applicable[applicableField] = context.currentConditionHash;
                  }
            }
      });

      if (pathOnly)
            return path;

      if (context.countDepthMap) {
            path = replaceAsterisksWithNumbers(path, context.countDepthMap)
      }

      let propertyPaths = path.split('.');

      if (propertyPaths.some((p) => endswith([p, '[*]']))) {
            const expandArray = (baseContext, remainingPath, depth = 0) => {
                  if (depth > 50) {
                        throw new Error("Exceeded allowed depth of 50");
                  }
                  let results = [];
                  for (let p = 0; p < remainingPath.length; p++) {
                        let path = remainingPath[p];
                        if (endswith([path, '[*]'])) {
                              let items = getPropertyFromObject(baseContext, [path.substring(0, path.length - 3)]);
                              //console.log(`Running field function:`,JSON.stringify(baseContext), JSON.stringify(items));
                              if(!items){
                                    return null;
                              }

                              for (let item of items) {
                                    results.push(expandArray(item, remainingPath.slice(p + 1, remainingPath.length), ++depth))
                              }
                        }
                        else {
                              baseContext = getPropertyFromObject(baseContext, [path]);
                        }
                  }

                  if(results.length == 0 && baseContext){
                        return baseContext;
                  }

                  return results;
            }
            let currentValue = expandArray(context.resource, propertyPaths);

            return currentValue;
      }
      else {
            
            if(args[0].toLowerCase() == 'fullname'){
                  return extractFullName(context.resource.id);
            }

            return getPropertyFromObject(context.resource, propertyPaths);
      }
}

function extractFullName(resourceId) {
      // Split the resource ID by slashes
      const parts = resourceId.split('/');
  
      // Find the first occurrence of "providers" and start processing after it
      const providerIndex = parts.indexOf("providers");
      if (providerIndex === -1) return ""; // if "providers" not found, return empty
  
      // Filter out the resource names after "providers"
      const nameParts = [];
      for (let i = providerIndex + 3; i < parts.length; i += 2) {
          nameParts.push(parts[i]);
      }
  
      return nameParts.join('/');
  }
  
function current(args, context) {
      if (!Array.isArray(args)) {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      if (args.length > 1) {
            throw new Error(`Expected a maximum of 1 arguments for function 'current', got ${args.length}`);
      }

      if (!context.countContext) {
            throw new Error(`Expected current to be used within a 'count'`);
      }

      if (args.length == 1) {
            return context.countContext[args[0]][context.countContextIndex];
      }
      else {
            return context.countContext[Object.keys(context.countContext).pop()][context.countContextIndex];
      }
}

function replaceAsterisksWithNumbers(str, arr) {
      let index = 0;
      return str.replace(/\[\*\]/g, (match) => {
            if (index < arr.length) {
                  return `[${arr[index++]}]`;
            }
            return match; // In case there are more [*] than array elements (shouldn't happen based on your problem description)
      });
}

const requestcontext = (args, context) => {
      if (!Array.isArray(args)) {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      if (args.length > 0) {
            throw new Error(`Expected a maximum of 0 arguments for function 'requestContext', got ${args.length}`);
      }

      return context.request;
}

const operations = {
      requestcontext,
      range,
      field,
      current,
      parameters,
      array,
      createarray,
      greater,
      greaterorequals,
      less,
      lessorequals,
      coalesce,
      datetimeadd,
      datetimefromepoch,
      datetimetoepoch,
      utcnow,
      truefunction,
      falsefunction,
      iffunction,
      and,
      or,
      bool,
      add,
      div,
      mul,
      max,
      min,
      sub,
      float,
      int,
      base64,
      base64tojson,
      base64tostring,
      createobject,
      concat,
      contains,
      datauri,
      datauritostring,
      endswith,
      empty,
      equals,
      first,
      format,
      not,
      json,
      startswith,
      guid,
      indexof,
      join,
      last,
      lastindexof,
      newGuid,
      length,
      padLeft,
      replace,
      skip,
      split,
      string,
      substring,
      subscription,
      resourcegroup,
      tolower,
      toupper,
      trim,
      take,
      uri,
      uricomponent,
      uricomponenttostring,
      intersection,
      union,
      items

};

const availableFunctions = () => {
      let available = [];
      for (let operation in operations) {
            available.push(operation);
      }

      return available;
}

module.exports = { ResolveFunctions, IsFunction, availableFunctions, field, endswith }
