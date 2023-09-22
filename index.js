const {
      LoginWithAzCLI,
      RetrievePolicy,
      RetrieveTestCompliance,
      RetrieveTestPolicies
} = require('./azureApi');

const { GetCompliance } = require('./compliance');

const TestCompliance = async (policyAssignmentId, resourceId, policyDefinitionId, policyDefinitionRefId) => {
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

const MAX_CONCURRENCY = 3; // Maximum number of parallel evaluations

const main = async () => {
      let pass = 0;
      let passRes = 0;
      let fail = 0;
      let failRes = 0;
      let lastLogin = new Date();

      await LoginWithAzCLI();
      let policyAssignments = await RetrieveTestPolicies();

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

                  const evaluationPromises = [];

                  for (let test of testCompliance.slice(0, 20)) {

                        if (new Date().getTime() - lastLogin.getTime() > 6 * 60 * 1000) {
                              await LoginWithAzCLI(false);
                              lastLogin = new Date();
                              console.log(`Pass: ${pass} (${passRes}) - Fail: ${fail} (${failRes})`);
                        }

                        evaluationPromises.push(
                              (async () => {
                                    try {
                                          let compliance = await GetCompliance(policyData, test.resourceId);

                                          if (!compliance) {
                                                //   console.log(
                                                //     `Resource ID: ${currentResourceId} (Not Found) - Policy Assignment ID: ${policyAssignment.policyAssignmentId} - Policy Definition ID: ${policyAssignment.policyDefinitionId}`
                                                //   );
                                          } else if (
                                                `${test.complianceState}`.toLowerCase() !== `${compliance.result.complianceState}`.toLowerCase() &&
                                                ["compliant","noncompliant"].some((s) => s == test.complianceState.toLowerCase()) 
                                          ) {
                                                console.log(
                                                      `//Result: ${compliance.result.complianceState} - Expected: ${test.complianceState}`,
                                                      `TestCompliance('${compliance.context.policyAssignmentId}','${compliance.context.id}','${compliance.context.policyDefinitionId}'${compliance.context.policyDefinitionRefId ? `,'${compliance.context.policyDefinitionRefId}'` : ''})`);
                                                failed = true;
                                                failRes++;
                                          } else {
                                                //console.log(`Test Result: ${test.complianceState == compliance.result.complianceState}`, test.resourceId);
                                                passRes++;
                                          }
                                    }
                                    catch (err) {
                                          if (
                                                !`${err}`.startsWith('Error: Could not find Policy Assignment') &&
                                                !`${err}`.startsWith('AxiosError:')
                                          ) {
                                                console.log(
                                                      `[ERROR]`,
                                                      err,
                                                      `TestCompliance('${compliance.context.policyAssignmentId}','${compliance.context.id}','${compliance.context.policyDefinitionId}'${compliance.context.policyDefinitionRefId ? `,'${compliance.context.policyDefinitionRefId}'` : ''})`
                                                );
                                          } else {
                                                // console.log(
                                                //       `[ERROR] - Could not find Policy Assignment`,
                                                //       `TestCompliance('${compliance.context.policyAssignmentId}','${compliance.context.id}','${compliance.context.policyDefinitionId}'${compliance.context.policyDefinitionRefId ? `,'${compliance.context.policyDefinitionRefId}'` : ''})`
                                                // );
                                          }
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

            }
            catch { }
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