import { Ban, Pause, Play, RefreshCw, Search, Skull } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errMsg, type Proc } from "../lib/api";
import { formatSize } from "../lib/files";
import { confirmDialog, report, toast, useStore, withSudo } from "../lib/store";

type Key = "pid" | "user" | "cpu" | "mem" | "rss" | "etime" | "name";

const COLS: { key: Key; label: string; cls: string; num?: boolean }[] = [
  { key: "pid", label: "PID", cls: "w-16", num: true },
  { key: "name", label: "Ad", cls: "w-40" },
  { key: "user", label: "Kullanıcı", cls: "w-28" },
  { key: "cpu", label: "CPU %", cls: "w-16", num: true },
  { key: "mem", label: "Bellek %", cls: "w-18", num: true },
  { key: "rss", label: "RSS", cls: "w-20", num: true },
  { key: "etime", label: "Süre", cls: "w-20", num: true },
];

function formatElapsed(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}g ${h}s` : h ? `${h}s ${m}d` : `${m}d ${s % 60}s`;
}

export default function Processes() {
  const me = useStore((s) => s.session!.username);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState<{ key: Key; asc: boolean }>({ key: "cpu", asc: false });
  const [selected, setSelected] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .procList()
        .then((p) => alive && (setProcs(p), setError(null)))
        .catch((e) => alive && setError(errMsg(e)));
    load();
    const t = paused ? 0 : window.setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [paused, tick]);

  const view = useMemo(() => {
    const q = query.toLowerCase();
    const list = procs.filter(
      (p) => (!mine || p.user === me) && (!q || p.command.toLowerCase().includes(q) || p.user.includes(q) || String(p.pid) === q),
    );
    const dir = sort.asc ? 1 : -1;
    return list.sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [procs, query, mine, me, sort]);

  const sel = procs.find((p) => p.pid === selected) ?? null;
  const totalCpu = procs.reduce((n, p) => n + p.cpu, 0);

  async function kill(signal: "TERM" | "KILL") {
    if (!sel) return;
    const ok = await confirmDialog({
      title: signal === "KILL" ? "Süreç zorla sonlandırılsın mı?" : "Süreç sonlandırılsın mı?",
      message: `${sel.name} (PID ${sel.pid}, kullanıcı ${sel.user}) — SIG${signal}`,
      detail: sel.command,
      confirmLabel: signal === "KILL" ? "Zorla sonlandır" : "Sonlandır",
      danger: true,
    });
    if (!ok) return;
    try {
      await withSudo(() => api.procKill(sel.pid, signal));
      toast(`SIG${signal} gönderildi: ${sel.name} (${sel.pid})`, "success");
      setTick((t) => t + 1);
    } catch (e) {
      report(e);
    }
  }

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-2 py-1.5">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-400" />
          <input className="field py-1 pl-7 text-[12px]" placeholder="Komut, kullanıcı veya PID ara" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 text-ink-300">
          <input type="checkbox" className="accent-accent" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Yalnızca benimkiler
        </label>
        <div className="flex-1" />
        <button className="icon-btn" onClick={() => setPaused((p) => !p)} title={paused ? "Otomatik yenilemeyi sürdür" : "Otomatik yenilemeyi duraklat"}>
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        </button>
        <button className="icon-btn" onClick={() => setTick((t) => t + 1)} title="Yenile">
          <RefreshCw className="size-4" />
        </button>
        <button className="btn py-1" disabled={!sel} onClick={() => kill("TERM")}>
          <Ban className="size-3.5" /> Sonlandır
        </button>
        <button className="btn btn-danger py-1" disabled={!sel} onClick={() => kill("KILL")}>
          <Skull className="size-3.5" /> Zorla (-9)
        </button>
      </div>

      {error && <p className="m-2 rounded-lg bg-danger/10 p-2 text-danger">{error}</p>}

      <div className="flex shrink-0 gap-2 border-b border-ink-800 px-3 py-1.5 text-[11px] font-medium tracking-wide text-ink-400 uppercase">
        {COLS.map((c) => (
          <button
            key={c.key}
            className={`${c.cls} shrink-0 hover:text-ink-100 ${c.num ? "text-right" : "text-left"} ${sort.key === c.key ? "text-ink-100" : ""}`}
            onClick={() => setSort({ key: c.key, asc: sort.key === c.key ? !sort.asc : !c.num })}
          >
            {c.label}
            {sort.key === c.key && <span className="ml-0.5 text-accent">{sort.asc ? "↑" : "↓"}</span>}
          </button>
        ))}
        <span className="flex-1">Komut</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto font-mono text-[12px]">
        {view.map((p) => (
          <div
            key={p.pid}
            onPointerDown={() => setSelected(p.pid)}
            className={`flex gap-2 px-3 py-[3px] ${selected === p.pid ? "bg-accent/15" : "hover:bg-ink-850"}`}
          >
            <span className="w-16 shrink-0 text-right text-ink-400 tabular-nums">{p.pid}</span>
            <span className="w-40 shrink-0 truncate font-sans text-ink-100">{p.name}</span>
            <span className={`w-28 shrink-0 truncate ${p.user === "root" ? "text-ink-100" : "text-ink-400"}`}>{p.user}</span>
            <span className="w-16 shrink-0 text-right tabular-nums">{p.cpu.toFixed(1)}</span>
            <span className="w-18 shrink-0 text-right tabular-nums">{p.mem.toFixed(1)}</span>
            <span className="w-20 shrink-0 text-right text-ink-300 tabular-nums">{formatSize(p.rss)}</span>
            <span className="w-20 shrink-0 text-right text-ink-400 tabular-nums">{formatElapsed(p.etime)}</span>
            <span className="min-w-0 flex-1 truncate text-ink-400" title={p.command}>
              {p.command}
            </span>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 gap-4 border-t border-ink-800 px-3 py-1 text-[11.5px] text-ink-400">
        <span>{procs.length} süreç</span>
        <span>Toplam CPU: {totalCpu.toFixed(1)}%</span>
        {paused && <span className="text-accent">duraklatıldı</span>}
        {sel && <span className="ml-auto truncate font-mono">seçili: {sel.pid} {sel.name}</span>}
      </div>
    </div>
  );
}
