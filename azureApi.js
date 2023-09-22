const authToken = {
      token: ''
};
const axios = require('axios');
const fs = require('fs');

function getResourceType (id) {
      let result = "";

      if(`${id}`.includes('/providers/')){
            result = `${id}`.split('/providers/');
            result = result[result.length-1];

            let segments = result.split(`/`);
            let resourceType = [];
            resourceType.push(segments[0]);

            for(let s = 1; s < segments.length; s++){
                  resourceType.push(segments[s]);
                  s++;
            }

            result = resourceType.join('/');
      }

      return result;
}

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
// Create an instance of Axios
const api = axios.create({
      timeout: 30000
});

// Axios interceptor for handling 401 responses and retrying
api.interceptors.response.use(
      (response) => {
            // If the response is successful, return it as-is
            return response;
      },
      async (error) => {
            if (error.response && error.response.status === 401) {
                  // 401 status code indicates the need for reauthentication
                  try {
                        // Perform reauthentication (e.g., refresh token)
                        await LoginWithAzCLI();

                        // Retry the original request with the updated credentials
                        const originalRequest = error.config;
                        return api(originalRequest);
                  } catch (reauthError) {
                        // If reauthentication fails, you can handle it here
                        console.error('Reauthentication failed:', reauthError);
                        throw reauthError;
                  }
            }
            // For other errors, simply rethrow the error
            throw error;
      }
);

const RetrieveProviders = async () => {
      const headers = {
            'Authorization': `Bearer ${authToken.token}`
      };

      try {
            const response = await api.get(`https://management.azure.com/providers?api-version=2019-08-01`, { headers });
            return response.data.value;
      } catch (error) {
            return null;
      }
}

