import * as vscode from "vscode";
import { azureBastion } from "./AzureBastion";

export function activate(context: vscode.ExtensionContext) {
  azureBastion.activate(context);
}

export function deactivate() {
  azureBastion.deactivate();
}
