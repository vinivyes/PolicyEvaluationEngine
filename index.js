const {
      ParseFunction
} = require('./parser');

const {
      ResolveCondition,
      getPropertyFromObject
} = require('./conditions');

const {
      LoginWithAzCLI,
      RetrievePolicy,
      getResourceById,
      RetrieveTestCompliance,
      RetrieveTestPolicies
} = require('./azureApi');
const { IsFunction, ResolveFunctions } = require('./functions');

const GetCompliance = async (policyData, resourceId) => {
      let resource = await getResourceById(resourceId);
      if (!resource || !resource.resource)
            return null;

      if(!resource.resource.type)
            resource.resource.type = `${resourceId}`.toLowerCase().includes('resourcegroups') ? 'Microsoft.Resources/subscriptions/resourceGroups' : 'Microsoft.Resources/subscriptions'

      //Retrieve location from parent resource
      if (resource.resource.type.split('/').length > 2) {
            let idSegments = resource.resource.id.split('/');
            idSegments = idSegments.slice(0, idSegments.length - ((resource.resource.type.split('/').length - 2) * 2))
            let parentId = idSegments.join("/");
            let parentResource = await getResourceById(parentId);
            if (parentResource && parentResource.resource){
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
      let policyResolution = {};
      const addToPolicyResolution = (result) => {
            let newPr = {};
            if(result.rawOperation){
                  newPr = result.rawOperation;
                  if(newPr.FieldKey == "count"){
                        newPr["context"] = newPr.FieldValueRaw.context;
                  }
                  if(newPr.OperationValueRaw){
                        newPr.OperationValueRaw = addToPolicyResolution(newPr.OperationValueRaw);
                  }
                  if(newPr.FieldValueRaw){
                        newPr.FieldValueRaw = addToPolicyResolution(newPr.FieldValueRaw);
                  }
            }
            else if(result.rawResults){
                  let rawResults = [];
                  for(let r = 0; r < result.rawResults.length; r++){
                        let rr = result.rawResults[r];

                        rawResults.push(addToPolicyResolution(rr));
                  }
                  return rawResults;
            }
            else if(result.rawResult){
                  return addToPolicyResolution(result.rawResult);
            }
            return Object.keys(newPr).length == 0 ? result : newPr;
      }
      
      policyResolution = addToPolicyResolution(result);

      let inlinePolicyResolution = {};
      let inlinePolicyResolutionNoFunctions = {};
      const addToInlinePolicyResolution = (pr, noFunctions = false) => {
            let newPr = {};
            if(pr.context){
                  newPr["context"] = pr.context;
            }
            if(pr.OperationKey){
                  newPr[pr.OperationKey] = noFunctions && pr.OperationKey != "not" ? pr.OperationValue : addToInlinePolicyResolution(pr.OperationValueRaw, noFunctions);
                  if(pr.OperationValueRaw != pr.OperationValue && typeof pr.OperationValueRaw == "object" && pr.OperationValueRaw.original){
                        newPr[`${pr.OperationKey}Expression`] = pr.OperationValueRaw.original;
                  }
                  if(pr.OperationValueRaw && pr.FieldKey && pr.OperationValueRaw != pr.OperationValue && !noFunctions){
                        newPr[`${pr.OperationKey}_result`] = pr.OperationValue;
                  }
                  if(Array.isArray(pr.OperationValueRaw)){
                        let newValue = []
                        for(let operation of pr.OperationValueRaw){
                              newValue.push(addToInlinePolicyResolution(operation, noFunctions));
                        }
                        newPr[pr.OperationKey] = newValue;
                  }
            }
            if(pr.FieldKey){

                  newPr[pr.FieldKey] = noFunctions ? pr.FieldValue : addToInlinePolicyResolution(pr.FieldValueRaw, noFunctions);
                  if(pr.FieldValueRaw != pr.FieldValue && typeof pr.FieldValueRaw == "object" && pr.FieldValueRaw.original){
                        newPr[`${pr.FieldKey}Expression`] = pr.FieldValueRaw.original;
                  }
                  if(pr.FieldValueRaw && pr.FieldValueRaw != pr.FieldValue && !noFunctions){
                        newPr[`${pr.FieldKey}_result`] = pr.FieldValue;
                  }
                  if(Array.isArray(pr.FieldValueRaw)){
                        let newValue = []
                        for(let operation of pr.FieldValueRaw){
                              newValue.push(addToInlinePolicyResolution(operation, noFunctions));
                        }
                        newPr[pr.FieldKey] = newValue;
                  }
            }
            else if(typeof pr.OperationValue != "undefined"){
                  newPr["result"] = pr.OperationValue;
            }

            if(typeof getPropertyFromObject(pr,'path') != "undefined"){
                  newPr["path"] = getPropertyFromObject(pr,'path');
            }

            if(typeof getPropertyFromObject(pr,'result') != "undefined"){
                  newPr["result"] = getPropertyFromObject(pr,'result');
            }

            return Object.keys(newPr).length == 0 ? pr : newPr;
      }
      
      inlinePolicyResolution = addToInlinePolicyResolution(policyResolution);
      inlinePolicyResolutionNoFunctions = addToInlinePolicyResolution(policyResolution,true);
      
      return {
            result: result,
            context: context,
            policyResolution: policyResolution,
            inlinePolicyResolution: inlinePolicyResolution,
            inlinePolicyResolutionNoFunctions: inlinePolicyResolutionNoFunctions
      }
}

const TestCompliance = async (policyAssignmentId, resourceId, policyDefinitionId, policyDefinitionRefId) => {
      await LoginWithAzCLI();

      try {
            
            let policyData = await RetrievePolicy(policyAssignmentId, policyDefinitionId, policyDefinitionRefId);
            for (let test of resourceId ? [{ resourceId: resourceId }] : testCompliance) {

                  let compliance = await GetCompliance(policyData, test.resourceId);

                  console.log(JSON.stringify(compliance.inlinePolicyResolutionNoFunctions))

                  if (!test.complianceState) {
                        console.log(`Test Result, Resource is: ${compliance.result.complianceState}`)
                  }
                  else if (`${test.complianceState}`.toLowerCase() != `${compliance.complianceState}`.toLowerCase()) {
                        console.log(`[FAILED] Resource ID: ${test.resourceId} - Policy Assignmnet ID: ${policyAssignmentId} - Policy Definition ID: ${policyDefinitionId} `)
                  }
                  else {
                        console.log(`Test Result: ${test.complianceState == compliance.complianceState}`, test.resourceId)
                  }
            }
      }
      catch (err) {
            if (!`${err}`.startsWith('Error: Could not find Policy Assignment'))
                  console.log(`[ERROR]`, err, `Policy Assignmnet ID: ${policyAssignmentId} - Policy Definition ID: ${policyDefinitionId} `)
      }

}

TestCompliance('/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/Microsoft.Authorization/policyAssignments/625bf25501584b0bbbb5eaf6','/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/resourcegroups/sr5028/providers/microsoft.storage/storageaccounts/sr502899fb')
//TestCompliance('/subscriptions/414a181f-779c-4fe6-a79b-550c73428208/providers/microsoft.authorization/policyassignments/a034e648e96e412a8ffbfa86','/subscriptions/414a181f-779c-4fe6-a79b-550c73428208/resourcegroups/armsyncdemo/providers/microsoft.compute/virtualmachines/vm-a','/subscriptions/414a181f-779c-4fe6-a79b-550c73428208/providers/microsoft.authorization/policydefinitions/a741ac2f-3f5b-4dc0-94cf-d41ea44ad624')

const MAX_CONCURRENCY = 6; // Maximum number of parallel evaluations

const main = async () => {
  let pass = 0;
  let passRes = 0;
  let fail = 0;
  let failRes = 0;
  let lastLogin = new Date();

  await LoginWithAzCLI();
  let policyAssignments = await RetrieveTestPolicies();
  let currentResourceId = null;

  async function evaluatePolicyAssignment(policyAssignment) {
    try {
      let testCompliance = await RetrieveTestCompliance(
        policyAssignment.policyAssignmentId,
        policyAssignment.policyDefinitionId,
        policyAssignment.policyDefinitionRefId
      );

      let policyData = await RetrievePolicy(
        policyAssignment.policyAssignmentId,
        policyAssignment.policyDefinitionId,
        policyAssignment.policyDefinitionRefId
      );

      let failed = false;
      currentResourceId = null;

      const evaluationPromises = [];

      for (let test of testCompliance.slice(0, 20)) {

        if (new Date().getTime() - lastLogin.getTime() > 6 * 60 * 1000) {
          await LoginWithAzCLI(false);
          lastLogin = new Date();
          console.log(`Pass: ${pass} (${passRes}) - Fail: ${fail} (${failRes})`);
        }

        evaluationPromises.push(
          (async () => {
            let cResourceId = test.resourceId;

            let compliance = await GetCompliance(policyData, test.resourceId);

            if (!compliance) {
              console.log(
                `Resource ID: ${currentResourceId} (Not Found) - Policy Assignment ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId}`
              );
            } else if (
              `${test.complianceState}`.toLowerCase() !== `${compliance.result.complianceState}`.toLowerCase()
            ) {
              console.log(
                `[FAILED] Resource ID: ${test.resourceId} - Policy Assignment ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} - Resource ID: ${cResourceId}`,
                `TestCompliance('${policyAssignment.policyAssignmentId}','${cResourceId}','${policyAssignment.policyDefinitionId}')`
              );
              failed = true;
              failRes++;
            } else {
              console.log(`Test Result: ${test.complianceState == compliance.result.complianceState}`, test.resourceId);
              passRes++;
            }
          })()
        );
      }

      await Promise.all(evaluationPromises);

      if (failed) {
        fail++;
      } else {
        pass++;
      }
    } catch (err) {
      if (
        !`${err}`.startsWith('Error: Could not find Policy Assignment') &&
        !`${err}`.startsWith('AxiosError:')
      ) {
        console.log(
          `[ERROR]`,
          err,
          `Policy Assignment ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} - Resource ID: ${currentResourceId}`,
          `TestCompliance('${policyAssignment.policyAssignmentId}','${currentResourceId}')`
        );
      } else {
        console.log(
          `[ERROR] - Could not find Policy Assignment`,
          `Policy Assignment ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} - Resource ID: ${currentResourceId}`,
          `TestCompliance('${policyAssignment.policyAssignmentId}','${currentResourceId}')`
        );
      }
    }
  }

  // Create an array of promises for policy evaluations, limiting concurrency to MAX_CONCURRENCY
  const policyEvaluationPromises = [];

  for (let policyAssignment of policyAssignments) {
    policyEvaluationPromises.push(evaluatePolicyAssignment(policyAssignment));
    if (policyEvaluationPromises.length >= MAX_CONCURRENCY) {
      await Promise.all(policyEvaluationPromises);
      policyEvaluationPromises.length = 0;
    }
  }

  // Wait for any remaining evaluations to complete
  await Promise.all(policyEvaluationPromises);

  console.log(`Pass: ${pass} (${passRes}) - Fail: ${fail} (${failRes})`);
};


//main();
//TestCompliance('/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/microsoft.authorization/policyassignments/e35806bd40b4488f8b462ef3','/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/resourcegroups/sr7232/providers/microsoft.network/networksecuritygroups/vnet7232-default-nsg-eastus','/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/microsoft.authorization/policydefinitions/54630b03-621b-4eed-9f84-21ba8cb6d687')