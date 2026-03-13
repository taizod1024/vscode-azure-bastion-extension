import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";

/** Azure Bastion Extension class */
class AzureBastion {
  /** application id */
  public appId = "azure-bastion";

  /** application name */
  public appName = "Azure Bastion Extension";

  /** output channel */
  public channel: vscode.OutputChannel;

  /** extension path */
  public extensionPath: string;

  /** status bar button */
  public statusBarButton: vscode.StatusBarItem | undefined;

  /** constructor */
  constructor() {}

  /** activate extension */
  public activate(context: vscode.ExtensionContext) {
    // init context
    this.channel = vscode.window.createOutputChannel(this.appName, { log: true });
    this.channel.appendLine("");
    this.channel.appendLine(`## ${this.appName} activated`);
    this.extensionPath = context.extensionPath;

    // init vscode
    context.subscriptions.push(
      vscode.commands.registerCommand(`${this.appId}.invokeAZNetWork`, async () => {
        try {
          await this.invokeAZNetWorkAsync();
        } catch (reason) {
          this.channel.appendLine(`ERROR: ${reason}`);
          vscode.window.showErrorMessage(`${reason}`);
        }
      }),
    );

    // Create status bar button
    this.statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarButton.command = `${this.appId}.invokeAZNetWork`;
    this.statusBarButton.text = "$(debug-disconnect) Azure Bastion";
    this.statusBarButton.tooltip = "Click to establish Azure Bastion";
    this.statusBarButton.show();
    context.subscriptions.push(this.statusBarButton);
  }

  /** deactivate extension */
  public deactivate() {}

