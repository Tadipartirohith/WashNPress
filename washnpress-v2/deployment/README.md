# Infrastructure

`main.bicep` provisions an autoscaling deployment on Azure:

- A container App Service on a PremiumV3 plan, which supports autoscale, with Always On
  and a health check on `/health`.
- An autoscale rule that scales out above 65 percent average CPU and back in below 30
  percent, between a configurable minimum and maximum number of instances.
- Azure Database for PostgreSQL Flexible Server with zone redundant high availability,
  14 day backups, and point in time restore.
- Azure Cache for Redis for sessions, OTP, rate limiting, and caching.
- A Key Vault for secrets, with the app using a system assigned managed identity.
- Application Insights for logs, metrics, and tracing.

Deploy:

```bash
az deployment group create \
  --resource-group washnpress-rg \
  --template-file deployment/main.bicep \
  --parameters acrServer=<acr>.azurecr.io \
               postgresAdminPassword=<strong-password> \
               razorpayWebhookSecret=<secret> \
               minInstances=2 maxInstances=10
```

Alternative: if you prefer not to manage a plan, Azure Container Apps gives per request
and scale to zero autoscaling behind the same image and environment variables. The app
is stateless, so either target works without code changes, provided the database sits
behind a connection pooler under high instance counts.
