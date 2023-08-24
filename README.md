# Azure Policy Evaluation Engine
This application is intended to make testing Azure Policies faster, with a Policy Assignment ID and Resource ID you can determine if a resource will be flagged as compliant/non-compliant without waiting for Azure's normal evaluation cycle.

##Roadmap
- Replicate ARM Functions behavior
- Replicate conditions behavior (field, value, count)
- Retrieve authentication tokens from Azure CLI
- Retrieve Policy information from live environment using Azure Resource Graph
- Generate compliance information for _audit_, _deny_, _modify_ effects.
- Replicate _IfNotExists_ behavior for evaluation.
- Generate compliance for _auditIfNotExists_, _deployIfNotExists_
- Replicate Remediation Task behavior
- Bulk test results agains actual compliance data to raise shortcomings of replication
- Implement option to evaluate Functions and Conditions using ARM Template outputs for better accuracy and failover.

##Additional Information
This project is still being worked on and the Roadmap reflects the direction I would like to take with this tool as today testing Policies while writting them can take time due to the compliance delays.
