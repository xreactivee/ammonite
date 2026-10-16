import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { closeMenu, useStore } from "../lib/store";

export default function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(menu.x, window.innerWidth - r.width - 6),
      y: Math.min(menu.y, window.innerHeight - r.height - 6),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeMenu();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", closeMenu);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="panel fixed z-[9500] min-w-[210px] rounded-lg p-1 text-[13px] animate-fade"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
        item === "sep" ? (
          <div key={i} className="mx-1 my-1 h-px bg-ink-700" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              closeMenu();
              item.onClick();
            }}
            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left disabled:opacity-35 ${
              item.danger ? "text-danger hover:bg-danger/10" : "hover:bg-ink-800"
            }`}
          >
            {item.icon ? <item.icon className="size-4 opacity-80" /> : <span className="size-4" />}
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="font-mono text-[11px] opacity-50">{item.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
