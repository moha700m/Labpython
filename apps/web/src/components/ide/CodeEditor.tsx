"use client";
import { useEffect, useRef } from "react";
import Editor, { loader, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { Diagnostic } from "@mcs/shared";
import { languageForPath } from "@mcs/shared";

// Self-hosted Monaco (copied to /public/monaco by scripts/copy-monaco.mjs). No CDN at runtime.
loader.config({ paths: { vs: "/monaco/vs" } });

let providersRegistered = false;

const CPP_SNIPPETS: { label: string; insert: string; doc: string }[] = [
  { label: "main", insert: "int main() {\n\t$0\n\treturn 0;\n}", doc: "الدالة الرئيسية" },
  { label: "cout", insert: "std::cout << $1 << '\\n';", doc: "طباعة إلى الشاشة" },
  { label: "cin", insert: "std::cin >> $1;", doc: "قراءة من لوحة المفاتيح" },
  { label: "getline", insert: "std::getline(std::cin, ${1:line});", doc: "قراءة سطر كامل" },
  { label: "for", insert: "for (int ${1:i} = 0; $1 < ${2:n}; ++$1) {\n\t$0\n}", doc: "حلقة for" },
  { label: "forr", insert: "for (const auto& ${1:x} : ${2:items}) {\n\t$0\n}", doc: "حلقة على عناصر حاوية" },
  { label: "while", insert: "while (${1:condition}) {\n\t$0\n}", doc: "حلقة while" },
  { label: "if", insert: "if (${1:condition}) {\n\t$0\n}", doc: "شرط" },
  { label: "class", insert: "class ${1:Name} {\npublic:\n\t$1();\n\t~$1();\n\nprivate:\n\t$0\n};", doc: "صنف (class)" },
  { label: "struct", insert: "struct ${1:Name} {\n\t$0\n};", doc: "بنية (struct)" },
  { label: "vector", insert: "std::vector<${1:int}> ${2:v};", doc: "مصفوفة ديناميكية" },
  { label: "map", insert: "std::map<${1:std::string}, ${2:int}> ${3:m};", doc: "قاموس مرتّب" },
  { label: "unique_ptr", insert: "auto ${1:p} = std::make_unique<${2:T}>($0);", doc: "مؤشر ذكي" },
  { label: "lambda", insert: "auto ${1:fn} = [${2:&}](${3}) {\n\t$0\n};", doc: "دالة لامدا" },
  { label: "try", insert: "try {\n\t$1\n} catch (const std::exception& e) {\n\tstd::cerr << e.what() << '\\n';\n}", doc: "معالجة استثناء" },
  { label: "#include", insert: "#include <${1:iostream}>", doc: "تضمين ملف ترويسة" },
  { label: "#pragma once", insert: "#pragma once", doc: "حماية ملف الترويسة" },
];
const STD_NAMES = [
  "std::cout", "std::cin", "std::cerr", "std::endl", "std::string", "std::string_view", "std::vector", "std::array", "std::map", "std::unordered_map",
  "std::set", "std::unordered_set", "std::pair", "std::tuple", "std::optional", "std::variant", "std::function", "std::thread", "std::mutex",
  "std::unique_ptr", "std::shared_ptr", "std::make_unique", "std::make_shared", "std::move", "std::sort", "std::find", "std::accumulate",
  "std::transform", "std::ranges::sort", "std::format", "std::println", "std::span", "std::chrono::steady_clock", "std::filesystem::path",
  "std::to_string", "std::stoi", "std::stod", "std::size_t", "std::int64_t", "std::uint8_t",
];
const HEADERS = ["iostream", "string", "vector", "map", "unordered_map", "set", "algorithm", "numeric", "memory", "optional", "variant", "functional", "thread", "mutex", "chrono", "fstream", "sstream", "iomanip", "cmath", "cstdint", "array", "span", "ranges", "format", "print", "filesystem", "windows.h"];

function registerProviders(monaco: Monaco) {
  if (providersRegistered) return;
  providersRegistered = true;
  for (const lang of ["cpp", "c"]) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: [":", "<", "#"],
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position);
        const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        const lineText = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
        const suggestions: import("monaco-editor").languages.CompletionItem[] = [];
        if (/#include\s*<\w*$/.test(lineText)) {
          for (const h of HEADERS) suggestions.push({ label: h, kind: monaco.languages.CompletionItemKind.File, insertText: h, range });
          return { suggestions };
        }
        for (const s of CPP_SNIPPETS)
          suggestions.push({ label: s.label, kind: monaco.languages.CompletionItemKind.Snippet, insertText: s.insert, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, documentation: s.doc, range });
        for (const n of STD_NAMES) {
          const short = n.replace(/^std::/, "");
          const typedStd = /std::\w*$/.test(lineText);
          suggestions.push({ label: n, kind: monaco.languages.CompletionItemKind.Class, insertText: typedStd ? short : n, filterText: typedStd ? short : n, range });
        }
        // Identifiers already present in the file.
        const seen = new Set<string>();
        for (const m of model.getValue().matchAll(/\b([A-Za-z_]\w{2,})\b/g)) {
          const id = m[1]!;
          if (seen.has(id) || seen.size > 400) continue;
          seen.add(id);
          suggestions.push({ label: id, kind: monaco.languages.CompletionItemKind.Variable, insertText: id, range });
        }
        return { suggestions };
      },
    });
  }
  // Quick fixes from our Arabic suggestions (shown in the lightbulb menu).
  monaco.languages.registerCodeActionProvider("cpp", {
    provideCodeActions(model, _range, context) {
      const actions: import("monaco-editor").languages.CodeAction[] = [];
      for (const marker of context.markers) {
        const missing = /#include (<[^>]+>)/.exec(marker.message);
        if (missing) {
          actions.push({
            title: `أضف ‎#include ${missing[1]}‎`,
            kind: "quickfix",
            diagnostics: [marker],
            isPreferred: true,
            edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: `#include ${missing[1]}\n` } }] },
          });
        }
        if (/فاصلة منقوطة/.test(marker.message)) {
          const prev = Math.max(1, marker.startLineNumber - 1);
          const line = model.getLineContent(prev);
          actions.push({
            title: "أضف ; في نهاية السطر السابق",
            kind: "quickfix",
            diagnostics: [marker],
            edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: { startLineNumber: prev, startColumn: line.length + 1, endLineNumber: prev, endColumn: line.length + 1 }, text: ";" } }] },
          });
        }
      }
      return { actions, dispose() {} };
    },
  });
}

