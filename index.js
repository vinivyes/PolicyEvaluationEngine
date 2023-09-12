const {
      ParseFunction
} = require('./parser');

const {
      ResolveCondition
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
            if (parentResource && parentResource.resource)
                  resource.resource.location = parentResource.resource.location;
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

      return {
            result: await ResolveCondition(policyData.PolicyRule.if, context),
            context: context
      }
}
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
        currentResourceId = test.resourceId;

        if (new Date().getTime() - lastLogin.getTime() > 6 * 60 * 1000) {
          await LoginWithAzCLI(false);
          lastLogin = new Date();
          console.log(`Pass: ${pass} (${passRes}) - Fail: ${fail} (${failRes})`);
        }

        evaluationPromises.push(
          (async () => {
            let compliance = await GetCompliance(policyData, test.resourceId);

            if (!compliance) {
              console.log(
                `Resource ID: ${currentResourceId} (Not Found) - Policy Assignment ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId}`
              );
            } else if (
              `${test.complianceState}`.toLowerCase() !== `${compliance.result.complianceState}`.toLowerCase()
            ) {
              console.log(
                `[FAILED] Resource ID: ${test.resourceId} - Policy Assignment ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} - Resource ID: ${currentResourceId}`,
                `TestCompliance('${policyAssignment.policyAssignmentId}','${currentResourceId}','${policyAssignment.policyDefinitionId}')`
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


const TestCompliance = async (policyAssignmentId, resourceId, policyDefinitionId, policyDefinitionRefId) => {
      await LoginWithAzCLI();

      try {
            //let testCompliance = await RetrieveTestCompliance(policyAssignmentId, policyDefinitionId, policyDefinitionRefId);
            let policyData = await RetrievePolicy(policyAssignmentId, policyDefinitionId, policyDefinitionRefId);
            for (let test of resourceId ? [{ resourceId: resourceId }] : testCompliance) {

                  let compliance = await GetCompliance(policyData, test.resourceId);

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

//TestCompliance(`/subscriptions/af15e575-f948-49ac-bce0-252d028e9379/providers/Microsoft.Authorization/policyAssignments/Defender for Containers provisioning Azure Policy Addon for Kub`,`/subscriptions/af15e575-f948-49ac-bce0-252d028e9379/resourcegroups/hdi-5f0843d98ced4627bc887881350ca1a7/providers/microsoft.containerservice/managedclusters/espark1-pool`)
//main();

//TestCompliance('/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/microsoft.authorization/policyassignments/17fe2bf902f84d3cb25e77ed','/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/resourcegroups/sr2435/providers/microsoft.eventhub/namespaces/sr2435-p-pff/networkrulesets/default','/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/microsoft.authorization/policydefinitions/d14f2fbe-61be-4c85-b929-d23fc107041f')
//TestCompliance('/providers/microsoft.management/managementgroups/48fed3a1-0814-4847-88ce-b766155f2792/providers/microsoft.authorization/policyassignments/b65cf29bbd4b57d','/subscriptions/af15e575-f948-49ac-bce0-252d028e9379/resourcegroups/krishrg5/providers/microsoft.network/networksecuritygroups/basicnsgkrishvmss08-vnet-nic01','/providers/microsoft.management/managementgroups/48fed3a1-0814-4847-88ce-b766155f2792/providers/microsoft.authorization/policydefinitions/e695de0794b757d')
TestCompliance('/providers/microsoft.management/managementgroups/48fed3a1-0814-4847-88ce-b766155f2792/providers/microsoft.authorization/policyassignments/b65cf29bbd4b57d','/subscriptions/af15e575-f948-49ac-bce0-252d028e9379/resourcegroups/cmpreviewtest-centralus/providers/microsoft.network/networksecuritygroups/cmpreviewcentraleuap-nsg/securityrules/allow_all_outbound','/providers/microsoft.management/managementgroups/48fed3a1-0814-4847-88ce-b766155f2792/providers/microsoft.authorization/policydefinitions/e695de0794b757d')