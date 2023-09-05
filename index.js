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

const main = async () => {
      let pass = 0;
      let passRes = 0;
      let fail = 0;
      let failRes = 0;

      let lastLogin = new Date();
      await LoginWithAzCLI();
      let policyAssignments = await RetrieveTestPolicies();
      for (let policyAssignment of policyAssignments) {
            //if(policyAssignment.policyDefinitionId.toLowerCase() != "/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/Microsoft.Authorization/policyDefinitions/0dc82890-d654-4226-a688-bfe111aed41c".toLowerCase())
            //     continue;

            try {
                  let testCompliance = await RetrieveTestCompliance(policyAssignment.policyAssignmentId, policyAssignment.policyDefinitionId, policyAssignment.policyDefinitionRefId);
                  let policyData = await RetrievePolicy(policyAssignment.policyAssignmentId, policyAssignment.policyDefinitionId, policyAssignment.policyDefinitionRefId);
                  let failed = false;
                  for (let test of testCompliance) {
                        if(test.resourceId.toLowerCase() != "/subscriptions/af15e575-f948-49ac-bce0-252d028e9379/resourcegroups/nititest/providers/microsoft.network/networksecuritygroups/nrms-aqwr5g2vc4zboniti-vnetdcr/securityrules/nrms-rule-103".toLowerCase())
                             continue;

                        //Login every 5 minutes
                        //TODO: Dynamic Token renewal based on expiration date
                        if (new Date().getTime() - lastLogin.getTime() > (6 * 60 * 1000)) {
                              await LoginWithAzCLI(false);
                              lastLogin = new Date();
                              console.log(`Pass: ${pass} (${passRes}) - Fail: ${fail} (${failRes})`)
                        }

                        let resource = await getResourceById(test.resourceId);
                        if (!resource || !resource.resource)
                              continue;

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
                              id: test.resourceId,
                              resource: resource.resource,
                              request: {
                                    apiVersion: resource.apiVersion
                              }
                        }

                        let effect = policyData.PolicyRule.then.effect;
                        let isFunctionEffect = `${effect}`[0] == "[" && `${effect}`[`${effect}`.length - 1] == "]";
                        if (isFunctionEffect) {
                              effect = await ResolveFunctions(
                                    ParseFunction(`${effect}`.substring(1, `${effect}`.length - 1)),
                                    context
                              );
                        }

                        context.effect = `${effect}`.toLowerCase();
                        let compliance = await ResolveCondition(policyData.PolicyRule.if, context)

                        if (`${test.complianceState}`.toLowerCase() != `${compliance.complianceState}`.toLowerCase()) {
                              console.log(`[FAILED] Resource ID: ${test.resourceId} - Policy Assignmnet ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} `)
                              failed = true;
                              failRes++;
                        }
                        else {
                              console.log(`Test Result: ${test.complianceState == compliance.complianceState}`, test.resourceId)
                              passRes++;
                        }
                  }

                  if (failed) {
                        fail++;
                  }
                  else {
                        pass++;
                  }
            }
            catch (err) {
                  if (!`${err}`.startsWith('Error: Could not find Policy Assignment'))
                        console.log(`[ERROR]`, err, `Policy Assignmnet ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} `)
            }
      }
      console.log(`Pass: ${pass} (${passRes}) - Fail: ${fail} (${failRes})`)
}

main();