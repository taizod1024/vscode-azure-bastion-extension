import * as vscode from "vscode";
import { execFile } from "child_process";
import * as https from "https";
import * as path from "path";
import { URL } from "url";

interface AzureSubscription {
  id: string;
  name: string;
  tenantId: string;
}

interface BastionHost {
  id: string;
  name: string;
  subscriptionId: string;
  resourceGroup: string;
  vnetIds: string[];
}

interface VirtualMachine {
  id: string;
  name: string;
  subscriptionId: string;
  resourceGroup: string;
  networkInterfaceIds: string[];
}

interface VmSettings {
  username?: string;
  remotePort?: number;
  localPort?: number;
  legacyBastionName?: string;
  legacyBastionResourceGroup?: string;
  legacyBastionSubscriptionId?: string;
}

interface ExplorerState {
  subscriptions: AzureSubscription[];
  vmSettings: Record<string, VmSettings>;
}

interface ArmResource {
  id?: string;
  name?: string;
  properties?: {
    ipConfigurations?: Array<{ properties?: { subnet?: { id?: string } } }>;
    virtualNetwork?: { id?: string };
    networkProfile?: { networkInterfaces?: Array<{ id?: string }> };
    ipConfigurationsOnSubnet?: Array<{ properties?: { subnet?: { id?: string } } }>;
  };
  subscriptionId?: string;
  displayName?: string;
  tenantId?: string;
  state?: string;
  nextLink?: string;
  value?: ArmResource[];
}

interface NetworkPeeringResource {
  properties?: {
    peeringState?: string;
    remoteVirtualNetwork?: { id?: string };
  };
}

type ExplorerNode =
  | { kind: "subscription"; subscription: AzureSubscription }
  | { kind: "vm"; vm: VirtualMachine; bastions: BastionHost[] }
  | { kind: "message"; label: string; command: string };

const stateKey = "azure-bastion.sidebar.v1";
const migrationKey = "azure-bastion.sidebar.migrated.v1";
const azureResourcesExtensionId = "ms-azuretools.vscode-azureresourcegroups";
const microsoftScopes = ["https://management.azure.com/user_impersonation"];

class BastionTreeProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private readonly changed = new vscode.EventEmitter<ExplorerNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private nodes: ExplorerNode[] = [];
  private readonly children = new Map<ExplorerNode, ExplorerNode[]>();

  refresh(nodes: ExplorerNode[]) {
    this.nodes = nodes;
    const current = new Set(nodes);
    for (const node of this.children.keys()) {
      if (!current.has(node)) this.children.delete(node);
    }
    this.changed.fire();
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    if (node.kind === "subscription") {
      const item = new vscode.TreeItem(node.subscription.name, vscode.TreeItemCollapsibleState.Expanded);
      item.description = node.subscription.id;
      item.iconPath = new vscode.ThemeIcon("cloud");
      return item;
    }
    if (node.kind === "vm") {
      const item = new vscode.TreeItem(node.vm.name, vscode.TreeItemCollapsibleState.None);
      item.description = node.vm.resourceGroup;
      item.tooltip = node.vm.id;
      item.contextValue = "azureBastionVm";
      item.iconPath = new vscode.ThemeIcon("vm");
      item.command = {
        command: "azure-bastion.connectVm",
        title: "Connect",
        arguments: [node.vm.id],
      };
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.command = { command: node.command, title: node.label };
    item.iconPath = new vscode.ThemeIcon(node.command.endsWith("signIn") ? "account" : "info");
    return item;
  }

  getChildren(node?: ExplorerNode): ExplorerNode[] {
    if (!node) return this.nodes;
    if (node.kind !== "subscription") return [];
    return this.children.get(node) || [];
  }

  setChildren(node: ExplorerNode, children: ExplorerNode[]) {
    this.children.set(node, children);
  }

  dispose() {
    this.changed.dispose();
  }
}

class AzureResources {
  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {}

