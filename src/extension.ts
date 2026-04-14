import * as vscode from 'vscode';
import * as path from 'path';
import { RichMarkdownEditorProvider } from './richMarkdownEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    // Single shared output channel — all logs, warnings, and errors from this
    // extension go here so the user can find them under
    // View -> Output -> "Rich Markdown Editor".
    const output = vscode.window.createOutputChannel('Rich Markdown Editor');
    context.subscriptions.push(output);
    output.appendLine(`[${new Date().toISOString()}] Rich Markdown Editor activated.`);

    // Register the custom text editor (WYSIWYG).
    context.subscriptions.push(RichMarkdownEditorProvider.register(context, output));

    // Explorer / editor-title / command-palette command.
    context.subscriptions.push(
        vscode.commands.registerCommand('richMarkdownEditor.open', async (uri?: vscode.Uri) => {
            let target = uri;
            if (!target) {
                const active = vscode.window.activeTextEditor?.document.uri;
                if (active) { target = active; }
            }
            if (!target) {
                const picked = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    filters: { Markdown: ['md', 'markdown'] }
                });
                if (!picked || picked.length === 0) { return; }
                target = picked[0];
            }
            const ext = path.extname(target.fsPath).toLowerCase();
            if (ext !== '.md' && ext !== '.markdown') {
                output.appendLine(`[warn] Ignoring non-Markdown file: ${target.fsPath}`);
                vscode.window.showWarningMessage('Rich Markdown Editor: selected file is not a Markdown file.');
                return;
            }
            output.appendLine(`[info] Opening "${target.fsPath}" with Rich Markdown Editor.`);
            await vscode.commands.executeCommand(
                'vscode.openWith',
                target,
                RichMarkdownEditorProvider.viewType
            );
        })
    );
}

export function deactivate() { /* noop */ }