  public async invokeAZNetWorkAsync() {
    this.channel.appendLine("invokeAZNetWorkAsync: Starting");

    // Show QuickPick to select operation type
    const selected = await vscode.window.showQuickPick(
      [
        { label: "$(debug-disconnect) Tunnel", description: "Establish tunnel connection", value: "tunnel" },
        { label: "$(terminal) SSH", description: "Establish SSH connection", value: "ssh" },
        { label: "$(gear) Settings", description: "Open extension settings", value: "settings" },
      ],
      {
        placeHolder: "Select operation type",
        matchOnDescription: true,
        ignoreFocusOut: false,
        canPickMany: false,
      },
    );

    if (!selected) {
      this.channel.appendLine("User cancelled the operation");
      return;
    }

    this.channel.appendLine(`Selected: ${selected.value}`);

    try {
      if (selected.value === "tunnel") {
        await this.executeTunnel();
      } else if (selected.value === "ssh") {
        await this.executeSSH();
      } else if (selected.value === "settings") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "azure-bastion");
      }
    } catch (error) {
      this.channel.appendLine(`Error: ${error}`);
      vscode.window.showErrorMessage(`Error: ${error}`);
    }

    this.channel.appendLine("invokeAZNetWorkAsync: Completed");
  }

  private getHostNameFromResourceId(resourceId: string): string {
    return resourceId.split("/").pop() || resourceId;
  }

  private async executeTunnel() {
    this.channel.appendLine("executeTunnel: Starting tunnel connection");

    // Check WINDIR environment variable
    if (!process.env.WINDIR) {
      const errorMsg = "WINDIR environment variable is not set";
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      return;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration("azure-bastion");
    const subscriptionId = config.get<string>("subscriptionId");
    const bastionName = config.get<string>("bastionName");
    const bastionResourceGroup = config.get<string>("bastionResourceGroup");
    const targetVmResourceIds = config.get<string[]>("targetVmResourceId") || [];
    const remotePort = config.get<number>("remotePort");
    const localPorts = config.get<number[]>("localPort") || [];

    // Validate required parameters
    const missingParams: string[] = [];
    if (!subscriptionId) missingParams.push("subscriptionId");
    if (!bastionName) missingParams.push("bastionName");
    if (!bastionResourceGroup) missingParams.push("bastionResourceGroup");
    if (targetVmResourceIds.length === 0) missingParams.push("targetVmResourceId");
    if (!remotePort) missingParams.push("remotePort");
    if (localPorts.length === 0) missingParams.push("localPort");

    if (missingParams.length > 0) {
      const errorMsg = `Missing required parameters: ${missingParams.join(", ")}`;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      await vscode.commands.executeCommand("workbench.action.openSettings", "azure-bastion");
      return;
    }

    // Select VM Resource ID
    const vmOptions = targetVmResourceIds.map((id, index) => ({
      label: `localhost:${localPorts[index]} -> ${this.getHostNameFromResourceId(id)}:${remotePort}`,
      value: index,
    }));

    const selectedVmIndex = await vscode.window.showQuickPick(vmOptions, {
      placeHolder: "Select target VM",
      ignoreFocusOut: false,
    });

    if (selectedVmIndex === undefined) {
      this.channel.appendLine("User cancelled VM selection");
      return;
    }

    // Use the local port corresponding to the selected VM index
    const targetVmResourceId = targetVmResourceIds[selectedVmIndex.value];
    const localPort = localPorts[selectedVmIndex.value];

    try {
      // Prepare PowerShell script path
      const scriptPath = path.join(this.extensionPath, "bin", "Invoke-AZNetwork.ps1");

      // Execute PowerShell script
      const cmd = `powershell -command start-process 'cmd.exe' -argumentlist '/c','powershell','-ExecutionPolicy','RemoteSigned','${scriptPath}','-SubscriptionId',${subscriptionId},'-BastionName',${bastionName},'-BastionResourceGroup',${bastionResourceGroup},'-TargetVmResourceId',${targetVmResourceId},'-RemotePort',${remotePort.toString()},'-LocalPort',${localPort.toString()}`;
      this.channel.appendLine(`Command: ${cmd}`);
      exec(cmd, (error, _stdout, stderr) => {
        if (error) {
          this.channel.appendLine(`Command execution error: ${error}`);
        }
        if (stderr) {
          this.channel.appendLine(`stderr: ${stderr}`);
        }
      });
    } catch (error) {
      this.channel.appendLine(`Command execution error: ${error}`);
      vscode.window.showErrorMessage(`Execution error: ${error}`);
    }
    this.channel.appendLine("executeTunnel: Completed");
  }

  private async executeSSH() {
    this.channel.appendLine("executeSSH: Starting SSH connection");

    // Check WINDIR environment variable
    if (!process.env.WINDIR) {
      const errorMsg = "WINDIR environment variable is not set";
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      return;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration("azure-bastion");
    const subscriptionId = config.get<string>("subscriptionId");
    const bastionName = config.get<string>("bastionName");
    const bastionResourceGroup = config.get<string>("bastionResourceGroup");
    const targetVmResourceIds = config.get<string[]>("targetVmResourceId") || [];
    const remotePort = config.get<number>("remotePort");
    const localPorts = config.get<number[]>("localPort") || [];
    const usernames = config.get<string[]>("username") || [];

    // Validate required parameters
    const missingParams: string[] = [];
    if (!subscriptionId) missingParams.push("subscriptionId");
    if (!bastionName) missingParams.push("bastionName");
    if (!bastionResourceGroup) missingParams.push("bastionResourceGroup");
    if (targetVmResourceIds.length === 0) missingParams.push("targetVmResourceId");
    if (!remotePort) missingParams.push("remotePort");
    if (localPorts.length === 0) missingParams.push("localPort");
    if (usernames.length === 0) missingParams.push("username");

    if (missingParams.length > 0) {
      const errorMsg = `Missing required parameters: ${missingParams.join(", ")}`;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      await vscode.commands.executeCommand("workbench.action.openSettings", "azure-bastion");
      return;
    }

    // Select VM Resource ID
    const vmOptions = targetVmResourceIds.map((id, index) => ({
      label: `localhost:${localPorts[index]} -> ${usernames[index]}@${this.getHostNameFromResourceId(id)}:${remotePort}`,
      value: index,
    }));

    const selectedVmIndex = await vscode.window.showQuickPick(vmOptions, {
      placeHolder: "Select target VM",
      ignoreFocusOut: false,
    });

    if (selectedVmIndex === undefined) {
      this.channel.appendLine("User cancelled VM selection");
      return;
    }

    // Use the username corresponding to the selected VM index
    const targetVmResourceId = targetVmResourceIds[selectedVmIndex.value];
    const username = usernames[selectedVmIndex.value];

    try {
      // Prepare PowerShell script path
      const scriptPath = path.join(this.extensionPath, "bin", "Invoke-AZNetwork.ps1");

      // Execute PowerShell script with SSH parameter
      const cmd = `powershell -command start-process 'cmd.exe' -argumentlist '/c','powershell','-ExecutionPolicy','RemoteSigned','${scriptPath}','-SubscriptionId',${subscriptionId},'-BastionName',${bastionName},'-BastionResourceGroup',${bastionResourceGroup},'-TargetVmResourceId',${targetVmResourceId},'-Username',${username},'-Mode','ssh'`;
      this.channel.appendLine(`Command: ${cmd}`);
      exec(cmd, (error, _stdout, stderr) => {
        if (error) {
          this.channel.appendLine(`Command execution error: ${error}`);
        }
        if (stderr) {
          this.channel.appendLine(`stderr: ${stderr}`);
        }
      });
    } catch (error) {
      this.channel.appendLine(`Command execution error: ${error}`);
      vscode.window.showErrorMessage(`Execution error: ${error}`);
    }
    this.channel.appendLine("executeSSH: Completed");
  }
}

export const azureBastion = new AzureBastion();
