# Azure Bastion Extension - beta

A VS Code extension for Azure Bastion

![](https://github.com/taizod1024/vscode-azure-bastion-extension/blob/main/images/azure-bastion_1.png?raw=true)

![](https://github.com/taizod1024/vscode-azure-bastion-extension/blob/main/images/azure-bastion_2.png?raw=true)

## Features

- Easily create connections through Azure Bastion directly from VS Code (Tunnel, SSH, RDP)
- Browse Azure subscriptions and Bastion-reachable virtual machines in the Azure Bastion sidebar
- Refresh resources and select a Bastion when more than one can reach a VM
- Save each VM's SSH username and tunnel ports in extension storage instead of settings
- Tunnel: Establish port forwarding for direct access
- SSH: Interactive SSH connections
- RDP: Remote Desktop connections
- Open Azure Bastion resources from the status bar
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
3. The **Azure Resources** extension (`ms-azuretools.vscode-azureresourcegroups`) is required for Azure sign-in. On startup, Azure Bastion offers to install it if it is missing. Sign in to Azure from its Resources view or from the Azure Bastion view.

## Azure Bastion sidebar

1. Open the **Azure Bastion** view from the Activity Bar or click the Azure Bastion status bar item.
2. Sign in to Azure in the Azure Resources view if prompted.
3. The view lists subscriptions and virtual machines that share a virtual network with a Bastion host or are connected through a directly connected VNet peering. VM names are sorted alphabetically within each subscription.
4. Use the refresh button in the view title to update the resource list.
5. Select a VM to choose Tunnel, SSH, or RDP. If more than one Bastion can reach that VM, select a Bastion; a single candidate is used automatically.
6. Use the VM context menu to configure its SSH username and tunnel ports. When connecting, missing SSH usernames and tunnel ports can also be entered and saved.

Azure sign-in for resource discovery is provided by VS Code's built-in Microsoft authentication through Azure Resources. Connection commands still use Azure CLI, which may prompt you to sign in, and require the `ssh` and `bastion` extensions as described above. The extension stores VM usernames and port numbers in VS Code extension storage; it never stores passwords. SSH and RDP authentication prompts remain with Azure CLI.

On first activation, the previous `azure-bastion.*` settings are migrated to extension storage and the migrated global/workspace setting values are removed. No connection targets need to be configured in Settings.

Resource discovery requires permission to read subscriptions, virtual machines, network interfaces, Bastion hosts, and VNet peerings. VM reachability across more complex hub-and-spoke or transitive network topologies may not be detected automatically.

## Usage

Select a VM in the Azure Bastion view and choose the required connection type:

- **Tunnel**: Enter a remote port and local listening port when prompted. The local port can be used in `~/.ssh/config` for SSH clients.
- **SSH**: Enter the VM's SSH username when it has not been saved yet. Azure CLI handles password authentication.
- **RDP**: Azure CLI opens the RDP setup flow.
