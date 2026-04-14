// Browser entry: bundles Toast UI Editor + ProseMirror + the code-syntax
// plugin + Prism (core + a selection of common languages) into a single IIFE
// that exposes window.toastui.{Editor, CodeSyntaxHighlight, Prism}.
import Editor from '@toast-ui/editor';
import Prism from 'prismjs';

// Common-language support. Add more here if you need them — each is a few KB.
// (markup / css / clike / javascript are part of Prism core.)
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-diff';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-graphql';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-kotlin';
import 'prismjs/components/prism-less';
import 'prismjs/components/prism-lua';
import 'prismjs/components/prism-makefile';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-objectivec';
import 'prismjs/components/prism-perl';
// markup-templating MUST load before php (and any other templating langs).
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-powershell';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-r';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-scala';
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';

import CodeSyntaxHighlight from '@toast-ui/editor-plugin-code-syntax-highlight';

window.toastui = window.toastui || {};
window.toastui.Editor = Editor;
window.toastui.CodeSyntaxHighlight = CodeSyntaxHighlight;
window.toastui.Prism = Prism;
