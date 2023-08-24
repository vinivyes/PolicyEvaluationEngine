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
      getResourceById
} = require('./azureApi');

const main = async () => {
      await LoginWithAzCLI();
      let resourceId = '/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/resourcegroups/azharexplorerfa/providers/microsoft.storage/storageaccounts/azharexplorerfa';
      let policyData = await RetrievePolicy('/subscriptions/6e6feb18-4fff-4ecf-8ca8-0dc0c7506558/providers/Microsoft.Authorization/policyAssignments/625bf25501584b0bbbb5eaf6');
      let context = {
            parameters: policyData.Parameters,
            id: resourceId,
            resource: await getResourceById(resourceId)
      }

      console.log(ResolveCondition(policyData.PolicyRule.if, context))
}

main();