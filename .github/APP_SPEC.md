# Azure Bastion Extension Specification

## Azure Bastion resource view

The extension exposes one Azure Bastion root node containing Azure subscriptions and Bastion-reachable virtual machines in the Azure Bastion Activity Bar view. The Command Palette is not used to launch extension features; resource discovery, sign-in, connections, and resource actions are available from the view and its context menus.

The Azure Bastion root row provides a refresh action for the complete resource tree. The view title provides the SSH configuration action. VM context menus provide Tunnel and SSH connections, plus RDP for Windows VMs, and VM configuration. Subscription and VM context menus provide properties, portal, and refresh actions.

VM rows expose inline icon actions for Tunnel, SSH, RDP (Windows only), built-in browser, external browser, and refresh. Subscription rows expose built-in browser, external browser, and refresh inline actions. The same actions remain available from the context menu; inline icons are revealed when hovering over a row.

Each displayed VM shows the Azure power state (for example, `running` or `deallocated`) in its description beside the name and in its tooltip. Windows VM actions are identified from the OS disk type. A running VM uses the normal blue icon; other or unavailable power states use a muted icon. Power state is fetched from the VM Instance View during resource discovery, so each refresh updates the displayed state. An Instance View request failure is logged, does not prevent the VM from appearing, and marks the VM with a red error icon.

## Resource properties

View Properties fetches the selected subscription or VM JSON from Azure Resource Manager and opens it as a file in the operating system's temporary directory. The extension removes that file when its document closes and cleans up remaining tracked files during extension disposal, so the JSON does not open as an unsaved untitled document.

## Resource refresh

The root row's Refresh action reloads the complete resource tree, clearing its children while loading and showing "Refreshing..." in the root node's description with an animated spinner on that node until Azure resource discovery finishes. A subscription row's Refresh action reloads only that subscription's VM children, using Bastion hosts across signed-in subscriptions to preserve cross-subscription reachability checks; only the subscription row shows "Refreshing..." in its description and spins while refreshing. A VM row's Refresh action reloads only that VM's power state, with "Refreshing..." in the VM row's description and an animated spinner on that node. Failed resource fetches are marked with a red error icon on the affected root, subscription, or VM node. A failed node refresh preserves the current tree and reports the error. An expired Azure access token that VS Code cannot refresh is reported in an error dialog and prompts the user to sign in again; it is not diagnosed as a local clock issue. Only the most recently requested refresh may update the tree.

## Azure portal

Subscriptions and VMs can be opened from their context menus in either VS Code's built-in Simple Browser or the system's external browser. The portal URL targets the selected resource and includes the tenant when available.

## Actions and icons

Tunnel, SSH, RDP, internal browser, external browser, and refresh actions use their corresponding VS Code codicons in menus. Extension commands are intentionally hidden from the Command Palette.
