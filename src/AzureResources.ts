import * as vscode from "vscode";
import { execFile } from "child_process";
import * as https from "https";
import * as fs from "fs";
import * as os from "os";
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
  osType?: string;
  powerState?: string;
  powerStateFetchFailed?: boolean;
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
    osDisk?: { osType?: string };
    storageProfile?: { osDisk?: { osType?: string } };
  };
  subscriptionId?: string;
  displayName?: string;
  tenantId?: string;
  state?: string;
  nextLink?: string;
  value?: ArmResource[];
  statuses?: Array<{ code?: string }>;
}

interface NetworkPeeringResource {
  properties?: {
    peeringState?: string;
    remoteVirtualNetwork?: { id?: string };
  };
}

type ExplorerNode =
  | { kind: "root"; refreshing?: "busy" | "failed" }
  | { kind: "subscription"; subscription: AzureSubscription; refreshing?: "busy" | "failed" }
  | { kind: "vm"; vm: VirtualMachine; bastions: BastionHost[]; refreshing?: "busy" | "failed" }
  | { kind: "message"; label: string; command?: string };

type ConnectionMode = "tunnel" | "ssh" | "rdp";

class AzureAuthenticationError extends Error {}

function isWindowsVm(vm: VirtualMachine): boolean {
  return /^Windows$/i.test(vm.osType || "");
}

function vmIcon(): string {
  return "vm";
}

const stateKey = "azure-bastion.sidebar.v1";
const sshBlockStart = "# azure-bastion:start (managed by the Azure Bastion extension; edits in this block are overwritten)";
const sshBlockEnd = "# azure-bastion:end";
const migrationKey = "azure-bastion.sidebar.migrated.v1";
const azureResourcesExtensionId = "ms-azuretools.vscode-azureresourcegroups";
const microsoftScopes = ["https://management.azure.com/user_impersonation"];

class BastionTreeProvider implements vscode.TreeDataProvider<ExplorerNode> {
  private readonly changed = new vscode.EventEmitter<ExplorerNode | undefined | null | void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly root: ExplorerNode = { kind: "root" };
  private nodes: ExplorerNode[] = [this.root];
  private readonly children = new Map<ExplorerNode, ExplorerNode[]>();

  refresh(nodes: ExplorerNode[]) {
    this.children.set(this.root, nodes);
    const current = new Set([this.root, ...nodes]);
    for (const node of this.children.keys()) {
      if (!current.has(node)) this.children.delete(node);
    }
    this.changed.fire();
  }

