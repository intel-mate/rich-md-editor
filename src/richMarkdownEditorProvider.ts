import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Custom text editor that renders a Markdown file as a WYSIWYG rich-text editor
 * using the Toast UI Editor library (bundled locally — no CDN). Supports a
 * Confluence/CKEditor-style shortcut toolbar, tables, and image attachments.
 *
 * All logs/warnings/errors are written to the shared "Rich Markdown Editor"
 * output channel passed in from `activate`.
 */
export class RichMarkdownEditorProvider implements vscode.CustomTextEditorProvider {
    public static readonly viewType = 'richMarkdownEditor.editor';

    public static register(
        context: vscode.ExtensionContext,
        output: vscode.OutputChannel
    ): vscode.Disposable {
        const provider = new RichMarkdownEditorProvider(context, output);
        return vscode.window.registerCustomEditorProvider(
            RichMarkdownEditorProvider.viewType,
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false
            }
        );
    }

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly output: vscode.OutputChannel
    ) {}

    private log(level: 'info' | 'warn' | 'error', message: string) {
        this.output.appendLine(`[${new Date().toISOString()}] [${level}] ${message}`);
    }

    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        this.log('info', `resolveCustomTextEditor: ${document.uri.fsPath}`);

        const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        const docDirUri = vscode.Uri.file(path.dirname(document.uri.fsPath));
        // Allow the webview to load images/assets from the document's own folder
        // (and any workspace folder containing it) in addition to our bundled assets.
        const roots = [mediaRoot, docDirUri];
        const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (wsFolder) { roots.push(wsFolder.uri); }
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: roots
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview, docDirUri);

        // Track the most recent content the webview itself sent us (already
        // normalized and applied to the document). When onDidChangeTextDocument
        // fires with exactly that content, the change was caused by OUR apply
        // in response to the webview's own edit — echoing it back would cause
        // the editor to rebuild its ProseMirror doc and lose the cursor
        // position. Any other change (external edit, file reload, revert) is
        // a real external change we should push.
        let lastAppliedFromWebview: string | undefined;

        // Outbound: push doc text to webview.
        const updateWebview = () => {
            const text = document.getText();
            this.log('info', `push setContent (${text.length} chars)`);
            webviewPanel.webview.postMessage({ type: 'setContent', content: text });
        };

        const changeDocSub = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() !== document.uri.toString()) { return; }
            if (e.contentChanges.length === 0) { return; }
            // Skip the echo of our own webview-originated edit.
            if (lastAppliedFromWebview !== undefined
                && e.document.getText() === lastAppliedFromWebview) {
                lastAppliedFromWebview = undefined;
                return;
            }
            updateWebview();
        });

        webviewPanel.onDidDispose(() => {
            this.log('info', `panel disposed: ${document.uri.fsPath}`);
            changeDocSub.dispose();
        });

        // Inbound: messages from webview.
        webviewPanel.webview.onDidReceiveMessage(async msg => {
            switch (msg?.type) {
                case 'ready':
                    this.log('info', 'webview reported ready');
                    updateWebview();
                    return;
                case 'edit': {
                    const newText: string = normalizeMarkdown(msg.content ?? '');
                    if (newText === document.getText()) { return; }
                    // Remember this value so the change listener can recognise
                    // the resulting onDidChangeTextDocument event as our own
                    // echo and suppress it (preventing a cursor-reset loop in
                    // the WYSIWYG view).
                    lastAppliedFromWebview = newText;
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(
                        document.uri,
                        new vscode.Range(0, 0, document.lineCount, 0),
                        newText
                    );
                    await vscode.workspace.applyEdit(edit);
                    return;
                }
                case 'save':
                    await document.save();
                    this.log('info', `saved ${document.uri.fsPath}`);
                    return;
                case 'uploadImage': {
                    try {
                        const savedRel = await this.saveImage(document, msg.name, msg.data);
                        this.log('info', `image saved: ${savedRel}`);
                        webviewPanel.webview.postMessage({
                            type: 'imageSaved',
                            requestId: msg.requestId,
                            relPath: savedRel
                        });
                    } catch (err: any) {
                        this.log('error', `image save failed: ${err?.message ?? err}`);
                        webviewPanel.webview.postMessage({
                            type: 'imageSaved',
                            requestId: msg.requestId,
                            error: String(err?.message ?? err)
                        });
                    }
                    return;
                }
                case 'log':
                    this.log(msg.level === 'error' ? 'error' : msg.level === 'warn' ? 'warn' : 'info',
                        `[webview] ${msg.message}`);
                    return;
                case 'error':
                    this.log('error', `[webview] ${msg.message}`);
                    vscode.window.showErrorMessage(`Rich Markdown Editor: ${msg.message}`);
                    return;
            }
        });
    }

    /**
     * Save a base64 image next to the markdown file inside an `assets/` folder.
     * Returns the relative path suitable for a markdown image link.
     */
    private async saveImage(
        document: vscode.TextDocument,
        fileName: string,
        base64: string
    ): Promise<string> {
        const docDir = path.dirname(document.uri.fsPath);
        const assetsDirFs = path.join(docDir, 'assets');
        const assetsDirUri = vscode.Uri.file(assetsDirFs);
        try {
            await vscode.workspace.fs.createDirectory(assetsDirUri);
        } catch { /* ignore */ }

        const safeBase = (fileName || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
        const ext = path.extname(safeBase) || '.png';
        const stem = path.basename(safeBase, ext) || 'image';
        const unique = `${stem}-${Date.now()}${ext}`;
        const targetFs = path.join(assetsDirFs, unique);
        const targetUri = vscode.Uri.file(targetFs);

        const comma = base64.indexOf(',');
        const payload = comma >= 0 ? base64.slice(comma + 1) : base64;
        const buf = Buffer.from(payload, 'base64');
        await vscode.workspace.fs.writeFile(targetUri, buf);

        return `assets/${unique}`;
    }

    private getHtml(webview: vscode.Webview, docDirUri: vscode.Uri): string {
        const nonce = getNonce();
        const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
        const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'toastui-editor.css'));
        const prismCssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'prism.css'));
        const pluginCssUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'plugin-code-syntax-highlight.css'));
        const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'toastui-editor.js'));
        // Base URL the webview can use to resolve relative image paths that
        // appear in the markdown (e.g. "assets/foo.png" saved next to the doc).
        const docBaseUri = webview.asWebviewUri(docDirUri).toString();

        // Strict CSP — no network, only our bundled assets + inline styles for theming.
        const csp = [
            `default-src 'none'`,
            `img-src ${webview.cspSource} data: blob:`,
            `style-src ${webview.cspSource} 'unsafe-inline'`,
            `font-src ${webview.cspSource} data:`,
            `script-src 'nonce-${nonce}' ${webview.cspSource}`
        ].join('; ');

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Rich Markdown Editor</title>
  <link rel="stylesheet" href="${cssUri}" />
  <link rel="stylesheet" href="${prismCssUri}" />
  <link rel="stylesheet" href="${pluginCssUri}" />
  <style nonce="${nonce}">
    /* --- Typography ---------------------------------------------------------
       Use modern system UI fonts that ship with every OS — no bundled fonts,
       no network calls. "Inter" is tried first in case the user has it
       installed; otherwise falls back to each platform's cleanest UI font. */
    :root {
      --rme-font-ui: "Inter", "Inter var", ui-sans-serif, system-ui,
        -apple-system, BlinkMacSystemFont, "Segoe UI Variable Text", "Segoe UI",
        Roboto, "Helvetica Neue", Arial, sans-serif;
      --rme-font-mono: ui-monospace, "SF Mono", "JetBrains Mono",
        "Cascadia Code", "Fira Code", Menlo, Monaco, Consolas,
        "Liberation Mono", "Courier New", monospace;
    }

    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      background: #ffffff;   /* keep a light surface — TUI popups assume light */
      color: #1f1f1f;
      font-family: var(--rme-font-ui);
      font-size: 15px;
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
      font-feature-settings: "kern", "liga", "calt";
    }
    #editor { height: 100vh; }

    /* Propagate the UI font into every Toast UI surface (editor body,
       preview, popups, toolbar) — TUI defaults to its own stack. */
    .toastui-editor-defaultUI,
    .toastui-editor-defaultUI .ProseMirror,
    .toastui-editor-defaultUI .toastui-editor-md-container,
    .toastui-editor-defaultUI .toastui-editor-ww-container,
    .toastui-editor-contents,
    .toastui-editor-md-preview,
    .toastui-editor-popup,
    .toastui-editor-dropdown-toolbar {
      font-family: var(--rme-font-ui) !important;
    }

    /* Monospace for code surfaces only. */
    .toastui-editor-contents pre,
    .toastui-editor-contents code,
    .toastui-editor-md-container .ProseMirror,
    .toastui-editor-md-preview pre,
    .toastui-editor-md-preview code {
      font-family: var(--rme-font-mono) !important;
      font-size: 0.92em;
    }

    /* Slightly tighter heading rhythm for readability. */
    .toastui-editor-contents h1,
    .toastui-editor-contents h2,
    .toastui-editor-contents h3,
    .toastui-editor-contents h4,
    .toastui-editor-contents h5,
    .toastui-editor-contents h6 {
      line-height: 1.3;
      letter-spacing: -0.01em;
      font-weight: 650;
    }

    .toastui-editor-defaultUI { border: none; }

    /* --- Toolbar: quieter & a touch shorter --------------------------------
       We keep the default icon size (they share a sprite and scaling it
       shifts each icon's background-position, breaking the layout). Instead
       we trim padding and spacing for a tighter overall bar. */
    .toastui-editor-defaultUI-toolbar,
    .toastui-editor-toolbar {
      position: sticky;
      top: 0;
      z-index: 20;
      background: #ffffff;
      padding: 2px 6px !important;
      border-bottom: 1px solid #e5e5e5 !important;
    }
    /* Keep the default icon/sprite geometry — only trim the button chrome
       (margins, hover surface, corners). Don't touch background-size: Toast
       UI uses a single sprite with fixed background-position per icon. */
    .toastui-editor-toolbar-icons {
      margin: 1px 1px !important;
      border-radius: 4px !important;
    }
    .toastui-editor-toolbar-icons:hover {
      background-color: #f1f1f1 !important;
    }
    .toastui-editor-toolbar-divider {
      height: 18px !important;
      margin: 6px 3px !important;
    }
    .toastui-editor-toolbar-group {
      margin: 0 2px !important;
    }

    /* Mode switch tabs (Markdown / WYSIWYG) — tighten those too. */
    .toastui-editor-mode-switch {
      height: 28px !important;
    }
    .toastui-editor-mode-switch .tab-item {
      font-size: 12px !important;
      padding: 4px 10px !important;
      font-family: var(--rme-font-ui) !important;
    }

    /* All floating popups / dropdowns must sit above the editor content
       and must have an opaque background so they are readable. */
    .toastui-editor-popup,
    .toastui-editor-dropdown-toolbar,
    .toastui-editor-context-menu,
    .toastui-editor-popup-add-table,
    .toastui-editor-popup-add-link,
    .toastui-editor-popup-add-image,
    .toastui-editor-popup-add-heading,
    .toastui-editor-popup-code-block-languages {
      z-index: 1000 !important;
      background: #ffffff !important;
      color: #1f1f1f !important;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18) !important;
      border: 1px solid #d0d0d0 !important;
    }

    /* Table-size picker grid — needs pointer events to handle drag-select. */
    .toastui-editor-popup-add-table,
    .toastui-editor-popup-add-table * {
      pointer-events: auto !important;
    }
    .toastui-editor-popup-add-table .toastui-editor-table-selection,
    .toastui-editor-table-selection {
      background: #ffffff !important;
      position: relative;
    }
    .toastui-editor-table-cell,
    .toastui-editor-table-cell-selected {
      border: 1px solid #c0c0c0 !important;
      background: #ffffff !important;
    }
    .toastui-editor-table-cell-selected,
    .toastui-editor-table-selection-layer {
      background: #e6f0ff !important;
      border-color: #4a90e2 !important;
    }

    /* Make sure popup menu items stay readable on hover */
    .toastui-editor-dropdown-toolbar button:hover,
    .toastui-editor-popup button:hover {
      background: #f0f0f0 !important;
    }

    /* Code-block language input — make the datalist-enhanced field legible. */
    .toastui-editor-popup-code-block-languages,
    .toastui-editor-ww-code-block-language {
      background: #ffffff !important;
      border: 1px solid #d0d0d0 !important;
      border-radius: 4px !important;
      padding: 8px !important;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18) !important;
    }
    .toastui-editor-popup-code-block-languages input,
    .toastui-editor-ww-code-block-language input {
      background: #ffffff !important;
      color: #1f1f1f !important;
      border: 1px solid #c0c0c0 !important;
      border-radius: 3px !important;
      font-size: 13px !important;
    }
  </style>
