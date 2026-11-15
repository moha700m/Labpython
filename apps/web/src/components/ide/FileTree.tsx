"use client";
import { useMemo, useState } from "react";
import { ChevronDown, FileCode2, FilePlus2, FileText, Folder, FolderUp, Pencil, Trash2, Upload } from "lucide-react";
import type { FileEntry } from "@/lib/api";

interface Node {
  name: string;
  path: string;
  dir: boolean;
  children: Node[];
}

function buildTree(files: FileEntry[]): Node[] {
  const root: Node = { name: "", path: "", dir: true, children: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let cur = root;
    parts.forEach((p, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join("/");
      let next = cur.children.find((c) => c.name === p && c.dir === !isFile);
      if (!next) {
        next = { name: p, path, dir: !isFile, children: [] };
        cur.children.push(next);
      }
      cur = next;
    });
  }
  const sort = (n: Node) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

const isCode = (p: string) => /\.(c|cc|cpp|cxx|h|hh|hpp|hxx|inl)$/i.test(p);

export function FileTree({
  files,
  active,
  dirty,
  diagCount,
  onOpen,
  onCreate,
  onDelete,
  onRename,
  onUploadFiles,
  onUploadFolder,
}: {
  files: FileEntry[];
  active: string | null;
  dirty: Set<string>;
  diagCount: Record<string, number>;
  onOpen: (p: string) => void;
  onCreate: (p: string) => void;
  onDelete: (p: string) => void;
  onRename: (from: string, to: string) => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggle = (p: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const render = (nodes: Node[], depth: number): React.ReactNode =>
    nodes.map((n) => (
      <li key={n.path}>
        <div
          className={`group flex cursor-pointer items-center gap-1.5 rounded-md py-1 pe-1 text-[13px] ${active === n.path ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-surface-3"}`}
          style={{ paddingInlineStart: 8 + depth * 14 }}
          onClick={() => (n.dir ? toggle(n.path) : onOpen(n.path))}
          role="treeitem"
          aria-selected={active === n.path}
          aria-expanded={n.dir ? !collapsed.has(n.path) : undefined}
        >
          {n.dir ? (
            <>
              <ChevronDown size={13} className={`shrink-0 transition ${collapsed.has(n.path) ? "rtl:rotate-90 ltr:-rotate-90" : ""}`} />
              <Folder size={14} className="shrink-0 text-accent" />
            </>
          ) : isCode(n.path) ? (
            <FileCode2 size={14} className="ms-[19px] shrink-0 text-teal" />
          ) : (
            <FileText size={14} className="ms-[19px] shrink-0 text-ink-3" />
          )}
          <span className="truncate font-mono" dir="ltr">
            {n.name}
          </span>
          {dirty.has(n.path) && <span className="size-1.5 shrink-0 rounded-full bg-accent" title="غير محفوظ" />}
          {!!diagCount[n.path] && <span className="rounded bg-danger/15 px-1 text-[10px] text-danger">{diagCount[n.path]}</span>}
          {!n.dir && (
            <span className="ms-auto hidden gap-0.5 group-hover:flex">
              <button
                className="rounded p-0.5 hover:bg-surface-2"
                title="إعادة تسمية"
                aria-label={`إعادة تسمية ${n.path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  const to = prompt("الاسم الجديد (المسار كاملاً):", n.path);
                  if (to && to !== n.path) onRename(n.path, to);
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="rounded p-0.5 text-danger hover:bg-surface-2"
                title="حذف"
                aria-label={`حذف ${n.path}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`حذف ${n.path}؟`)) onDelete(n.path);
                }}
              >
                <Trash2 size={12} />
              </button>
            </span>
          )}
        </div>
        {n.dir && !collapsed.has(n.path) && <ul role="group">{render(n.children, depth + 1)}</ul>}
      </li>
    ));

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-xs font-semibold tracking-wide text-ink-3">ملفات المشروع</span>
        <div className="flex gap-0.5">
          <button
            className="btn btn-ghost px-1.5 py-1"
            title="ملف جديد"
            aria-label="ملف جديد"
            onClick={() => {
              const p = prompt("اسم الملف الجديد (مثال: src/utils.cpp أو include/utils.hpp):");
              if (p) onCreate(p);
            }}
          >
            <FilePlus2 size={15} />
          </button>
          <button className="btn btn-ghost px-1.5 py-1" title="رفع ملفات أو ZIP" aria-label="رفع ملفات" onClick={onUploadFiles}>
            <Upload size={15} />
          </button>
          <button className="btn btn-ghost px-1.5 py-1" title="رفع مجلد" aria-label="رفع مجلد" onClick={onUploadFolder}>
            <FolderUp size={15} />
          </button>
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto p-1.5 scroll-thin" role="tree" aria-label="ملفات المشروع">
        {render(tree, 0)}
      </ul>
    </div>
  );
}
