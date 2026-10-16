import { Plus, X } from "lucide-react";
import type { MouseEvent } from "react";
import { APPS, type AppId } from "../lib/appMeta";
import { closeWin, focusedWinId, focusWin, minimizeWin, openApp, openMenu, useStore, type MenuItem } from "../lib/store";

const DOCK_APPS = (Object.keys(APPS) as AppId[]).filter((a) => APPS[a].dock);

export default function Dock() {
  const windows = useStore((s) => s.windows);
  const extra = [...new Set(windows.map((w) => w.app))].filter((a) => !APPS[a].dock);

  function activate(app: AppId) {
    const mine = windows.filter((w) => w.app === app);
    if (!mine.length) return openApp(app);
    const top = mine.reduce((a, b) => (a.z > b.z ? a : b));
    if (top.id === focusedWinId() && !top.minimized) minimizeWin(top.id);
    else focusWin(top.id);
  }

  function menu(app: AppId, e: MouseEvent) {
    const mine = windows.filter((w) => w.app === app);
    const items: MenuItem[] = mine.map((w) => ({ label: w.title, onClick: () => focusWin(w.id) }));
    if (items.length) items.push("sep");
    if (!APPS[app].single || !mine.length) items.push({ label: "Yeni pencere", icon: Plus, onClick: () => openApp(app, {}, undefined) });
    if (mine.length) items.push({ label: "Tümünü kapat", icon: X, onClick: () => mine.forEach((w) => closeWin(w.id)) });
    openMenu(e, items);
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[9000] flex justify-center">
      <nav className="panel pointer-events-auto flex items-end gap-1 rounded-2xl px-2 pt-2 pb-1.5">
        {DOCK_APPS.map((a) => (
          <DockItem key={a} app={a} running={windows.some((w) => w.app === a)} onClick={() => activate(a)} onMenu={(e) => menu(a, e)} />
        ))}
        {extra.length > 0 && <div className="mx-1 h-8 w-px self-center bg-ink-700" />}
        {extra.map((a) => (
          <DockItem key={a} app={a} running onClick={() => activate(a)} onMenu={(e) => menu(a, e)} />
        ))}
      </nav>
    </div>
  );
}

function DockItem({ app, running, onClick, onMenu }: { app: AppId; running: boolean; onClick: () => void; onMenu: (e: MouseEvent) => void }) {
  const meta = APPS[app];
  return (
    <button
      onClick={(e) => (e.shiftKey && !meta.single ? openApp(app) : onClick())}
      onContextMenu={onMenu}
      className="group relative flex flex-col items-center outline-none"
      title=""
    >
      <span className="pointer-events-none absolute -top-9 rounded-md border border-ink-700 bg-ink-900 px-2 py-1 text-xs whitespace-nowrap opacity-0 transition group-hover:opacity-100">
        {meta.title}
      </span>
      <span
        className="grid size-11 origin-bottom place-items-center rounded-xl border border-ink-700 bg-black text-ink-300 transition duration-150 ease-out group-hover:-translate-y-1 group-hover:scale-110 group-hover:border-ink-600 group-hover:text-ink-100 group-active:scale-100"
      >
        <meta.icon className="size-5" strokeWidth={1.75} />
      </span>
      <span className={`mt-1 size-1 rounded-full ${running ? "bg-accent" : "bg-transparent"}`} />
    </button>
  );
}