</head>
<body>
  <div id="editor"></div>

  <script nonce="${nonce}" src="${jsUri}"></script>
  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();

      // Forward anything interesting in the webview back to the output channel.
      const log = (level, message) => vscode.postMessage({ type: 'log', level, message });
      window.addEventListener('error', (e) => {
        vscode.postMessage({
          type: 'error',
          message: (e.error && (e.error.stack || e.error.message)) || e.message || String(e)
        });
      });
      window.addEventListener('unhandledrejection', (e) => {
        vscode.postMessage({
          type: 'error',
          message: 'Unhandled promise rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || String(e.reason))
        });
      });

      if (!window.toastui || !window.toastui.Editor) {
        vscode.postMessage({
          type: 'error',
          message: 'Toast UI Editor failed to load (window.toastui.Editor is undefined).'
        });
        return;
      }
      const { Editor, CodeSyntaxHighlight, Prism } = window.toastui;

      // Base URI for resolving relative image paths inside the webview.
      const DOC_BASE = ${JSON.stringify(docBaseUri)};

      // Rewrite "assets/foo.png" or "./foo.png" into a webview-loadable URL.
      // Absolute URLs (http, https, data:, vscode-webview:) pass through.
      function toWebviewUrl(src) {
        if (!src) return src;
        if (/^(https?:|data:|blob:|vscode-webview:|vscode-resource:)/i.test(src)) return src;
        const base = DOC_BASE.endsWith('/') ? DOC_BASE : DOC_BASE + '/';
        const clean = src.replace(/^\\.\\//, '');
        return base + clean;
      }

      // Common code-block languages surfaced in an autocomplete datalist so the
      // user isn't staring at a bare text input.
      const LANGS = [
        'text','bash','shell','c','cpp','csharp','css','diff','dockerfile','go',
        'graphql','html','ini','java','javascript','json','jsx','kotlin','less',
        'lua','makefile','markdown','objectivec','perl','php','powershell','python',
        'r','ruby','rust','scala','scss','sql','swift','toml','typescript','tsx',
        'xml','yaml'
      ];

      let suppressChange = false;
      let pendingImage = null;

      let editor;
      try {
        editor = new Editor({
          el: document.getElementById('editor'),
          height: '100vh',
          initialEditType: 'wysiwyg',
          previewStyle: 'vertical',
          usageStatistics: false,
          initialValue: '',
          toolbarItems: [
            ['heading', 'bold', 'italic', 'strike'],
            ['hr', 'quote'],
            ['ul', 'ol', 'task', 'indent', 'outdent'],
            ['table', 'image', 'link'],
            ['code', 'codeblock'],
            ['scrollSync']
          ],
          plugins: CodeSyntaxHighlight
            ? [[CodeSyntaxHighlight, { highlighter: Prism }]]
            : [],
          customHTMLRenderer: {
            image(node, context) {
              const { destination } = node;
              const { getChildrenText, skipChildren } = context;
              skipChildren();
              return {
                type: 'openTag',
                tagName: 'img',
                selfClose: true,
                attributes: {
                  src: toWebviewUrl(destination),
                  alt: getChildrenText(node)
                }
              };
            }
          },
          hooks: {
            addImageBlobHook: (blob, callback) => {
              const reader = new FileReader();
              reader.onload = () => {
                const requestId = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8);
                pendingImage = { requestId, callback, name: blob.name || 'image.png' };
                vscode.postMessage({
                  type: 'uploadImage',
                  requestId,
                  name: blob.name || 'image.png',
                  data: reader.result
                });
              };
              reader.onerror = () => {
                vscode.postMessage({ type: 'error', message: 'Failed to read image blob.' });
              };
              reader.readAsDataURL(blob);
            }
          }
        });
        log('info', 'editor constructed');
      } catch (err) {
        vscode.postMessage({
          type: 'error',
          message: 'Editor construction failed: ' + (err && (err.stack || err.message) || String(err))
        });
        return;
      }

      editor.on('change', () => {
        if (suppressChange) return;
        const md = editor.getMarkdown();
        vscode.postMessage({ type: 'edit', content: md });
      });

      // Keyboard routing:
      //   * Ctrl/Cmd+Z  -> ProseMirror undo (don't let VS Code run TextDocument.undo)
      //   * Ctrl/Cmd+Y / Ctrl/Cmd+Shift+Z -> ProseMirror redo (same reason)
      //   * Ctrl/Cmd+S  -> save through the host
      // We use the capture phase and stopImmediatePropagation so neither VS
      // Code's global keybindings nor any other listener on the page run the
      // built-in TextDocument undo/redo (which would mutate the doc without
      // going through our webview->host sync and leave the editor's
      // ProseMirror state out of step, causing the caret to jump to EOF).
      window.addEventListener('keydown', (e) => {
        const isMod = e.ctrlKey || e.metaKey;
        const k = e.key.toLowerCase();
        if (isMod && (k === 'z' || k === 'y')) {
          // Let ProseMirror's own keymap handle undo/redo.
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
          return;
        }
        if (isMod && k === 's') {
          e.preventDefault();
          e.stopPropagation();
          vscode.postMessage({ type: 'save' });
        }
      }, true);

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.type === 'setContent') {
          const current = editor.getMarkdown();
          if (current === msg.content) return;
          // Preserve selection/cursor across a setMarkdown call so external
          // edits don't jolt the user to the end of the document.
          let savedSelection = null;
          try { savedSelection = editor.getSelection(); } catch (_) { /* noop */ }
          suppressChange = true;
          try {
            editor.setMarkdown(msg.content || '', false);
            if (savedSelection) {
              try { editor.setSelection(savedSelection[0], savedSelection[1]); }
              catch (_) { /* best-effort */ }
            }
          }
          catch (err) {
            vscode.postMessage({
              type: 'error',
              message: 'setMarkdown failed: ' + (err && (err.stack || err.message) || String(err))
            });
          } finally { suppressChange = false; }
        } else if (msg.type === 'imageSaved') {
          if (!pendingImage || pendingImage.requestId !== msg.requestId) return;
          const { callback, name } = pendingImage;
          pendingImage = null;
          if (msg.error) {
            vscode.postMessage({ type: 'error', message: 'Image save failed: ' + msg.error });
            return;
          }
          callback(msg.relPath, name);
        }
      });

      // --- Rewrite relative <img src> into webview URLs for display only. ---
      // We only touch the DOM attribute; ProseMirror keeps its own source of
      // truth, so the markdown serialised by getMarkdown() still contains the
      // original relative path (e.g. "assets/foo.png").
      (function enhanceImages() {
        const rewrite = (img) => {
          const src = img.getAttribute('src');
          if (!src) return;
          if (img.dataset.rmeRewrittenFrom === src) return;
          if (/^(https?:|data:|blob:|vscode-webview:|vscode-resource:)/i.test(src)) return;
          const url = toWebviewUrl(src);
          if (url === src) return;
          img.dataset.rmeRewrittenFrom = src;
          img.setAttribute('src', url);
        };
        const scan = (root) => {
          if (!root || root.nodeType !== 1) return;
          if (root.matches && root.matches('img')) rewrite(root);
          const imgs = root.querySelectorAll ? root.querySelectorAll('img') : [];
          imgs.forEach(rewrite);
        };
        new MutationObserver((muts) => {
          for (const m of muts) {
            if (m.type === 'attributes' && m.target && m.target.tagName === 'IMG') {
              // Re-rewrite if the src was reset to the original by ProseMirror.
              const img = m.target;
              if (img.dataset.rmeRewrittenFrom !== img.getAttribute('src')) rewrite(img);
            } else {
              m.addedNodes && m.addedNodes.forEach(scan);
            }
          }
        }).observe(document.body, {
          childList: true, subtree: true,
          attributes: true, attributeFilter: ['src']
        });
        scan(document.body);
      })();

      // --- Replace the code-block language input with a real combobox. ---
      // Toast UI ships a plain text input for picking a fenced-code language.
      // We wrap it with a clickable dropdown panel so the user can SEE the
      // list of common languages, while still being able to type a custom one.
      (function enhanceCodeBlockLanguagePopup() {
        const closeAllPanels = () => {
          document.querySelectorAll('.rme-lang-panel').forEach((p) => p.remove());
        };
        document.addEventListener('mousedown', (e) => {
          if (!(e.target instanceof Element)) return;
          if (!e.target.closest('.rme-lang-wrap') && !e.target.closest('.rme-lang-panel')) {
            closeAllPanels();
          }
        }, true);

        const openPanel = (input, chevron) => {
          closeAllPanels();
          const rect = input.getBoundingClientRect();
          const panel = document.createElement('div');
          panel.className = 'rme-lang-panel';
          panel.style.cssText = [
            'position: fixed',
            'top: ' + (rect.bottom + 2) + 'px',
            'left: ' + rect.left + 'px',
            'min-width: ' + Math.max(rect.width, 220) + 'px',
            'max-height: 260px',
            'overflow-y: auto',
            'background: #ffffff',
            'color: #1f1f1f',
            'border: 1px solid #d0d0d0',
            'box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2)',
            'border-radius: 4px',
            'z-index: 2000',
            'font-size: 13px',
            'padding: 4px 0'
          ].join(';');

          const filter = (input.value || '').trim().toLowerCase();
          const matches = filter
            ? LANGS.filter((l) => l.toLowerCase().includes(filter))
            : LANGS.slice();

          if (matches.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = 'No match — press Enter to use "' + input.value + '"';
            empty.style.cssText = 'padding: 6px 12px; color: #888;';
            panel.appendChild(empty);
          } else {
            for (const l of matches) {
              const item = document.createElement('div');
              item.textContent = l;
              item.style.cssText = 'padding: 6px 12px; cursor: pointer;';
              item.addEventListener('mouseenter', () => { item.style.background = '#f0f0f0'; });
              item.addEventListener('mouseleave', () => { item.style.background = ''; });
              item.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                input.value = l;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.focus();
                closeAllPanels();
              });
              panel.appendChild(item);
            }
          }
          document.body.appendChild(panel);
        };

        const attach = (input) => {
          if (!input || input.dataset.rmeEnhanced === '1') return;
          if (!input.closest) return;
          // Only enhance actual code-block language inputs.
          const container = input.closest(
            '.toastui-editor-popup-code-block-languages, .toastui-editor-ww-code-block-language'
          );
          if (!container) return;
          input.dataset.rmeEnhanced = '1';

          input.setAttribute('placeholder', 'Pick a language or type a custom one');
          input.setAttribute('autocomplete', 'off');
          input.setAttribute('spellcheck', 'false');
          input.style.minWidth = '220px';
          input.style.padding = '4px 28px 4px 8px';

          // Wrap with a relative container so the chevron sits inside the input.
          const wrap = document.createElement('span');
          wrap.className = 'rme-lang-wrap';
          wrap.style.cssText = 'position: relative; display: inline-block;';
          input.parentNode.insertBefore(wrap, input);
          wrap.appendChild(input);

          const chevron = document.createElement('button');
          chevron.type = 'button';
          chevron.className = 'rme-lang-chevron';
          chevron.setAttribute('aria-label', 'Show language list');
          chevron.textContent = '▾';
          chevron.style.cssText = [
            'position: absolute',
            'right: 4px',
            'top: 50%',
            'transform: translateY(-50%)',
            'background: transparent',
            'border: none',
            'cursor: pointer',
            'font-size: 12px',
            'color: #555',
            'padding: 2px 6px'
          ].join(';');
          chevron.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const existing = document.querySelector('.rme-lang-panel');
            if (existing) { closeAllPanels(); return; }
            openPanel(input, chevron);
          });
          wrap.appendChild(chevron);

          input.addEventListener('focus', () => openPanel(input, chevron));
          input.addEventListener('input', () => openPanel(input, chevron));
          input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { closeAllPanels(); }
            if (ev.key === 'Enter') { closeAllPanels(); }
          });
        };

        const scan = (root) => {
          if (!root || root.nodeType !== 1) return;
          const nodes = root.querySelectorAll(
            '.toastui-editor-popup-code-block-languages input, .toastui-editor-ww-code-block-language input'
          );
          nodes.forEach(attach);
        };

        new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (const n of m.addedNodes) {
              if (n.nodeType === 1) { scan(n); }
            }
            // The popup is sometimes reused; re-scan its subtree.
            if (m.target && m.target.nodeType === 1) scan(m.target);
          }
        }).observe(document.body, { childList: true, subtree: true });

        scan(document.body);
      })();

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
    }
}

/**
 * Clean up markdown coming out of Toast UI Editor before it's written to disk.
 *
 * Toast UI escapes any `digit.` sequence it emits (e.g. `1\. Title` inside an
 * ATX heading) to keep its markdown parser from re-reading the output as an
 * ordered list. Inside a heading that escape is unnecessary and renders as a
 * literal backslash in many viewers (including GitHub). We unescape it, but
 * only inside heading lines, so fenced code blocks and inline examples are
 * left untouched.
 */
function normalizeMarkdown(md: string): string {
    // Unescape `\.` only on ATX heading lines.
    return md.replace(/^(#{1,6} .*)$/gm, (line) => line.replace(/\\\./g, '.'));
}

function getNonce(): string {
    let text = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}
