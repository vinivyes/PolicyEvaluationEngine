const authToken = {
      token: ''
};
const axios = require('axios');
var deasync = require('deasync');

function sortApiVersions(versions) {
      return versions.sort((a, b) => {
            //if (a.includes('-preview') && !b.includes('-preview')) {
            //      return 1;  // a comes after b if a is preview but b is not.
            //} else if (!a.includes('-preview') && b.includes('-preview')) {
            //      return -1;  // a comes before b if a is not preview but b is.
            //} else {
                  return b.localeCompare(a);  // Otherwise, sort them lexicographically in descending order.
            //}
      });
}

async function getLatestApiVersion(id, provider) {
      if (provider && apiVersions[provider]) {
            return apiVersions[provider];
      }

      const endpoint = id ? `https://management.azure.com${id}?api-version=0` : `https://management.azure.com/subscriptions/${subscriptionId}/providers/${provider}?api-version=0`;
      const headers = {
            'Authorization': `Bearer ${authToken.token}`
      };
      try {
            const response = await axios.get(endpoint, { headers });
            const apiVersions = response.data.resourceTypes[0].apiVersions;
            return apiVersions[0];
      } catch (error) {
            if (error.response && error.response.data) {
                  error.response.data = typeof error.response.data === 'object' ? error.response.data : JSON.parse(error.response.data);
                  if (error.response.data.error && error.response.data.error.message) {
                        const errorMsg = error.response.data.error.message;
                        const match = errorMsg.match(/versions are '([\d\-,\s\w\.]+)'/);
                        if (match && match[1]) {
                              const versions = match[1].split(',').map((v) => v.trim())
                              const sortedVersions = sortApiVersions(versions);
                              return sortedVersions[0];
                        }
                  }
            }

            if (error.response.status != 404 && error.response.status != 403) {
                  console.error('Error getting API version:', error.response.data);
            }
            else {
                  console.log(`Could not retrieve API Version`, JSON.stringify(error))
            }
      }
}

function extractProviderFromResourceId(resourceId) {
      const providerSegments = resourceId.split('/providers/');
      // Take the last segment after the last '/providers/', and then extract the provider part
      const lastSegment = providerSegments[providerSegments.length - 1];
      const parts = lastSegment.split('/');
      return `${parts[0]}/${parts[1]}`;
}

const apiVersions = {

}

const resources = {

}

async function getResourceById(resourceId, forceApiVersion) {
      if(resources[resourceId])
            return resources[resourceId];

      let provider = null;
      if(`${resourceId}`.toLowerCase().includes('/providers/')){
            provider = extractProviderFromResourceId(resourceId);
      }
      
      const apiVersion = forceApiVersion ? forceApiVersion : await getLatestApiVersion(resourceId, provider);
      const endpoint = `https://management.azure.com${resourceId}?api-version=${apiVersion}`;

      if (!forceApiVersion && provider) {
            apiVersions[provider] = apiVersion;
      }

      const headers = {
            'Authorization': `Bearer ${authToken.token}`
      };

      try {
            const response = await axios.get(endpoint, { headers });
            let value = {
                  apiVersion: apiVersion,
                  resource: response.data
            };

            resources[resourceId] = value;
            return value;
      } catch (error) {
            if (error.response.status != 404) {
                  console.error('Resource not found (404):', resourceId);
            }
            else if (error.response.status != 403) {
                  console.error('Resource cannot be read (403):', resourceId);
            }
            else{
                  console.error('Error getting resource:', JSON.stringify(error.response));
            }
      }
}


async function runResourceGraphQuery(query) {
      if (!authToken.token) {
            throw new Error("You must login before you can query, auth token not found.")
      }

      const endpoint = 'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01';

      // Set up the headers, notably the Authorization header with your access token.
      const headers = {
            'Authorization': `Bearer ${authToken.token}`,
            'Content-Type': 'application/json'
      };

      const requestBody = {
            query: query
      };

      try {
            const response = await axios.post(endpoint, requestBody, { headers: headers });
            return response.data;
      } catch (error) {
            console.error('Error running query:', error.response);
            throw error;
      }
}

