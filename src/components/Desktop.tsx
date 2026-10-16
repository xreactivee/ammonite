import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Eye, EyeOff, FolderOpen, Image, RefreshCw, Upload } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { api, type Entry } from "../lib/api";
import { baseName, dirMenu, entryMenu, fileKeys, iconFor, openEntry, uploadTo } from "../lib/files";
import { bumpFs, DOCK_SPACE, focusedWinId, openApp, openMenu, report, setSetting, TOP_BAR, useStore } from "../lib/store";
import { wallpaperCss } from "../lib/wallpapers";
import Dock from "./Dock";
import TopBar from "./TopBar";
import Window from "./Window";

export default function Desktop() {
  const session = useStore((s) => s.session)!;
  const wallpaper = useStore((s) => s.settings.wallpaper);
  const showHidden = useStore((s) => s.settings.desktopHidden === "1");
  const windows = useStore((s) => s.windows);
  const fsTick = useStore((s) => s.fsTick);
  const cut = useStore((s) => (s.clipboard?.mode === "cut" ? s.clipboard.paths : null));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dropDir, setDropDir] = useState<string | null>(null);
  const focused = focusedWinId();

  useEffect(() => {
    api.listDir(session.home, showHidden).then(setEntries).catch(report);
  }, [session.home, fsTick, showHidden]);

  useEffect(() => {
    const dirAt = (x: number, y: number) => {
      const dpr = window.devicePixelRatio || 1;
      const el = document.elementFromPoint(x / dpr, y / dpr);
      return el?.closest<HTMLElement>("[data-drop-dir]")?.dataset.dropDir ?? session.home;
    };
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") setDropDir(dirAt(payload.position.x, payload.position.y));
      else if (payload.type === "leave") setDropDir(null);
      else if (payload.type === "drop") {
        setDropDir(null);
        if (payload.paths.length) uploadTo(dirAt(payload.position.x, payload.position.y), payload.paths);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [session.home]);

  const sel = entries.filter((e) => e.path === selected);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: wallpaperCss(wallpaper) }}>
      <TopBar />

      <div
        className="absolute inset-x-0"
        style={{ top: TOP_BAR, bottom: DOCK_SPACE }}
        data-drop-dir={session.home}
        onPointerDown={() => setSelected(null)}
        onContextMenu={(e) =>
          openMenu(
            e,
            dirMenu(session.home, [
              { label: "Dosyalarda aç", icon: FolderOpen, onClick: () => openApp("files", { path: session.home }) },
              { label: "Yenile", icon: RefreshCw, onClick: bumpFs },
              "sep",
              {
                label: showHidden ? "Gizli dosyaları gizle" : "Gizli dosyaları göster",
                icon: showHidden ? EyeOff : Eye,
                onClick: () => setSetting("desktopHidden", showHidden ? "0" : "1"),
              },
              { label: "Duvar kağıdını değiştir…", icon: Image, onClick: () => openApp("settings") },
            ]),
          )
        }
      >
        <div className="grid h-full auto-cols-[96px] grid-flow-col grid-rows-[repeat(auto-fill,104px)] content-start gap-x-1 p-4">
          {entries.map((e) => (
            <DesktopIcon
              key={e.path}
              entry={e}
              selected={selected === e.path}
              dimmed={!!cut?.includes(e.path)}
              onSelect={() => setSelected(e.path)}
              onMenu={(ev) => {
                setSelected(e.path);
                openMenu(ev, entryMenu([e]));
              }}
              onKey={(ev) => fileKeys(ev, sel.length ? sel : [e], session.home)}
            />
          ))}
        </div>
      </div>

      {windows.map((w) => (
        <Window key={w.id} win={w} focused={w.id === focused} />
      ))}

      <Dock />

      {dropDir && (
        <div className="pointer-events-none fixed inset-0 z-[9600] grid place-items-center border-2 border-dashed border-ink-400 bg-black/40">
          <div className="panel flex items-center gap-3 rounded-lg px-5 py-3 text-sm">
            <Upload className="size-4 text-ink-300" />
            Bırakın, yüklenecek: <span className="font-mono text-ink-100">{dropDir === session.home ? "~" : dropDir}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DesktopIcon({
  entry,
  selected,
  dimmed,
  onSelect,
  onMenu,
  onKey,
}: {
  entry: Entry;
  selected: boolean;
  dimmed: boolean;
  onSelect: () => void;
  onMenu: (e: MouseEvent) => void;
  onKey: (e: KeyboardEvent) => void;
}) {
  const { Icon, color } = iconFor(entry);
  return (
    <button
      className={`group flex h-[100px] w-[92px] flex-col items-center gap-1.5 rounded-lg p-1.5 outline-none ${dimmed ? "opacity-45" : ""}`}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={() => openEntry(entry)}
      onContextMenu={onMenu}
      onKeyDown={onKey}
      title={entry.name}
    >
      <span
        className={`grid size-14 place-items-center rounded-2xl transition ${
          selected ? "bg-white/20 ring-1 ring-white/30" : "group-hover:bg-white/10"
        }`}
      >
        <Icon className="size-10" style={{ color }} strokeWidth={1.5} fill={entry.isDir ? "currentColor" : "none"} fillOpacity={0.16} />
      </span>
      <span
        className={`line-clamp-2 max-w-full rounded px-1 text-center text-[12px] leading-tight break-all [text-shadow:0_1px_3px_rgb(0_0_0/0.9)] ${
          selected ? "bg-accent text-on-accent [text-shadow:none]" : "text-white"
        }`}
      >
        {entry.isLink ? `${baseName(entry.name)} ↗` : entry.name}
      </span>
    </button>
  );
}
