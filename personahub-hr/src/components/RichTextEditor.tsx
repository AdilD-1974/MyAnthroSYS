// ============================================================
// RichTextEditor.tsx — src/components/RichTextEditor.tsx
// Éditeur riche (TipTap) : gras, italique, souligné, barré,
// titres, listes à puces / numérotées, citation, tableaux.
// ------------------------------------------------------------
// Installation requise :
//   npm install @tiptap/react @tiptap/pm @tiptap/starter-kit
//     @tiptap/extension-underline @tiptap/extension-placeholder
//     @tiptap/extension-table @tiptap/extension-table-row
//     @tiptap/extension-table-cell @tiptap/extension-table-header
// ============================================================

import React from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Quote, Table as TableIcon, Heading2,
  Undo2, Redo2, Trash2, Rows3, Columns3,
} from "lucide-react";

// ── Classes tokenisées (cohérentes avec le design system) ────
const C = {
  border: "border-[hsl(var(--border))]",
  bg: "bg-[hsl(var(--background))]",
  fg: "text-[hsl(var(--foreground))]",
  muted: "text-[hsl(var(--muted-foreground))]",
  accent: "hover:bg-[hsl(var(--accent))]",
  active: "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]",
};

interface RichTextEditorProps {
  value: string;                 // HTML stocké
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;            // px
  readOnly?: boolean;
}

function ToolbarButton({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void; active?: boolean; disabled?: boolean;
  title: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? C.active : `${C.fg} ${C.accent}`
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const dansTableau = editor.isActive("table");

  return (
    <div className={`flex items-center gap-0.5 flex-wrap p-1.5 border-b ${C.border}`}>
      <ToolbarButton title="Gras (Ctrl+B)" active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold size={15} />
      </ToolbarButton>
      <ToolbarButton title="Italique (Ctrl+I)" active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic size={15} />
      </ToolbarButton>
      <ToolbarButton title="Souligné (Ctrl+U)" active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon size={15} />
      </ToolbarButton>
      <ToolbarButton title="Barré" active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough size={15} />
      </ToolbarButton>

      <span className={`w-px h-5 mx-1 ${C.border} border-l`} />

      <ToolbarButton title="Titre" active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={15} />
      </ToolbarButton>
      <ToolbarButton title="Liste à puces" active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List size={15} />
      </ToolbarButton>
      <ToolbarButton title="Liste numérotée" active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </ToolbarButton>
      <ToolbarButton title="Citation" active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote size={15} />
      </ToolbarButton>

      <span className={`w-px h-5 mx-1 ${C.border} border-l`} />

      {!dansTableau ? (
        <ToolbarButton title="Insérer un tableau"
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon size={15} />
        </ToolbarButton>
      ) : (
        <>
          <ToolbarButton title="Ajouter une ligne"
            onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Rows3 size={15} />
          </ToolbarButton>
          <ToolbarButton title="Ajouter une colonne"
            onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Columns3 size={15} />
          </ToolbarButton>
          <ToolbarButton title="Supprimer le tableau"
            onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 size={15} />
          </ToolbarButton>
        </>
      )}

      <span className="flex-1" />

      <ToolbarButton title="Annuler (Ctrl+Z)" disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 size={15} />
      </ToolbarButton>
      <ToolbarButton title="Rétablir (Ctrl+Y)" disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 size={15} />
      </ToolbarButton>
    </div>
  );
}

export default function RichTextEditor({
  value, onChange, placeholder = "Détails, contexte…", minHeight = 140, readOnly = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Underline,
      Placeholder.configure({ placeholder }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value || "",
    editable: !readOnly,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "tiptap-content focus:outline-none",
      },
    },
  });

  // Synchroniser si la valeur change depuis l'extérieur (ex: chargement async)
  React.useEffect(() => {
    if (editor && value !== editor.getHTML() && document.activeElement?.closest(".tiptap-content") === null) {
      editor.commands.setContent(value || "", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  return (
    <div className={`rounded-lg border overflow-hidden ${C.border} ${C.bg}`}>
      {!readOnly && <Toolbar editor={editor} />}
      <div
        className="px-3 py-2 overflow-y-auto"
        style={{ minHeight, maxHeight: 400 }}
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent editor={editor} />
      </div>

      {/* Styles spécifiques au contenu édité (titres, listes, tableaux) */}
      <style>{`
        .tiptap-content { font-size: 0.875rem; line-height: 1.5; color: hsl(var(--foreground)); }
        .tiptap-content p { margin: 0.25rem 0; }
        .tiptap-content h2 { font-size: 1.05rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
        .tiptap-content h3 { font-size: 0.95rem; font-weight: 600; margin: 0.4rem 0 0.2rem; }
        .tiptap-content ul, .tiptap-content ol { padding-left: 1.25rem; margin: 0.25rem 0; }
        .tiptap-content ul { list-style: disc; }
        .tiptap-content ol { list-style: decimal; }
        .tiptap-content li { margin: 0.1rem 0; }
        .tiptap-content blockquote {
          border-left: 3px solid hsl(var(--border));
          padding-left: 0.75rem; margin: 0.5rem 0;
          color: hsl(var(--muted-foreground)); font-style: italic;
        }
        .tiptap-content table {
          border-collapse: collapse; width: 100%; margin: 0.5rem 0;
          font-size: 0.8125rem;
        }
        .tiptap-content th, .tiptap-content td {
          border: 1px solid hsl(var(--border)); padding: 4px 8px;
          text-align: left; min-width: 60px;
        }
        .tiptap-content th {
          background: hsl(var(--accent)); font-weight: 600;
        }
        .tiptap-content p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          float: left; pointer-events: none; height: 0;
        }
        .tiptap-content strong { font-weight: 600; }
      `}</style>
    </div>
  );
}

// ============================================================
// Lecture seule — pour afficher la description ailleurs
// (ex: carte Kanban, vue détail en mode lecture)
// ============================================================
export function RichTextViewer({ html }: { html: string }) {
  if (!html || html === "<p></p>") {
    return <p className={`text-sm italic ${C.muted}`}>Aucune description</p>;
  }
  return (
    <div
      className="tiptap-content text-sm"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