const { exec } = require('child_process');

function executeCommand(command) {
      return new Promise((resolve, reject) => {
            exec(command, (error, stdout, stderr) => {
                  if (error) {
                        console.error(`exec error: ${error}`);
                        reject(error);
                  } else if (stderr) {
                        console.error(`stderr: ${stderr}`);
                        reject(new Error(stderr));
                  } else {
                        resolve(stdout.trim());
                  }
            });
      });
}

async function getAccessToken() {
      try {
            const token = await executeCommand('az account get-access-token');
            return JSON.parse(token);
      } catch (error) {
            console.error("Failed to get access token. Error: ", error.message);
            throw error;
      }
}

async function getProviders() {
      try {
            const token = await executeCommand('az provider list --expand "resourceTypes/aliases"');
            return JSON.parse(token);
      } catch (error) {
            console.error("Failed to get access token. Error: ", error.message);
            throw error;
      }
}


async function login() {
      try {
            await executeCommand('az login');
      } catch (error) {
            console.error("Failed to login. Error: ", error.message);
            throw error;
      }
}

const LoginWithAzCLI = async () => {
      try {
            let auth = await getAccessToken();
            authToken.token = auth.accessToken;
            console.log("Access token retrieved: ", authToken.token);
            console.log("Tenant: ", auth.tenant);
      } catch (error) {
            console.log("Attempting to login...");
            await login();
            // After successful login, retry getting access token
            let auth = await getAccessToken();
            authToken.token = auth.accessToken;
            console.log("Access token retrieved: ", authToken.token);
            console.log("Tenant: ", auth.tenant);
      }
}

