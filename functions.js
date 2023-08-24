const crypto = require('crypto');
const { IsFunction } = require('./parser');
const { RetrieveAliases, RetrieveAliasesSync } = require('./azureApi');
const fs = require('fs');

const getPropertyFromObject = (obj, properties) => {
      for (let prop of properties) {
            if (obj && obj.hasOwnProperty(prop)) {
                  obj = obj[prop];
            } else {
                  return undefined;
            }
      }
      return obj;
};

const ResolveFunctions = (functionTree, context) => {
      if (functionTree.type != "Function") {
            throw new Error(`Not a function...`);
      }
      let argValues = [];

      for (let arg of functionTree.args) {
            if (arg.type == "Function") {
                  arg.value = ResolveFunctions(arg, context);
            }

            argValues.push(arg.value);
      }

      functionTree.args = argValues;

      const result = typeof operations[functionTree.method] === "function"
            ? operations[functionTree.method](argValues, context)
            : new Error(`Function ${functionTree.method} not found!`);

      if (functionTree.properties) {
            return getPropertyFromObject(result, functionTree.properties);
      }

      return result;
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

      return String(args[0]) == String(args[1])
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

const base64ToString = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 1) {
                  throw new Error(`Expected 1 arguments on function 'base64ToString', got ${args.length}`);
            }
      }
      else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      return atob(`${args[0]}`)
}

