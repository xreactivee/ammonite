import { LoaderCircle, Minus, Plus, X, type LucideIcon } from "lucide-react";
import { memo, Suspense, useRef, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { REGISTRY } from "../apps/registry";
import { APPS } from "../lib/appMeta";
import { closeWin, DOCK_SPACE, focusWin, minimizeWin, patchWin, toggleMaxWin, TOP_BAR, type Win } from "../lib/store";

const MIN_W = 380;
const MIN_H = 240;
const EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;

const EDGE_CLASS: Record<(typeof EDGES)[number], string> = {
  n: "top-0 left-2 right-2 h-1.5 cursor-ns-resize",
  s: "bottom-0 left-2 right-2 h-1.5 cursor-ns-resize",
  e: "right-0 top-2 bottom-2 w-1.5 cursor-ew-resize",
  w: "left-0 top-2 bottom-2 w-1.5 cursor-ew-resize",
  ne: "top-0 right-0 size-3 cursor-nesw-resize",
  sw: "bottom-0 left-0 size-3 cursor-nesw-resize",
  nw: "top-0 left-0 size-3 cursor-nwse-resize",
  se: "bottom-0 right-0 size-3 cursor-nwse-resize",
};

function track(cursor: string, onMove: (dx: number, dy: number) => void, onEnd: () => void, e: RPointerEvent) {
  const sx = e.clientX;
  const sy = e.clientY;
  document.body.dataset.drag = "1";
  document.body.style.cursor = cursor;
  const move = (ev: PointerEvent) => onMove(ev.clientX - sx, ev.clientY - sy);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    delete document.body.dataset.drag;
    document.body.style.cursor = "";
    onEnd();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function Window({ win, focused }: { win: Win; focused: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const App = REGISTRY[win.app];
  const Icon = APPS[win.app].icon;

  function startMove(e: RPointerEvent) {
    if (e.button !== 0 || win.maximized || (e.target as HTMLElement).closest("button")) return;
    const el = ref.current!;
    let { x, y } = win;
    track(
      "grabbing",
      (dx, dy) => {
        x = Math.max(80 - win.w, Math.min(window.innerWidth - 80, win.x + dx));
        y = Math.max(TOP_BAR, Math.min(window.innerHeight - 60, win.y + dy));
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      },
      () => patchWin(win.id, { x, y }),
      e,
    );
  }

  function startResize(edge: (typeof EDGES)[number], e: RPointerEvent) {
    if (e.button !== 0 || win.maximized) return;
    e.stopPropagation();
    const el = ref.current!;
    const s = { x: win.x, y: win.y, w: win.w, h: win.h };
    let r = { ...s };
    track(
      getComputedStyle(e.currentTarget).cursor,
      (dx, dy) => {
        r = { ...s };
        if (edge.includes("e")) r.w = Math.max(MIN_W, s.w + dx);
        if (edge.includes("s")) r.h = Math.max(MIN_H, s.h + dy);
        if (edge.includes("w")) {
          r.w = Math.max(MIN_W, s.w - dx);
          r.x = s.x + s.w - r.w;
        }
        if (edge.includes("n")) {
          r.h = Math.max(MIN_H, s.h - dy);
          r.y = s.y + s.h - r.h;
          if (r.y < TOP_BAR) {
            r.h -= TOP_BAR - r.y;
            r.y = TOP_BAR;
          }
        }
        Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      },
      () => patchWin(win.id, r),
      e,
    );
  }

  const geometry = win.maximized
    ? { left: 0, top: TOP_BAR, width: "100vw", height: `calc(100vh - ${TOP_BAR + DOCK_SPACE}px)` }
    : { left: win.x, top: win.y, width: win.w, height: win.h };

  return (
    <div
      ref={ref}
      className={`absolute flex flex-col overflow-hidden animate-win-in ${win.maximized ? "rounded-none" : "rounded-[10px]"} ${win.minimized ? "hidden" : ""
        } panel ${focused ? "border-ink-600" : "border-ink-800"}`}
      style={{ ...geometry, zIndex: win.z }}
      onPointerDownCapture={() => focusWin(win.id)}
    >
      <div
        className="flex h-9 shrink-0 items-center gap-3 border-b border-ink-800 px-3"
        onPointerDown={startMove}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest("button") && toggleMaxWin(win.id)}
      >
        <div className="group flex gap-2">
          <Light color="#ff5f57" label="Kapat" icon={X} onClick={() => closeWin(win.id)} active={focused} />
          <Light color="#febc2e" label="Küçült" icon={Minus} onClick={() => minimizeWin(win.id)} active={focused} />
          <Light color="#28c840" label={win.maximized ? "Geri al" : "Büyüt"} icon={Plus} onClick={() => toggleMaxWin(win.id)} active={focused} />
        </div>
        <div className={`flex min-w-0 flex-1 items-center justify-center gap-2 pr-14 text-[13px] ${focused ? "text-ink-100" : "text-ink-400"}`}>
          <Icon className="size-3.5 shrink-0 opacity-70" />
          <span className="truncate font-medium">{win.title}</span>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-ink-400">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          }
        >
          <App winId={win.id} props={win.props} />
        </Suspense>
      </div>
      {!win.maximized &&
        EDGES.map((edge) => <div key={edge} className={`absolute z-10 ${EDGE_CLASS[edge]}`} onPointerDown={(e) => startResize(edge, e)} />)}
    </div>
  );
}

function Light({ color, label, icon: Icon, onClick, active }: { color: string; label: string; icon: LucideIcon; onClick: () => void; active: boolean }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid size-3 place-items-center rounded-full group-hover:bg-(--c) ${active ? "bg-(--c)" : "bg-ink-600"}`}
      style={{ "--c": color } as CSSProperties}
    >
      <Icon className="size-2 text-black/70 opacity-0 group-hover:opacity-100" strokeWidth={3.5} />
    </button>
  );
}

export default memo(Window);
