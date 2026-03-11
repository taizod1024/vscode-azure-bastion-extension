import * as vscode from "vscode";
import { azureBastionSSH } from "./AzureBastionSSH";

export function activate(context: vscode.ExtensionContext) {
  azureBastionSSH.activate(context);
}

export function deactivate() {
  azureBastionSSH.deactivate();
}
