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

const main = async () => {
      let pass = 0;
      let fail = 0;

      await LoginWithAzCLI();
      let policyAssignments = await RetrieveTestPolicies();
      for (let policyAssignment of policyAssignments.slice(0, 100)) {
            try {
                  let testCompliance = await RetrieveTestCompliance(policyAssignment.policyAssignmentId, policyAssignment.policyDefinitionId);
                  let policyData = await RetrievePolicy(policyAssignment.policyAssignmentId);
                  let failed = false;
                  for (let test of testCompliance.slice(0, 10)) {
                        let resource = await getResourceById(test.resourceId);
                        if (resource.resource.type.split('/').length > 2) {
                              let idSegments = resource.resource.id.split('/');
                              idSegments = idSegments.slice(0, idSegments.length - ((resource.resource.type.split('/').length - 2) * 2))
                              let parentId = idSegments.join("/");
                              let parentResource = await getResourceById(parentId);
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

                        let compliance = await ResolveCondition(policyData.PolicyRule.if, context)
                        if (`${test.complianceState}`.toLowerCase() != `${(compliance.result ? 'NonCompliant' : 'Compliant')}`.toLowerCase()) {
                              console.log(`[FAILED] Resource ID: ${test.resourceId} - Policy Assignmnet ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} `)
                              failed = true;
                        }
                        else {
                              console.log(`Test Result: ${test.complianceState == (compliance.result ? 'NonCompliant' : 'Compliant')}`, test.resourceId)
                        }

                        
                  
                  }

                  if(failed){
                        fail++;
                  }
                  else{
                        pass++;
                  }
            }
            catch (err) {
                  console.log(`[ERROR]`, err, `Policy Assignmnet ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId} `)
            }
      }
      console.log(`Pass: ${pass} - Fail: ${fail}`)
}

main();