export interface CodeEditorHandle {
  editor: MonacoEditor.IStandaloneCodeEditor | null;
  monaco: Monaco | null;
}

export function CodeEditor({
  path,
  value,
  onChange,
  diagnostics,
  theme,
  beginner,
  onSave,
  onBuild,
  onRun,
  onFormat,
  handleRef,
}: {
  path: string;
  value: string;
  onChange: (v: string) => void;
  diagnostics: Diagnostic[];
  theme: "dark" | "light";
  beginner: boolean;
  onSave: () => void;
  onBuild: () => void;
  onRun: () => void;
  onFormat: () => void;
  handleRef?: React.MutableRefObject<CodeEditorHandle>;
}) {
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const actions = useRef({ onSave, onBuild, onRun, onFormat });
  actions.current = { onSave, onBuild, onRun, onFormat };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    if (handleRef) handleRef.current = { editor, monaco };
    registerProviders(monaco);
    monaco.editor.defineTheme("mcs-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "f2b33d" },
        { token: "string", foreground: "8bd49c" },
        { token: "number", foreground: "f39c6b" },
        { token: "comment", foreground: "5d6f82", fontStyle: "italic" },
        { token: "type", foreground: "38d6b6" },
      ],
      colors: { "editor.background": "#0d1218", "editorLineNumber.foreground": "#3b4a5c", "editor.lineHighlightBackground": "#151d26", "editorGutter.background": "#0d1218" },
    });
    monaco.editor.defineTheme("mcs-light", { base: "vs", inherit: true, rules: [{ token: "keyword", foreground: "a0610f" }], colors: { "editor.background": "#fbf9f4" } });
    monaco.editor.setTheme(theme === "dark" ? "mcs-dark" : "mcs-light");
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => actions.current.onSave());
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB, () => actions.current.onBuild());
    editor.addCommand(monaco.KeyCode.F5, () => actions.current.onRun());
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => actions.current.onFormat());
  };

  useEffect(() => {
    monacoRef.current?.editor.setTheme(theme === "dark" ? "mcs-dark" : "mcs-light");
  }, [theme]);

  // Compiler diagnostics → inline markers (with Arabic explanation in the hover).
  useEffect(() => {
    const monaco = monacoRef.current;
    const model = editorRef.current?.getModel();
    if (!monaco || !model) return;
    const markers = diagnostics
      .filter((d) => d.file === path && d.line > 0)
      .map((d) => ({
        severity: d.severity === "error" ? monaco.MarkerSeverity.Error : d.severity === "warning" ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info,
        startLineNumber: d.line,
        startColumn: d.column || 1,
        endLineNumber: d.line,
        endColumn: model.getLineMaxColumn(Math.min(d.line, model.getLineCount())),
        message: d.message + (d.explanationAr ? `\n\n${d.explanationAr}` : "") + (d.suggestionAr ? `\n💡 ${d.suggestionAr}` : ""),
        source: "compiler",
      }));
    monaco.editor.setModelMarkers(model, "compiler", markers);
  }, [diagnostics, path, value]);

  return (
    <div className="h-full" dir="ltr">
      <Editor
        path={path}
        value={value}
        language={languageForPath(path)}
        onChange={(v) => onChange(v ?? "")}
        onMount={onMount}
        keepCurrentModel
        theme={theme === "dark" ? "vs-dark" : "vs"}
        loading={<div className="p-4 text-sm text-ink-3">تحميل المحرر…</div>}
        options={{
          fontFamily: "var(--font-code), monospace",
          fontSize: beginner ? 15 : 14,
          fontLigatures: true,
          minimap: { enabled: !beginner },
          lineNumbers: "on",
          renderWhitespace: beginner ? "none" : "selection",
          tabSize: 4,
          insertSpaces: true,
          automaticLayout: true,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          wordWrap: "off",
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true },
          quickSuggestions: { other: true, comments: false, strings: false },
          suggestOnTriggerCharacters: true,
          lightbulb: { enabled: "on" as never },
          padding: { top: 8 },
        }}
      />
    </div>
  );
}
