resource "azurerm_cosmosdb_account" "main" {
  name                = "githubappcosmosdb"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }

  capabilities {
    name = "EnableFreeTier"
  }
}

resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "githubAppDatabase"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}

resource "azurerm_cosmosdb_sql_container" "installations" {
  name                = "Installations"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name

  partition_key_path = "/installationId"
  throughput         = 400
}

resource "azurerm_cosmosdb_sql_container" "subscriptions" {
  name                = "Subscriptions"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name

  partition_key_path = "/subscriptionId"
  throughput         = 400
}

resource "azurerm_cosmosdb_sql_container" "repository_access" {
  name                = "RepositoryAccess"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name

  partition_key_path = "/installationId"
  throughput         = 400
}

resource "azurerm_cosmosdb_sql_container" "usage" {
  name                = "Usage"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name

  partition_key_path = "/installationId"
  throughput         = 400
}

resource "azurerm_role_assignment" "cosmosdb_role" {
  scope                = azurerm_cosmosdb_account.main.id
  role_definition_name = "Cosmos DB Account Reader Role"
  principal_id         = azurerm_windows_function_app.nodejs.identity.principal_id
}