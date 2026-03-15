# Azure Bastion Extension - beta

A VS Code extension for Azure Bastion

![](https://github.com/taizod1024/vscode-azure-bastion-extension/blob/main/images/azure-bastion_1.png?raw=true)

![](https://github.com/taizod1024/vscode-azure-bastion-extension/blob/main/images/azure-bastion_2.png?raw=true)

## Features

- Easily create connections through Azure Bastion directly from VS Code (Tunnel, SSH, RDP)
- Tunnel: Establish port forwarding for direct access
- SSH: Interactive SSH connections
- RDP: Remote Desktop connections
- One-click connection from the status bar
- Secure remote development environment with Azure CLI integration

## Install

1. Install Azure CLI and required extensions
   1. Open a terminal
   2. Install Azure CLI: `winget install Microsoft.AzureCLI`
   3. Install required extensions:
      - `az extension add -n ssh`
      - `az extension add -n bastion`
2. Install the VS Code extension
   1. Open VS Code
   2. Install the Azure Bastion extension from the extensions marketplace

## Configuration

**Note**: The **Port** value in ~/.ssh/config must correspond to the **Local Port** setting.

1. Edit your `~/.ssh/config` file with the following structure:
   ```
   Host localhost(example_vm)
       HostName localhost
       Port 60022
       User example_user
   ```
2. Configure the extension settings in VS Code (`azure-bastion`):
   - **Azure Subscription ID**: Your Azure subscription ID
   - **Bastion Resource Name**: Name of the Azure Bastion resource
   - **Resource Group**: The resource group containing the Bastion resource
   - **Target VM Resource IDs**: List of Azure VM resource IDs to connect to
   - **Tunnel**:
     - **Local Ports**: List of local ports to bind tunnels (example: [60022, 60023])
     - **Remote Ports**: List of ports on the target VMs (example: [22, 22])
   - **SSH**:
     - **Usernames**: List of SSH usernames for connection (example: ["user1", "user2"])

## Usage

1.  Click the `Azure Bastion` button in the status bar
2.  Select operation type
    - Tunnel
    - SSH
    - RDP