const base64ToJson = (args) => {
      if (Array.isArray(args)) {
            if (args.length != 1) {
                  throw new Error(`Expected 1 arguments on function 'base64ToJson', got ${args.length}`);
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
            return String(args[0]).includes(String(args[1]))
      }
}



const dataUri = (args) => {
      if (Array.isArray(args) && args.length === 1) {
            const stringToConvert = args[0];

            // Convert the string to base64
            const base64String = Buffer.from(stringToConvert).toString('base64');

            // Return the formatted data URI
            return `data:text/plain;charset=utf8;base64,${base64String}`;
      } else {
            throw new Error(`Expected 1 argument for 'dataUri' function, got ${args.length}`);
      }
}

// Helper function to convert a dataUri back to a string
const dataUriToString = (args) => {
      if (Array.isArray(args) && args.length === 1) {
            const dataUri = args[0];

            // Extract the base64 part of the data URI
            const base64Match = dataUri.match(/base64,(.*)$/);
            if (!base64Match) {
                  throw new Error('Invalid data URI format');
            }

            // Decode the base64 string to get the original string
            return Buffer.from(base64Match[1], 'base64').toString('utf8');
      } else {
            throw new Error(`Expected 1 argument for 'dataUriToString' function, got ${args.length}`);
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
      else {
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

const startsWith = (args) => {
      if (Array.isArray(args)) {
            if (args.length !== 2) {
                  throw new Error(`Expected 2 arguments for 'startsWith', got ${args.length}`);
            }
      } else {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      let stringToSearch = String(args[0]);
      let stringToFind = String(args[1]);

      return stringToSearch.toLowerCase().startsWith(stringToFind.toLowerCase());
}

const endsWith = (args) => {
      if (Array.isArray(args)) {
            if (args.length !== 2) {
                  throw new Error(`Expected 2 arguments for 'endsWith', got ${args.length}`);
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
      if (typeof inputValue === 'string') {
            return inputValue.charAt(inputValue.length - 1);
      } else if (Array.isArray(inputValue)) {
            return inputValue[inputValue.length - 1];
      } else {
            throw new Error("Invalid type provided to 'last' function. Expected string or array.");
      }
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
      return args[0].replace(new RegExp(args[1], 'g'), args[2]);
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

const toLower = (args) => {
      if (args.length !== 1) {
            throw new Error(`Expected 1 argument for 'toLower', got ${args.length}`);
      }
      return args[0].toLowerCase();
};

const toUpper = (args) => {
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

      if (baseUri.endsWith('/')) {
            return baseUri + relativeUri;
      } else if (!baseUri.includes('/') || baseUri.endsWith('//')) {
            return baseUri + relativeUri;
      } else {
            return baseUri.substring(0, baseUri.lastIndexOf('/') + 1) + relativeUri;
      }
};

const uriComponent = (args) => {
      if (!Array.isArray(args) || args.length !== 1) {
            throw new Error("Expected an array with 1 argument for the 'uriComponent' function.");
      }

      return encodeURIComponent(args[0]);
};

const uriComponentToString = (args) => {
      if (!Array.isArray(args) || args.length !== 1) {
            throw new Error("Expected an array with 1 argument for the 'uriComponentToString' function.");
      }

      return decodeURIComponent(args[0]);
};

const subscription = (args, context) => {
      if (args ? args.length !== 0 : false) {
            throw new Error("Expected 0 arguments for the 'subscription' function.");
      }
      if (!context ? true : !context.id) {
            throw new Error("Error getting context, contexts should have at least 'id' property.");
      }

      let id = take([context.id.split("/"), 3]).join('/')
      let subscriptionId = take([skip([context.id.split("/"), 2]), 1])

      return {
            id: id,
            subscriptionId: subscriptionId
      }
}

const resourceGroup = (args, context) => {
      if (args ? args.length !== 0 : false) {
            throw new Error("Expected 0 arguments for the 'resourceGroup' function.");
      }
      if (!context ? true : !context.id) {
            throw new Error("Error getting context, contexts should have at least 'id' property.");
      }

      let id = take([context.id.split("/"), 5]).join('/')
      let name = take([skip([context.id.split("/"), 4]), 1])

      return {
            id: id,
            name: name
      }
}

function createObject(args) {
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

function falseFunction() {
      return false;
}
function trueFunction() {
      return true;
}

function ifFunction(args) {
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

const dateTimeAdd = (args) => {
      if (args.length < 2 || args.length > 3) {
            throw new Error(`Expected 2 or 3 arguments on function 'dateTimeAdd', got ${args.length}`);
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

function dateTimeFromEpoch(args) {
      if (args.length !== 1) {
            console.error('Invalid number of parameters provided for dateTimeFromEpoch function');
            return;
      }

      const date = new Date(args[0] * 1000); // Convert from seconds to milliseconds

      return date.toISOString();
}


function dateTimeToEpoch(args) {
      if (args.length !== 1) {
            console.error('Invalid number of parameters provided for dateTimeToEpoch function');
            return;
      }

      const date = new Date(args[0]);
      const epochTime = Math.floor(date.getTime() / 1000);

      return epochTime;
}


function utcNow(args) {
      if (args.length > 1) {
            console.error('Invalid number of parameters provided for utcNow function');
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

const greaterOrEquals = (args) => {
      if (args.length !== 2) {
            throw new Error("Expected 2 arguments for 'greaterOrEquals', but got " + args.length);
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

const lessOrEquals = (args) => {
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

const createArray = (args) => {
      return args;
};

const indexOf = (args) => {
      if (!Array.isArray(args)) {
            throw new Error("Expected an array argument for 'args'");
      }

      if (args.length !== 2) {
            throw new Error(`Expected 2 arguments for 'indexOf', got ${args.length}`);
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

const lastIndexOf = (args) => {
      if (!Array.isArray(args)) {
            throw new Error("Expected an array argument for 'args'");
      }

      if (args.length !== 2) {
            throw new Error(`Expected 2 arguments for 'lastIndexOf', got ${args.length}`);
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

      if (!context.parameters[args[0]])
            throw new Error(`Context has parameters has no value for '${args[0]}' to resolve 'parameters' function.`);

      return context.parameters[args[0]];
}

const inMemory = {
      aliases:null
}

const field = (args, context) => {
      if (!Array.isArray(args)) {
            throw new Error(`Call this function using 'Array' type arguments`);
      }

      if (args.length != 1) {
            throw new Error(`Expected 1 arguments for function 'field', got ${args.length}`);
      }

      if (!context.resource) {
            throw new Error(`Expected resource in the context for function 'field'`);
      }

      if(!inMemory.aliases){
            if(fs.existsSync('./aliases.json'))
                  inMemory.aliases = JSON.parse(fs.readFileSync('./aliases.json', 'utf-8'))
            else{
                  let aliases = RetrieveAliasesSync();
                  inMemory.aliases = aliases;
                  fs.writeFileSync('./aliases.json', JSON.stringify(aliases), {encoding: 'utf-8'});
            }
      }
      let path = null;
      for(let alias of inMemory.aliases){
            if(alias.name === args[0]){
                  console.log(alias)
                  path = `${alias.defaultPath}`
            }
      }

      if(!path)
            throw new Error(`Alias '${args[0]}' was not`);

      return getPropertyFromObject(context.resource,path.split('.'));
}

const operations = {
      range,
      field,
      parameters,
      array,
      createArray,
      greater,
      greaterOrEquals,
      less,
      lessOrEquals,
      coalesce,
      dateTimeAdd,
      dateTimeFromEpoch,
      dateTimeToEpoch,
      utcNow,
      trueFunction,
      falseFunction,
      ifFunction,
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
      base64ToJson,
      base64ToString,
      createObject,
      concat,
      contains,
      dataUri,
      dataUriToString,
      endsWith,
      empty,
      equals,
      first,
      format,
      not,
      json,
      startsWith,
      guid,
      indexOf,
      join,
      last,
      lastIndexOf,
      newGuid,
      length,
      padLeft,
      replace,
      skip,
      split,
      string,
      substring,
      subscription,
      resourceGroup,
      toLower,
      toUpper,
      trim,
      take,
      uri,
      uriComponent,
      uriComponentToString,
      intersection,
      union,
      items

};

module.exports = { ResolveFunctions, IsFunction, operations }
