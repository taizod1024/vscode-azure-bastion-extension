import * as vscode from "vscode";
import child_process from "child_process";
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
      vscode.commands.registerCommand(`${this.appId}.tunnelConnection`, async () => {
        this.channel.show(false);
        try {
          await this.tunnelConnectionAsync();
        } catch (reason) {
          this.channel.appendLine(`ERROR: ${reason}`);
          vscode.window.showErrorMessage(`${reason}`);
        }
      }),
    );

    // Create status bar button
    this.statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarButton.command = `${this.appId}.tunnelConnection`;
    this.statusBarButton.text = "$(debug-disconnect) Azure Bastion";
    this.statusBarButton.tooltip = "Click to establish Azure Bastion";
    this.statusBarButton.show();
    context.subscriptions.push(this.statusBarButton);
  }

  /** deactivate extension */
  public deactivate() {}

  public async tunnelConnectionAsync() {
    this.channel.appendLine("tunnelConnectionAsync: Starting tunnel connection");

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
    const targetVmResourceId = config.get<string>("targetVmResourceId");
    const remotePort = config.get<number>("remotePort");
    const localPort = config.get<number>("localPort");

    // Validate required parameters
    const missingParams: string[] = [];
    if (!subscriptionId) missingParams.push("subscriptionId");
    if (!bastionName) missingParams.push("bastionName");
    if (!bastionResourceGroup) missingParams.push("bastionResourceGroup");
    if (!targetVmResourceId) missingParams.push("targetVmResourceId");
    if (!remotePort) missingParams.push("remotePort");
    if (!localPort) missingParams.push("localPort");

    if (missingParams.length > 0) {
      const errorMsg = `Missing required parameters: ${missingParams.join(", ")}`;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      await vscode.commands.executeCommand("workbench.action.openSettings", "azure-bastion");
      return;
    }

    try {
      // Prepare PowerShell script path
      const scriptPath = path.join(this.extensionPath, "bin", "Invoke-AZNetwork.ps1");

      // Execute PowerShell script
      const cmd = `powershell -command start-process 'cmd.exe' -argumentlist '/c','powershell','-ExecutionPolicy','RemoteSigned','${scriptPath}','-SubscriptionId',${subscriptionId},'-BastionName',${bastionName},'-BastionResourceGroup',${bastionResourceGroup},'-TargetVmResourceId',${targetVmResourceId},'-RemotePort',${remotePort.toString()},'-LocalPort',${localPort.toString()}`;
      this.channel.appendLine(`Command: ${cmd}`);
      child_process.exec(cmd, (error, _stdout, stderr) => {
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
    this.channel.appendLine("tunnelConnectionAsync: Completed");
  }
}

export const azureBastion = new AzureBastion();
