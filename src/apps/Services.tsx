import { CircleStop, LoaderCircle, Play, RefreshCw, RotateCw, ScrollText, Search, ToggleLeft, ToggleRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errMsg, type Service } from "../lib/api";
import { report, toast, withSudo } from "../lib/store";

type Filter = "all" | "running" | "failed" | "inactive";

const FILTERS: [Filter, string][] = [
  ["all", "Tümü"],
  ["running", "Çalışan"],
  ["failed", "Hatalı"],
  ["inactive", "Durmuş"],
];

function state(s: Service): { label: string; dot: string } {
  if (s.active === "failed") return { label: "hatalı", dot: "#e5484d" };
  if (s.active === "active") return { label: s.sub === "running" ? "çalışıyor" : s.sub, dot: "#46a758" };
  if (s.active === "activating" || s.active === "reloading") return { label: s.active, dot: "#ffb547" };
  return { label: s.sub === "dead" ? "durmuş" : s.sub, dot: "#6b7280" };
}

export default function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [logs, setLogs] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setServices(await api.svcList());
      setError(null);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const view = useMemo(() => {
    const q = query.toLowerCase();
    return services.filter((s) => {
      if (q && !s.unit.toLowerCase().includes(q) && !s.description.toLowerCase().includes(q)) return false;
      if (filter === "running") return s.active === "active";
      if (filter === "failed") return s.active === "failed";
      if (filter === "inactive") return s.active === "inactive";
      return true;
    });
  }, [services, query, filter]);

  const sel = services.find((s) => s.unit === selected) ?? null;
  const failed = services.filter((s) => s.active === "failed").length;

  async function act(action: string) {
    if (!sel) return;
    setBusy(action);
    try {
      await withSudo(() => api.svcAction(sel.unit, action));
      toast(`${sel.unit}: ${action} tamam`, "success");
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(null);
    }
  }

  async function showLogs(unit: string) {
    setLogs("");
    try {
      setLogs((await withSudo(() => api.svcLogs(unit, 300))) || "(kayıt yok)");
    } catch (e) {
      setLogs(null);
      report(e);
    }
  }

  useEffect(() => setLogs(null), [selected]);

  return (
    <div className="flex h-full flex-col text-[12.5px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-2 py-1.5">
        <div className="relative w-60">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-400" />
          <input className="field py-1 pl-7 text-[12px]" placeholder="Servis ara" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="flex rounded-lg bg-black p-0.5">
          {FILTERS.map(([f, label]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 text-[12px] ${filter === f ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-300"}`}
            >
              {label}
              {f === "failed" && failed > 0 && <span className="ml-1 rounded bg-danger/25 px-1 text-[10px] text-danger">{failed}</span>}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button className="icon-btn" onClick={refresh} title="Yenile">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <p className="m-2 rounded-lg bg-danger/10 p-2 text-danger">{error}</p>}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto py-1">
          {view.map((s) => {
            const st = state(s);
            return (
              <div
                key={s.unit}
                onPointerDown={() => setSelected(s.unit)}
                className={`mx-1 grid grid-cols-[minmax(0,1.1fr)_96px_80px_minmax(0,1fr)] items-center gap-3 rounded-md px-2 py-[5px] ${
                  selected === s.unit ? "bg-accent/15" : "hover:bg-ink-850"
                }`}
              >
                <span className="truncate font-mono text-[12px] text-ink-100">{s.unit.replace(/\.service$/, "")}</span>
                <span className="flex items-center gap-1.5 text-ink-300">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: st.dot }} />
                  {st.label}
                </span>
                <span className={s.enabled === "enabled" ? "text-ink-300" : "text-ink-400"}>{s.enabled}</span>
                <span className="truncate text-ink-400">{s.description}</span>
              </div>
            );
          })}
          {!loading && !view.length && <p className="p-8 text-center text-ink-400">Servis bulunamadı</p>}
        </div>

        {sel && (
          <aside className="flex w-[360px] shrink-0 flex-col border-l border-ink-800 bg-black">
            <div className="border-b border-ink-800 p-3">
              <h3 className="truncate font-mono text-[13px] text-ink-100">{sel.unit}</h3>
              <p className="mt-0.5 text-ink-400">{sel.description || "—"}</p>
              <dl className="mt-2 grid grid-cols-[70px_1fr] gap-y-0.5 text-[12px]">
                <dt className="text-ink-400">Durum</dt>
                <dd>
                  {sel.active} ({sel.sub})
                </dd>
                <dt className="text-ink-400">Açılışta</dt>
                <dd>{sel.enabled}</dd>
                <dt className="text-ink-400">Yükleme</dt>
                <dd>{sel.load}</dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <ActionBtn icon={Play} label="Başlat" onClick={() => act("start")} busy={busy === "start"} disabled={!!busy} />
                <ActionBtn icon={CircleStop} label="Durdur" onClick={() => act("stop")} busy={busy === "stop"} disabled={!!busy} />
                <ActionBtn icon={RotateCw} label="Yeniden başlat" onClick={() => act("restart")} busy={busy === "restart"} disabled={!!busy} />
                {sel.enabled === "enabled" ? (
                  <ActionBtn icon={ToggleLeft} label="Açılışta kapat" onClick={() => act("disable")} busy={busy === "disable"} disabled={!!busy} />
                ) : (
                  <ActionBtn icon={ToggleRight} label="Açılışta başlat" onClick={() => act("enable")} busy={busy === "enable"} disabled={!!busy} />
                )}
                <ActionBtn icon={ScrollText} label="Günlükler" onClick={() => showLogs(sel.unit)} busy={logs === ""} disabled={false} />
              </div>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-300 select-text">
              {logs ?? "Son günlük kayıtlarını görmek için \"Günlükler\"e basın."}
            </pre>
          </aside>
        )}
      </div>

      <div className="flex shrink-0 gap-4 border-t border-ink-800 px-3 py-1 text-[11.5px] text-ink-400">
        <span>{services.length} servis</span>
        <span>{services.filter((s) => s.active === "active").length} etkin</span>
        {failed > 0 && <span className="text-danger">{failed} hatalı</span>}
      </div>
    </div>
  );
}

function ActionBtn({
  icon: Icon,
  label,
  onClick,
  busy,
  disabled,
}: {
  icon: typeof Play;
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <button className="btn py-1 text-[12px]" onClick={onClick} disabled={disabled}>
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
      {label}
    </button>
  );
}
