const {
      ParseFunction
} = require('./parser');

const {
      ResolveCondition,
      getPropertyFromObject
} = require('./conditions');

const {
      getResourceById,
      RetrievePolicy
} = require('./azureApi');
const { ResolveFunctions } = require('./functions');

const GetCompliance = async (policyData, resourceId) => {
      let resource = await getResourceById(resourceId);
      if (!resource || !resource.resource)
            return null;

      if (!resource.resource.type)
            resource.resource.type = `${resourceId}`.toLowerCase().includes('resourcegroups') ? 'Microsoft.Resources/subscriptions/resourceGroups' : 'Microsoft.Resources/subscriptions'

      //Retrieve location from parent resource
      if (resource.resource.type.split('/').length > 2) {
            let idSegments = resource.resource.id.split('/');
            idSegments = idSegments.slice(0, idSegments.length - ((resource.resource.type.split('/').length - 2) * 2))
            let parentId = idSegments.join("/");
            let parentResource = await getResourceById(parentId);
            if (parentResource && parentResource.resource) {
                  resource.resource.location = parentResource.resource.location;
                  resource.resource.tags = parentResource.resource.tags;
            }
      }

      let context = {
            parameters: policyData.Parameters,
            id: resourceId,
            resource: resource.resource,
            policyAssignmentId: policyData.PolicyAssignmentID,
            policyDefinitionId: policyData.PolicyDefinitionID,
            policyDefinitionRefId: policyData.DefinitionRefID,
            request: {
                  apiVersion: resource.apiVersion
            },
            policyRule: policyData.PolicyRule
      }

      let effect = policyData.PolicyRule.then.effect;
      let isFunctionEffect = `${effect}`[0] == "[" && `${effect}`[`${effect}`.length - 1] == "]";
      if (isFunctionEffect) {
            effect = (await ResolveFunctions(
                  ParseFunction(`${effect}`.substring(1, `${effect}`.length - 1)),
                  context
            )).value;
      }

      context.effect = `${effect}`.toLowerCase();
      let result = await ResolveCondition(policyData.PolicyRule.if, context);
      
      let ifNotExistsResolution = [];

      for(let resolution of result.ifnotexists ? result.ifnotexists.rawEvaluation : []){
            ifNotExistsResolution.push({
                  resource: resolution.resource,
                  ifNotExistsResolution: GenerateInlineResolution(resolution.evaluation)
            })
      }

      return {
            result: result,
            context: context,
            ifResolution: GenerateInlineResolution(result),
            ifNotExistsResolution: ifNotExistsResolution,
      }
}

const GenerateInlineResolution = (res) => {
      if(!res){
            return null;
      }

      let policyResolution = {};
      const addToPolicyResolution = (result) => {
            let newPr = {};
            if (result.rawOperation) {
                  newPr = result.rawOperation;
                  if (newPr.FieldKey == "count") {
                        newPr["context"] = newPr.FieldValueRaw.context;
                  }
                  if (newPr.OperationValueRaw) {
                        newPr.OperationValueRaw = addToPolicyResolution(newPr.OperationValueRaw);
                  }
                  if (newPr.FieldValueRaw) {
                        newPr.FieldValueRaw = addToPolicyResolution(newPr.FieldValueRaw);
                  }
            }
            else if (result.rawResults) {
                  let rawResults = [];
                  for (let r = 0; r < result.rawResults.length; r++) {
                        let rr = result.rawResults[r];

                        rawResults.push(addToPolicyResolution(rr));
                  }
                  return rawResults;
            }
            else if (result.rawResult) {
                  return addToPolicyResolution(result.rawResult);
            }
            return Object.keys(newPr).length == 0 ? result : newPr;
      }

      policyResolution = addToPolicyResolution(res);

      let inlinePolicyResolution = {};
      let inlinePolicyResolutionNoFunctions = {};
      const addToInlinePolicyResolution = (pr, noFunctions = false) => {
            let newPr = {};
            if (pr.context) {
                  newPr["context"] = pr.context;
            }
            if (pr.OperationKey) {
                  newPr[pr.OperationKey] = noFunctions && pr.OperationKey != "not" ? pr.OperationValue : addToInlinePolicyResolution(pr.OperationValueRaw, noFunctions);
                  if (pr.OperationValueRaw != pr.OperationValue && typeof pr.OperationValueRaw == "object" && pr.OperationValueRaw.original) {
                        newPr[`${pr.OperationKey}Expression`] = pr.OperationValueRaw.original;
                  }
                  if (pr.OperationValueRaw && pr.FieldKey && pr.OperationValueRaw != pr.OperationValue && !noFunctions) {
                        newPr[`${pr.OperationKey}_result`] = pr.OperationValue;
                  }
                  if (Array.isArray(pr.OperationValueRaw)) {
                        let newValue = []
                        for (let operation of pr.OperationValueRaw) {
                              newValue.push(addToInlinePolicyResolution(operation, noFunctions));
                        }
                        newPr[pr.OperationKey] = newValue;
                  }
            }
            if (pr.FieldKey) {

                  newPr[pr.FieldKey] = noFunctions ? pr.FieldValue : addToInlinePolicyResolution(pr.FieldValueRaw, noFunctions);
                  if (pr.FieldValueRaw != pr.FieldValue && typeof pr.FieldValueRaw == "object" && pr.FieldValueRaw.original) {
                        newPr[`${pr.FieldKey}Expression`] = pr.FieldValueRaw.original;
                  }
                  if (pr.FieldValueRaw && pr.FieldValueRaw != pr.FieldValue && !noFunctions) {
                        newPr[`${pr.FieldKey}_result`] = pr.FieldValue;
                  }
                  if (Array.isArray(pr.FieldValueRaw)) {
                        let newValue = []
                        for (let operation of pr.FieldValueRaw) {
                              newValue.push(addToInlinePolicyResolution(operation, noFunctions));
                        }
                        newPr[pr.FieldKey] = newValue;
                  }
            }
            else if (typeof pr.OperationValue != "undefined") {
                  newPr["result"] = pr.OperationValue;
            }

            if (typeof getPropertyFromObject(pr, 'path') != "undefined") {
                  newPr["path"] = getPropertyFromObject(pr, 'path');
            }

            if (typeof getPropertyFromObject(pr, 'result') != "undefined") {
                  newPr["result"] = getPropertyFromObject(pr, 'result');
            }

            return Object.keys(newPr).length == 0 ? pr : newPr;
      }

      inlinePolicyResolution = addToInlinePolicyResolution(policyResolution);
      inlinePolicyResolutionNoFunctions = addToInlinePolicyResolution(policyResolution, true);

      return {
            policyResolution: policyResolution,
            inlinePolicyResolution: inlinePolicyResolution,
            inlinePolicyResolutionNoFunctions: inlinePolicyResolutionNoFunctions
      }
}

module.exports = { GetCompliance }