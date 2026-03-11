import * as vscode from "vscode";

/** Azure Bastion SSH Extension class */
class AzureBastionSSH {
  /** application id */
  public appId = "azure-bastion-ssh";

  /** application name */
  public appName = "Azure Bastion SSH Extension";

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
    this.statusBarButton.text = "$(debug-disconnect) Azure Bastion SSH";
    this.statusBarButton.tooltip = "Click to establish Azure Bastion SSH tunnel";
    this.statusBarButton.show();
    context.subscriptions.push(this.statusBarButton);
  }

  /** deactivate extension */
  public deactivate() {}

  public async tunnelConnectionAsync() {
    this.channel.appendLine("tunnelConnectionAsync: Starting tunnel connection");

    // Change status bar button background to orange
    if (this.statusBarButton) {
      this.statusBarButton.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
    }

    try {
      // Execute timeout 5 seconds wait
      this.channel.appendLine("Executing 5 second wait...");

      await new Promise<void>(resolve => {
        setTimeout(() => {
          this.channel.appendLine("Wait completed");
          resolve();
        }, 5000);
      });

      this.channel.appendLine("Command executed successfully");
    } catch (error) {
      this.channel.appendLine(`Command execution error: ${error}`);
    } finally {
      // Reset status bar button background color
      if (this.statusBarButton) {
        this.statusBarButton.backgroundColor = undefined;
      }
      this.channel.appendLine("tunnelConnectionAsync: Completed");
    }
  }
}

export const azureBastionSSH = new AzureBastionSSH();