async function getLatestApiVersion(id, provider) {
      let resourceTypeSearch = getResourceType(id).toLowerCase();

      if (resourceTypeSearch && apiVersions[resourceTypeSearch]) {
            return apiVersions[resourceTypeSearch];
      }

      if (!inMemory.providers) {
            if (fs.existsSync('./providers.json'))
                  inMemory.providers = JSON.parse(fs.readFileSync('./providers.json', 'utf-8'))
            else {
                  let providers = await RetrieveProviders();
                  if(providers == null){
                        process.kill(20);
                  }
                  inMemory.providers = providers;
                  fs.writeFileSync('./providers.json', JSON.stringify(providers), { encoding: 'utf-8' });
            }
      }

      let providerApiVersionMatchCount = 0;
      let providersApiVersion = null;
      let namespaceSearch = `${resourceTypeSearch}`.split('/')[0]

      for(let namespace of inMemory.providers){
            if(namespace.namespace.toLowerCase() == namespaceSearch.toLowerCase()){
                  for(let resourceType of namespace.resourceTypes){
                        let rt = `${namespace.namespace}/${resourceType.resourceType}`.toLowerCase();
                        if(rt.startsWith(resourceTypeSearch) && rt.length > providerApiVersionMatchCount){
                              providerApiVersionMatchCount = rt.length;
                              let sortedVersions = sortApiVersions(resourceType.apiVersions);
                              providersApiVersion = sortedVersions[0];
                        }
                  }
            }
      }

      if(providersApiVersion){
            apiVersions[resourceTypeSearch] = providersApiVersion;
            return providersApiVersion;
      }
      else{
            const endpoint = id ? `https://management.azure.com${id}?api-version=0` : `https://management.azure.com/subscriptions/${subscriptionId}/providers/${provider}?api-version=0`;
            const headers = {
                  'Authorization': `Bearer ${authToken.token}`
            };
            try {
                  const response = await api.get(endpoint, { headers });
                  throw new Error('Should have failed');
            } catch (error) {
                  if (error.response && error.response.data) {
                        error.response.data = typeof error.response.data === 'object' ? error.response.data : JSON.parse(error.response.data);
                        if (error.response.data.error && error.response.data.error.message) {
                              const errorMsg = error.response.data.error.message;
                              const match = errorMsg.match(/versions are '([\d\-,\s\w\.]+)'/);
                              if (match && match[1]) {
                                    const versions = match[1].split(',').map((v) => v.trim())
                                    const sortedVersions = sortApiVersions(versions);
                                    apiVersions[resourceTypeSearch] = sortedVersions[0];
                                    return sortedVersions[0];
                              }
                        }
                  }

                  if (error.response.status != 404 && error.response.status != 403) {
                        console.error('Error getting API version:', error.response.data);
                  }
                  else {
                        console.log(`Could not retrieve API Version: (${error.response.status})`)
                  }
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

const inMemory = {
      providers: null
}

const apiVersions = {

}

const resources = {

}

async function getResourceById(resourceId, forceApiVersion = null, forceUpdate = false) {
      if (resources[resourceId] && !forceUpdate)
            return resources[resourceId];

      let provider = null;
      if (`${resourceId}`.toLowerCase().includes('/providers/')) {
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
            const response = await api.get(endpoint, { headers });
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
                  throw new Error('Resource cannot be read (403):', resourceId);
            }
            else {
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
            const response = await api.post(endpoint, requestBody, { headers: headers });
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

async function getAccountInfo() {
      try {
            const token = await executeCommand('az account show');
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

const LoginWithAzCLI = async (accountInfo = false) => {
      try {
            let auth = await getAccessToken();
            authToken.token = auth.accessToken;
            authToken.tenantId = auth.tenant;
            console.log("Access token retrieved: ", authToken.token);
            console.log("Tenant: ", auth.tenant);
      } catch (error) {
            console.log("Attempting to login...");
            await login();
            // After successful login, retry getting access token
            let auth = await getAccessToken();
            authToken.token = auth.accessToken;
            authToken.tenantId = auth.tenant;
            console.log("Access token retrieved: ", authToken.token);
            console.log("Tenant: ", auth.tenant);
      }

      if (accountInfo) {
            try {
                  let accountInfo = await getAccountInfo();
                  authToken.user = accountInfo.user;
            }
            catch { }
      }

      return authToken;
}

const RetrievePolicy = async (policyAssignmentId, policyDefinitionId, policyDefinitionRefId, retry = false) => {
      if (!authToken.token) {
            if(retry)
                  throw new Error("You must login before you can retrieve a policy, auth token not found.")
            else{
                  await LoginWithAzCLI();
                  return RetrievePolicy(policyAssignmentId, policyDefinitionId, policyDefinitionRefId, true);
            }
      }

      let argQuery = `
            policyresources
            | where type =~ "Microsoft.Authorization/policyAssignments"
            ${policyAssignmentId ? '| where id =~ "' + policyAssignmentId + '"' : ''}
            | mv-expand AssignmentParameters = iff(array_length(bag_keys(properties.parameters)) == 0,dynamic([""]),properties.parameters) limit 400      
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
            | mv-expand SetDefinitionParameters = iff(array_length(bag_keys(properties.parameters)) == 0,dynamic([""]),properties.parameters) limit 400      
            | extend SetDefinitionParameters = pack_dictionary(tolower(tostring(bag_keys(SetDefinitionParameters)[0])), SetDefinitionParameters[tostring(bag_keys(SetDefinitionParameters)[0])])
            | summarize SetDefinitionParameters=make_bag(SetDefinitionParameters)
                  by 
                  PolicySetDefinitionID = id,
                  SetDefinitionDisplayName = tostring(properties.displayName),
                  SetDefinitions=tostring(properties.policyDefinitions)
            | mv-expand Definition=todynamic(SetDefinitions) limit 400
            | project PolicySetDefinitionID, SetDefinitionParameters, _DefinitionParameters=iff(array_length(bag_keys(Definition.parameters)) == 0,dynamic([""]),Definition.parameters), DefinitionRefId = tostring(Definition.policyDefinitionReferenceId), PolicyDefinitionID = tostring(Definition.policyDefinitionId)
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
                  PolicyRule = tostring(properties.policyRule),
                  PolicyMode = tostring(properties.mode)
            )
            on $left.PolicyDefinitionID == $right.PolicyDefinitionID
            | mv-expand DefinitionParameter=DefinitionParameters
            | extend DefinitionParameter = pack_dictionary(tolower(tostring(bag_keys(DefinitionParameter)[0])), DefinitionParameter[tostring(bag_keys(DefinitionParameter)[0])].defaultValue)
            | extend SetDefinitionParameter = iif(tostring(bag_keys(DefinitionParameter)[0]) == tostring(bag_keys(SetDefinitionParameter)[0]), SetDefinitionParameter, dynamic(null))
            | summarize SetParameters=make_bag(SetDefinitionParameter), DefParameters=make_bag(DefinitionParameter) by PolicyAssignmentID, DefinitionRefId, PolicyDefinitionID, DefinitionDisplayName, AssignmentDisplayName, PolicyRule, PolicyMode
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
            | mv-expand Parameters=iff(array_length(bag_keys(Parameters)) == 0,dynamic([""]),Parameters) limit 400            
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
      | summarize by policyAssignmentId=tostring(properties.policyAssignmentId), policyDefinitionId=tostring(properties.policyDefinitionId), policyDefinitionRefId=tostring(properties.policyDefinitionReferenceId)
      | join kind=leftouter ( 
      policyresources
      | where type =~ "microsoft.authorization/policydefinitions"
      | project id=tolower(id), policyRule=properties.policyRule
      )
      on $left.policyDefinitionId == $right.id
      | where tolower(policyRule.then.details.type) != "microsoft.security/assessments"
      | project-away id, policyRule
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
            const response = await api.get(endpoint, { headers });
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
                              alias.resourceType = `${namespace.namespace}/${resourceType.resourceType}`;
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

module.exports = { LoginWithAzCLI, RetrievePolicy, runResourceGraphQuery, getResourceById, RetrieveAliases, RetrieveTestCompliance, RetrieveTestPolicies }