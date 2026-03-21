import { useState, useRef, useEffect } from "react";

interface Props {
  fileName: string;
  onRename: (newName: string) => void;
}

export function EditableFileName({ fileName, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    const val = inputRef.current?.value.trim();
    if (val && val !== fileName) {
      onRename(val);
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="filename-input"
        defaultValue={fileName}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <h1 className="filename" onClick={() => setEditing(true)} title="Click to rename">
      {fileName}
    </h1>
  );
}
