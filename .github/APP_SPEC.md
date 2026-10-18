# Azure Bastion Extension Specification

## Azure Bastion resource view

The extension exposes Azure subscriptions and Bastion-reachable virtual machines in the Azure Bastion Activity Bar view. The Command Palette is not used to launch extension features; resource discovery, sign-in, connections, and resource actions are available from the view and its context menus.

The view title provides resource refresh and SSH configuration actions. VM context menus provide Tunnel and SSH connections, plus RDP for Windows VMs, and VM configuration. Subscription and VM context menus provide properties, portal, and refresh actions.

Each displayed VM includes its Azure power state in the tooltip. A running VM uses the normal blue icon; other or unavailable power states use a muted icon. Power state is fetched from the VM Instance View during resource discovery, so each refresh updates the displayed state. An Instance View request failure is logged and does not prevent the VM from appearing.

## Resource properties

View Properties fetches the selected subscription or VM JSON from Azure Resource Manager and opens it as a file in the operating system's temporary directory. The extension removes that file when its document closes and cleans up remaining tracked files during extension disposal, so the JSON does not open as an unsaved untitled document.

## Resource refresh

Refreshing replaces the current tree with a loading message before starting Azure resource discovery. The tree is rebuilt with the discovered subscriptions, VMs, and latest VM power states when discovery succeeds. If discovery fails, the loading message is replaced by a sign-in or retry action; stale tree nodes are not retained. Only the most recently requested refresh may update the tree.

## Azure portal

Subscriptions and VMs can be opened from their context menus in either VS Code's built-in Simple Browser or the system's external browser. The portal URL targets the selected resource and includes the tenant when available.

## Actions and icons

Tunnel, SSH, RDP, internal browser, external browser, and refresh actions use their corresponding VS Code codicons in menus. Extension commands are intentionally hidden from the Command Palette.
