# Azure Bastion Extension

A VS Code extension for Azure Bastion

## Features

- Easily create SSH tunnels through Azure Bastion directly from VS Code
- One-click connection from the status bar
- Secure remote development environment with Azure CLI integration

![](https://github.com/taizod1024/vscode-azure-bastion-extension/blob/main/images/azure-bastion_1.png?raw=true)

![](https://github.com/taizod1024/vscode-azure-bastion-extension/blob/main/images/azure-bastion_2.png?raw=true)

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
   Host localhost:60022(example_user@example.com:22)
       HostName example.com
       User example_user
       Port 60022
   ```
2. Configure the extension settings in VS Code (`azure-bastion`):
   - **Azure Subscription ID**: Your Azure subscription ID
   - **Bastion Resource Name**: Name of the Azure Bastion resource
   - **Resource Group**: The resource group containing the Bastion resource
   - **Remote Port**: Port on the target VM (default: 22 for SSH)
   - **Usernames**: List of SSH usernames for connection
   - **Target VM Resource IDs**: List of Azure VM resource IDs to connect to
   - **Local Ports**: List of local ports to bind tunnels (example: 60022)

## Usage

1.  Click the `Azure Bastion` button in the status bar
2.  Select operation type
    - Tunnel
    - SSH
