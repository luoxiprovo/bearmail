import { Folder } from "lucide-react";
import type { Mailbox } from "../types";

export function FolderPicker({
  folders,
  onPick,
  disabled,
}: {
  folders: Mailbox[];
  onPick(id: string): void;
  disabled?: boolean;
}) {
  if (!folders.length) return null;
  return (
    <label className="folder-picker">
      <Folder size={16} />
      <select
        aria-label="Add to folder"
        value=""
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => {
          const id = event.target.value;
          if (id) onPick(id);
        }}
      >
        <option value="">Add to folder</option>
        {folders.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
      </select>
    </label>
  );
}
