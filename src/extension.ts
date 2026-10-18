import * as vscode from "vscode";
import { azureBastion } from "./AzureBastion";
import { BastionExplorer } from "./AzureResources";

export function activate(context: vscode.ExtensionContext) {
  azureBastion.activate(context);
  const explorer = new BastionExplorer(context, azureBastion.channel);
  void explorer.activate().catch(error => {
    azureBastion.channel.appendLine(`ERROR: Could not initialize the Azure Bastion sidebar: ${error}`);
    void vscode.window.showErrorMessage(`Could not initialize the Azure Bastion sidebar: ${error}`);
  });
}

export function deactivate() {
  azureBastion.deactivate();
}
