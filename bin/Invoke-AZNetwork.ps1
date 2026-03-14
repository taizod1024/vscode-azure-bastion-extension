param(
    [Parameter(Mandatory = $true)]
    [string]$SubscriptionId,
    
    [Parameter(Mandatory = $true)]
    [string]$BastionName,
    
    [Parameter(Mandatory = $true)]
    [string]$BastionResourceGroup,
    
    [Parameter(Mandatory = $true)]
    [string]$TargetVmResourceId,
    
    [Parameter(Mandatory = $false)]
    [int]$RemotePort,
    
    [Parameter(Mandatory = $false)]
    [int]$LocalPort,
    
    [Parameter(Mandatory = $false)]
    [string]$Username,
    
    [Parameter(Mandatory = $false)]
    [ValidateSet("tunnel", "ssh", "rdp")]
    [string]$Mode = "tunnel"
)

$ErrorActionPreference = "SilentlyContinue"

# Extract hostname from TargetVmResourceId
$HostName = $TargetVmResourceId -split "/" | Select-Object -Last 1

# Set window title
if ($Mode -eq "tunnel") {
    [System.Console]::Title = "Azure Bastion Tunnel"
    [System.Console]::Title = "localhost:$LocalPort -> $($HostName):$RemotePort"
}
elseif ($Mode -eq "ssh") {
    [System.Console]::Title = "Azure Bastion SSH"
}
elseif ($Mode -eq "rdp") {
    [System.Console]::Title = "Azure Bastion RDP"
}

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

function Write-WarnLog {
    param([string]$Message)
    Write-Host "[$((Get-Timestamp))] $Message" -ForegroundColor Yellow
}

Write-Log "Script started"
Write-Log "Parameters:"
Write-Host "  - SubscriptionId: $SubscriptionId"
Write-Host "  - BastionName: $BastionName"
Write-Host "  - BastionResourceGroup: $BastionResourceGroup"
Write-Host "  - TargetVmResourceId: $TargetVmResourceId"
Write-Host "  - Mode: $Mode"
if ($Mode -eq "tunnel") {
    Write-Host "  - RemotePort: $RemotePort"
    Write-Host "  - LocalPort: $LocalPort"
}
elseif ($Mode -eq "ssh") {
    Write-Host "  - Username: $Username"
}

# Validate mode-specific parameters
if ($Mode -eq "tunnel") {
    if (-not $RemotePort -or -not $LocalPort) {
        Write-ErrorLog "Tunnel mode requires RemotePort and LocalPort parameters"
        Write-WarnLog "Press Enter to exit..."
        Read-Host
        exit 1
    }
}
elseif ($Mode -eq "ssh") {
    if (-not $Username) {
        Write-ErrorLog "SSH mode requires Username parameter"
        Write-WarnLog "Press Enter to exit..."
        Read-Host
        exit 1
    }
}

# Check if az command exists
Write-Log "Checking if Azure CLI is installed..."
$azCommand = Get-Command az -ErrorAction SilentlyContinue
if (-not $azCommand) {
    Write-ErrorLog "Azure CLI (az) is not installed or not found in PATH"
    Write-WarnLog "Press Enter to exit..."
    Read-Host
    exit 1

}
Write-Log "Azure CLI found"

# Login to Azure
Write-Log "Logging in to Azure..."
$null | az login --output none

if ($LASTEXITCODE -ne 0) {
    Write-ErrorLog "Failed to login to Azure (exit code: $LASTEXITCODE)"
    Write-WarnLog "Press Enter to exit..."
    Read-Host
    exit 1
}
Write-Log "Azure login successful"

# Set subscription
Write-Log "Setting subscription to $SubscriptionId..."
az account set --subscription $SubscriptionId

if ($LASTEXITCODE -ne 0) {
    Write-ErrorLog "Failed to set subscription (exit code: $LASTEXITCODE)"
    Write-WarnLog "Press Enter to exit..."
    Read-Host
    exit 1
}
Write-Log "Subscription set successfully"

# Execute Bastion command
if ($Mode -eq "tunnel") {
    # Execute Bastion tunnel command
    Write-Log "Creating tunnel connection..."

    [System.Console]::Title = "localhost:$LocalPort -> $($HostName):$RemotePort"
    
    az network Bastion tunnel `
        --name $BastionName `
        --resource-group $BastionResourceGroup `
        --target-resource-id $TargetVmResourceId `
        --resource-port $RemotePort `
        --port $LocalPort
    
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorLog "Failed to create Bastion tunnel (exit code: $LASTEXITCODE)"
        Write-WarnLog "Press Enter to exit..."
        Read-Host
        exit 1
    }
    
    Write-Log "Tunnel created successfully"
}
elseif ($Mode -eq "ssh") {
    # Execute Bastion SSH command
    Write-Log "Establishing SSH connection..."
    
    az network Bastion ssh `
        --name $BastionName `
        --resource-group $BastionResourceGroup `
        --target-resource-id $TargetVmResourceId `
        --username $Username `
        --auth-type password
    
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorLog "Failed to establish SSH connection (exit code: $LASTEXITCODE)"
        Write-WarnLog "Press Enter to exit..."
        Read-Host
        exit 1
    }
    
    Write-Log "SSH connection closed"
}
elseif ($Mode -eq "rdp") {
    # Execute Bastion RDP command
    Write-Log "Establishing RDP connection..."
    
    az network Bastion rdp `
        --name $BastionName `
        --resource-group $BastionResourceGroup `
        --target-resource-id $TargetVmResourceId
    
    if ($LASTEXITCODE -ne 0) {
        Write-ErrorLog "Failed to establish RDP connection (exit code: $LASTEXITCODE)"
        Write-WarnLog "Press Enter to exit..."
        Read-Host
        exit 1
    }
    
    Write-Log "RDP connection closed"
}
