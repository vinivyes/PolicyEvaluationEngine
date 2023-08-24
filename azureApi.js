const authToken = {
      token: ''
};
const axios = require('axios');

function sortApiVersions(versions) {
      return versions.sort((a, b) => {
            if (a.includes('-preview') && !b.includes('-preview')) {
                  return 1;  // a comes after b if a is preview but b is not.
            } else if (!a.includes('-preview') && b.includes('-preview')) {
                  return -1;  // a comes before b if a is not preview but b is.
            } else {
                  return b.localeCompare(a);  // Otherwise, sort them lexicographically in descending order.
            }
      });
}

async function getLatestApiVersion(subscriptionId, provider) {
      const endpoint = `https://management.azure.com/subscriptions/${subscriptionId}/providers/${provider}?api-version=0`;
      const headers = {
            'Authorization': `Bearer ${authToken.token}`
      };
      try {
            const response = await axios.get(endpoint, { headers });
            const apiVersions = response.data.resourceTypes[0].apiVersions;
            return apiVersions[0];
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

function extractProviderFromResourceId(resourceId) {
      const providerSegments = resourceId.split('/providers/');
      // Take the last segment after the last '/providers/', and then extract the provider part
      const lastSegment = providerSegments[providerSegments.length - 1];
      const parts = lastSegment.split('/');
      return `${parts[0]}/${parts[1]}`;
}

async function getResourceById(resourceId, forceApiVersion) {
      const provider = extractProviderFromResourceId(resourceId);
      const subscriptionId = resourceId.split('/')[2];

      const apiVersion = forceApiVersion ? forceApiVersion : await getLatestApiVersion(subscriptionId, provider);
      const endpoint = `https://management.azure.com${resourceId}?api-version=${apiVersion}`;

      const headers = {
            'Authorization': `Bearer ${authToken.token}`
      };

      try {
            const response = await axios.get(endpoint, { headers });
            return response.data;
      } catch (error) {
            console.error('Error getting resource:', error);
            throw error;
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
            console.error('Error running query:', JSON.stringify(error.response));
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

const RetrievePolicy = async (policyAssignmentId) => {
      if (!authToken.token) {
            throw new Error("You must login before you can retrieve a policy, auth token not found.")
      }

      let argQuery = `
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
            | project 
            PolicyDefinitionID = id,
            DefinitionDisplayName = tostring(properties.displayName),
            DefinitionParameters = properties.parameters,
            PolicyRule = tostring(properties.policyRule)
      )   on $left.PolicyDefinitionID == $right.PolicyDefinitionID
      | extend Parameters=bag_merge(Parameters, DefinitionParameters)
      | mv-expand Parameters limit 400
      | extend Parameters=pack_dictionary(tostring(bag_keys(Parameters)[0]),coalesce(Parameters[tostring(bag_keys(Parameters)[0])].value,Parameters[tostring(bag_keys(Parameters)[0])].defaultValue))
      | summarize Parameters=make_bag(Parameters) by PolicyAssignmentID, PolicyDefinitionID, DefinitionDisplayName, AssignmentDisplayName, PolicyRule
      | extend PolicyRule=todynamic(PolicyRule)
      | limit 1
      `

      let policyQuery = await runResourceGraphQuery(argQuery);

      if (policyQuery.totalRecords == 0) {
            throw new Error("Could not find Policy Assignment")
      }

      return policyQuery.data[0]
}

const RetrieveAliasesSync = () => {
      let isDone = false;
      let result, error;
  
      RetrieveAliases()
          .then(res => {
              result = res;
              isDone = true;
          })
          .catch(err => {
              error = err;
              isDone = true;
          });
  
      // This loop will "freeze" the event loop until the promise resolves or rejects.
      // This can be harmful to your application's performance.
      while (!isDone) {
          require('deasync').runLoopOnce();
      }
  
      if (error) {
          throw error;
      }
  
      return result;
}

const RetrieveAliases = async () => {
      const endpoint = `https://management.azure.com/providers?$expand=resourceTypes%2Faliases&api-version=2021-04-01`;
      const headers = {
            'Authorization': `Bearer ${authToken.token}`
      };
      try {
            const response = await axios.get(endpoint, { headers });
            let aliases = [
                  {"name":"id","defaultPath":"id"},
                  {"name":"location","defaultPath":"location"},
                  {"name":"type","defaultPath":"type"},
                  {"name":"kind","defaultPath":"kind"},
                  {"name":"name","defaultPath":"name"},
                  {"name":"fullName","defaultPath":"id"},
                  {"name":"tags","defaultPath":"tags"}
            ]

            for (let namespace of response.data.value) {
                  for (let resourceType of namespace.resourceTypes) {
                        for(let alias of resourceType.aliases){
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

module.exports = { LoginWithAzCLI, RetrievePolicy, runResourceGraphQuery, getResourceById, RetrieveAliases, RetrieveAliasesSync }