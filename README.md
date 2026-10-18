# Azure Bastion Extension - beta

A VS Code extension for Azure Bastion

> **Notice (2026/10/18):** The UI was redesigned. Connections are now made from the **Azure Bastion** sidebar (Activity Bar), and the status bar item and the quick pick menu were removed. VM settings are no longer configured in Settings; they are stored in extension storage.

## Features

- Easily create connections through Azure Bastion directly from VS Code (Tunnel, SSH, RDP)
- Browse Azure subscriptions and Bastion-reachable virtual machines, including their current power state, in the Azure Bastion sidebar
- Refresh resources and VM power states, and select a Bastion when more than one can reach a VM
- View resource properties as JSON and open subscriptions or VMs in the built-in or external browser from the context menu
- Save each VM's SSH username and tunnel ports in extension storage instead of settings
- Tunnel: Establish port forwarding for direct access
- SSH: Interactive SSH connections
- RDP: Remote Desktop connections
- Secure remote development environment with Azure CLI integration
- Windows only (connections are launched through PowerShell)

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

1. Open the **Azure Bastion** view from the Activity Bar. Features are accessed from the view and its context menus, not the Command Palette.
2. Sign in to Azure in the Azure Resources view if prompted.
3. The view lists subscriptions and virtual machines that share a virtual network with a Bastion host or are connected through a directly connected VNet peering. VM names are sorted alphabetically within each subscription.
4. Use the refresh button in the view title, or **Refresh** in a node's context menu, to update the resource list. The current nodes are cleared while Azure resources are reloaded so stale entries are not shown.
5. Right-click a VM to choose Tunnel, SSH, or RDP (RDP is shown for Windows VMs only). If more than one Bastion can reach that VM, select a Bastion; a single candidate is used automatically.
6. Use **Configure VM** in the VM context menu to set its SSH username and tunnel ports. When connecting, missing SSH usernames and tunnel ports can also be entered and saved.
7. Saved VM settings are synced to `~/.ssh/config` as a managed block (`# azure-bastion:start` to `# azure-bastion:end`) with `Host <VM name>`, `HostName localhost`, `Port <local port>`, and `User <username>`. Use the **Open SSH Config** button at the top of the view to review it. The extension storage is the source of truth: edit VM settings with **Configure VM**, not inside the block, because changes in the block are overwritten. Content outside the block is never modified.
8. Use **View Properties** to open the resource's JSON from Azure Resource Manager. The JSON is opened from a temporary file and is removed when the document is closed, avoiding an unsaved-document prompt. **Open in Portal** opens the resource in VS Code's built-in browser, and **Open in Portal with External Browser** opens it in your default browser. Both portal actions are available on subscriptions and VMs.

Azure sign-in for resource discovery is provided by VS Code's built-in Microsoft authentication through Azure Resources. Connection commands still use Azure CLI, which may prompt you to sign in, and require the `ssh` and `bastion` extensions as described above. The extension stores VM usernames and port numbers in VS Code extension storage; it never stores passwords. SSH and RDP authentication prompts remain with Azure CLI.

On first activation, the previous `azure-bastion.*` settings are migrated to extension storage and the migrated global/workspace setting values are removed. No connection targets need to be configured in Settings.

Resource discovery requires permission to read subscriptions, virtual machines and their instance views, network interfaces, Bastion hosts, and VNet peerings. VM reachability across more complex hub-and-spoke or transitive network topologies may not be detected automatically.

## Usage

Right-click a VM in the Azure Bastion view and choose the required connection type:

- **Tunnel**: Enter a remote port and local listening port when prompted. The local port can be used in `~/.ssh/config` for SSH clients.
- **SSH**: Enter the VM's SSH username when it has not been saved yet. Azure CLI handles password authentication.
- **RDP**: Azure CLI opens the RDP setup flow.
