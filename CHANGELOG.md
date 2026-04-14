# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - Unreleased

- Initial release.
- Custom text editor for `.md` / `.markdown` files powered by Toast UI Editor.
- Explorer, editor-tab, and command-palette entry points; `Ctrl/Cmd+Shift+M` keybinding.
- Confluence/CKEditor-style toolbar with headings, lists, tables, links, images, code, code blocks, scroll sync.
- Paste/drag image attachments saved to `./assets/`.
- Code-block language combobox with live filtering (custom chevron + floating panel).
- Native syntax highlighting via Prism + `@toast-ui/editor-plugin-code-syntax-highlight` (35+ languages, all bundled locally).
- Clean typography (Inter → system-ui stack, `ui-monospace` code, 15px / 1.65) and a tighter 32px toolbar that preserves the stock sprite geometry.
- Cursor stability: host-side echo suppression (`lastAppliedFromWebview`) so typing no longer jumps the caret to end-of-file.
- Undo/redo stability: capture-phase interception of `Cmd/Ctrl+Z` and `Cmd/Ctrl+Y` in the webview, plus selection preservation across external `setMarkdown` calls.
- Image attachments render correctly inside the webview via `toWebviewUrl` rewriting (WYSIWYG MutationObserver + markdown-preview `customHTMLRenderer.image`).
- Heading-line unescaping of `\.` so numbered headings stay readable in the source file.
- Dedicated "Rich Markdown Editor" output channel.
- GitHub Actions workflows for CI (build + package VSIX artifact) and tag-triggered release (GitHub Release + optional Marketplace / Open VSX publish).
