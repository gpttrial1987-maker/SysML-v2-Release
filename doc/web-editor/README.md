# SysML v2 Web Editor

This lightweight, client-side web application provides a convenient place to sketch textual SysML v2 models from a browser.

## Features

- CodeMirror-based editor with line numbers, bracket matching, and a dark/light theme toggle.
- Quick access toolbar to create new models, open existing `.sysml` files, download the current model, and insert a starter template.
- Automatically generated model outline built from common SysML declarations such as `package`, `part`, `interface`, `action`, `constraint`, and `requirement`.
- Heuristic validation that spots unmatched `end` blocks and curly braces.

## Getting Started

1. Open `index.html` in a modern browser (Chrome, Edge, Firefox, or Safari).
2. Start typing SysML v2 text into the editor.
3. Use the outline on the right to navigate to major declarations.
4. Click **Download** to save the current model to a `.sysml` file.

> **Note:** The application runs entirely in the browser and does not upload or store any content on a server.

## Development Notes

- The editor depends on the CodeMirror 5 CDN for syntax highlighting. Network access is required the first time you open the page so the scripts can be cached by your browser.
- `editor.js` contains the minimal outline and validation heuristics; extend this file if you want to integrate a full SysML v2 parser.
