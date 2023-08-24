const { operations } = require('./functions');
const availableFunctions = () => {
      let available = [];
      for (let operation in operations)
            available.push(operation);

      return available;
}

const propertyAccessPattern = /(?:\.([a-zA-Z_][a-zA-Z_0-9]*)|\[['"]?([a-zA-Z_][a-zA-Z_0-9]*)['"]?\])/g;

const ParseFunction = (f) => {
      let functionTree = {
            type: 'Function',
            method: '',
            args: [],
            value: null
      }

      let loadedMethod = false;
      let currentArgument = '';
      let depth = 0;
      let literal = null;
      let depth0f = '';

      for (let c = 0; c < f.length; c++) {
            if(depth == 0 || (depth == 1 && f[c] == ")")){
                  depth0f += f[c];
            }

            if (f[c] == "(" && !loadedMethod) {
                  loadedMethod = true;
                  //Reserved words
                  switch(functionTree.method){
                        case "if":
                              functionTree.method = "ifFunction";
                              break;
                        case "true":
                              functionTree.method = "trueFunction";
                              break;
                        case "false":
                              functionTree.method = "falseFunction";
                              break;
                  }
                  depth++;
                  continue;
            }

            if (f[c] == "'" && depth > 0 && f[c - 1] != "\\" && (literal == f[c] || literal == null)) {
                  if (literal == "'") {
                        literal = null;
                  }
                  else {
                        literal = "'";
                  }
                  currentArgument += f[c];
                  continue;
            }

            if (f[c] == '"' && depth > 0 && f[c - 1] != "\\" && (literal == f[c] || literal == null)) {
                  if (literal == '"') {
                        literal = null;
                  }
                  else {
                        literal = '"';
                  }
                  currentArgument += f[c];
                  continue;
            }

            if (f[c] == "(" && !literal) {
                  depth++;
            }

            if (f[c] == ")" && !literal) {
                  depth--;
            }

            if (!loadedMethod) {
                  functionTree.method += f[c]
                  continue;
            }

            if (depth <= 1 && (f[c] == "," || (f[c] == ")" && ((c+1 < f.length ? f[c+1] != "." && f[c+1] != "[" : true))) || depth == 0) && !literal) {
                  if (f[c] == ")" && depth >= 1) {
                        currentArgument += f[c];
                  }

                  if (currentArgument == "") {
                        continue;
                  }

                  console.log(`Adding new Argument: ${currentArgument}`)

                  functionTree.args.push(currentArgument);
                  currentArgument = '';
                  continue;
            }

            currentArgument += f[c];
      }

      let parsedArgs = [];

      for (let arg of functionTree.args) {
            parsedArgs.push(ParseArgument(arg));
      }

      functionTree.args = parsedArgs;

      let properties = [];
      let match;
      while (match = propertyAccessPattern.exec(depth0f)) {
        properties.push(match[1] || match[2] || match[3]);
      }
      if (properties.length > 0) {
        functionTree.properties = properties;
      }

      return functionTree;
}

const ParseArgument = (arg) => {
      
      let argType = null;
      let argumentTree = {};
      if ((`${arg}`[0] == "'" && `${arg}`[`${arg}`.length - 1] == "'") || (`${arg}`[0] == '"' && `${arg}`[`${arg}`.length - 1] == '"')) {
            argType = "string";
            argumentTree = {
                  type: argType,
                  method: null,
                  args: null,
                  value: `${arg}`.substring(1, `${arg}`.length - 1)
            }
      }
      else {
            if (IsFunction(`${arg}`)) {
                  argumentTree = ParseFunction(`${arg}`)
            }
            else {
                  argType = typeof (JSON.parse(arg));
                  argumentTree = {
                        type: argType,
                        method: null,
                        args: null,
                        value: JSON.parse(arg)
                  }
            }
      }
      
      return argumentTree;
}

const IsFunction = (f) => {
      const getFunctionName = (str) => {
            // Regex to identify function patterns
            const functionPattern = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*\((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*\)/;
            
            const match = functionPattern.exec(str);
            
            // Return the function name if a match is found
            return match ? match[1] : null;
      };

      let availableFunction = false;
      
      for (let af of availableFunctions()) {
            if(availableFunction)
                  continue;

            if (af == getFunctionName(f) || af == `${getFunctionName(f)}Function`) {
                  availableFunction = true;
            }
      }

      return availableFunction;
}

module.exports = { ParseFunction, IsFunction }

