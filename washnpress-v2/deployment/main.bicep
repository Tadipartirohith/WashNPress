// Wash N Press infrastructure with autoscaling and managed data services.
// Provisions: a Linux container App Service on a plan that supports autoscale, an
// autoscale rule on CPU, Azure Database for PostgreSQL Flexible Server, Azure Cache
// for Redis, a Key Vault for secrets, and Application Insights for observability.

param location string = resourceGroup().location
param namePrefix string = 'washnpress'
param acrServer string
param acrImage string = 'washnpress-backend:latest'
@secure()
param postgresAdminPassword string
@secure()
param razorpayWebhookSecret string
param minInstances int = 2
param maxInstances int = 10

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  sku: { name: 'P1v3', tier: 'PremiumV3' }   // supports autoscale, unlike Basic
  kind: 'linux'
  properties: { reserved: true }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web' }
}

resource vault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${namePrefix}-kv'
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
  }
}

resource redis 'Microsoft.Cache/redis@2024-03-01' = {
  name: '${namePrefix}-redis'
  location: location
  properties: { sku: { name: 'Standard', family: 'C', capacity: 1 }, enableNonSslPort: false, minimumTlsVersion: '1.2' }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: '${namePrefix}-pg'
  location: location
  sku: { name: 'Standard_D2ds_v5', tier: 'GeneralPurpose' }
  properties: {
    version: '16'
    administratorLogin: 'wnpadmin'
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 64 }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'ZoneRedundant' }
  }
}

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: '${namePrefix}-api'
  location: location
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acrServer}/${acrImage}'
      alwaysOn: true
      healthCheckPath: '/health'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'WNP_APP__ENV', value: 'production' }
        { name: 'WNP_STORAGE__DRIVER', value: 'postgres' }
        { name: 'WNP_STORAGE__POSTGRES__URL', value: 'postgresql://wnpadmin:${postgresAdminPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/washnpress?sslmode=require' }
        { name: 'WNP_CACHE__DRIVER', value: 'redis' }
        { name: 'WNP_CACHE__REDIS__URL', value: 'rediss://${redis.properties.hostName}:6380' }
        { name: 'WNP_PAYMENTS__WEBHOOKSECRET', value: razorpayWebhookSecret }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
      ]
    }
  }
}

// Autoscale: add instances as average CPU rises, remove them as it falls.
resource autoscale 'Microsoft.Insights/autoscalesettings@2022-10-01' = {
  name: '${namePrefix}-autoscale'
  location: location
  properties: {
    enabled: true
    targetResourceUri: plan.id
    profiles: [
      {
        name: 'default'
        capacity: { minimum: string(minInstances), maximum: string(maxInstances), default: string(minInstances) }
        rules: [
          {
            metricTrigger: { metricName: 'CpuPercentage', metricResourceUri: plan.id, timeGrain: 'PT1M', statistic: 'Average', timeWindow: 'PT5M', timeAggregation: 'Average', operator: 'GreaterThan', threshold: 65 }
            scaleAction: { direction: 'Increase', type: 'ChangeCount', value: '1', cooldown: 'PT3M' }
          }
          {
            metricTrigger: { metricName: 'CpuPercentage', metricResourceUri: plan.id, timeGrain: 'PT1M', statistic: 'Average', timeWindow: 'PT10M', timeAggregation: 'Average', operator: 'LessThan', threshold: 30 }
            scaleAction: { direction: 'Decrease', type: 'ChangeCount', value: '1', cooldown: 'PT5M' }
          }
        ]
      }
    ]
  }
}

output apiUrl string = 'https://${web.properties.defaultHostName}'
