import * as vscode from "vscode";

/** Azure Bastion Extension class */
class AzureBastion {
  /** application id */
  public appId = "azure-bastion";

  /** application name */
  public appName = "Azure Bastion Extension";

  /** output channel */
  public channel: vscode.OutputChannel;

  /** activate extension */
  public activate(context: vscode.ExtensionContext) {
    this.channel = vscode.window.createOutputChannel(this.appName, { log: true });
    context.subscriptions.push(this.channel);
    this.channel.appendLine("");
    this.channel.appendLine(`## ${this.appName} activated`);

    context.subscriptions.push(
      vscode.commands.registerCommand(`${this.appId}.invokeAZNetWork`, async () => {
        try {
          await vscode.commands.executeCommand(`${this.appId}.focusExplorer`);
        } catch (reason) {
          this.channel.appendLine(`ERROR: ${reason}`);
          vscode.window.showErrorMessage(`${reason}`);
        }
      }),
    );
  }

  /** deactivate extension */
  public deactivate() {}
}

export const azureBastion = new AzureBastion();
