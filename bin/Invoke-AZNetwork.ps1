param(
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory = $true)]
    [string]$BastionName,
    
    [Parameter(Mandatory = $true)]
    [string]$BastionResourceGroup,
    
    [Parameter(Mandatory = $true)]
    [string]$TargetVmResourceId,
    
    [Parameter(Mandatory = $true)]
    [int]$RemotePort,
    
    [Parameter(Mandatory = $true)]
    [int]$LocalPort
)

Pause

# Check if az command exists
$azCommand = Get-Command az -ErrorAction SilentlyContinue
if (-not $azCommand) {
    Write-Error "Azure CLI (az) is not installed or not found in PATH"
    pause
    exit 1
}

# Check if az ssh extension is installed
Write-Host "Checking Azure CLI ssh extension..."
$extensions = az extension list --query "[?name=='ssh'].name" -o tsv 2>$null
if ([string]::IsNullOrEmpty($extensions)) {
    Write-Error "Azure CLI ssh extension is not installed. Please install it with: az extension add --name ssh"
    pause
    exit 1
}

Write-Host "Azure CLI and ssh extension verified successfully"

# Login to Azure
Write-Host "Logging in to Azure..."
az login --output none

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to login to Azure"
    pause
    exit 1
}

# Set subscription
Write-Host "Setting subscription to $SubscriptionId..."
az account set --subscription $SubscriptionId

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to set subscription"
    pause
    exit 1
}

# Execute bastion tunnel command
Write-Host "Creating tunnel to target VM..."
Write-Host "Bastion: $BastionName"
Write-Host "Resource Group: $BastionResourceGroup"
Write-Host "Target VM: $TargetVmResourceId"
Write-Host "Remote Port: $RemotePort"
Write-Host "Local Port: $LocalPort"

az network bastion tunnel `
    --name $BastionName `
    --resource-group $BastionResourceGroup `
    --target-resource-id $TargetVmResourceId `
    --resource-port $RemotePort `
    --local-port $LocalPort

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to create bastion tunnel"
    pause
    exit 1
}

Write-Host "Tunnel created successfully"
pause