const RetrievePolicy = async (policyAssignmentId, policyDefinitionId, policyDefinitionRefId) => {
      if (!authToken.token) {
            throw new Error("You must login before you can retrieve a policy, auth token not found.")
      }

      let argQuery = `
      policyresources
      | where type =~ "Microsoft.Authorization/policyAssignments"
      ${policyAssignmentId ? '| where id =~ "' + policyAssignmentId + '"' : ''}
      | mv-expand AssignmentParameters = properties.parameters limit 400
      | extend AssignmentParameters = pack_dictionary(tolower(tostring(bag_keys(AssignmentParameters)[0])), AssignmentParameters[tostring(bag_keys(AssignmentParameters)[0])])
      | summarize AssignmentParameters = make_bag(AssignmentParameters)
      by
      PolicyAssignmentID = id, 
      _PolicyDefinitionID = tostring(properties.policyDefinitionId), 
      AssignmentDisplayName = tostring(properties.displayName)
      | where _PolicyDefinitionID contains "/policySetDefinitions/"
      | join kind=inner ( 
      policyresources
      | where type =~ "Microsoft.Authorization/policySetDefinitions"
      | mv-expand SetDefinitionParameters = properties.parameters limit 400
      | extend SetDefinitionParameters = pack_dictionary(tolower(tostring(bag_keys(SetDefinitionParameters)[0])), SetDefinitionParameters[tostring(bag_keys(SetDefinitionParameters)[0])])
      | summarize SetDefinitionParameters=make_bag(SetDefinitionParameters)
            by 
            PolicySetDefinitionID = id,
            SetDefinitionDisplayName = tostring(properties.displayName),
            SetDefinitions=tostring(properties.policyDefinitions)
      | mv-expand Definition=todynamic(SetDefinitions) limit 400
      | project PolicySetDefinitionID, SetDefinitionParameters, _DefinitionParameters=Definition.parameters, DefinitionRefId = tostring(Definition.policyDefinitionReferenceId), PolicyDefinitionID = tostring(Definition.policyDefinitionId)
      )
      on $left._PolicyDefinitionID == $right.PolicySetDefinitionID
      ${policyDefinitionRefId ? '| where DefinitionRefId =~ "' + policyDefinitionRefId + '"' : ''}
      | project-away _PolicyDefinitionID
      | mv-expand DefParam=_DefinitionParameters limit 400
      | extend DefParamLookup=tostring(DefParam[tostring(bag_keys(DefParam)[0])].value)
      | extend ShouldDefParamLookup= (DefParamLookup startswith "[parameters('" and DefParamLookup endswith "')]")
      | extend DefParamLookupPair=iif(ShouldDefParamLookup, substring(DefParamLookup, 13, indexof(DefParamLookup, "')]") - 13), '')
      | extend SetDefinitionParameter=pack_dictionary(tolower(tostring(bag_keys(DefParam)[0])), iif(ShouldDefParamLookup, coalesce(AssignmentParameters[tolower(DefParamLookupPair)].value, SetDefinitionParameters[tolower(DefParamLookupPair)].defaultValue), todynamic(DefParamLookup)))
      | join kind=inner ( 
      policyresources
      | where type =~ "Microsoft.Authorization/policyDefinitions"
      ${policyDefinitionId ? '| where id =~ "' + policyDefinitionId + '"' : ''}
      | project 
            PolicyDefinitionID = id,
            DefinitionDisplayName = tostring(properties.displayName),
            DefinitionParameters = properties.parameters,
            PolicyRule = tostring(properties.policyRule)
      )
      on $left.PolicyDefinitionID == $right.PolicyDefinitionID
      | mv-expand DefinitionParameter=DefinitionParameters
      | extend DefinitionParameter = pack_dictionary(tolower(tostring(bag_keys(DefinitionParameter)[0])), DefinitionParameter[tostring(bag_keys(DefinitionParameter)[0])].defaultValue)
      | extend SetDefinitionParameter = iif(tostring(bag_keys(DefinitionParameter)[0]) == tostring(bag_keys(SetDefinitionParameter)[0]), SetDefinitionParameter, dynamic(null))
      | summarize SetParameters=make_bag(SetDefinitionParameter), DefParameters=make_bag(DefinitionParameter) by PolicyAssignmentID, DefinitionRefId, PolicyDefinitionID, DefinitionDisplayName, AssignmentDisplayName, PolicyRule
      | extend Parameters = bag_merge(SetParameters, DefParameters)
      | project-away SetParameters, DefParameters
      | extend PolicyRule=todynamic(PolicyRule)
      | union ( 
      policyresources
      | where type =~ "Microsoft.Authorization/policyAssignments"
      ${policyAssignmentId ? '| where id =~ "' + policyAssignmentId + '"' : ''}
      | project 
            PolicyAssignmentID = id, 
            PolicyDefinitionID = tostring(properties.policyDefinitionId), 
            AssignmentDisplayName = tostring(properties.displayName),
            Parameters = properties.parameters
      | where PolicyDefinitionID !contains "/policySetDefinitions/"
      | join kind=inner ( 
            policyresources
            | where type =~ "Microsoft.Authorization/policyDefinitions"
            ${policyDefinitionId ? '| where id =~ "' + policyDefinitionId + '"' : ''}
            | project 
                  PolicyDefinitionID = id,
                  DefinitionDisplayName = tostring(properties.displayName),
                  DefinitionParameters = properties.parameters,
                  PolicyRule = tostring(properties.policyRule),
                  PolicyMode = tostring(properties.mode)
                  )
                  on $left.PolicyDefinitionID == $right.PolicyDefinitionID
            | extend Parameters=bag_merge(Parameters, DefinitionParameters)
            | mv-expand Parameters limit 400
            | extend Parameters=pack_dictionary(tostring(bag_keys(Parameters)[0]), coalesce(Parameters[tostring(bag_keys(Parameters)[0])].value, Parameters[tostring(bag_keys(Parameters)[0])].defaultValue))
            | summarize Parameters=make_bag(Parameters) by PolicyAssignmentID, PolicyDefinitionID, DefinitionDisplayName, AssignmentDisplayName, PolicyRule, PolicyMode
            | extend PolicyRule=todynamic(PolicyRule)
            )
            | where PolicyMode in~ ("All", "Indexed")
            | limit 1
      `

      let policyQuery = await runResourceGraphQuery(argQuery);

      if (policyQuery.totalRecords == 0) {
            throw new Error("Could not find Policy Assignment")
      }

      return policyQuery.data[0]
}

