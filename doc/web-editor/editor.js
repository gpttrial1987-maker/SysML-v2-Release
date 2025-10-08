(function () {
  const editorElement = document.getElementById("editor");
  const outlineElement = document.getElementById("outline");
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

  cm.setValue(defaultTemplate);
  updateOutline(defaultTemplate);
  showValidation();

  document.getElementById("btn-new").addEventListener("click", () => {
    if (cm.getValue().trim().length === 0 || confirm("Discard current model?")) {
      cm.setValue("");
      cm.focus();
    }
  });

  document.getElementById("btn-insert").addEventListener("click", () => {
    const current = cm.getValue();
    if (current.trim().length === 0) {
      cm.setValue(defaultTemplate);
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
    updateOutline(content);
    debouncedValidation();
  });

  fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    cm.setValue(text);
    cm.focus();
    updateOutline(text);
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

  function updateOutline(content) {
    const outline = buildOutline(content);
    outlineElement.innerHTML = "";
    if (outline.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "No structural elements detected.";
      empty.className = "empty";
      outlineElement.appendChild(empty);
      return;
    }

    for (const item of outline) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item.name;
      const kind = document.createElement("span");
      kind.textContent = item.kind;
      kind.className = "kind";
      li.appendChild(name);
      li.appendChild(kind);
      li.addEventListener("click", () => {
        cm.setCursor({ line: item.line, ch: 0 });
        cm.focus();
      });
      outlineElement.appendChild(li);
    }
  }

  function buildOutline(content) {
    const outline = [];
    const regex = /^(\s*)(package|part|interface|action|state|transition|constraint|requirement|view|viewpoint|usecase)\s+([A-Za-z0-9_:]+)/i;
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const match = line.match(regex);
      if (match) {
        outline.push({
          line: index,
          indent: match[1].length,
          kind: match[2],
          name: match[3],
        });
      }
    });
    return outline;
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
