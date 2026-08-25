import { forwardRef, useEffect, useImperativeHandle, useRef, type KeyboardEvent, type ReactNode } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Highlighter, Image as ImageIcon,
  IndentDecrease, IndentIncrease, Italic, Link2, List, ListOrdered, RemoveFormatting,
  Strikethrough, Underline,
} from "lucide-react";
import { fileToCompressedDataUrl, sanitizeComposeHtml } from "../richtext";

const FONTS = ["Arial", "Georgia", "Times New Roman", "Courier New", "Verdana", "system-ui"];
const SIZES = [
  { label: "Small", value: "2" },
  { label: "Normal", value: "3" },
  { label: "Large", value: "5" },
  { label: "Huge", value: "7" },
];

export interface RichTextEditorHandle {
  insertImage(file: File): Promise<void>;
}

interface Props {
  value: string;
  onChange(html: string): void;
  placeholder?: string;
  "aria-label"?: string;
  className?: string;
  compact?: boolean;
  onInsertImage?: (file: File) => Promise<string> | string;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor({
  value,
  onChange,
  placeholder = "Start writing…",
  "aria-label": ariaLabel = "Message body",
  className = "",
  compact = false,
  onInsertImage,
}, ref) {
  const editor = useRef<HTMLDivElement>(null);
  const synced = useRef("");
  const colorInput = useRef<HTMLInputElement>(null);
  const highlightInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editor.current || value === synced.current) return;
    editor.current.innerHTML = value || "";
    synced.current = value;
  }, [value]);

  const emit = () => {
    const html = sanitizeComposeHtml(editor.current?.innerHTML ?? "");
    synced.current = html;
    onChange(html);
  };

  const run = (command: string, argument?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, argument);
    emit();
  };

  const addLink = () => {
    const url = window.prompt("Link address", "https://");
    if (!url?.trim()) return;
    run("createLink", url.trim());
  };

  const insertPicture = async (file: File) => {
    try {
      const src = onInsertImage ? await onInsertImage(file) : await fileToCompressedDataUrl(file, 720, 0.72);
      run("insertImage", src);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "The picture could not be added.");
    }
  };

  useImperativeHandle(ref, () => ({ insertImage: insertPicture }));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") { event.preventDefault(); run("bold"); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "i") { event.preventDefault(); run("italic"); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "u") { event.preventDefault(); run("underline"); }
  };

  return (
    <div className={`richtext ${compact ? "compact" : ""} ${className}`.trim()}>
      <div className="richtext-toolbar" role="toolbar" aria-label="Text formatting">
        <select aria-label="Font" defaultValue="Arial" onChange={(event) => run("fontName", event.target.value)}>
          {FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
        </select>
        <select aria-label="Text size" defaultValue="3" onChange={(event) => run("fontSize", event.target.value)}>
          {SIZES.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}
        </select>
        <span className="richtext-sep" />
        <ToolbarButton label="Bold" onClick={() => run("bold")}><Bold size={15} /></ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => run("italic")}><Italic size={15} /></ToolbarButton>
        <ToolbarButton label="Underline" onClick={() => run("underline")}><Underline size={15} /></ToolbarButton>
        <ToolbarButton label="Strikethrough" onClick={() => run("strikeThrough")}><Strikethrough size={15} /></ToolbarButton>
        <ToolbarButton label="Text color" onClick={() => colorInput.current?.click()}><span className="color-swatch" /></ToolbarButton>
        <ToolbarButton label="Highlight" onClick={() => highlightInput.current?.click()}><Highlighter size={15} /></ToolbarButton>
        <input ref={colorInput} type="color" aria-label="Text color value" hidden onChange={(event) => run("foreColor", event.target.value)} />
        <input ref={highlightInput} type="color" defaultValue="#fff3bf" aria-label="Highlight color value" hidden onChange={(event) => run("hiliteColor", event.target.value)} />
        <span className="richtext-sep" />
        <ToolbarButton label="Align left" onClick={() => run("justifyLeft")}><AlignLeft size={15} /></ToolbarButton>
        <ToolbarButton label="Align center" onClick={() => run("justifyCenter")}><AlignCenter size={15} /></ToolbarButton>
        <ToolbarButton label="Align right" onClick={() => run("justifyRight")}><AlignRight size={15} /></ToolbarButton>
        <ToolbarButton label="Justify" onClick={() => run("justifyFull")}><AlignJustify size={15} /></ToolbarButton>
        <span className="richtext-sep" />
        <ToolbarButton label="Bulleted list" onClick={() => run("insertUnorderedList")}><List size={15} /></ToolbarButton>
        <ToolbarButton label="Numbered list" onClick={() => run("insertOrderedList")}><ListOrdered size={15} /></ToolbarButton>
        <ToolbarButton label="Decrease indent" onClick={() => run("outdent")}><IndentDecrease size={15} /></ToolbarButton>
        <ToolbarButton label="Increase indent" onClick={() => run("indent")}><IndentIncrease size={15} /></ToolbarButton>
        <span className="richtext-sep" />
        <ToolbarButton label="Insert link" onClick={addLink}><Link2 size={15} /></ToolbarButton>
        <ToolbarButton label="Insert picture" onClick={() => imageInput.current?.click()}><ImageIcon size={15} /></ToolbarButton>
        <ToolbarButton label="Clear formatting" onClick={() => run("removeFormat")}><RemoveFormatting size={15} /></ToolbarButton>
        <input ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertPicture(file);
        }} />
      </div>
      <div
        ref={editor}
        className="richtext-editor"
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        aria-placeholder={placeholder}
        contentEditable
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        onKeyDown={onKeyDown}
        suppressContentEditableWarning
      />
    </div>
  );
});

function ToolbarButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return <button type="button" className="richtext-button" aria-label={label} title={label} onMouseDown={(event) => event.preventDefault()} onClick={onClick}>{children}</button>;
}
