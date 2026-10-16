import { useEffect, useRef, useState } from "react";
import { closeDialog, useStore } from "../lib/store";

export default function Dialog() {
  const dialog = useStore((s) => s.dialog);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    const v = dialog.input?.value ?? "";
    setValue(v);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const dot = v.lastIndexOf(".");
        if (dialog.input?.selectStem && dot > 0) el.setSelectionRange(0, dot);
        else el.select();
      } else {
        confirmRef.current?.focus();
      }
    });
  }, [dialog]);

  if (!dialog) return null;
  const confirm = () => closeDialog(dialog.input ? value : true);
  const cancel = () => closeDialog(dialog.input ? null : false);

  return (
    <div
      className="fixed inset-0 z-[9800] grid place-items-center bg-black/60 animate-fade"
      onPointerDown={(e) => e.target === e.currentTarget && cancel()}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
        if (e.key === "Enter" && dialog.input) confirm();
      }}
    >
      <div className="panel w-[440px] max-w-[92vw] rounded-xl p-5 animate-win-in">
        <h3 className={`font-display text-lg font-semibold ${dialog.danger ? "text-danger" : ""}`}>{dialog.title}</h3>
        {dialog.message && <p className="mt-2 text-[13px] leading-relaxed text-ink-300">{dialog.message}</p>}
        {dialog.detail && (
          <code className="mt-3 block rounded-lg border border-ink-700 bg-black p-2.5 font-mono text-[12px] break-all text-ink-100 select-text">
            {dialog.detail}
          </code>
        )}
        {dialog.input && (
          <input
            ref={inputRef}
            className="field mt-4 font-mono text-sm"
            type={dialog.input.password ? "password" : "text"}
            placeholder={dialog.input.placeholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            spellCheck={false}
          />
        )}
        <div className="mt-5 flex justify-end gap-2">
          {dialog.cancelLabel !== null && (
            <button className="btn" onClick={cancel}>
              {dialog.cancelLabel ?? "Vazgeç"}
            </button>
          )}
          <button ref={confirmRef} className={`btn ${dialog.danger ? "btn-danger" : "btn-primary"}`} onClick={confirm}>
            {dialog.confirmLabel ?? "Tamam"}
          </button>
        </div>
      </div>
    </div>
  );
}