const RetrieveTestPolicies = async () => {
      if (!authToken.token) {
            throw new Error("You must login before you can retrieve a policy, auth token not found.")
      }

      let argQuery = `
      policyresources
      | where type == "microsoft.policyinsights/policystates"
      | where properties.policyDefinitionAction in~ ("Audit", "Deny", "Modify", "Append")
      | summarize by policyAssignmentId=tostring(properties.policyAssignmentId), policyDefinitionId=tostring(properties.policyDefinitionId), policyDefinitionRefId=tostring(properties.policyDefinitionReferenceId)
      `

      let policyQuery = await runResourceGraphQuery(argQuery);

      if (policyQuery.totalRecords == 0) {
            throw new Error("Could not find Policy State to test")
      }

      return policyQuery.data

}

const RetrieveTestCompliance = async (policyAssignmentId, policyDefinitionId, policyDefinitionRefId, limit = 20) => {
      if (!authToken.token) {
            throw new Error("You must login before you can retrieve a policy, auth token not found.")
      }

      let argQuery = `
      policyresources
      | where type == "microsoft.policyinsights/policystates"
      ${policyAssignmentId ? '| where properties.policyAssignmentId =~ "' + policyAssignmentId + '"' : ''}
      ${policyDefinitionId ? '| where properties.policyDefinitionId =~ "' + policyDefinitionId + '"' : ''}
      ${policyDefinitionRefId ? '| where properties.policyDefinitionReferenceId =~ "' + policyDefinitionRefId + '"' : ''}
      | project resourceId = tostring(properties.resourceId), complianceState=tostring(properties.complianceState)
      | limit ${limit}
      `

      let policyQuery = await runResourceGraphQuery(argQuery);

      if (policyQuery.totalRecords == 0) {
            throw new Error("Could not find Policy State to test")
      }

      return policyQuery.data
}

const RetrieveAliases = async () => {
      const endpoint = `https://management.azure.com/providers?$expand=resourceTypes%2Faliases&api-version=2021-04-01`;
      const headers = {
            'Authorization': `Bearer ${authToken.token}`
      };
      try {
            const response = await axios.get(endpoint, { headers });
            let aliases = [
                  { "name": "id", "defaultPath": "id" },
                  { "name": "location", "defaultPath": "location" },
                  { "name": "identity", "defaultPath": "identitty" },
                  { "name": "extendedLocation", "defaultPath": "extendedLocation" },
                  { "name": "identity.type", "defaultPath": "identity.type" },
                  { "name": "identity.userAssignedIdentities", "defaultPath": "identity.userAssignedIdentities" },
                  { "name": "type", "defaultPath": "type" },
                  { "name": "kind", "defaultPath": "kind" },
                  { "name": "name", "defaultPath": "name" },
                  { "name": "fullName", "defaultPath": "id" },
                  { "name": "tags", "defaultPath": "tags" }
            ]

            for (let namespace of response.data.value) {
                  for (let resourceType of namespace.resourceTypes) {
                        for (let alias of resourceType.aliases) {
                              aliases.push(alias);
                        }
                  }
            }

            return aliases;
      } catch (error) {
            if (error.response && error.response.data && error.response.data.error && error.response.data.error.message) {
                  const errorMsg = error.response.data.error.message;
                  const match = errorMsg.match(/The supported api-versions are '([\d\-,\s\w\.]+)'/);
                  if (match && match[1]) {
                        const versions = match[1].split(',');
                        const sortedVersions = sortApiVersions(versions);
                        return sortedVersions[0];
                  }
            }
            console.error('Error getting API version:', error);
            throw error;
      }
}

module.exports = { LoginWithAzCLI, RetrievePolicy, runResourceGraphQuery, getResourceById,  RetrieveAliases, RetrieveTestCompliance, RetrieveTestPolicies }