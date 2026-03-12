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

# Helper functions
function Get-Timestamp {
    return Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
}

function Write-Log {
    param([string]$Message)
    Write-Host "[$((Get-Timestamp))] $Message"
}

function Write-ErrorLog {
    param([string]$Message)
    Write-Host "[$((Get-Timestamp))] ERROR: $Message" -ForegroundColor Red
}

Write-Log "Script started"
Write-Log "Parameters:"
Write-Host "  - SubscriptionId: $SubscriptionId"
Write-Host "  - BastionName: $BastionName"
Write-Host "  - BastionResourceGroup: $BastionResourceGroup"
Write-Host "  - TargetVmResourceId: $TargetVmResourceId"
Write-Host "  - RemotePort: $RemotePort"
Write-Host "  - LocalPort: $LocalPort"

# Check if az command exists
Write-Log "Checking if Azure CLI is installed..."
$azCommand = Get-Command az -ErrorAction SilentlyContinue
if (-not $azCommand) {
    Write-ErrorLog "Azure CLI (az) is not installed or not found in PATH"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Log "Azure CLI found"

# Login to Azure
Write-Log "Logging in to Azure..."
$null | az login --output none

if ($LASTEXITCODE -ne 0) {
    Write-ErrorLog "Failed to login to Azure (exit code: $LASTEXITCODE)"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Log "Azure login successful"

# Set subscription
Write-Log "Setting subscription to $SubscriptionId..."
az account set --subscription $SubscriptionId

if ($LASTEXITCODE -ne 0) {
    Write-ErrorLog "Failed to set subscription (exit code: $LASTEXITCODE)"
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Log "Subscription set successfully"

# Execute bastion tunnel command
Write-Log "Creating tunnel to target VM..."
Write-Log "  Bastion: $BastionName"
Write-Log "  Resource Group: $BastionResourceGroup"
Write-Log "  Target VM: $TargetVmResourceId"
Write-Log "  Remote Port: $RemotePort"
Write-Log "  Local Port: $LocalPort"

az network bastion tunnel `
    --name $BastionName `
    --resource-group $BastionResourceGroup `
    --target-resource-id $TargetVmResourceId `
    --resource-port $RemotePort `
    --port $LocalPort

if ($LASTEXITCODE -ne 0) {
    Write-ErrorLog "Failed to create bastion tunnel (exit code: $LASTEXITCODE)"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Log "Tunnel created successfully"
Read-Host "Press Enter to exit"
