import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  FilePlus,
  FolderOpen,
  FolderPlus,
  HardDrive,
  House,
  LoaderCircle,
  RefreshCw,
  Search,
  SquareTerminal,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { api, errMsg, type Entry } from "../lib/api";
import {
  baseName,
  dirMenu,
  entryMenu,
  fileKeys,
  formatDate,
  formatMode,
  formatSize,
  iconFor,
  newFile,
  newFolder,
  openEntry,
  parentDir,
  uploadTo,
} from "../lib/files";
import { bumpFs, openApp, openMenu, patchWin, setSetting, useStore } from "../lib/store";
import type { AppProps } from "./registry";

type SortKey = "name" | "size" | "mtime";

const PLACES = ["/", "/etc", "/var/log", "/var/www", "/opt", "/srv", "/tmp"];

export default function Files({ winId, props }: AppProps) {
  const home = useStore((s) => s.session!.home);
  const fsTick = useStore((s) => s.fsTick);
  const showHidden = useStore((s) => s.settings.filesHidden === "1");
  const cut = useStore((s) => (s.clipboard?.mode === "cut" ? s.clipboard.paths : null));
  const [path, setPath] = useState<string>((props.path as string) || home);
  const [back, setBack] = useState<string[]>([]);
  const [fwd, setFwd] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const anchor = useRef(-1);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .listDir(path, showHidden)
      .then((r) => alive && (setEntries(r), setError(null)))
      .catch((e) => alive && (setEntries([]), setError(errMsg(e))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, showHidden, fsTick]);

  useEffect(() => {
    patchWin(winId, { title: path === home ? "Ev" : baseName(path) });
    setSel(new Set());
    setFilter("");
    anchor.current = -1;
  }, [path, home, winId]);

  const view = useMemo(() => {
    const q = filter.toLowerCase();
    const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : [...entries];
    const dir = sort.asc ? 1 : -1;
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (sort.key === "size") return (a.size - b.size) * dir;
      if (sort.key === "mtime") return (a.mtime - b.mtime) * dir;
      return a.name.localeCompare(b.name, "tr", { sensitivity: "base", numeric: true }) * dir;
    });
    return list;
  }, [entries, sort, filter]);

  const selected = view.filter((e) => sel.has(e.path));

  function go(p: string) {
    if (p === path) return;
    setBack((b) => [...b, path]);
    setFwd([]);
    setPath(p);
  }

  function goBack() {
    const p = back.at(-1);
    if (!p) return;
    setBack((b) => b.slice(0, -1));
    setFwd((f) => [path, ...f]);
    setPath(p);
  }

  function goFwd() {
    const p = fwd[0];
    if (!p) return;
    setFwd((f) => f.slice(1));
    setBack((b) => [...b, path]);
    setPath(p);
  }

  const open = (e: Entry) => (e.isDir ? go(e.path) : openEntry(e));

  function click(e: MouseEvent, entry: Entry, i: number) {
    if (e.shiftKey && anchor.current >= 0) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      setSel(new Set(view.slice(a, b + 1).map((x) => x.path)));
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(sel);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      setSel(next);
      anchor.current = i;
    } else {
      setSel(new Set([entry.path]));
      anchor.current = i;
    }
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "Enter" && selected.length === 1) {
      open(selected[0]);
    } else if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) {
      go(parentDir(path));
    } else if (e.altKey && e.key === "ArrowLeft") {
      goBack();
    } else if (e.altKey && e.key === "ArrowRight") {
      goFwd();
    } else if (mod && e.key.toLowerCase() === "a") {
      setSel(new Set(view.map((v) => v.path)));
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const cur = view.findIndex((v) => v.path === selected.at(-1)?.path);
      const next = Math.max(0, Math.min(view.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
      if (view[next]) {
        setSel(new Set([view[next].path]));
        anchor.current = next;
        root.current?.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: "nearest" });
      }
    } else if (!fileKeys(e, selected, path)) {
      return;
    }
    e.preventDefault();
  }

  function rowMenu(e: MouseEvent, entry: Entry) {
    const targets = sel.has(entry.path) ? selected : [entry];
    if (!sel.has(entry.path)) setSel(new Set([entry.path]));
    const items = entryMenu(targets);
    if (targets.length === 1 && entry.isDir) {
      items.splice(1, 0, { label: "Yeni pencerede aç", icon: FolderOpen, onClick: () => openApp("files", { path: entry.path }) });
    }
    openMenu(e, items);
  }

  const toggleHidden = () => setSetting("filesHidden", showHidden ? "0" : "1");
  const selSize = selected.reduce((n, e) => n + (e.isDir ? 0 : e.size), 0);

  return (
    <div ref={root} className="flex h-full flex-col text-[13px] outline-none" tabIndex={0} onKeyDown={onKey} data-drop-dir={path}>
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-2 py-1.5">
        <button className="icon-btn" onClick={goBack} disabled={!back.length} title="Geri (Alt+←)">
          <ArrowLeft className="size-4" />
        </button>
        <button className="icon-btn" onClick={goFwd} disabled={!fwd.length} title="İleri (Alt+→)">
          <ArrowRight className="size-4" />
        </button>
        <button className="icon-btn" onClick={() => go(parentDir(path))} disabled={path === "/"} title="Üst klasör (Backspace)">
          <ArrowUp className="size-4" />
        </button>
        <PathBar path={path} home={home} editing={editing} setEditing={setEditing} go={go} />
        <div className="relative w-40">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-400" />
          <input
            className="field py-1 pl-7 text-[12px]"
            placeholder="Bu klasörde ara"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
          />
        </div>
        <div className="mx-1 h-5 w-px bg-ink-800" />
        <button className="icon-btn" onClick={bumpFs} title="Yenile">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
        <button className="icon-btn" onClick={() => newFolder(path)} title="Yeni klasör">
          <FolderPlus className="size-4" />
        </button>
        <button className="icon-btn" onClick={() => newFile(path)} title="Yeni dosya">
          <FilePlus className="size-4" />
        </button>
        <button className="icon-btn" onClick={() => uploadTo(path)} title="Dosya yükle">
          <Upload className="size-4" />
        </button>
        <button className="icon-btn" onClick={toggleHidden} title={showHidden ? "Gizli dosyaları gizle" : "Gizli dosyaları göster"}>
          {showHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
        <button className="icon-btn" onClick={() => openApp("terminal", { cwd: path })} title="Burada terminal aç">
          <SquareTerminal className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-44 shrink-0 space-y-0.5 overflow-y-auto border-r border-ink-800 bg-black p-2">
          <p className="px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-widest text-ink-400 uppercase">Konumlar</p>
          <Place icon={House} label="Ev" active={path === home} onClick={() => go(home)} />
          {PLACES.map((p) => (
            <Place key={p} icon={p === "/" ? HardDrive : FolderOpen} label={p === "/" ? "Kök ( / )" : p} active={path === p} onClick={() => go(p)} />
          ))}
        </aside>

        <div
          className="flex min-w-0 flex-1 flex-col"
          onContextMenu={(e) =>
            openMenu(
              e,
              dirMenu(path, [
                { label: "Yenile", icon: RefreshCw, onClick: bumpFs },
                { label: showHidden ? "Gizli dosyaları gizle" : "Gizli dosyaları göster", icon: showHidden ? EyeOff : Eye, onClick: toggleHidden },
              ]),
            )
          }
          onPointerDown={(e) => e.target === e.currentTarget && setSel(new Set())}
        >
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_88px_132px_96px] gap-2 border-b border-ink-800 px-3 py-1.5 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
            <SortHead label="Ad" k="name" sort={sort} setSort={setSort} />
            <SortHead label="Boyut" k="size" sort={sort} setSort={setSort} right />
            <SortHead label="Değiştirilme" k="mtime" sort={sort} setSort={setSort} />
            <span>İzinler</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1" onPointerDown={(e) => e.target === e.currentTarget && setSel(new Set())}>
            {error ? (
              <div className="flex flex-col items-center gap-3 p-10 text-center text-ink-300">
                <TriangleAlert className="size-8 text-accent" />
                <p className="max-w-sm">{error}</p>
                <button className="btn" onClick={() => go(home)}>
                  <House className="size-4" /> Ev klasörüne dön
                </button>
              </div>
            ) : loading && !entries.length ? (
              <div className="grid place-items-center p-10 text-ink-400">
                <LoaderCircle className="size-5 animate-spin" />
              </div>
            ) : !view.length ? (
              <p className="p-10 text-center text-ink-400">{filter ? "Eşleşen öğe yok" : "Bu klasör boş"}</p>
            ) : (
              view.map((e, i) => {
                const { Icon, color } = iconFor(e);
                const isSel = sel.has(e.path);
                return (
                  <div
                    key={e.path}
                    data-row={i}
                    className={`mx-1 grid cursor-default grid-cols-[minmax(0,1fr)_88px_132px_96px] items-center gap-2 rounded-md px-2 py-[5px] ${
                      isSel ? "bg-accent/15 text-ink-100" : "hover:bg-ink-850"
                    } ${cut?.includes(e.path) ? "opacity-45" : ""}`}
                    onPointerDown={(ev) => ev.button === 0 && click(ev, e, i)}
                    onDoubleClick={() => open(e)}
                    onContextMenu={(ev) => rowMenu(ev, e)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="size-4 shrink-0" style={{ color }} fill={e.isDir ? "currentColor" : "none"} fillOpacity={0.16} />
                      <span className="truncate">{e.name}</span>
                      {e.isLink && <span className="text-[10px] text-ink-100">↗</span>}
                    </span>
                    <span className="text-right font-mono text-[11.5px] text-ink-300 tabular-nums">{e.isDir ? "—" : formatSize(e.size)}</span>
                    <span className="text-[12px] text-ink-300 tabular-nums">{formatDate(e.mtime)}</span>
                    <span className="font-mono text-[11px] text-ink-400">{formatMode(e.mode, e.isDir)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-ink-800 px-3 py-1 text-[11.5px] text-ink-400">
        <span>{view.length} öğe</span>
        {selected.length > 0 && (
          <span>
            {selected.length} seçili{selSize > 0 && ` · ${formatSize(selSize)}`}
          </span>
        )}
        <span className="ml-auto truncate font-mono">{path}</span>
      </div>
    </div>
  );
}

function PathBar({
  path,
  home,
  editing,
  setEditing,
  go,
}: {
  path: string;
  home: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  go: (p: string) => void;
}) {
  const [value, setValue] = useState(path);
  useEffect(() => setValue(path), [path]);

  if (editing) {
    return (
      <input
        autoFocus
        className="field mx-1 flex-1 py-1 font-mono text-[12px]"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const v = value.trim().replace(/^~(?=\/|$)/, home);
            if (v) go(v.length > 1 ? v.replace(/\/+$/, "") : v);
            setEditing(false);
          }
          if (e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  const parts = path.split("/").filter(Boolean);
  return (
    <div
      className="mx-1 flex min-w-0 flex-1 cursor-text items-center overflow-hidden rounded-lg border border-ink-700 bg-black px-1.5 py-[3px]"
      onClick={(e) => e.target === e.currentTarget && setEditing(true)}
      title="Yolu düzenlemek için tıklayın"
    >
      <button className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[12px] hover:bg-ink-800" onClick={() => go("/")}>
        /
      </button>
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 shrink items-center">
          {i > 0 && <ChevronRight className="size-3 shrink-0 text-ink-400" />}
          <button
            className={`truncate rounded px-1.5 py-0.5 text-[12px] hover:bg-ink-800 ${i === parts.length - 1 ? "font-medium text-ink-100" : "text-ink-300"}`}
            onClick={() => go("/" + parts.slice(0, i + 1).join("/"))}
          >
            {p}
          </button>
        </span>
      ))}
      <span className="min-w-6 flex-1 self-stretch" onClick={() => setEditing(true)} />
    </div>
  );
}

function Place({ icon: Icon, label, active, onClick }: { icon: typeof House; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
        active ? "bg-ink-800 text-ink-100" : "text-ink-300 hover:bg-ink-850"
      }`}
    >
      <Icon className={`size-4 shrink-0 ${active ? "text-accent" : "text-ink-400"}`} />
      <span className="truncate font-mono text-[12px]">{label}</span>
    </button>
  );
}

function SortHead({
  label,
  k,
  sort,
  setSort,
  right,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; asc: boolean };
  setSort: (s: { key: SortKey; asc: boolean }) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <button
      className={`flex items-center gap-1 uppercase hover:text-ink-100 ${right ? "justify-end" : ""} ${active ? "text-ink-100" : ""}`}
      onClick={() => setSort({ key: k, asc: active ? !sort.asc : true })}
    >
      {label}
      {active && <span className="text-accent">{sort.asc ? "↑" : "↓"}</span>}
    </button>
  );
}
