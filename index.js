const {
      ResolveFunctions
} = require('./functions');

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
      RetrieveTestCompliance
} = require('./azureApi');

const main = async () => {
      await LoginWithAzCLI();
      let policyAssignmentId = '/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/microsoft.authorization/policyassignments/e35806bd40b4488f8b462ef3'
      let testCompliance = await RetrieveTestCompliance(policyAssignmentId);
      let policyData = await RetrievePolicy(policyAssignmentId);
      for(let test of testCompliance){
            let context = {
                  parameters: policyData.Parameters,
                  id: test.resourceId,
                  resource: await getResourceById(test.resourceId)
            }
      
            console.log(context.resource)
            let compliance = ResolveCondition(policyData.PolicyRule.if, context)
            if(test.complianceState != (compliance.result ? 'NonCompliant' : 'Compliant')){
                  console.log(`Failed test!`)
            }
            console.log(test.resourceId, `is ${compliance.result ? 'Non-Compliant' : 'Compliant'} - Test Result: ${test.complianceState == (compliance.result ? 'NonCompliant' : 'Compliant')}`, compliance)
      }
}

main();