const ResolveCondition = (c, context) => {
      let condition = {
            rawCondition:c,
            result: null
      }

      let keys = Object.keys(c);

      if(keys.length == 1){
            condition.result = typeof operations[keys[0]] === "function"
                  ? operations[keys[0]](c, context)
                  : new Error(`Function ${keys[0]} not found!`);
      }
      else if(keys.length == 2) {
            let valueKey = keys.find(k => {
                  return `${k}`.toLocaleLowerCase() == "value" || `${k}`.toLocaleLowerCase() == "field"
            });
            let operationKey = keys.find(k => {
                  return `${k}`.toLocaleLowerCase() != "value" && `${k}`.toLocaleLowerCase() != "field"
            });

            if(!valueKey)
                  throw new Error(`Conditions should have either 'field' or 'value' operators`);

            if(!operationKey)
                  throw new Error(`Conditions should have an operation, such as 'equals','greater', etc...`);

            let arg0 = c[valueKey];
            let arg1 = c[operationKey];
            let isFunction0 = `${arg0}`[0] == "[" && `${arg0}`[`${arg0}`.length - 1] == "]";
            let isFunction1 = `${arg1}`[0] == "[" && `${arg1}`[`${arg1}`.length - 1] == "]";

            if(isFunction0 && IsFunction(`${arg0}`.substring(1, `${arg0}`.length - 2))){
                  arg0 = ResolveFunctions(
                        ParseFunction(arg0),
                        context
                  );
            }

            if(isFunction1 && IsFunction(`${arg1}`.substring(1, `${arg1}`.length - 2))){
                  arg1 = ResolveFunctions(
                        ParseFunction(arg1),
                        context
                  );
            }

            if(valueKey == "field"){         
                  arg0 = ResolveFunctions(
                        ParseFunction(`field('${arg0}')`),
                        context
                  );
            }

            console.log(`Arg0: ${JSON.stringify(arg0)}`)
            console.log(`Arg1: ${JSON.stringify(arg1)}`)

            condition.result = typeof operations[operationKey] === "function"
                  ? operations[operationKey]([arg0,arg1], context)
                  : new Error(`Function ${operationKey} not found!`);
      }
      else{
            throw new Error('Unrecognized condition');
      }

      console.log(condition);
      
      return condition;
}



const allOf = (c, context) => {
      let condition = {
            rawCondition:c,
            result: null
      }

      let results = [];

      for(let node of c.allOf){
            results.push(ResolveCondition(node, context))
      }

      condition.result = results.every(r => r.result == true);

      return condition;
}

const anyOf = (c, context) => {
      let condition = {
            rawCondition:c,
            result: null
      }

      let results = [];

      for(let node of c.anyOf){
            results.push(ResolveCondition(node, context).result)
      }

      condition.result = results.some(r => r.result == true);

      return condition;
}

const not = (c, context) => {
      let condition = {
            rawCondition:c,
            result: null
      }

      condition.result = !ResolveCondition(c['not'], context).result

      return condition;
}

const operations = {
      allOf,
      anyOf,
      not,
}

const { IsFunction, ResolveFunctions } = require('./functions');
const { ParseFunction } = require('./parser');

module.exports = { ResolveCondition }