  setRootRefreshing(refreshing?: "busy" | "failed") {
    if (this.root.kind !== "root") return;
    this.root.refreshing = refreshing;
    this.changed.fire(this.root);
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    if (node.kind === "root") {
      const item = new vscode.TreeItem("Azure Bastion", vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "azureBastionRoot";
      item.iconPath = node.refreshing === "busy"
        ? new vscode.ThemeIcon("sync~spin")
        : node.refreshing === "failed"
          ? new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"))
          : new vscode.ThemeIcon("cloud", new vscode.ThemeColor("charts.blue"));
      return item;
    }
    if (node.kind === "subscription") {
      const item = new vscode.TreeItem(node.subscription.name, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = "azureBastionSubscription";
      item.iconPath = node.refreshing === "busy"
        ? new vscode.ThemeIcon("sync~spin")
        : node.refreshing === "failed"
          ? new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"))
          : new vscode.ThemeIcon("key", new vscode.ThemeColor("charts.blue"));
      return item;
    }
    if (node.kind === "vm") {
      const item = new vscode.TreeItem(node.vm.name, vscode.TreeItemCollapsibleState.None);
      item.description = node.refreshing === "busy" ? "Refreshing..." : node.refreshing === "failed" || node.vm.powerStateFetchFailed ? "Refresh failed" : node.vm.powerState || "Unknown";
      item.tooltip = `${node.vm.id}\nPower state: ${node.vm.powerState || "Unknown"}`;
      item.contextValue = isWindowsVm(node.vm) ? "azureBastionVmWindows" : "azureBastionVmOther";
      const iconColor = node.vm.powerState === "running" ? "charts.blue" : "disabledForeground";
      item.iconPath = node.refreshing === "busy"
        ? new vscode.ThemeIcon("sync~spin")
        : node.refreshing === "failed" || node.vm.powerStateFetchFailed
          ? new vscode.ThemeIcon("error", new vscode.ThemeColor("errorForeground"))
          : new vscode.ThemeIcon(vmIcon(), new vscode.ThemeColor(iconColor));
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    if (node.command) item.command = { command: node.command, title: node.label };
    item.iconPath = node.command?.endsWith("signIn")
      ? new vscode.ThemeIcon("account")
      : node.label.startsWith("Refreshing")
        ? new vscode.ThemeIcon("sync~spin")
        : new vscode.ThemeIcon("info", new vscode.ThemeColor("charts.yellow"));
    return item;
  }

  getChildren(node?: ExplorerNode): ExplorerNode[] {
    if (!node) return this.nodes;
    if (node.kind !== "root" && node.kind !== "subscription") return [];
    return this.children.get(node) || [];
  }

  setChildren(node: ExplorerNode, children: ExplorerNode[]) {
    this.children.set(node, children);
  }

  updateChildren(node: ExplorerNode, children: ExplorerNode[]) {
    this.children.set(node, children);
    this.changed.fire(node);
  }

  updateNode(node: ExplorerNode) {
    this.changed.fire(node);
  }

  dispose() {
    this.changed.dispose();
  }
}

class AzureResources {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
  ) {}

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
      throw this.responseError(response.status, body);
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
              reject(this.responseError(status, body));
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

  private responseError(status: number, body: string): Error {
    let code: string | undefined;
    let message = `Azure Resource Manager request failed (${status}).`;
    try {
      const errorBody = JSON.parse(body) as { error?: { code?: string; message?: string } };
      code = errorBody.error?.code;
      if (errorBody.error?.message) message = errorBody.error.message;
    } catch {
      // Retain the status-based message if Azure returns a non-JSON error body.
    }
    if (status === 401 && code === "ExpiredAuthenticationToken") {
      return new AzureAuthenticationError("Your Azure access token has expired, and VS Code could not refresh it. Sign in again from the Azure Resources view, then refresh the list.");
    }
    return new Error(message);
  }

  async getResourceJson(resourceId: string, apiVersion: string): Promise<ArmResource> {
    const session = await this.getSession(false);
    if (!session) throw new Error("Sign in to Azure from the Azure Resources view, then refresh this list.");
    return this.requestJson(this.tokenFor(resourceId, session.accessToken), `${resourceId}?api-version=${apiVersion}`);
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
      if (error instanceof AzureAuthenticationError) throw error;
      this.log.appendLine(`WARN: Could not list tenants: ${error}`);
    }
    for (const tenant of tenants) {
      if (!tenant.tenantId) continue;
      try {
        const tenantSession = await vscode.authentication.getSession("microsoft", [...microsoftScopes, `VSCODE_TENANT:${tenant.tenantId}`], { silent: true });
        if (tenantSession) await collect(tenantSession.accessToken, `tenant ${tenant.tenantId}`);
        else this.log.appendLine(`Tenant ${tenant.tenantId} is not signed in; skipped. Sign in to it from the Azure Resources extension.`);
      } catch (error) {
        if (error instanceof AzureAuthenticationError) throw error;
        this.log.appendLine(`WARN: Could not read subscriptions of tenant ${tenant.tenantId}: ${error}`);
      }
    }
    return [...found.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private async loadForSubscription(token: string, subscription: AzureSubscription, includeVms = true): Promise<{ bastions: BastionHost[]; vms: VirtualMachine[] }> {
    const [bastionResources, vmResources] = await Promise.all([
      this.armGet<ArmResource>(token, `/subscriptions/${encodeURIComponent(subscription.id)}/providers/Microsoft.Network/bastionHosts?api-version=2024-05-01`),
      includeVms
        ? this.armGet<ArmResource>(token, `/subscriptions/${encodeURIComponent(subscription.id)}/providers/Microsoft.Compute/virtualMachines?api-version=2024-03-01`)
        : Promise.resolve([] as ArmResource[]),
    ]);

    const bastions: BastionHost[] = bastionResources
      .filter(resource => resource.id && resource.name)
      .map(resource => ({
        id: resource.id as string,
        name: resource.name as string,
        subscriptionId: this.subscriptionFromId(resource.id as string),
        resourceGroup: this.resourceGroupFromId(resource.id as string),
        vnetIds: [...(resource.properties?.ipConfigurations || []).map(configuration => this.vnetFromSubnetId(configuration.properties?.subnet?.id)), this.vnetFromSubnetId(resource.properties?.virtualNetwork?.id)].filter((id): id is string => !!id),
      }));
    const vms: VirtualMachine[] = vmResources
      .filter(resource => resource.id && resource.name)
      .map(resource => ({
        id: resource.id as string,
        name: resource.name as string,
        osType: resource.properties?.osDisk?.osType || resource.properties?.storageProfile?.osDisk?.osType,
        subscriptionId: this.subscriptionFromId(resource.id as string),
        resourceGroup: this.resourceGroupFromId(resource.id as string),
        networkInterfaceIds: (resource.properties?.networkProfile?.networkInterfaces || []).map(networkInterface => networkInterface.id).filter((id): id is string => !!id),
      }));
    this.log.appendLine(`Subscription ${subscription.name}: ${bastions.length} Bastion host(s) [${bastions.map(b => `${b.name} -> ${b.vnetIds.join(",") || "no vnet"}`).join("; ")}], ${vms.length} VM(s).`);
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
        if (error instanceof AzureAuthenticationError) throw error;
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
        return (resource.properties?.ipConfigurations || resource.properties?.ipConfigurationsOnSubnet || []).map(configuration => this.vnetFromSubnetId(configuration.properties?.subnet?.id)).filter((vnetId): vnetId is string => !!vnetId);
      } catch (error) {
        if (error instanceof AzureAuthenticationError) throw error;
        this.log.appendLine(`WARN: Could not inspect network interface ${id}: ${error}`);
        return [];
      }
    });
    return [...new Set(results.flat())];
  }

