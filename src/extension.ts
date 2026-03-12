import * as vscode from "vscode";
import { azureBastionTunnel } from "./AzureBastionTunnel";

export function activate(context: vscode.ExtensionContext) {
  azureBastionTunnel.activate(context);
}

export function deactivate() {
  azureBastionTunnel.deactivate();
}
