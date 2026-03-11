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

$ErrorActionPreference = "SilentlyContinue"

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Script started"
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Parameters:"
Write-Host "  - SubscriptionId: $SubscriptionId"
Write-Host "  - BastionName: $BastionName"
Write-Host "  - BastionResourceGroup: $BastionResourceGroup"
Write-Host "  - TargetVmResourceId: $TargetVmResourceId"
Write-Host "  - RemotePort: $RemotePort"
Write-Host "  - LocalPort: $LocalPort"

# Check if az command exists
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Checking if Azure CLI is installed..."
$azCommand = Get-Command az -ErrorAction SilentlyContinue
if (-not $azCommand) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: Azure CLI (az) is not installed or not found in PATH" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Azure CLI found"

# Check if az ssh extension is installed
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Checking Azure CLI ssh extension..."
$extensions = az extension list --query "[?name=='ssh'].name" -o tsv 2>$null
if ([string]::IsNullOrEmpty($extensions)) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: Azure CLI ssh extension is not installed" -ForegroundColor Red
    Write-Host "Please install it with: az extension add --name ssh"
    pause
    exit 1
}
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] SSH extension found"
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Azure CLI and ssh extension verified successfully"

# Login to Azure
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Logging in to Azure..."
az login --output none

if ($LASTEXITCODE -ne 0) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: Failed to login to Azure (exit code: $LASTEXITCODE)" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Azure login successful"

# Set subscription
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Setting subscription to $SubscriptionId..."
az account set --subscription $SubscriptionId

if ($LASTEXITCODE -ne 0) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: Failed to set subscription (exit code: $LASTEXITCODE)" -ForegroundColor Red
    pause
    exit 1
}
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Subscription set successfully"

# Execute bastion tunnel command
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Creating tunnel to target VM..."
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]   Bastion: $BastionName"
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]   Resource Group: $BastionResourceGroup"
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]   Target VM: $TargetVmResourceId"
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]   Remote Port: $RemotePort"
Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')]   Local Port: $LocalPort"

az network bastion tunnel `
    --name $BastionName `
    --resource-group $BastionResourceGroup `
    --target-resource-id $TargetVmResourceId `
    --resource-port $RemotePort `
    --local-port $LocalPort

if ($LASTEXITCODE -ne 0) {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] ERROR: Failed to create bastion tunnel (exit code: $LASTEXITCODE)" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Tunnel created successfully"
pause