  private async getVmPowerState(token: string, vm: VirtualMachine): Promise<{ powerState?: string; failed: boolean }> {
    try {
      const instanceView = await this.requestJson(
        this.tokenFor(vm.id, token),
        `${vm.id}/instanceView?api-version=2024-03-01`,
      );
      return {
        powerState: instanceView.statuses
          ?.find(status => status.code?.startsWith("PowerState/"))
          ?.code?.slice("PowerState/".length)
          .toLowerCase(),
        failed: false,
      };
    } catch (error) {
      if (error instanceof AzureAuthenticationError) throw error;
      this.log.appendLine(`WARN: Could not load power state for VM ${vm.id}: ${error}`);
      return { failed: true };
    }
  }

  async refreshVmPowerState(vm: VirtualMachine): Promise<{ powerState?: string; failed: boolean }> {
    const session = await this.getSession(false);
    if (!session) throw new Error("Sign in to Azure from the Azure Resources view, then refresh this list.");
    return this.getVmPowerState(session.accessToken, vm);
  }

  private async discoverMachines(
    token: string,
    vms: VirtualMachine[],
    bastions: BastionHost[],
  ): Promise<Array<{ vm: VirtualMachine; bastions: BastionHost[] }>> {
    const reachableByBastionVnet = await this.loadPeeredVnets(token, bastions);
    const settings = await this.getState();
    const machines = await this.mapLimit(vms, 5, async vm => {
      let vmVnets: string[] = [];
      try {
        vmVnets = await this.getVmVnets(token, vm);
      } catch (error) {
        if (error instanceof AzureAuthenticationError) throw error;
        this.log.appendLine(`WARN: Could not inspect VM network interfaces for ${vm.id}: ${error}`);
      }
      const matchingBastions = bastions.filter(bastion => bastion.vnetIds.some(bastionVnet => [...(reachableByBastionVnet.get(bastionVnet) || new Set([bastionVnet]))].some(vnet => vmVnets.includes(vnet))));
      const saved = settings.vmSettings[vm.id.toLowerCase()];
      if (saved?.legacyBastionName) {
        const legacy = bastions.find(bastion => bastion.name.toLowerCase() === saved.legacyBastionName?.toLowerCase() && bastion.resourceGroup.toLowerCase() === saved.legacyBastionResourceGroup?.toLowerCase() && bastion.subscriptionId.toLowerCase() === saved.legacyBastionSubscriptionId?.toLowerCase());
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
      if (matchingBastions.length === 0) return { vm, bastions: matchingBastions };
      const powerStateResult = await this.getVmPowerState(token, vm);
      return {
        vm: { ...vm, powerState: powerStateResult.powerState, powerStateFetchFailed: powerStateResult.failed },
        bastions: matchingBastions,
      };
    });
    return machines.filter(machine => machine.bastions.length > 0);
  }

  async discover(): Promise<{ subscriptions: AzureSubscription[]; machines: Array<{ vm: VirtualMachine; bastions: BastionHost[] }>; failedSubscriptionIds: string[] }> {
    const session = await this.getSession(false);
    if (!session) throw new Error("Sign in to Azure from the Azure Resources view, then refresh this list.");
    const subscriptions = await this.loadSubscriptions(session.accessToken);
    const failedSubscriptionIds: string[] = [];
    const resources = await this.mapLimit(subscriptions, 3, async subscription => {
      try {
        return await this.loadForSubscription(this.tokenFor(`/subscriptions/${subscription.id}`, session.accessToken), subscription);
      } catch (error) {
        if (error instanceof AzureAuthenticationError) throw error;
        this.log.appendLine(`WARN: Could not load resources for subscription ${subscription.name}: ${error}`);
        failedSubscriptionIds.push(subscription.id.toLowerCase());
        return { bastions: [] as BastionHost[], vms: [] as VirtualMachine[] };
      }
    });
    const bastions = resources.flatMap(resource => resource.bastions);
    const vms = resources.flatMap(resource => resource.vms);
    const machines = await this.discoverMachines(session.accessToken, vms, bastions);
    return { subscriptions, machines, failedSubscriptionIds };
  }

  async discoverSubscription(subscriptionId: string): Promise<{ subscription: AzureSubscription; machines: Array<{ vm: VirtualMachine; bastions: BastionHost[] }> }> {
    const session = await this.getSession(false);
    if (!session) throw new Error("Sign in to Azure from the Azure Resources view, then refresh this list.");
    const subscriptions = await this.loadSubscriptions(session.accessToken);
    const subscription = subscriptions.find(candidate => candidate.id.toLowerCase() === subscriptionId.toLowerCase());
    if (!subscription) throw new Error(`Subscription ${subscriptionId} is no longer available or is not signed in.`);

    const resources = await this.mapLimit(subscriptions, 3, async candidate => {
      const includeVms = candidate.id.toLowerCase() === subscription.id.toLowerCase();
      try {
        return await this.loadForSubscription(this.tokenFor(`/subscriptions/${candidate.id}`, session.accessToken), candidate, includeVms);
      } catch (error) {
        if (error instanceof AzureAuthenticationError) throw error;
        if (includeVms) throw error;
        this.log.appendLine(`WARN: Could not load Bastion hosts for subscription ${candidate.name}: ${error}`);
        return { bastions: [] as BastionHost[], vms: [] as VirtualMachine[] };
      }
    });
    const bastions = resources.flatMap(resource => resource.bastions);
    const vms = resources.find((_, index) => subscriptions[index].id.toLowerCase() === subscription.id.toLowerCase())?.vms || [];
    const machines = await this.discoverMachines(session.accessToken, vms, bastions);
    return { subscription, machines };
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
    await this.syncSshConfig();
  }

  get sshConfigPath(): string {
    return path.join(os.homedir(), ".ssh", "config");
  }

  /** write the managed Host block of ~/.ssh/config from the saved VM settings */
  async syncSshConfig(): Promise<void> {
    try {
      const state = await this.getState();
      const entries = Object.entries(state.vmSettings).filter(([, settings]) => settings.localPort);
      const names = entries.map(([id]) => id.split("/").pop() || id);
      const lines = entries.flatMap(([id, settings], index) => {
        const name = names.filter(candidate => candidate === names[index]).length > 1 ? `${names[index]}-${this.resourceGroupFromId(id)}` : names[index];
        return [`Host ${name}`, "  HostName localhost", `  Port ${settings.localPort}`, ...(settings.username && /^[\w.@-]+$/.test(settings.username) ? [`  User ${settings.username}`] : []), `  HostKeyAlias ${name}`];
      });
      const block = lines.length > 0 ? `${sshBlockStart}\n${lines.join("\n")}\n${sshBlockEnd}\n` : "";
      const existing = fs.existsSync(this.sshConfigPath) ? fs.readFileSync(this.sshConfigPath, "utf8") : "";
      const pattern = /# azure-bastion:start[^\n]*\r?\n[\s\S]*?# azure-bastion:end[^\n]*(\r?\n)?/;
      let next: string;
      if (pattern.test(existing)) next = existing.replace(pattern, () => block);
      else if (block) next = existing + (existing && !existing.endsWith("\n") ? "\n" : "") + (existing ? "\n" : "") + block;
      else return;
      if (next === existing) return;
      fs.mkdirSync(path.dirname(this.sshConfigPath), { recursive: true });
      fs.writeFileSync(this.sshConfigPath, next, "utf8");
    } catch (error) {
      this.log.appendLine(`ERROR: Could not update ${this.sshConfigPath}: ${error}`);
    }
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
    const legacySettings = ["subscriptionId", "bastionName", "bastionResourceGroup", "targetVmResourceId", "tunnel.remotePort", "tunnel.localPort", "ssh.username"];
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
  private readonly temporaryPropertyFiles = new Map<string, string>();
  private view: vscode.TreeView<ExplorerNode> | undefined;
  private refreshRequest = 0;
  private isRefreshing = false;
  private nodeRefreshInProgress: Promise<void> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
  ) {
    this.resources = new AzureResources(context, log);
  }

  /** prompt to install the Azure Resources extension when it is missing; returns true if available */
  async ensureAzureResourcesExtension(): Promise<boolean> {
    if (vscode.extensions.getExtension(azureResourcesExtensionId)) return true;
    const install = "Install";
    const choice = await vscode.window.showWarningMessage("Azure Bastion requires the Azure Resources extension to sign in to Azure and list your resources.", install);
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
      vscode.workspace.onDidCloseTextDocument(document => {
        if (document.uri.scheme === "file") this.cleanupTemporaryPropertyFile(document.uri.fsPath);
      }),
      { dispose: () => this.cleanupTemporaryPropertyFiles() },
      vscode.commands.registerCommand("azure-bastion.refreshResources", async () => this.refresh()),
      vscode.commands.registerCommand("azure-bastion.refreshNode", async (node?: ExplorerNode) => this.refreshNode(node)),
      vscode.commands.registerCommand("azure-bastion.signIn", async () => this.signIn()),
      vscode.commands.registerCommand("azure-bastion.connectVmTunnel", async (vm?: string | ExplorerNode) => this.connectVm(vm, "tunnel")),
      vscode.commands.registerCommand("azure-bastion.connectVmSsh", async (vm?: string | ExplorerNode) => this.connectVm(vm, "ssh")),
      vscode.commands.registerCommand("azure-bastion.connectVmRdp", async (vm?: string | ExplorerNode) => this.connectVm(vm, "rdp")),
      vscode.commands.registerCommand("azure-bastion.configureVm", async (vm?: string | ExplorerNode) => this.configureVm(vm)),
      vscode.commands.registerCommand("azure-bastion.viewProperties", async (node?: ExplorerNode) => this.viewProperties(node)),
      vscode.commands.registerCommand("azure-bastion.openSshConfig", async () => this.openSshConfig()),
      vscode.commands.registerCommand("azure-bastion.openInPortal", async (node?: ExplorerNode) => this.openInPortal(node, false)),
      vscode.commands.registerCommand("azure-bastion.openInPortalExternal", async (node?: ExplorerNode) => this.openInPortal(node, true)),
      vscode.commands.registerCommand("azure-bastion.focusExplorer", async () => {
        await vscode.commands.executeCommand("workbench.view.extension.azureBastion");
        await this.refresh();
      }),
    );
    await this.resources.migrateLegacySettings();
    await this.resources.syncSshConfig();
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
    const request = ++this.refreshRequest;
    this.isRefreshing = true;
    this.machines = [];
    this.tree.setRootRefreshing("busy");
    try {
      if (this.nodeRefreshInProgress) await this.nodeRefreshInProgress;
      if (request !== this.refreshRequest) return;
      const { subscriptions, machines, failedSubscriptionIds } = await this.resources.discover();
      if (request !== this.refreshRequest) return;
      await this.resources.saveSubscriptions(subscriptions);
      if (request !== this.refreshRequest) return;
      this.machines = machines;
      this.tree.setRootRefreshing(undefined);
      if (subscriptions.length === 0) {
        this.tree.refresh([{ kind: "message", label: "No enabled Azure subscriptions found", command: "azure-bastion.refreshResources" }]);
        return;
      }
      const roots: ExplorerNode[] = subscriptions.map(subscription => ({
        kind: "subscription",
        subscription,
        refreshing: failedSubscriptionIds.includes(subscription.id.toLowerCase()) ? "failed" : undefined,
      }));
      for (const root of roots) {
        if (root.kind !== "subscription") continue;
        this.tree.setChildren(root, this.childrenForSubscription(root.subscription.id, machines, root.refreshing === "failed"));
      }
      this.tree.refresh(roots);
      this.log.appendLine(`Azure resources refreshed: ${subscriptions.length} subscription(s), ${machines.length} Bastion-reachable VM(s).`);
    } catch (error) {
      if (request !== this.refreshRequest) return;
      this.tree.setRootRefreshing("failed");
      this.log.appendLine(`ERROR: Azure resource refresh failed: ${error}`);
      const message = `${error}`;
      const label = message.includes("Sign in to Azure") || message.includes("Install or enable") ? "Sign in to Azure" : "Azure resource refresh failed - retry";
      const command = label === "Sign in to Azure" ? "azure-bastion.signIn" : "azure-bastion.refreshResources";
      this.tree.refresh([{ kind: "message", label, command }]);
      if (showErrors || error instanceof AzureAuthenticationError) void vscode.window.showErrorMessage(`Azure resource refresh failed: ${error}`);
    } finally {
      if (request === this.refreshRequest) this.isRefreshing = false;
    }
  }

