import * as vscode from "vscode";
import { exec } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

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

  // Constants - Command and Menu
  private readonly commandInvokeAZNetwork = "invokeAZNetWork";
  private readonly commandOpenSettings = "workbench.action.openSettings";
  private readonly menuTunnel = "tunnel";
  private readonly menuSSH = "ssh";
  private readonly menuRDP = "rdp";
  private readonly menuEditSSHConfig = "editSSHConfig";
  private readonly menuSettings = "settings";

  // Constants - Configuration Keys
  private readonly configSubscriptionId = "subscriptionId";
  private readonly configBastionName = "bastionName";
  private readonly configBastionResourceGroup = "bastionResourceGroup";
  private readonly configTargetVmResourceId = "targetVmResourceId";
  private readonly configRemotePort = "remotePort";
  private readonly configLocalPort = "localPort";
  private readonly configUsername = "username";

  // Constants - Paths
  private readonly sshDirName = ".ssh";
  private readonly sshConfigFile = "config";
  private readonly scriptDir = "bin";
  private readonly scriptName = "Invoke-AZNetwork.ps1";

  // Constants - Messages
  private readonly msgSSHConfigNotFound = "SSH config file not found. Create ~/.ssh/config?";
  private readonly msgWindirNotSet = "WINDIR environment variable is not set";

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
      vscode.commands.registerCommand(`${this.appId}.${this.commandInvokeAZNetwork}`, async () => {
        try {
          await this.invokeAZNetWorkAsync();
        } catch (reason) {
          this.channel.appendLine(`ERROR: ${reason}`);
          vscode.window.showErrorMessage(`${reason}`);
        }
      }),
    );

    // Create status bar button
    this.statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    this.statusBarButton.command = `${this.appId}.${this.commandInvokeAZNetwork}`;
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
        { label: "$(debug-disconnect) Tunnel", description: "Establish tunnel connection", value: this.menuTunnel },
        { label: "$(terminal) SSH", description: "Establish SSH connection", value: this.menuSSH },
        { label: "$(remote-explorer) RDP", description: "Establish RDP connection", value: this.menuRDP },
        { kind: vscode.QuickPickItemKind.Separator, label: "" },
        { label: "$(edit) Edit SSH Config", description: "Edit ~/.ssh/config", value: this.menuEditSSHConfig },
        { label: "$(gear) Settings", description: "Open extension settings", value: this.menuSettings },
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
      if (selected.value === this.menuTunnel) {
        await this.executeTunnel();
      } else if (selected.value === this.menuSSH) {
        await this.executeSSH();
      } else if (selected.value === this.menuRDP) {
        await this.executeRDP();
      } else if (selected.value === this.menuEditSSHConfig) {
        await this.editSSHConfig();
      } else if (selected.value === this.menuSettings) {
        await vscode.commands.executeCommand(this.commandOpenSettings, this.appId);
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

  private async editSSHConfig() {
    this.channel.appendLine("editSSHConfig: Opening SSH config file");

    try {
      const homeDir = os.homedir();
      const sshDir = path.join(homeDir, this.sshDirName);
      const sshConfigPath = path.join(sshDir, this.sshConfigFile);

      // Check if SSH config file exists
      if (!fs.existsSync(sshConfigPath)) {
        this.channel.appendLine(`SSH config file not found: ${sshConfigPath}`);

        // Show confirmation dialog
        const response = await vscode.window.showInformationMessage(this.msgSSHConfigNotFound, "Yes", "No");

        if (response === "Yes") {
          // Create .ssh directory if it doesn't exist
          if (!fs.existsSync(sshDir)) {
            fs.mkdirSync(sshDir, { recursive: true });
            this.channel.appendLine(`Created SSH directory: ${sshDir}`);
          }

          // Create empty config file
          const sshConfigTemplate = `Host localhost:60022(example_user@example.com:22)
    HostName example.com
    User example_user
    Port 60022
`;
          fs.writeFileSync(sshConfigPath, sshConfigTemplate);
          this.channel.appendLine(`Created SSH config file: ${sshConfigPath}`);
        } else {
          this.channel.appendLine("User cancelled SSH config file creation");
          return;
        }
      }

      // Open the SSH config file in the editor
      const uri = vscode.Uri.file(sshConfigPath);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document);

      this.channel.appendLine(`Opened SSH config file: ${sshConfigPath}`);
    } catch (error) {
      this.channel.appendLine(`Error opening SSH config file: ${error}`);
      vscode.window.showErrorMessage(`Failed to open SSH config file: ${error}`);
    }
  }

  private async executeTunnel() {
    this.channel.appendLine("executeTunnel: Starting tunnel connection");

    // Check WINDIR environment variable
    if (!process.env.WINDIR) {
      const errorMsg = this.msgWindirNotSet;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      return;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration(this.appId);
    const subscriptionId = config.get<string>(this.configSubscriptionId);
    const bastionName = config.get<string>(this.configBastionName);
    const bastionResourceGroup = config.get<string>(this.configBastionResourceGroup);
    const targetVmResourceIds = config.get<string[]>(this.configTargetVmResourceId) || [];
    const remotePort = config.get<number>(this.configRemotePort);
    const localPorts = config.get<number[]>(this.configLocalPort) || [];

    // Validate required parameters
    const missingParams: string[] = [];
    if (!subscriptionId) missingParams.push(this.configSubscriptionId);
    if (!bastionName) missingParams.push(this.configBastionName);
    if (!bastionResourceGroup) missingParams.push(this.configBastionResourceGroup);
    if (targetVmResourceIds.length === 0) missingParams.push(this.configTargetVmResourceId);
    if (!remotePort) missingParams.push(this.configRemotePort);
    if (localPorts.length === 0) missingParams.push(this.configLocalPort);

    if (missingParams.length > 0) {
      const errorMsg = `Missing required parameters: ${missingParams.join(", ")}`;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      await vscode.commands.executeCommand(this.commandOpenSettings, this.appId);
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
      const scriptPath = path.join(this.extensionPath, this.scriptDir, this.scriptName);

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
      const errorMsg = this.msgWindirNotSet;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      return;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration(this.appId);
    const subscriptionId = config.get<string>(this.configSubscriptionId);
    const bastionName = config.get<string>(this.configBastionName);
    const bastionResourceGroup = config.get<string>(this.configBastionResourceGroup);
    const targetVmResourceIds = config.get<string[]>(this.configTargetVmResourceId) || [];
    const remotePort = config.get<number>(this.configRemotePort);
    const localPorts = config.get<number[]>(this.configLocalPort) || [];
    const usernames = config.get<string[]>(this.configUsername) || [];

    // Validate required parameters
    const missingParams: string[] = [];
    if (!subscriptionId) missingParams.push(this.configSubscriptionId);
    if (!bastionName) missingParams.push(this.configBastionName);
    if (!bastionResourceGroup) missingParams.push(this.configBastionResourceGroup);
    if (targetVmResourceIds.length === 0) missingParams.push(this.configTargetVmResourceId);
    if (!remotePort) missingParams.push(this.configRemotePort);
    if (localPorts.length === 0) missingParams.push(this.configLocalPort);
    if (usernames.length === 0) missingParams.push(this.configUsername);

    if (missingParams.length > 0) {
      const errorMsg = `Missing required parameters: ${missingParams.join(", ")}`;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      await vscode.commands.executeCommand(this.commandOpenSettings, this.appId);
      return;
    }

    // Select VM Resource ID
    const vmOptions = targetVmResourceIds.map((id, index) => ({
      label: `${usernames[index]}@${this.getHostNameFromResourceId(id)}:${remotePort}`,
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
      const scriptPath = path.join(this.extensionPath, this.scriptDir, this.scriptName);

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

  private async executeRDP() {
    this.channel.appendLine("executeRDP: Starting RDP connection");

    // Check WINDIR environment variable
    if (!process.env.WINDIR) {
      const errorMsg = this.msgWindirNotSet;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      return;
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration(this.appId);
    const subscriptionId = config.get<string>(this.configSubscriptionId);
    const bastionName = config.get<string>(this.configBastionName);
    const bastionResourceGroup = config.get<string>(this.configBastionResourceGroup);
    const targetVmResourceIds = config.get<string[]>(this.configTargetVmResourceId) || [];
    const remotePort = config.get<number>(this.configRemotePort);
    const localPorts = config.get<number[]>(this.configLocalPort) || [];
    const usernames = config.get<string[]>(this.configUsername) || [];

    // Validate required parameters
    const missingParams: string[] = [];
    if (!subscriptionId) missingParams.push(this.configSubscriptionId);
    if (!bastionName) missingParams.push(this.configBastionName);
    if (!bastionResourceGroup) missingParams.push(this.configBastionResourceGroup);
    if (targetVmResourceIds.length === 0) missingParams.push(this.configTargetVmResourceId);
    if (!remotePort) missingParams.push(this.configRemotePort);
    if (localPorts.length === 0) missingParams.push(this.configLocalPort);
    if (usernames.length === 0) missingParams.push(this.configUsername);

    if (missingParams.length > 0) {
      const errorMsg = `Missing required parameters: ${missingParams.join(", ")}`;
      this.channel.appendLine(`ERROR: ${errorMsg}`);
      vscode.window.showErrorMessage(errorMsg);
      await vscode.commands.executeCommand(this.commandOpenSettings, this.appId);
      return;
    }

    // Select VM Resource ID
    const vmOptions = targetVmResourceIds.map((id, index) => ({
      label: `${this.getHostNameFromResourceId(id)}`,
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
      const scriptPath = path.join(this.extensionPath, this.scriptDir, this.scriptName);

      // Execute PowerShell script with RDP parameter
      const cmd = `powershell -command start-process 'cmd.exe' -argumentlist '/c','powershell','-ExecutionPolicy','RemoteSigned','${scriptPath}','-SubscriptionId',${subscriptionId},'-BastionName',${bastionName},'-BastionResourceGroup',${bastionResourceGroup},'-TargetVmResourceId',${targetVmResourceId},'-Username',${username},'-Mode','rdp'`;
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
    this.channel.appendLine("executeRDP: Completed");
  }
}

export const azureBastion = new AzureBastion();
