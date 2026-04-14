# Rich Markdown Editor

A VS Code extension that lets you preview and edit Markdown files inline with a rich WYSIWYG editor — similar to Confluence or CKEditor — including a shortcut toolbar, tables, and image attachments. Everything is bundled locally; the webview makes zero network calls.

## Features

- **Rich inline editor** powered by [Toast UI Editor](https://ui.toast.com/tui-editor), shown directly in the VS Code editor area (not a side panel).
- **Explorer context menu**: right-click any `.md` / `.markdown` file → **Rich Markdown Editor**.
- **Editor-tab context menu** and **Command Palette**: same command is available there too.
- **Keyboard shortcut**: `Ctrl+Shift+M` (`Cmd+Shift+M` on macOS) while a Markdown file is focused.
- **Shortcut toolbar**: headings, bold / italic / strike, lists (bullet, ordered, task, indent, outdent), quote, horizontal rule, **tables**, **images**, links, inline code, code blocks, scroll sync.
- **Tables**: full table editing including the drag-to-size picker, add/remove rows and columns.
- **Image attachments**: paste or drag-drop an image into the editor. The image is copied into an `assets/` folder next to your Markdown file and inserted as a relative link (`![alt](assets/foo-<timestamp>.png)`), so the file stays portable.
- **Code blocks with language dropdown**: the language label on any fenced code block opens a combobox populated with common languages (`javascript`, `typescript`, `python`, `go`, `java`, `rust`, `sql`, `yaml`, `bash`, `dockerfile`, `kotlin`, …) instead of a bare text input.
- **Native syntax highlighting**: fenced code blocks are highlighted in both the WYSIWYG view and the markdown preview using [Prism](https://prismjs.com/) via `@toast-ui/editor-plugin-code-syntax-highlight`. 35+ languages ship out of the box (bash, c, cpp, csharp, diff, dockerfile, go, graphql, ini, java, json, jsx, kotlin, less, lua, makefile, markdown, objectivec, perl, php, powershell, python, r, ruby, rust, scala, scss, sql, swift, toml, tsx, typescript, yaml, plus Prism's built-in markup / css / clike / javascript). Everything is bundled locally — no CDN is contacted.
- **Two-way sync** with the underlying text document — other VS Code editors, source control, and the file on disk always see plain Markdown. `Ctrl/Cmd+S` saves.
- **Stable cursor while typing**: host-side echo suppression keeps the caret where you left it — incoming `onDidChangeTextDocument` events that originated from the webview itself are recognised and not re-broadcast back, so ProseMirror isn't rebuilt on every keystroke.
- **Native undo/redo**: `Cmd/Ctrl+Z` and `Cmd/Ctrl+Y` are intercepted at capture phase so VS Code's global `TextDocument.undo` can't yank the caret to end-of-file; undo runs through ProseMirror's history and the selection is preserved.
- **Clean typography**: Inter → `ui-sans-serif` → system-ui stack for prose, `ui-monospace` → Menlo → Consolas for code, 15px / 1.65 line-height, antialiased. No font files bundled — everything resolves against OS-installed faces, so the webview still makes zero network calls.
- **Compact toolbar**: 32px opaque bar with subtle hover chrome; default Toast UI sprite geometry is left untouched so every icon renders correctly.
- **Dedicated output channel**: every activation, file open, save, image save, and webview error is logged under **View → Output → "Rich Markdown Editor"**.

## Project layout

```
rich-md-editor/
├── build/
│   └── editor-entry.js          # esbuild entry that exposes window.toastui.Editor
├── media/
│   ├── toastui-editor.js                    # IIFE bundle: Toast UI + ProseMirror + Prism + plugin (~680 KB)
│   ├── toastui-editor.css                   # Toast UI styles (all icons inlined as data URIs)
│   ├── prism.css                            # Prism default light theme
│   └── plugin-code-syntax-highlight.css     # Toast UI code-syntax plugin styles
├── src/
│   ├── extension.ts             # activate(), command registration, output channel
│   └── richMarkdownEditorProvider.ts  # CustomTextEditorProvider + webview HTML
├── out/                         # Compiled JS (produced by tsc)
├── .github/
│   └── workflows/
│       ├── ci.yml               # Build + package + upload VSIX on push / PR
│       └── release.yml          # Build + GH release + Marketplace + Open VSX on v* tags
├── .vscode/
│   ├── launch.json              # "Run Extension" debug config
│   └── tasks.json               # npm: compile / npm: watch
├── CHANGELOG.md
├── package.json
├── tsconfig.json
└── README.md
```

## Install / Run (development)

```bash
npm install
npm run build:webview   # bundles Toast UI + ProseMirror into media/toastui-editor.js
npm run compile         # tsc -p ./
# Open the folder in VS Code and press F5 to launch an Extension Development Host.
```

### npm scripts

| Script | What it does |
| --- | --- |
| `npm run build:webview` | Bundles Toast UI Editor + its ProseMirror deps into `media/toastui-editor.js` via esbuild (IIFE, minified). |
| `npm run compile` | Compiles the extension host TypeScript (`src/ → out/`). |
| `npm run watch` | `tsc --watch` for iterative development. |
| `npm run vscode:prepublish` | Runs `build:webview` then `compile` — used when packaging the `.vsix`. |

## Usage

1. In the **Explorer**, right-click a `.md` file → **Rich Markdown Editor** (or press `Ctrl/Cmd+Shift+M` on a focused Markdown file).
2. Edit with the toolbar. Paste or drag images straight into the document; they are saved to `./assets/` next to the file.
3. Save with `Ctrl/Cmd+S`. The file stays as clean Markdown on disk — image links are relative paths, code blocks are standard fenced blocks, etc.

To make the rich editor the default for `.md`, run **View: Reopen Editor With…** and pick *Configure default editor…*.

## Architecture notes

- **Custom text editor**: implemented as a `vscode.CustomTextEditorProvider` (viewType `richMarkdownEditor.editor`) registered with `priority: "option"`, so regular Markdown editing is unaffected until the user explicitly opens a file with this editor.
- **Two-way sync**:
  - Extension host → webview: `postMessage({ type: "setContent", content })` is sent on `ready` and on every `onDidChangeTextDocument` event for that document.
  - Webview → extension host: Toast UI's `change` event fires `postMessage({ type: "edit", content: getMarkdown() })`; the host applies a single `WorkspaceEdit` that replaces the entire document range.
- **Bundled-locally, no CDN**: `@toast-ui/editor` from npm is a webpack UMD that expects `prosemirror-*` as *external* modules, so loading it as a browser global produces an unusable `Editor` constructor. The `build:webview` script uses esbuild to produce a real IIFE bundle with all ProseMirror deps inlined.
- **Content Security Policy** (applied to the webview HTML):
  ```
  default-src 'none';
  img-src <cspSource> data: blob:;
  style-src <cspSource> 'unsafe-inline';
  font-src  <cspSource> data:;
  script-src 'nonce-…' <cspSource>
  ```
  No `connect-src` is granted — the webview cannot reach the network.
- **Image handling**:
  - On paste/drop, `addImageBlobHook` base64-encodes the blob and posts it to the host.
  - The host writes the file to `<docDir>/assets/<stem>-<timestamp>.<ext>` and returns the relative path `assets/<stem>-<timestamp>.<ext>`.
  - For rendering *inside the webview*, the document's folder is added to `localResourceRoots`, and a client-side `MutationObserver` rewrites `<img src>` attributes to full `vscode-webview://…` URLs. ProseMirror's internal model is untouched, so `getMarkdown()` still emits the clean relative path.
- **Code-block language dropdown**: a `MutationObserver` watches for the Toast UI language popup, wraps the input in a custom combobox (chevron + floating panel) populated with common Prism languages; selection dispatches synthetic `input`/`change` events so Toast UI re-highlights immediately.
- **Cursor stability**:
  - *Host-side echo suppression*: the provider keeps a `lastAppliedFromWebview` snapshot of the text it just applied from the webview. When `onDidChangeTextDocument` fires with matching content, the `setContent` roundtrip is suppressed — otherwise every keystroke would rebuild the ProseMirror document and drop the caret at end-of-file.
  - *Undo/redo interception*: a capture-phase `keydown` listener in the webview calls `stopPropagation()` + `stopImmediatePropagation()` on `Cmd/Ctrl+Z` and `Cmd/Ctrl+Y`, preventing VS Code's global keybinding from invoking `TextDocument.undo` (which bypasses ProseMirror's history and resets the selection). Undo is handled entirely by the editor, keeping the caret where it belongs.
  - *Selection preservation on legitimate external edits*: when the document really does change from the outside, the webview captures `editor.getSelection()` before `setMarkdown()` and restores it via `editor.setSelection()` afterwards.
- **Typography**: Inter (if installed) then `ui-sans-serif` / system-ui for prose, `ui-monospace` / Menlo / Consolas for code, 15px / 1.65 line-height, heading weight 650. No font files ship with the extension — the stack falls through to whatever the host OS provides, so the webview's CSP stays strict and no network is contacted.
- **Logging**: the extension creates a single `OutputChannel` named **Rich Markdown Editor**. Every lifecycle event in the host is logged there; the webview forwards `window.onerror`, `unhandledrejection`, and explicit `vscode.postMessage({ type: "error" | "log" })` calls into the same channel.

## Troubleshooting

- **Editor opens blank / broken preview** — make sure `npm run build:webview` has been run at least once so `media/toastui-editor.js` exists. Open **View → Output → Rich Markdown Editor**; any initialisation error (e.g. `window.toastui.Editor is undefined`) will be logged there.
- **Images show as a broken-image icon** — check the output channel for `image save failed:` lines, and confirm the document lives inside a VS Code workspace folder (or at least inside a folder the webview has access to).
- **`F5` prompts to install a JSON debugger** — that means VS Code hasn't picked up `.vscode/launch.json` yet. Reload the window (`Developer: Reload Window`) and pick **Run Extension** from the Run & Debug dropdown.
- **Keybinding conflicts with another extension** — override `richMarkdownEditor.open` in your `keybindings.json`.

## Adding more languages

To highlight additional Prism languages, add the corresponding import to `build/editor-entry.js` and rerun `npm run build:webview`:

```js
import 'prismjs/components/prism-elixir';
import 'prismjs/components/prism-erlang';
import 'prismjs/components/prism-haskell';
```

The full list of supported components is in `node_modules/prismjs/components/`.

> **Gotcha**: some languages depend on `prism-markup-templating` being loaded first (e.g. `php`, `twig`, `smarty`, `erb`, `latte`). If you add one of those, import `prismjs/components/prism-markup-templating` *before* the language itself, otherwise Prism will throw `tokenizePlaceholders is not a function` at runtime.

## Continuous integration & release

Two GitHub Actions workflows live in `.github/workflows/`:

**`ci.yml` — on every push and PR to `main`/`master`:**

1. `npm ci`
2. `npm run build:webview` (esbuild IIFE bundle)
3. `npm run compile` (tsc)
4. `npx vsce package --no-dependencies` → uploads the `.vsix` as an artifact

**`release.yml` — on pushing a tag `vX.Y.Z` (matching `package.json` version):**

1. Verifies the tag matches `package.json` version (fails fast if not).
2. Builds and packages as above.
3. Creates a **GitHub Release** with the `.vsix` attached and auto-generated notes.
4. Publishes to the **VS Code Marketplace** if `VSCE_PAT` is configured.
5. Publishes to the **Open VSX Registry** if `OVSX_PAT` is configured.

Steps 4 and 5 are skipped automatically when the secret isn't present, so the workflow is safe to run even before you've set up publishing.

### Cutting a release

```bash
# Bump the version
npm version patch         # or minor / major — creates a vX.Y.Z commit + tag
git push origin main --follow-tags
```

### Required repository secrets (optional)

| Secret | Where to get it | What it enables |
| --- | --- | --- |
| `VSCE_PAT` | Azure DevOps → User Settings → Personal Access Tokens. Scope: **Marketplace → Manage**. | Publishing to the VS Code Marketplace via `vsce publish`. |
| `OVSX_PAT` | https://open-vsx.org/user-settings/tokens | Publishing to the Open VSX Registry via `ovsx publish`. |

`GITHUB_TOKEN` is supplied automatically; no extra setup is needed for the GitHub Release step.

Before the very first marketplace publish, also:

- Change `"publisher": "local"` in `package.json` to your actual Marketplace publisher id.
- Replace the `OWNER` placeholder in the `repository` and `bugs` URLs with your GitHub org/user.

## Known limitations

- Only the `code-syntax-highlight` plugin is bundled; Toast UI's color-picker, chart, and UML plugins are not.
- Single editor per document (`supportsMultipleEditorsPerDocument: false`); opening the same `.md` in two rich editors at once is not supported.
- No settings UI yet for customising the toolbar or image location.