  private childrenForSubscription(subscriptionId: string, machines: Array<{ vm: VirtualMachine; bastions: BastionHost[] }>, failed = false): ExplorerNode[] {
    if (failed) return [{ kind: "message", label: "Resource fetch failed - refresh this subscription" }];
    const children: ExplorerNode[] = machines
      .filter(machine => machine.vm.subscriptionId.toLowerCase() === subscriptionId.toLowerCase())
      .sort((left, right) => left.vm.name.localeCompare(right.vm.name))
      .map(machine => ({ kind: "vm", ...machine }));
    return children.length > 0
      ? children
      : [{ kind: "message", label: "No Bastion-reachable virtual machines" }];
  }

  private async refreshNode(node?: ExplorerNode): Promise<void> {
    if (node?.kind === "root") {
      await this.refresh();
      return;
    }
    if ((node?.kind !== "subscription" && node?.kind !== "vm") || this.isRefreshing || this.nodeRefreshInProgress) return;
    const request = this.refreshRequest;
    const operation = this.refreshNodeData(node, request);
    this.nodeRefreshInProgress = operation;
    try {
      await operation;
    } finally {
      if (this.nodeRefreshInProgress === operation) this.nodeRefreshInProgress = undefined;
    }
  }

  private async refreshNodeData(node: Extract<ExplorerNode, { kind: "subscription" | "vm" }>, request: number): Promise<void> {
    try {
      if (node.kind === "subscription") {
        const root = this.getSubscriptionNode(node.subscription.id);
        if (!root) return;
        root.refreshing = "busy";
        this.tree.updateNode(root);
        let refreshed: Awaited<ReturnType<AzureResources["discoverSubscription"]>>;
        try {
          refreshed = await this.resources.discoverSubscription(node.subscription.id);
        } catch (error) {
          if (request === this.refreshRequest) {
            root.refreshing = "failed";
            this.tree.updateNode(root);
            this.tree.updateChildren(root, [{ kind: "message", label: "Refresh failed - see error message" }]);
          }
          throw error;
        }
        if (request !== this.refreshRequest) return;
        root.subscription = refreshed.subscription;
        root.refreshing = undefined;
        this.tree.updateNode(root);
        this.machines = [
          ...this.machines.filter(machine => machine.vm.subscriptionId.toLowerCase() !== root.subscription.id.toLowerCase()),
          ...refreshed.machines,
        ];
        this.tree.updateChildren(root, this.childrenForSubscription(root.subscription.id, this.machines));
        this.log.appendLine(`Subscription ${root.subscription.name} refreshed: ${refreshed.machines.length} Bastion-reachable VM(s).`);
        return;
      }

      const root = this.getSubscriptionNode(node.vm.subscriptionId);
      if (!root) return;
      const setRefreshing = (refreshing?: "busy" | "failed") => {
        const siblings = this.tree.getChildren(root);
        const index = siblings.findIndex(child => child.kind === "vm" && child.vm.id.toLowerCase() === node.vm.id.toLowerCase());
        const current = siblings[index];
        if (current?.kind !== "vm") return;
        siblings[index] = { ...current, refreshing };
        this.tree.updateChildren(root, siblings);
        this.tree.updateNode(siblings[index]);
      };
      setRefreshing("busy");
      let powerState: Awaited<ReturnType<AzureResources["refreshVmPowerState"]>>;
      try {
        powerState = await this.resources.refreshVmPowerState(node.vm);
      } catch (error) {
        if (request === this.refreshRequest) setRefreshing("failed");
        throw error;
      }
      if (request !== this.refreshRequest) return;
      const children = this.tree.getChildren(root);
      const vmIndex = children.findIndex(child => child.kind === "vm" && child.vm.id.toLowerCase() === node.vm.id.toLowerCase());
      const vmNode = children[vmIndex];
      if (vmNode?.kind !== "vm") return;
      const updatedVm = { ...vmNode.vm, powerState: powerState.powerState, powerStateFetchFailed: powerState.failed };
      children[vmIndex] = { ...vmNode, vm: updatedVm, refreshing: powerState.failed ? "failed" : undefined };
      this.machines = this.machines.map(machine =>
        machine.vm.id.toLowerCase() === updatedVm.id.toLowerCase()
          ? { ...machine, vm: updatedVm }
          : machine,
      );
      this.tree.updateChildren(root, children);
      this.tree.updateNode(children[vmIndex]);
      this.log.appendLine(`VM ${updatedVm.name} power state refreshed: ${powerState.powerState || "Unknown"}.`);
    } catch (error) {
      if (request !== this.refreshRequest) return;
      const message = `Could not refresh ${node.kind === "vm" ? `VM ${node.vm.name}` : `subscription ${node.subscription.name}`}: ${error}`;
      this.log.appendLine(`ERROR: ${message}`);
      void vscode.window.showErrorMessage(message);
    }
  }

