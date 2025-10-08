(function () {
  const editorElement = document.getElementById("editor");
  const outlineElement = document.getElementById("outline");
  const outlineForm = document.getElementById("outline-config");
  const outlineStatusElement = document.getElementById("outline-status");
  const apiUrlInput = document.getElementById("api-url");
  const projectIdInput = document.getElementById("project-id");
  const commitIdInput = document.getElementById("commit-id");
  const elementIdInput = document.getElementById("element-id");
  const tokenInput = document.getElementById("api-token");
  const outlineResetButton = document.getElementById("outline-reset");
  const validationElement = document.getElementById("validation-status");
  const fileInput = document.getElementById("file-input");
  const themeToggle = document.getElementById("toggle-theme");

  const sysmlKeywords = [
    "package",
    "part",
    "interface",
    "action",
    "state",
    "transition",
    "subject",
    "import",
    "item",
    "attribute",
    "operation",
    "end",
    "constraint",
    "requirement",
    "view",
    "viewpoint",
    "usecase",
    "association",
    "relationship",
  ];

  const OUTLINE_STORAGE_KEY = "sysml-web-editor-outline-config";

  let ignoreNextChange = false;
  let outlineMode = "heuristic";
  let outlineTree = [];
  const outlineNodeIndex = new Map();
  let activeOutlineNode = null;
  let outlineRangeMarker = null;
  let suppressCursorSync = false;
  let outlineOutOfSync = false;
  let currentApiConfig = null;
  let outlineNodeIdCounter = 0;

  const cm = CodeMirror.fromTextArea(editorElement, {
    mode: {
      name: "clike",
      keywords: sysmlKeywords.join(" "),
      blockKeywords: sysmlKeywords.join(" "),
      atoms: "true false",
    },
    lineNumbers: true,
    matchBrackets: true,
    tabSize: 2,
    indentUnit: 2,
    autofocus: true,
    autoCloseBrackets: true,
    extraKeys: {
      "Ctrl-S": () => downloadModel(),
      "Cmd-S": () => downloadModel(),
      "Ctrl-Space": () => showValidation(),
    },
  });

  const defaultTemplate = `package Example::SynchronousMotor {
  import SysML::Standard;

  part controller : Controller;
  part motor : Motor;

  interface Controller {
    attribute torqueCommand : Real;
    action regulateSpeed();
  }

  interface Motor {
    attribute actualSpeed : Real;
    action applyTorque();
  }

  constraint MaintainSpeed {
    regulatedSpeed >= 0.0;
  }
}
`;

  ignoreNextChange = true;
  cm.setValue(defaultTemplate);
  updateHeuristicOutline(defaultTemplate);
  showValidation();

  document.getElementById("btn-new").addEventListener("click", () => {
    if (cm.getValue().trim().length === 0 || confirm("Discard current model?")) {
      ignoreNextChange = true;
      cm.setValue("");
      cm.focus();
      updateHeuristicOutline("");
    }
  });

  document.getElementById("btn-insert").addEventListener("click", () => {
    const current = cm.getValue();
    if (current.trim().length === 0) {
      ignoreNextChange = true;
      cm.setValue(defaultTemplate);
      updateHeuristicOutline(defaultTemplate);
    } else {
      cm.replaceRange(`\n${defaultTemplate}`, cm.getCursor());
    }
    cm.focus();
  });

  document.getElementById("btn-open").addEventListener("click", () => {
    fileInput.click();
  });

  document.getElementById("btn-save").addEventListener("click", downloadModel);

  const debouncedValidation = debounce(showValidation, 400);

  cm.on("change", () => {
    const content = cm.getValue();
    if (ignoreNextChange) {
      ignoreNextChange = false;
    } else if (outlineMode === "heuristic") {
      updateHeuristicOutline(content);
    } else {
      markOutlineOutOfSync();
    }
    debouncedValidation();
  });

  cm.on("cursorActivity", () => {
    if (suppressCursorSync) {
      suppressCursorSync = false;
      return;
    }

    if (outlineMode !== "api" || outlineTree.length === 0) {
      return;
    }

    const cursor = cm.getCursor();
    const node = findNodeForCursor(cursor, outlineTree);
    if (node && node !== activeOutlineNode) {
      setActiveOutlineNode(node, { origin: "editor" });
    } else if (!node) {
      clearOutlineSelection();
    }
  });

  outlineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const config = readApiConfigFromInputs();
    if (!config) {
      setOutlineStatus(
        "API URL, project, commit, and root element identifiers are required to load the outline.",
        "warning",
      );
      return;
    }

    setOutlineStatus("Loading outline from API…", "note");
    try {
      await loadOutlineFromApi(config);
      currentApiConfig = config;
      outlineOutOfSync = false;
      persistApiConfig(config);
    } catch (error) {
      console.error("Failed to load outline", error);
      const message = error instanceof Error ? error.message : String(error);
      setOutlineStatus(`Failed to load outline: ${message}`, "error");
    }
  });

  outlineResetButton?.addEventListener("click", () => {
    currentApiConfig = null;
    outlineOutOfSync = false;
    clearOutlineSelection();
    setOutlineStatus("Outline is generated heuristically from the current editor content.", "info");
    updateHeuristicOutline(cm.getValue());
  });

  initializeOutlineConfig();

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    ignoreNextChange = true;
    cm.setValue(text);
    cm.focus();
    updateHeuristicOutline(text);
    showValidation();
    fileInput.value = "";
  });

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (prefersDark) {
    themeToggle.checked = true;
    document.body.classList.add("dark");
  }

  themeToggle.addEventListener("change", () => {
    document.body.classList.toggle("dark", themeToggle.checked);
    cm.refresh();
  });

  function downloadModel() {
    const content = cm.getValue();
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `model-${new Date().toISOString().replace(/[:.]/g, "-")}.sysml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showValidation() {
    const content = cm.getValue();
    const diagnostics = validate(content);
    if (diagnostics.length === 0) {
      validationElement.textContent = "No structural issues detected.";
      validationElement.className = "status success";
    } else {
      validationElement.innerHTML = diagnostics
        .map((diag) => `<span class="issue">${diag}</span>`)
        .join(" ");
      validationElement.className = "status warning";
    }
  }

  function updateHeuristicOutline(content) {
    outlineMode = "heuristic";
    outlineOutOfSync = false;
    currentApiConfig = null;
    clearRangeMarker();

    outlineTree = buildHeuristicNodes(content);
    activeOutlineNode = null;
    renderOutlineTree();

    if (!content || content.trim().length === 0) {
      setOutlineStatus("Outline is generated heuristically from the current editor content.", "info");
    } else {
      setOutlineStatus("Outline is generated heuristically from the current editor content.", "info");
    }
  }

  function buildHeuristicNodes(content) {
    const regex = /^(\s*)(package|part|interface|action|state|transition|constraint|requirement|view|viewpoint|usecase)\s+([A-Za-z0-9_:]+)/i;
    const lines = content.split(/\r?\n/);
    const items = [];
    lines.forEach((line, index) => {
      const match = line.match(regex);
      if (match) {
        items.push({
          line: index,
          indent: match[1].length,
          kind: match[2],
          name: match[3],
        });
      }
    });

    outlineNodeIdCounter = 0;
    const roots = [];
    const stack = [{ indent: -1, node: null }];

    items.forEach((item, index) => {
      const node = {
        id: `heuristic-${outlineNodeIdCounter++}`,
        elementId: null,
        label: item.name,
        name: item.name,
        kind: item.kind,
        range: {
          start: { line: item.line, ch: 0 },
          end: { line: item.line, ch: Number.MAX_SAFE_INTEGER },
        },
        children: [],
        parent: null,
        expanded: true,
        source: "heuristic",
      };

      while (stack.length > 1 && item.indent <= stack[stack.length - 1].indent) {
        stack.pop();
      }

      const parentEntry = stack[stack.length - 1];
      if (parentEntry.node) {
        node.parent = parentEntry.node;
        parentEntry.node.children.push(node);
      } else {
        roots.push(node);
      }

      stack.push({ indent: item.indent, node });
    });

    return roots;
  }

  async function loadOutlineFromApi(config) {
    const normalized = normalizeApiConfig(config);
    const visited = new Set();
    outlineNodeIdCounter = 0;

    const element = await fetchElement(normalized, normalized.elementId);
    if (!element) {
      throw new Error("API returned an empty element response.");
    }

    const rootNode = await buildApiOutline(normalized, element, null, visited);
    outlineMode = "api";
    outlineOutOfSync = false;
    outlineTree = rootNode ? [rootNode] : [];
    activeOutlineNode = null;
    clearRangeMarker();
    renderOutlineTree();

    const total = countNodes(outlineTree);
    if (total === 0) {
      setOutlineStatus("No owned elements were returned for the requested element.", "warning");
    } else {
      setOutlineStatus(`Loaded outline with ${total} element${total === 1 ? "" : "s"}.`, "success");
    }

    const rootText = rootNode?.text;
    if (typeof rootText === "string" && rootText.trim().length > 0 && rootText !== cm.getValue()) {
      ignoreNextChange = true;
      cm.setValue(rootText);
      cm.refresh();
      showValidation();
    }

    if (rootNode?.range) {
      setActiveOutlineNode(rootNode, { origin: "api" });
    } else {
      clearOutlineSelection();
    }
  }

  async function buildApiOutline(config, element, parent, visited) {
    const node = createOutlineNodeFromApi(element, parent);
    if (!node.elementId) {
      node.elementId = extractElementId(element) ?? node.id;
    }

    const elementId = node.elementId;
    if (elementId && visited.has(elementId)) {
      return node;
    }
    if (elementId) {
      visited.add(elementId);
    }

    let ownedElements = [];
    try {
      ownedElements = elementId ? await fetchOwnedElements(config, elementId) : [];
    } catch (error) {
      console.warn("Failed to fetch owned elements", error);
    }

    for (const childEntry of ownedElements) {
      const childId = extractElementId(childEntry);
      if (!childId || visited.has(childId)) {
        continue;
      }

      let childElement = childEntry;
      if (childEntry && typeof childEntry === "object" && "element" in childEntry) {
        childElement = childEntry.element;
      }

      if (!childElement || typeof childElement !== "object" || !extractElementId(childElement)) {
        try {
          childElement = await fetchElement(config, childId);
        } catch (error) {
          console.warn(`Failed to fetch element ${childId}`, error);
          continue;
        }
      }

      const childNode = await buildApiOutline(config, childElement, node, visited);
      childNode.parent = node;
      node.children.push(childNode);
    }

    return node;
  }

  function createOutlineNodeFromApi(element, parent) {
    const raw = element && typeof element === "object" && "data" in element && element.data ? element.data : element;
    const elementId = extractElementId(raw) ?? `api-node-${outlineNodeIdCounter++}`;
    const name = pickString(
      raw?.name,
      raw?.shortName,
      raw?.displayName,
      raw?.declaredName,
      raw?.declaredShortName,
      raw?.payload?.declaredName,
      raw?.payload?.name,
      raw?.payload?.shortName,
    );

    const classifier = pickString(
      raw?.classifierId,
      Array.isArray(raw?.classifierIds) ? raw.classifierIds[0] : undefined,
      raw?.payload?.["@type"],
      raw?.specialization,
      raw?.specializations?.[0]?.classifierId,
      raw?.specializations?.[0]?.payload?.["@type"],
      raw?.type,
      raw?.["@type"],
    );

    const kind = simplifyClassifier(classifier);
    const label = name ?? (kind ? `${kind}${elementId ? ` (${truncateId(elementId)})` : ""}` : elementId ?? "Unnamed element");

    const textualRepresentations = collectTextualRepresentations(raw);
    let text;
    const ranges = [];
    for (const representation of textualRepresentations) {
      if (!text) {
        const body = pickString(representation?.body, representation?.text, representation?.value);
        if (body) {
          text = body;
        }
      }
      const parsedRanges = extractRangesFromRepresentation(representation);
      ranges.push(...parsedRanges);
    }

    const node = {
      id: elementId,
      elementId,
      label,
      name: name ?? undefined,
      kind: kind ?? undefined,
      range: ranges.length > 0 ? ranges[0] : undefined,
      ranges,
      text,
      children: [],
      parent: parent ?? null,
      expanded: parent ? false : true,
      source: "api",
      raw,
    };

    return node;
  }

  function collectTextualRepresentations(element) {
    const representations = [];

    function pushRepresentation(value) {
      if (!value) return;
      if (Array.isArray(value)) {
        value.forEach(pushRepresentation);
      } else if (typeof value === "object") {
        representations.push(value);
      }
    }

    if (element?.textualRepresentation) pushRepresentation(element.textualRepresentation);
    if (element?.textualRepresentations) pushRepresentation(element.textualRepresentations);
    if (element?.representations) pushRepresentation(element.representations);
    if (element?.payload?.textualRepresentation) pushRepresentation(element.payload.textualRepresentation);
    if (element?.payload?.textualRepresentations) pushRepresentation(element.payload.textualRepresentations);
    if (element?.specializations) {
      for (const specialization of element.specializations) {
        if (specialization?.textualRepresentation) pushRepresentation(specialization.textualRepresentation);
        if (specialization?.textualRepresentations) pushRepresentation(specialization.textualRepresentations);
        if (specialization?.payload?.textualRepresentation) pushRepresentation(specialization.payload.textualRepresentation);
        if (specialization?.payload?.textualRepresentations) pushRepresentation(specialization.payload.textualRepresentations);
      }
    }

    return representations;
  }

  function extractRangesFromRepresentation(representation) {
    const sources = [];
    if (!representation || typeof representation !== "object") {
      return sources;
    }

    const rawRanges = representation.ranges ?? representation.range ?? representation.sourceRanges ?? representation.locations;
    if (Array.isArray(rawRanges)) {
      for (const range of rawRanges) {
        const normalized = normalizeRange(range);
        if (normalized) {
          sources.push(normalized);
        }
      }
    } else if (rawRanges) {
      const normalized = normalizeRange(rawRanges);
      if (normalized) {
        sources.push(normalized);
      }
    }

    return sources;
  }

  function normalizeRange(range) {
    if (!range || typeof range !== "object") {
      return undefined;
    }

    const start = normalizePosition(range.start ?? range.startPosition ?? range.begin ?? {
      line: range.startLine ?? range.beginLine ?? range.lineStart,
      column: range.startColumn ?? range.beginColumn ?? range.columnStart,
    });
    const end = normalizePosition(range.end ?? range.endPosition ?? range.finish ?? {
      line: range.endLine ?? range.finishLine ?? range.lineEnd,
      column: range.endColumn ?? range.finishColumn ?? range.columnEnd,
    });

    if (!start || !end) {
      return undefined;
    }

    if (comparePositions(start, end) >= 0) {
      return undefined;
    }

    return { start, end };
  }

  function normalizePosition(position) {
    if (!position) {
      return undefined;
    }

    if (typeof position === "number") {
      return { line: Math.max(0, position), ch: 0 };
    }

    if (typeof position !== "object") {
      return undefined;
    }

    const lineCandidate = pickNumber(
      position.line,
      position.lineNumber,
      position.row,
      position.startLine,
      position.beginLine,
      position.lineIndex,
    );
    const columnCandidate = pickNumber(
      position.column,
      position.columnNumber,
      position.col,
      position.character,
      position.startColumn,
      position.beginColumn,
    );

    if (lineCandidate === undefined || columnCandidate === undefined) {
      return undefined;
    }

    const line = lineCandidate > 0 ? lineCandidate - 1 : lineCandidate;
    const ch = columnCandidate > 0 ? columnCandidate - 1 : columnCandidate;

    return { line: Math.max(0, line), ch: Math.max(0, ch) };
  }

  function pickNumber(...values) {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }
    return undefined;
  }

  function pickString(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return undefined;
  }

  function simplifyClassifier(value) {
    if (!value || typeof value !== "string") {
      return undefined;
    }
    const parts = value.split(/[:#\/]/);
    return parts[parts.length - 1] || value;
  }

  function truncateId(id) {
    return typeof id === "string" && id.length > 12 ? `${id.slice(0, 12)}…` : id;
  }

  function countNodes(nodes) {
    if (!Array.isArray(nodes)) {
      return 0;
    }
    return nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);
  }

  function setOutlineStatus(message, variant = "info") {
    if (!outlineStatusElement) {
      return;
    }
    outlineStatusElement.textContent = message;
    outlineStatusElement.className = `status ${variant}`;
  }

  function renderOutlineTree() {
    if (!outlineElement) {
      return;
    }

    outlineNodeIndex.clear();
    outlineElement.innerHTML = "";

    if (!outlineTree || outlineTree.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent =
        outlineMode === "api"
          ? "No owned elements were returned for the requested element."
          : "No structural elements detected.";
      outlineElement.appendChild(empty);
      return;
    }

    for (const node of outlineTree) {
      outlineElement.appendChild(renderOutlineNode(node));
    }
  }

  function renderOutlineNode(node) {
    outlineNodeIndex.set(node.id, node);

    const li = document.createElement("li");
    li.className = "outline-node";

    const row = document.createElement("div");
    row.className = "outline-row";
    if (activeOutlineNode === node) {
      row.classList.add("selected");
    }
    if (node.elementId) {
      row.title = node.elementId;
    }

    const toggle = document.createElement(node.children.length > 0 ? "button" : "span");
    toggle.className = node.children.length > 0 ? "outline-toggle" : "outline-spacer";
    if (node.children.length > 0) {
      toggle.type = "button";
      toggle.setAttribute("aria-label", node.expanded ? "Collapse" : "Expand");
      toggle.textContent = node.expanded ? "▾" : "▸";
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        node.expanded = !node.expanded;
        renderOutlineTree();
      });
    }
    row.appendChild(toggle);

    const labelButton = document.createElement("button");
    labelButton.type = "button";
    labelButton.className = "outline-label";
    labelButton.textContent = node.label ?? node.name ?? node.elementId ?? "Unnamed element";
    labelButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setActiveOutlineNode(node, { origin: "outline" });
    });
    row.appendChild(labelButton);

    if (node.kind) {
      const kind = document.createElement("span");
      kind.className = "outline-kind";
      kind.textContent = node.kind;
      row.appendChild(kind);
    }

    row.addEventListener("click", () => {
      setActiveOutlineNode(node, { origin: "outline" });
    });

    li.appendChild(row);

    if (node.children.length > 0) {
      if (!node.expanded) {
        for (const child of node.children) {
          child.parent = node;
        }
      } else {
        const childrenList = document.createElement("ul");
        childrenList.className = "outline-children";
        for (const child of node.children) {
          child.parent = node;
          childrenList.appendChild(renderOutlineNode(child));
        }
        li.appendChild(childrenList);
      }
    }

    return li;
  }

  function setActiveOutlineNode(node, options = {}) {
    if (!node) {
      clearOutlineSelection();
      return;
    }

    ensureNodeVisible(node);

    if (activeOutlineNode !== node) {
      activeOutlineNode = node;
      renderOutlineTree();
    }

    if (node.range) {
      const scroll = options.origin !== "editor";
      const updateCursor = options.origin === "outline" || options.origin === "api";
      highlightEditorRange(node.range, { scroll, updateCursor });
    } else {
      clearRangeMarker();
    }
  }

  function highlightEditorRange(range, { scroll = true, updateCursor = false } = {}) {
    if (!range) {
      clearRangeMarker();
      return;
    }

    const clamped = clampRangeToDocument(range);
    clearRangeMarker();
    outlineRangeMarker = cm.markText(clamped.start, clamped.end, {
      className: "cm-outline-range",
      clearOnEnter: false,
    });

    if (updateCursor) {
      suppressCursorSync = true;
      cm.setCursor(clamped.start);
    }

    if (scroll) {
      cm.scrollIntoView({ from: clamped.start, to: clamped.end }, 80);
    }
  }

  function clearRangeMarker() {
    if (outlineRangeMarker) {
      outlineRangeMarker.clear();
      outlineRangeMarker = null;
    }
  }

  function clearOutlineSelection() {
    if (activeOutlineNode) {
      activeOutlineNode = null;
      renderOutlineTree();
    }
    clearRangeMarker();
  }

  function ensureNodeVisible(node) {
    let current = node?.parent;
    while (current) {
      if (!current.expanded) {
        current.expanded = true;
      }
      current = current.parent;
    }
  }

  function clampRangeToDocument(range) {
    const lastLine = Math.max(0, cm.lineCount() - 1);

    const clampLine = (line) => Math.min(Math.max(line, 0), lastLine);
    const clampCh = (line, ch) => {
      const text = cm.getLine(line) ?? "";
      return Math.min(Math.max(ch, 0), text.length);
    };

    let startLine = clampLine(range.start.line);
    let startCh = clampCh(startLine, range.start.ch);
    let endLine = clampLine(range.end.line);
    let endCh = clampCh(endLine, range.end.ch);

    if (comparePositions({ line: startLine, ch: startCh }, { line: endLine, ch: endCh }) >= 0) {
      endLine = startLine;
      endCh = clampCh(endLine, startCh + 1);
    }

    return {
      start: { line: startLine, ch: startCh },
      end: { line: endLine, ch: endCh },
    };
  }

  function findNodeForCursor(position, nodes) {
    for (const node of nodes) {
      if (node.range && isPositionInRange(position, node.range)) {
        const descendant = findNodeForCursor(position, node.children ?? []);
        return descendant ?? node;
      }

      const childMatch = findNodeForCursor(position, node.children ?? []);
      if (childMatch) {
        return childMatch;
      }
    }
    return null;
  }

  function comparePositions(a, b) {
    if (a.line < b.line) return -1;
    if (a.line > b.line) return 1;
    if (a.ch < b.ch) return -1;
    if (a.ch > b.ch) return 1;
    return 0;
  }

  function isPositionInRange(position, range) {
    return comparePositions(position, range.start) >= 0 && comparePositions(position, range.end) <= 0;
  }

  function markOutlineOutOfSync() {
    if (outlineMode !== "api" || outlineOutOfSync) {
      return;
    }
    outlineOutOfSync = true;
    setOutlineStatus(
      "Editor content has changed; API-derived ranges may no longer align until the outline is reloaded.",
      "warning",
    );
  }

  function normalizeApiConfig(config) {
    return {
      baseUrl: trimTrailingSlash(config.baseUrl),
      projectId: config.projectId,
      commitId: config.commitId,
      elementId: config.elementId,
      token: config.token,
    };
  }

  function trimTrailingSlash(url) {
    return url.endsWith("/") ? url.replace(/\/+$/, "") : url;
  }

  function buildElementUrl(config, elementId) {
    const base = trimTrailingSlash(config.baseUrl);
    return `${base}/projects/${encodeURIComponent(config.projectId)}/commits/${encodeURIComponent(config.commitId)}/elements/${encodeURIComponent(elementId)}`;
  }

  async function fetchElement(config, elementId) {
    const url = buildElementUrl(config, elementId);
    const payload = await fetchFromApi(url, config.token);
    if (!payload) {
      return null;
    }
    if (payload.data) {
      return payload.data;
    }
    if (payload.element) {
      return payload.element;
    }
    return payload;
  }

  async function fetchOwnedElements(config, elementId) {
    const url = `${buildElementUrl(config, elementId)}/ownedElements`;
    const payload = await fetchFromApi(url, config.token);
    if (!payload) {
      return [];
    }
    if (Array.isArray(payload)) {
      return payload;
    }
    if (Array.isArray(payload.items)) {
      return payload.items;
    }
    if (Array.isArray(payload.elements)) {
      return payload.elements;
    }
    if (Array.isArray(payload.data)) {
      return payload.data;
    }
    if (Array.isArray(payload.ownedElements)) {
      return payload.ownedElements;
    }
    return [];
  }

  async function fetchFromApi(url, token) {
    const headers = { Accept: "application/json" };
    if (token) {
      headers.Authorization = formatAuthorizationToken(token);
    }

    let response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      throw new Error(
        error instanceof Error ? `Network error while contacting the SysML API: ${error.message}` : "Network error while contacting the SysML API.",
      );
    }

    const text = await response.text();

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      if (text) {
        try {
          const parsed = JSON.parse(text);
          message = pickString(parsed.message, parsed.error, parsed.title, message) ?? message;
        } catch (error) {
          // ignore JSON parse failure for error response
        }
      }
      throw new Error(message);
    }

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("Failed to parse API response as JSON.");
    }
  }

  function formatAuthorizationToken(token) {
    if (!token) {
      return token;
    }
    return /^Bearer\s/i.test(token) ? token : `Bearer ${token}`;
  }

  function extractElementId(value) {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    if (typeof value.elementId === "string") {
      return value.elementId;
    }
    if (typeof value.id === "string") {
      return value.id;
    }
    if (typeof value.sysmlId === "string") {
      return value.sysmlId;
    }
    if (typeof value["@id"] === "string") {
      return value["@id"];
    }
    if (value.data) {
      return extractElementId(value.data);
    }
    if (value.element) {
      return extractElementId(value.element);
    }
    return undefined;
  }

  function readApiConfigFromInputs() {
    const baseUrl = apiUrlInput?.value.trim();
    const projectId = projectIdInput?.value.trim();
    const commitId = commitIdInput?.value.trim();
    const elementId = elementIdInput?.value.trim();
    const token = tokenInput?.value.trim();

    if (!baseUrl || !projectId || !commitId || !elementId) {
      return null;
    }

    return {
      baseUrl,
      projectId,
      commitId,
      elementId,
      token: token || undefined,
    };
  }

  function applyConfigToInputs(config) {
    if (!config) return;
    if (config.baseUrl && apiUrlInput) apiUrlInput.value = config.baseUrl;
    if (config.projectId && projectIdInput) projectIdInput.value = config.projectId;
    if (config.commitId && commitIdInput) commitIdInput.value = config.commitId;
    if (config.elementId && elementIdInput) elementIdInput.value = config.elementId;
    if (config.token && tokenInput) tokenInput.value = config.token;
  }

  function persistApiConfig(config) {
    if (!window.localStorage) {
      return;
    }
    try {
      const { token, ...rest } = config;
      localStorage.setItem(OUTLINE_STORAGE_KEY, JSON.stringify(rest));
    } catch (error) {
      console.warn("Failed to persist outline configuration", error);
    }
  }

  function readStoredConfig() {
    if (!window.localStorage) {
      return null;
    }
    try {
      const raw = localStorage.getItem(OUTLINE_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw);
    } catch (error) {
      console.warn("Failed to read stored outline configuration", error);
      return null;
    }
  }

  function readApiConfigFromQuery() {
    try {
      const params = new URLSearchParams(window.location.search);
      const baseUrl = pickString(params.get("api"), params.get("apiUrl"));
      const projectId = pickString(params.get("project"), params.get("projectId"));
      const commitId = pickString(params.get("commit"), params.get("commitId"));
      const elementId = pickString(params.get("element"), params.get("elementId"));
      const token = pickString(params.get("token"), params.get("bearer"));

      if (baseUrl && projectId && commitId && elementId) {
        return {
          baseUrl,
          projectId,
          commitId,
          elementId,
          token: token ?? undefined,
        };
      }
      return null;
    } catch (error) {
      console.warn("Failed to parse outline configuration from query string", error);
      return null;
    }
  }

  function initializeOutlineConfig() {
    const stored = readStoredConfig();
    if (stored) {
      applyConfigToInputs(stored);
    }

    const fromQuery = readApiConfigFromQuery();
    if (fromQuery) {
      applyConfigToInputs(fromQuery);
      const config = readApiConfigFromInputs();
      if (config) {
        setOutlineStatus("Loading outline from API…", "note");
        loadOutlineFromApi(config)
          .then(() => {
            currentApiConfig = config;
            outlineOutOfSync = false;
          })
          .catch((error) => {
            console.error("Failed to auto-load outline", error);
            const message = error instanceof Error ? error.message : String(error);
            setOutlineStatus(`Failed to load outline: ${message}`, "error");
          });
      }
    }
  }

  function validate(content) {
    const diagnostics = [];
    const stack = [];
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (/^(package|interface|action|constraint|state|view|viewpoint|requirement)\b/i.test(trimmed)) {
        const keyword = trimmed.split(/\s+/)[0];
        stack.push({ keyword, line: index + 1 });
      }
      if (/^end\b/i.test(trimmed)) {
        const scope = stack.pop();
        if (!scope) {
          diagnostics.push(`Line ${index + 1}: unexpected 'end'.`);
        }
      }
    });

    for (const scope of stack.reverse()) {
      diagnostics.push(`Line ${scope.line}: '${scope.keyword}' has no matching 'end'.`);
    }

    const unclosedBraces = (content.match(/\{/g) || []).length - (content.match(/\}/g) || []).length;
    if (unclosedBraces > 0) {
      diagnostics.push(`${unclosedBraces} unmatched '{' detected.`);
    } else if (unclosedBraces < 0) {
      diagnostics.push(`${Math.abs(unclosedBraces)} unmatched '}' detected.`);
    }

    return diagnostics;
  }

  function debounce(fn, delay) {
    let handle;
    return function () {
      clearTimeout(handle);
      handle = setTimeout(fn, delay);
    };
  }
})();
