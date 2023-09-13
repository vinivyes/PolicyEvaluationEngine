const propertyAccessPattern = /(?:\.([a-zA-Z_][a-zA-Z_0-9]*)|\[['"]?([^'"\]]+)['"]?\])/g;
const { IsFunction} = require('./functions');

const ParseFunction = (f) => {
      let functionTree = {
            type: 'Function',
            method: '',
            args: [],
            value: null,
            original:f
      }

      let loadedMethod = false;
      let currentArgument = '';
      let depth = 0;
      let literal = null;
      let depth0f = '';
      let propertyAccessNumber = 0;

      let propertyAccessorStart = 0;

      for (let c = 0; c < f.length; c++) {
            if((depth == 0 && propertyAccessorStart == 0) || (depth == 1 && f[c] == ")" && propertyAccessorStart == 0)){
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

            if(f[c] == "[" && f[c+1] != "'" && f[c+1] != '"' && !literal && propertyAccessorStart == 0){
                  depth0f += `'{${propertyAccessNumber}}'`
                  propertyAccessNumber++;
            }

            if(f[c] == "[" && f[c+1] != "'" && f[c+1] != '"' && !literal){
                  propertyAccessorStart++;
                  currentArgument += f[c];
                  continue;
            }

            if(f[c] == "]" && !literal && propertyAccessorStart > 1){
                  propertyAccessorStart--;
                  currentArgument += f[c];
                  continue;
            }

            if(f[c] == "]" && !literal && propertyAccessorStart >= 1){
                  propertyAccessorStart--;
                  currentArgument += f[c];
                  depth0f += f[c];
                  if(depth <= 1){
                        functionTree.args.push(currentArgument);
                        currentArgument = '';
                  }
                  continue;
            }

            if(propertyAccessorStart > 0){
                  currentArgument += f[c];
                  continue;
            }

            if (depth <= 1 && (f[c] == "," || (f[c] == ")" && ((c+1 < f.length ? f[c+1] != "." && f[c+1] != "[" : true))) || depth == 0) && !literal) {
                  if (f[c] == ")" && depth >= 1) {
                        currentArgument += f[c];
                  }

                  if (currentArgument == "") {
                        continue;
                  }

                  //console.log(`Adding new Argument: ${currentArgument}`)

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
      properties = properties.map((property) => {
            if(property.startsWith('{') && property.endsWith('}')){
                  const index = functionTree.args.findIndex(n => n.type == `property`);

                  let retrievedValue;
                  if (index !== -1) {
                        // Remove the found value from the array and get the value
                        [retrievedValue] = functionTree.args.splice(index, 1);

                        return retrievedValue.value;
                  }
                  else{
                        return null;
                  }
            }
            else{
                  return property;
            }
      })
      if (properties.length > 0) {
        functionTree.properties = properties;
      }

      return functionTree;
}

const ParseArgument = (arg) => {
      arg = `${arg}`.trim();
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
                  let isPropertyFunction = `${arg}`.startsWith(`[`) && `${arg}`.endsWith(`]`)
                  let _propertyFunction = `${arg}`.substring(1,`${arg}`.length-1);
                  let argType = `unknown`;
                  try{
                        argType = isPropertyFunction ? `property` : typeof (JSON.parse(arg));
                  }
                  catch(err){
                        console.error(err)
                  }
                  argumentTree = {
                        type: argType,
                        method: null,
                        args: null,
                        value: isPropertyFunction ? ParseFunction(`${_propertyFunction}`) : JSON.parse(arg)
                  }
            }
      }
      
      return argumentTree;
}

//const result = ParseFunction(`parameters('FamilySKU').myStatic[parameters('SKUFamily')[field('microsoft.compute/virtualmachines/hardwareProfile.vmSize')]][field('microsoft.compute/virtualmachines/hardwareProfile.vmSize')]['myStatic2']`)
//console.log(result)

module.exports = { ParseFunction }