  private getSubscriptionNode(subscriptionId: string): Extract<ExplorerNode, { kind: "subscription" }> | undefined {
    const root = this.tree.getChildren().find((candidate): candidate is Extract<ExplorerNode, { kind: "root" }> => candidate.kind === "root");
    if (!root) return undefined;
    return this.tree.getChildren(root).find(
      (candidate): candidate is Extract<ExplorerNode, { kind: "subscription" }> =>
        candidate.kind === "subscription" && candidate.subscription.id.toLowerCase() === subscriptionId.toLowerCase(),
    );
  }

  private async openSshConfig(): Promise<void> {
    await this.resources.syncSshConfig();
    const file = this.resources.sshConfigPath;
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "", "utf8");
    }
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
  }

  private async viewProperties(node?: ExplorerNode): Promise<void> {
    if (node?.kind !== "subscription" && node?.kind !== "vm") return;
    const [id, apiVersion] = node.kind === "vm" ? [node.vm.id, "2024-03-01"] : [`/subscriptions/${node.subscription.id}`, "2022-12-01"];
    let temporaryFile: string | undefined;
    try {
      const json = await this.resources.getResourceJson(id, apiVersion);
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "azure-bastion-properties-"));
      const resourceName = (node.kind === "vm" ? node.vm.name : node.subscription.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "resource";
      temporaryFile = path.join(temporaryDirectory, `${resourceName}.json`);
      this.temporaryPropertyFiles.set(temporaryFile, temporaryDirectory);
      fs.writeFileSync(temporaryFile, JSON.stringify(json, null, 2), "utf8");
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(temporaryFile));
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (error) {
      if (temporaryFile) this.cleanupTemporaryPropertyFile(temporaryFile);
      this.log.appendLine(`ERROR: Could not load properties: ${error}`);
      void vscode.window.showErrorMessage(`Could not load properties: ${error}`);
    }
  }

  private cleanupTemporaryPropertyFile(temporaryFile: string): void {
    const temporaryDirectory = this.temporaryPropertyFiles.get(temporaryFile);
    if (!temporaryDirectory) return;
    try {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
      if (fs.existsSync(temporaryDirectory)) fs.rmdirSync(temporaryDirectory);
      this.temporaryPropertyFiles.delete(temporaryFile);
    } catch (error) {
      this.log.appendLine(`WARN: Could not remove temporary properties file ${temporaryFile}: ${error}`);
    }
  }

  private cleanupTemporaryPropertyFiles(): void {
    for (const temporaryFile of this.temporaryPropertyFiles.keys()) {
      this.cleanupTemporaryPropertyFile(temporaryFile);
    }
  }

  /**
   * Azure ポータルのリソース URL を作成する。
   * @param node ポータルで開くサブスクリプションまたは VM
   * @returns ポータル URL。対象が無効な場合は undefined
   */
  private async portalUrlFor(node?: ExplorerNode): Promise<string | undefined> {
    if (node?.kind !== "subscription" && node?.kind !== "vm") return undefined;
    const id = node.kind === "vm" ? node.vm.id : `/subscriptions/${node.subscription.id}`;
    const subscriptionId = node.kind === "vm" ? node.vm.subscriptionId : node.subscription.id;
    const state = await this.resources.getState();
    const tenantId = node.kind === "subscription" ? node.subscription.tenantId : state.subscriptions.find(subscription => subscription.id.toLowerCase() === subscriptionId.toLowerCase())?.tenantId;
    return `https://portal.azure.com/${tenantId ? `#@${tenantId}` : "#"}/resource${id}`;
  }

  /**
   * Azure ポータルを内部または外部ブラウザーで開く。
   * @param node ポータルで開くサブスクリプションまたは VM
   * @param useExternalBrowser 外部ブラウザーを使用する場合は true
   */
  private async openInPortal(node: ExplorerNode | undefined, useExternalBrowser: boolean): Promise<void> {
    try {
      const url = await this.portalUrlFor(node);
      if (!url) return;
      if (useExternalBrowser) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      } else {
        await vscode.commands.executeCommand("simpleBrowser.show", url);
      }
    } catch (error) {
      this.log.appendLine(`ERROR: Could not open Azure portal: ${error}`);
      void vscode.window.showErrorMessage(`Could not open Azure portal: ${error}`);
    }
  }

  private getMachine(vm?: string | ExplorerNode) {
    const vmId = typeof vm === "string" ? vm : vm?.kind === "vm" ? vm.vm.id : undefined;
    return this.machines.find(entry => entry.vm.id.toLowerCase() === vmId?.toLowerCase());
  }

  private async configureVm(vm?: string | ExplorerNode): Promise<void> {
    const machine = this.getMachine(vm);
    if (!machine) {
      void vscode.window.showErrorMessage("Refresh the Azure Bastion list and select a VM.");
      return;
    }
    const current = (await this.resources.getState()).vmSettings[machine.vm.id.toLowerCase()] || {};
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
      validateInput: value => (value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535) ? undefined : "Enter a port from 1 to 65535."),
      ignoreFocusOut: true,
    });
    if (remotePort === undefined) return;
    const localPort = await vscode.window.showInputBox({
      title: `Tunnel local port for ${machine.vm.name}`,
      prompt: "For example 60022",
      value: current.localPort?.toString() || "",
      validateInput: value => (value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535) ? undefined : "Enter a port from 1 to 65535."),
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

  private async connectVm(vm: string | ExplorerNode | undefined, mode: ConnectionMode): Promise<void> {
    const machine = this.getMachine(vm);
    if (!machine) {
      void vscode.window.showErrorMessage("Refresh the Azure Bastion list and select a VM.");
      return;
    }
    let settings = (await this.resources.getState()).vmSettings[machine.vm.id.toLowerCase()] || {};
    if (mode === "ssh" && !settings.username) {
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
    if (mode === "tunnel" && (!settings.remotePort || !settings.localPort)) {
      const remotePortText = await vscode.window.showInputBox({
        title: `Tunnel remote port for ${machine.vm.name}`,
        value: settings.remotePort?.toString() || "22",
        validateInput: value => (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535 ? undefined : "Enter a port from 1 to 65535."),
      });
      if (remotePortText === undefined) return;
      const localPortText = await vscode.window.showInputBox({
        title: `Tunnel local port for ${machine.vm.name}`,
        value: settings.localPort?.toString() || "60022",
        validateInput: value => (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535 ? undefined : "Enter a port from 1 to 65535."),
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
    await this.launchConnection(machine.vm, bastion, mode, settings);
  }

  private async launchConnection(vm: VirtualMachine, bastion: BastionHost, mode: ConnectionMode, settings: VmSettings): Promise<void> {
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