  private async getSession(createIfNone: boolean): Promise<vscode.AuthenticationSession | undefined> {
    const provider = vscode.extensions.getExtension(azureResourcesExtensionId);
    if (!provider) {
      throw new Error("Install or enable the Azure Resources extension to sign in to Azure.");
    }
    if (!provider.isActive) await provider.activate();
    const session = await vscode.authentication.getSession("microsoft", microsoftScopes, { createIfNone });
    if (session) this.log.appendLine(`Signed in as ${session.account.label}; scopes: ${session.scopes.join(" ")}`);
    return session;
  }

  private async armGet<T>(accessToken: string, endpoint: string): Promise<T[]> {
    const results: T[] = [];
    let next = endpoint;
    while (next) {
      const response = await this.requestJson(accessToken, next);
      if (Array.isArray(response.value)) results.push(...(response.value as T[]));
      if (response.subscriptionId) results.push(response as T);
      next = response.nextLink || "";
    }
    return results;
  }

  private async requestJson(accessToken: string, endpoint: string): Promise<ArmResource> {
    const url = new URL(endpoint, "https://management.azure.com");
    if (url.protocol !== "https:" || url.hostname !== "management.azure.com") {
      throw new Error("Refusing an Azure Resource Manager request to an unexpected host.");
    }
    const fetchFn = (globalThis as unknown as { fetch?: (input: string, init: object) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }> }).fetch;
    if (!fetchFn) return this.requestJsonHttps(accessToken, endpoint);
    const response = await fetchFn(url.toString(), {
      method: "GET",
      headers: { authorization: "Bearer " + accessToken, accept: "application/json" },
    });
    const body = await response.text();
    if (url.pathname.split("/").length <= 3) {
      this.log.appendLine(`GET ${url.pathname} -> ${response.status}, ${body.length} bytes${body.length < 300 ? `: ${body}` : ""}`);
    }
    if (response.status < 200 || response.status >= 300) {
      let message = `Azure Resource Manager request failed (${response.status}).`;
      try {
        const errorBody = JSON.parse(body) as { error?: { message?: string } };
        if (errorBody.error?.message) message = errorBody.error.message;
      } catch {
        // keep the generic message
      }
      throw new Error(message);
    }
    if (body.trim() === "") return {};
    try {
      return JSON.parse(body) as ArmResource;
    } catch (error) {
      throw new Error(`Azure Resource Manager returned invalid JSON for ${url.pathname}: ${error}`);
    }
  }

  private async requestJsonHttps(accessToken: string, endpoint: string): Promise<ArmResource> {
    const url = new URL(endpoint, "https://management.azure.com");
    if (url.protocol !== "https:" || url.hostname !== "management.azure.com") {
      throw new Error("Refusing an Azure Resource Manager request to an unexpected host.");
    }
    return new Promise<ArmResource>((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${accessToken}`,
            accept: "application/json",
          },
        },
        response => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", chunk => (body += chunk));
          response.on("end", () => {
            const status = response.statusCode || 0;
            if (url.pathname.split("/").length <= 3) {
              this.log.appendLine(`GET ${url.pathname} -> ${status}, ${body.length} bytes${body.length < 300 ? `: ${body}` : ""}`);
            }
            if (status < 200 || status >= 300) {
              let message = `Azure Resource Manager request failed (${status}).`;
              try {
                const errorBody = JSON.parse(body) as { error?: { message?: string } };
                if (errorBody.error?.message) message = errorBody.error.message;
              } catch (error) {
                this.log.appendLine(`WARN: Could not parse Azure error response: ${error}`);
              }
              reject(new Error(message));
              return;
            }
            if (body.trim() === "") {
              resolve({});
              return;
            }
            try {
              resolve(JSON.parse(body) as ArmResource);
            } catch (error) {
              reject(new Error(`Azure Resource Manager returned invalid JSON for ${url.pathname}: ${error}`));
            }
          });
        },
      );
      request.setTimeout(30000, () => request.destroy(new Error("Azure Resource Manager request timed out.")));
      request.on("error", reject);
      request.end();
    });
  }

  private resourceGroupFromId(id: string): string {
    return id.match(/\/resourceGroups\/([^/]+)/i)?.[1] || "";
  }

  private subscriptionFromId(id: string): string {
    return id.match(/\/subscriptions\/([^/]+)/i)?.[1] || "";
  }

  private vnetFromSubnetId(id: string | undefined): string | undefined {
    if (!id) return undefined;
    const match = id.match(/^(\/subscriptions\/[^/]+\/resourceGroups\/[^/]+\/providers\/Microsoft\.Network\/virtualNetworks\/[^/]+)/i);
    return match?.[1].toLowerCase();
  }

  private async mapLimit<T, R>(items: T[], limit: number, callback: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let index = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await callback(items[current]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  private tokensBySubscription = new Map<string, string>();

  private tokenFor(resourceId: string, fallback: string): string {
    return this.tokensBySubscription.get(this.subscriptionFromId(resourceId).toLowerCase()) || fallback;
  }

  private async loadSubscriptions(defaultToken: string): Promise<AzureSubscription[]> {
    this.tokensBySubscription.clear();
    const found = new Map<string, AzureSubscription>();
    const collect = async (token: string, label: string) => {
      const resources = await this.armGet<ArmResource>(token, "/subscriptions?api-version=2022-12-01");
      this.log.appendLine(`Found ${resources.length} subscription(s) for ${label}.`);
      for (const resource of resources) {
        if (!resource.subscriptionId || resource.state === "Disabled" || resource.state === "Deleted") continue;
        const key = resource.subscriptionId.toLowerCase();
        if (found.has(key)) continue;
        found.set(key, {
          id: resource.subscriptionId,
          name: resource.displayName || resource.subscriptionId,
          tenantId: resource.tenantId || "",
        });
        this.tokensBySubscription.set(key, token);
      }
    };

    await collect(defaultToken, "the default tenant");

    // Subscriptions in other tenants need a tenant-specific token
    let tenants: ArmResource[] = [];
    try {
      tenants = await this.armGet<ArmResource>(defaultToken, "/tenants?api-version=2022-12-01");
    } catch (error) {
      this.log.appendLine(`WARN: Could not list tenants: ${error}`);
    }
    for (const tenant of tenants) {
      if (!tenant.tenantId) continue;
      try {
        const tenantSession = await vscode.authentication.getSession(
          "microsoft",
          [...microsoftScopes, `VSCODE_TENANT:${tenant.tenantId}`],
          { silent: true },
        );
        if (tenantSession) await collect(tenantSession.accessToken, `tenant ${tenant.tenantId}`);
        else this.log.appendLine(`Tenant ${tenant.tenantId} is not signed in; skipped. Sign in to it from the Azure Resources extension.`);
      } catch (error) {
        this.log.appendLine(`WARN: Could not read subscriptions of tenant ${tenant.tenantId}: ${error}`);
      }
    }
    return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private async loadForSubscription(
    token: string,
    subscription: AzureSubscription,
  ): Promise<{ bastions: BastionHost[]; vms: VirtualMachine[] }> {
    const [bastionResources, vmResources] = await Promise.all([
      this.armGet<ArmResource>(
        token,
        `/subscriptions/${encodeURIComponent(subscription.id)}/providers/Microsoft.Network/bastionHosts?api-version=2024-05-01`,
      ),
      this.armGet<ArmResource>(
        token,
        `/subscriptions/${encodeURIComponent(subscription.id)}/providers/Microsoft.Compute/virtualMachines?api-version=2024-03-01`,
      ),
    ]);

    const bastions: BastionHost[] = bastionResources
      .filter(resource => resource.id && resource.name)
      .map(resource => ({
        id: resource.id as string,
        name: resource.name as string,
        subscriptionId: this.subscriptionFromId(resource.id as string),
        resourceGroup: this.resourceGroupFromId(resource.id as string),
        vnetIds: [
          ...(resource.properties?.ipConfigurations || []).map(configuration =>
            this.vnetFromSubnetId(configuration.properties?.subnet?.id),
          ),
          this.vnetFromSubnetId(resource.properties?.virtualNetwork?.id),
        ].filter((id): id is string => !!id),
      }));
    const vms: VirtualMachine[] = vmResources
      .filter(resource => resource.id && resource.name)
      .map(resource => ({
        id: resource.id as string,
        name: resource.name as string,
        subscriptionId: this.subscriptionFromId(resource.id as string),
        resourceGroup: this.resourceGroupFromId(resource.id as string),
        networkInterfaceIds: (resource.properties?.networkProfile?.networkInterfaces || [])
          .map(networkInterface => networkInterface.id)
          .filter((id): id is string => !!id),
      }));
    this.log.appendLine(
      `Subscription ${subscription.name}: ${bastions.length} Bastion host(s) [${bastions.map(b => `${b.name} -> ${b.vnetIds.join(",") || "no vnet"}`).join("; ")}], ${vms.length} VM(s).`,
    );
    return { bastions, vms };
  }

  private async loadPeeredVnets(token: string, bastions: BastionHost[]): Promise<Map<string, Set<string>>> {
    const peeringTargets = new Map<string, Set<string>>();
    const uniqueVnets = [...new Set(bastions.flatMap(bastion => bastion.vnetIds))];
    await this.mapLimit(uniqueVnets, 4, async vnetId => {
      const subscriptionId = this.subscriptionFromId(vnetId);
      const endpoint = `${vnetId}/virtualNetworkPeerings?api-version=2024-05-01`;
      try {
        const peerings = await this.armGet<NetworkPeeringResource>(this.tokenFor(vnetId, token), endpoint);
        const reachable = new Set<string>([vnetId]);
        for (const peering of peerings) {
          if (peering.properties?.peeringState !== "Connected") continue;
          const remoteId = peering.properties.remoteVirtualNetwork?.id;
          if (remoteId) reachable.add(remoteId.toLowerCase());
        }
        peeringTargets.set(vnetId, reachable);
      } catch (error) {
        this.log.appendLine(`WARN: Could not load VNet peerings for ${subscriptionId}/${vnetId}: ${error}`);
        peeringTargets.set(vnetId, new Set([vnetId]));
      }
    });
    return peeringTargets;
  }

  private async getVmVnets(token: string, vm: VirtualMachine): Promise<string[]> {
    const results = await this.mapLimit(vm.networkInterfaceIds, 4, async id => {
      try {
        const resource = await this.requestJson(this.tokenFor(id, token), `${id}?api-version=2024-05-01`);
        return (resource.properties?.ipConfigurations || resource.properties?.ipConfigurationsOnSubnet || [])
          .map(configuration => this.vnetFromSubnetId(configuration.properties?.subnet?.id))
          .filter((vnetId): vnetId is string => !!vnetId);
      } catch (error) {
        this.log.appendLine(`WARN: Could not inspect network interface ${id}: ${error}`);
        return [];
      }
    });
    return [...new Set(results.flat())];
  }

  async discover(): Promise<{ subscriptions: AzureSubscription[]; machines: Array<{ vm: VirtualMachine; bastions: BastionHost[] }> }> {
    const session = await this.getSession(false);
    if (!session) throw new Error("Sign in to Azure from the Azure Resources view, then refresh this list.");
    const subscriptions = await this.loadSubscriptions(session.accessToken);
    const resources = await this.mapLimit(subscriptions, 3, async subscription => {
      try {
        return await this.loadForSubscription(this.tokenFor(`/subscriptions/${subscription.id}`, session.accessToken), subscription);
      } catch (error) {
        this.log.appendLine(`WARN: Could not load resources for subscription ${subscription.name}: ${error}`);
        return { bastions: [] as BastionHost[], vms: [] as VirtualMachine[] };
      }
    });
    const bastions = resources.flatMap(resource => resource.bastions);
    const vms = resources.flatMap(resource => resource.vms);
    const reachableByBastionVnet = await this.loadPeeredVnets(session.accessToken, bastions);
    const settings = await this.getState();
    const machines = await this.mapLimit(vms, 5, async vm => {
      let vmVnets: string[] = [];
      try {
        vmVnets = await this.getVmVnets(session.accessToken, vm);
      } catch (error) {
        this.log.appendLine(`WARN: Could not inspect VM network interfaces for ${vm.id}: ${error}`);
      }
      const matchingBastions = bastions.filter(bastion =>
        bastion.vnetIds.some(bastionVnet =>
          [...(reachableByBastionVnet.get(bastionVnet) || new Set([bastionVnet]))].some(vnet => vmVnets.includes(vnet)),
        ),
      );
      const saved = settings.vmSettings[vm.id.toLowerCase()];
      if (saved?.legacyBastionName) {
        const legacy = bastions.find(
          bastion =>
            bastion.name.toLowerCase() === saved.legacyBastionName?.toLowerCase() &&
            bastion.resourceGroup.toLowerCase() === saved.legacyBastionResourceGroup?.toLowerCase() &&
            bastion.subscriptionId.toLowerCase() === saved.legacyBastionSubscriptionId?.toLowerCase(),
        );
        if (legacy && !matchingBastions.some(bastion => bastion.id.toLowerCase() === legacy.id.toLowerCase())) {
          matchingBastions.push(legacy);
        } else if (!legacy && matchingBastions.length === 0) {
          matchingBastions.push({
            id: "",
            name: saved.legacyBastionName,
            resourceGroup: saved.legacyBastionResourceGroup || "",
            subscriptionId: saved.legacyBastionSubscriptionId || vm.subscriptionId,
            vnetIds: [],
          });
        }
      }
      return { vm, bastions: matchingBastions };
    });
    return { subscriptions, machines: machines.filter(machine => machine.bastions.length > 0) };
  }

  async getState(): Promise<ExplorerState> {
    return (
      (await this.context.globalState.get<ExplorerState>(stateKey)) || {
        subscriptions: [],
        vmSettings: {},
      }
    );
  }

  async signIn(): Promise<void> {
    await this.getSession(true);
  }

  async saveSubscriptions(subscriptions: AzureSubscription[]): Promise<void> {
    const state = await this.getState();
    state.subscriptions = subscriptions;
    await this.context.globalState.update(stateKey, state);
  }

  async updateVmSettings(vmId: string, vmSettings: VmSettings): Promise<void> {
    const state = await this.getState();
    state.vmSettings[vmId.toLowerCase()] = vmSettings;
    await this.context.globalState.update(stateKey, state);
  }

  async migrateLegacySettings(): Promise<void> {
    if (this.context.globalState.get<boolean>(migrationKey)) return;
    const config = vscode.workspace.getConfiguration("azure-bastion");
    const subscriptionId = config.get<string>("subscriptionId") || "";
    const bastionName = config.get<string>("bastionName") || "";
    const bastionResourceGroup = config.get<string>("bastionResourceGroup") || "";
    const targetIds = config.get<string[]>("targetVmResourceId") || [];
    const remotePorts = config.get<number[]>("tunnel.remotePort") || [];
    const localPorts = config.get<number[]>("tunnel.localPort") || [];
    const usernames = config.get<string[]>("ssh.username") || [];
    const state = await this.getState();

    targetIds.forEach((id, index) => {
      state.vmSettings[id.toLowerCase()] = {
        username: usernames[index] || undefined,
        remotePort: remotePorts[index] || undefined,
        localPort: localPorts[index] || undefined,
        legacyBastionName: bastionName || undefined,
        legacyBastionResourceGroup: bastionResourceGroup || undefined,
        legacyBastionSubscriptionId: subscriptionId || undefined,
      };
      const idSubscription = this.subscriptionFromId(id) || subscriptionId;
      if (idSubscription && !state.subscriptions.some(subscription => subscription.id === idSubscription)) {
        state.subscriptions.push({ id: idSubscription, name: idSubscription, tenantId: "" });
      }
    });
    await this.context.globalState.update(stateKey, state);
    const legacySettings = [
      "subscriptionId",
      "bastionName",
      "bastionResourceGroup",
      "targetVmResourceId",
      "tunnel.remotePort",
      "tunnel.localPort",
      "ssh.username",
    ];
    for (const setting of legacySettings) {
      const inspected = config.inspect(setting);
      if (inspected?.globalValue !== undefined) {
        await config.update(setting, undefined, vscode.ConfigurationTarget.Global);
      }
      if (inspected?.workspaceValue !== undefined) {
        await config.update(setting, undefined, vscode.ConfigurationTarget.Workspace);
      }
    }
    await this.context.globalState.update(migrationKey, true);
    this.log.appendLine(`Migrated ${targetIds.length} configured VM(s) from extension settings.`);
  }
}

export class BastionExplorer {
  private readonly tree = new BastionTreeProvider();
  private readonly resources: AzureResources;
  private machines: Array<{ vm: VirtualMachine; bastions: BastionHost[] }> = [];
  private view: vscode.TreeView<ExplorerNode> | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly log: vscode.OutputChannel) {
    this.resources = new AzureResources(context, log);
  }

  /** prompt to install the Azure Resources extension when it is missing; returns true if available */
  async ensureAzureResourcesExtension(): Promise<boolean> {
    if (vscode.extensions.getExtension(azureResourcesExtensionId)) return true;
    const install = "Install";
    const choice = await vscode.window.showWarningMessage(
      "Azure Bastion requires the Azure Resources extension to sign in to Azure and list your resources.",
      install,
    );
    if (choice !== install) return false;
    try {
      await vscode.commands.executeCommand("workbench.extensions.installExtension", azureResourcesExtensionId);
    } catch (error) {
      this.log.appendLine(`ERROR: Could not install ${azureResourcesExtensionId}: ${error}`);
      void vscode.window.showErrorMessage(`Could not install the Azure Resources extension: ${error}`);
      return false;
    }
    return !!vscode.extensions.getExtension(azureResourcesExtensionId);
  }

  async activate(): Promise<void> {
    this.view = vscode.window.createTreeView("azureBastion.resources", {
      treeDataProvider: this.tree,
      showCollapseAll: true,
    });
    this.context.subscriptions.push(this.view, this.tree);
    this.context.subscriptions.push(
      vscode.commands.registerCommand("azure-bastion.refreshResources", async () => this.refresh()),
      vscode.commands.registerCommand("azure-bastion.signIn", async () => this.signIn()),
      vscode.commands.registerCommand("azure-bastion.connectVm", async (vmId?: string) => this.connectVm(vmId)),
      vscode.commands.registerCommand("azure-bastion.configureVm", async (vmId?: string) => this.configureVm(vmId)),
      vscode.commands.registerCommand("azure-bastion.focusExplorer", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.azureBastion");
        await this.refresh();
      }),
    );
    await this.resources.migrateLegacySettings();
    await this.ensureAzureResourcesExtension();
    await this.refresh(false);
  }

  private async signIn(): Promise<void> {
    try {
      if (!(await this.ensureAzureResourcesExtension())) return;
      await this.resources.signIn();
      await this.refresh(true);
    } catch (error) {
      this.log.appendLine(`ERROR: Azure sign-in failed: ${error}`);
      void vscode.window.showErrorMessage(`Azure sign-in failed: ${error}`);
    }
  }

  private async refresh(showErrors = true): Promise<void> {
    try {
      const { subscriptions, machines } = await this.resources.discover();
      await this.resources.saveSubscriptions(subscriptions);
      this.machines = machines;
      if (subscriptions.length === 0) {
        this.tree.refresh([
          { kind: "message", label: "No enabled Azure subscriptions found", command: "azure-bastion.refreshResources" },
        ]);
        return;
      }
      const roots: ExplorerNode[] = subscriptions.map(subscription => ({
        kind: "subscription",
        subscription,
      }));
      for (const root of roots) {
        if (root.kind !== "subscription") continue;
        this.tree.setChildren(
          root,
          machines
            .filter(machine => machine.vm.subscriptionId === root.subscription.id)
            .sort((left, right) => left.vm.name.localeCompare(right.vm.name))
            .map(machine => ({ kind: "vm", ...machine })),
        );
        if (this.tree.getChildren(root).length === 0) {
          this.tree.setChildren(root, [
            { kind: "message", label: "No Bastion-reachable virtual machines", command: "azure-bastion.refreshResources" },
          ]);
        }
      }
      this.tree.refresh(roots);
      this.log.appendLine(`Azure resources refreshed: ${subscriptions.length} subscription(s), ${machines.length} Bastion-reachable VM(s).`);
    } catch (error) {
      this.log.appendLine(`ERROR: Azure resource refresh failed: ${error}`);
      const message = `${error}`;
      const label = message.includes("Sign in to Azure") || message.includes("Install or enable")
        ? "Sign in to Azure"
        : "Azure resource refresh failed - retry";
      const command = label === "Sign in to Azure" ? "azure-bastion.signIn" : "azure-bastion.refreshResources";
      this.tree.refresh([{ kind: "message", label, command }]);
      if (showErrors) void vscode.window.showErrorMessage(`Azure resource refresh failed: ${error}`);
    }
  }

  private async configureVm(vmId?: string): Promise<void> {
    const machine = this.machines.find(entry => entry.vm.id.toLowerCase() === vmId?.toLowerCase());
    if (!machine) {
      void vscode.window.showErrorMessage("Refresh the Azure Bastion list and select a VM.");
      return;
    }
    const current = (await this.resources.getState()).vmSettings[vmId?.toLowerCase() || ""] || {};
    const username = await vscode.window.showInputBox({
      title: `SSH username for ${machine.vm.name} (optional)`,
      prompt: "Only the username is saved. Passwords are never stored.",
      value: current.username || "",
      ignoreFocusOut: true,
    });
    if (username === undefined) return;
    const remotePort = await vscode.window.showInputBox({
      title: `Tunnel remote port for ${machine.vm.name}`,
      prompt: "For example 22 (SSH) or 3389 (RDP)",
      value: current.remotePort?.toString() || "",
      validateInput: value => value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535)
        ? undefined
        : "Enter a port from 1 to 65535.",
      ignoreFocusOut: true,
    });
    if (remotePort === undefined) return;
    const localPort = await vscode.window.showInputBox({
      title: `Tunnel local port for ${machine.vm.name}`,
      prompt: "For example 60022",
      value: current.localPort?.toString() || "",
      validateInput: value => value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535)
        ? undefined
        : "Enter a port from 1 to 65535.",
      ignoreFocusOut: true,
    });
    if (localPort === undefined) return;
    await this.resources.updateVmSettings(machine.vm.id, {
      ...current,
      username: username.trim() || undefined,
      remotePort: remotePort ? Number(remotePort) : undefined,
      localPort: localPort ? Number(localPort) : undefined,
    });
    void vscode.window.showInformationMessage(`Saved connection settings for ${machine.vm.name}.`);
  }

  private async connectVm(vmId?: string): Promise<void> {
    const machine = this.machines.find(entry => entry.vm.id.toLowerCase() === vmId?.toLowerCase());
    if (!machine) {
      void vscode.window.showErrorMessage("Refresh the Azure Bastion list and select a VM.");
      return;
    }
    const mode = await vscode.window.showQuickPick(
      [
        { label: "$(debug-disconnect) Tunnel", value: "tunnel" },
        { label: "$(terminal) SSH", value: "ssh" },
        { label: "$(remote-explorer) RDP", value: "rdp" },
      ],
      { placeHolder: `Select connection type for ${machine.vm.name}` },
    );
    if (!mode) return;
    let settings = (await this.resources.getState()).vmSettings[machine.vm.id.toLowerCase()] || {};
    if (mode.value === "ssh" && !settings.username) {
      const username = await vscode.window.showInputBox({
        title: `SSH username for ${machine.vm.name}`,
        prompt: "This username will be saved for this VM. The password is not stored.",
        ignoreFocusOut: true,
      });
      if (username === undefined) return;
      settings = { ...settings, username: username.trim() || undefined };
      await this.resources.updateVmSettings(machine.vm.id, settings);
      if (!settings.username) {
        void vscode.window.showErrorMessage("An SSH username is required.");
        return;
      }
    }
    if (mode.value === "tunnel" && (!settings.remotePort || !settings.localPort)) {
      const remotePortText = await vscode.window.showInputBox({
        title: `Tunnel remote port for ${machine.vm.name}`,
        value: settings.remotePort?.toString() || "22",
        validateInput: value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535
          ? undefined
          : "Enter a port from 1 to 65535.",
      });
      if (remotePortText === undefined) return;
      const localPortText = await vscode.window.showInputBox({
        title: `Tunnel local port for ${machine.vm.name}`,
        value: settings.localPort?.toString() || "60022",
        validateInput: value => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535
          ? undefined
          : "Enter a port from 1 to 65535.",
      });
      if (localPortText === undefined) return;
      settings = { ...settings, remotePort: Number(remotePortText), localPort: Number(localPortText) };
      await this.resources.updateVmSettings(machine.vm.id, settings);
    }
    let bastion = machine.bastions[0];
    if (machine.bastions.length > 1) {
      const selected = await vscode.window.showQuickPick(
        machine.bastions.map((candidate, index) => ({
          label: candidate.name,
          description: candidate.resourceGroup,
          index,
        })),
        { placeHolder: `Select an Azure Bastion for ${machine.vm.name}` },
      );
      if (!selected) return;
      bastion = machine.bastions[selected.index];
    }
    await this.launchConnection(machine.vm, bastion, mode.value, settings);
  }

  private async launchConnection(
    vm: VirtualMachine,
    bastion: BastionHost,
    mode: string,
    settings: VmSettings,
  ): Promise<void> {
    if (!process.env.WINDIR) {
      void vscode.window.showErrorMessage("Azure Bastion connections currently require Windows.");
      return;
    }
    const scriptPath = path.join(this.context.extensionPath, "bin", "Invoke-AZNetwork.ps1");
    const parameters: Array<[string, string]> = [
      ["SubscriptionId", bastion.subscriptionId],
      ["BastionName", bastion.name],
      ["BastionResourceGroup", bastion.resourceGroup],
      ["TargetVmResourceId", vm.id],
    ];
    if (mode === "tunnel") {
      parameters.push(["RemotePort", `${settings.remotePort}`], ["LocalPort", `${settings.localPort}`]);
    } else if (mode === "ssh") {
      parameters.push(["Username", settings.username || ""]);
    }
    parameters.push(["Mode", mode]);
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const script = `& ${quote(scriptPath)} ${parameters.map(([name, value]) => `-${name} ${quote(value)}`).join(" ")}`;
    const encodedScript = Buffer.from(script, "utf16le").toString("base64");
    const launcher = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile -ExecutionPolicy RemoteSigned -EncodedCommand ${encodedScript}'`;
    execFile("powershell.exe", ["-NoProfile", "-Command", launcher], { windowsHide: true }, error => {
      if (error) {
        this.log.appendLine(`ERROR: Could not launch Azure Bastion connection: ${error}`);
        void vscode.window.showErrorMessage(`Could not launch Azure Bastion connection: ${error.message}`);
        return;
      }
      this.log.appendLine(`Started ${mode} connection to ${vm.name} through ${bastion.name}.`);
    });
  }
}
