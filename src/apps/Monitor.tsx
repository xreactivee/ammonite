import { Pause, Play, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, errMsg, type Stats } from "../lib/api";
import { formatSize } from "../lib/files";
import { useStore } from "../lib/store";

const HISTORY = 60;
const INTERVAL = 2000;
const RX = "var(--color-accent)";
const TX = "#8f8f8f";
const CRITICAL = "#ff4d4f";

type Sample = { cpu: number; cores: number[]; mem: number; rx: number; tx: number };

function pct(prev: { total: number; idle: number }, cur: { total: number; idle: number }) {
  const dt = cur.total - prev.total;
  return dt > 0 ? Math.max(0, Math.min(100, (100 * (dt - (cur.idle - prev.idle))) / dt)) : 0;
}

function formatUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} gün ${h} sa` : h ? `${h} sa ${m} dk` : `${m} dk`;
}

const rate = (bps: number) => `${formatSize(Math.round(bps))}/s`;

export default function Monitor() {
  const session = useStore((s) => s.session)!;
  const [stats, setStats] = useState<Stats | null>(null);
  const [hist, setHist] = useState<Sample[]>([]);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<{ stats: Stats; at: number } | null>(null);

  useEffect(() => {
    if (paused) return;
    let alive = true;
    async function tick() {
      try {
        const s = await api.sysStats();
        if (!alive) return;
        const now = performance.now();
        const p = prev.current;
        if (p && p.stats.cpus.length === s.cpus.length) {
          const dt = (now - p.at) / 1000;
          const sum = (st: Stats, k: "rx" | "tx") => st.net.reduce((n, i) => n + i[k], 0);
          const sample: Sample = {
            cpu: pct(p.stats.cpus[0], s.cpus[0]),
            cores: s.cpus.slice(1).map((c, i) => pct(p.stats.cpus[i + 1], c)),
            mem: s.mem.total ? (100 * (s.mem.total - s.mem.available)) / s.mem.total : 0,
            rx: Math.max(0, (sum(s, "rx") - sum(p.stats, "rx")) / dt),
            tx: Math.max(0, (sum(s, "tx") - sum(p.stats, "tx")) / dt),
          };
          setHist((h) => [...h.slice(-(HISTORY - 1)), sample]);
        }
        prev.current = { stats: s, at: now };
        setStats(s);
        setError(null);
      } catch (e) {
        if (alive) setError(errMsg(e));
      }
    }
    tick();
    const t = setInterval(tick, INTERVAL);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [paused]);

  const last = hist.at(-1);
  const memUsed = stats ? stats.mem.total - stats.mem.available : 0;
  const swapUsed = stats ? stats.mem.swapTotal - stats.mem.swapFree : 0;
  const cores = Math.max(0, (stats?.cpus.length ?? 1) - 1);

  return (
    <div className="h-full overflow-y-auto bg-ink-900 p-4 text-[13px]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-semibold">{session.hostname || session.host}</h2>
          <p className="truncate text-ink-400">
            {session.os} · {session.kernel}
            {stats?.cpuModel && ` · ${stats.cpuModel}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-ink-300">
          {stats && <span>Açık kalma: {formatUptime(stats.uptime)}</span>}
          <button className="btn py-1" onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />} {paused ? "Devam" : "Duraklat"}
          </button>
        </div>
      </div>

      {error && <p className="mb-3 rounded-lg bg-danger/10 p-2 text-danger">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Tile title="İşlemci" value={last ? `${last.cpu.toFixed(0)}%` : "…"} sub={`${cores} çekirdek`}>
          <Spark series={[{ name: "CPU", color: RX, values: hist.map((h) => h.cpu) }]} max={100} format={(v) => `${v.toFixed(1)}%`} />
        </Tile>
        <Tile
          title="Bellek"
          value={stats ? formatSize(memUsed) : "…"}
          sub={stats ? `/ ${formatSize(stats.mem.total)} · ${last?.mem.toFixed(0) ?? "–"}%` : ""}
        >
          <Spark series={[{ name: "Bellek", color: RX, values: hist.map((h) => h.mem) }]} max={100} format={(v) => `${v.toFixed(1)}%`} />
        </Tile>
        <Tile
          title="Ağ"
          value={last ? rate(last.rx) : "…"}
          sub={last ? `gelen · giden ${rate(last.tx)}` : ""}
          legend={[
            ["Gelen", RX, false],
            ["Giden", TX, true],
          ]}
        >
          <Spark
            series={[
              { name: "Gelen", color: RX, values: hist.map((h) => h.rx) },
              { name: "Giden", color: TX, dash: true, values: hist.map((h) => h.tx) },
            ]}
            format={rate}
          />
        </Tile>
        <Tile title="Yük ortalaması" value={stats ? stats.load[0].toFixed(2) : "…"} sub="1 dk">
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {(["1 dk", "5 dk", "15 dk"] as const).map((label, i) => (
              <div key={label} className="rounded-lg bg-black py-2">
                <div className="font-mono text-base text-ink-100 tabular-nums">{stats?.load[i].toFixed(2) ?? "–"}</div>
                <div className="text-[11px] text-ink-400">{label}</div>
              </div>
            ))}
          </div>
          {stats && stats.mem.swapTotal > 0 && (
            <div className="mt-3">
              <Meter label="Swap" used={swapUsed} total={stats.mem.swapTotal} />
            </div>
          )}
        </Tile>
      </div>

      {last && last.cores.length > 1 && (
        <Section title="Çekirdekler">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-2">
            {last.cores.map((c, i) => (
              <div key={i} className="flex items-center gap-2" title={`CPU ${i}: ${c.toFixed(1)}%`}>
                <span className="w-10 font-mono text-[11px] text-ink-400">cpu{i}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-800">
                  <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${c}%`, background: RX }} />
                </div>
                <span className="w-9 text-right font-mono text-[11px] text-ink-300 tabular-nums">{c.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {stats && stats.disks.length > 0 && (
        <Section title="Diskler">
          <div className="space-y-3">
            {stats.disks.map((d) => (
              <Meter key={d.mount + d.fs} label={d.mount} detail={`${d.fs} · ${d.kind}`} used={d.used} total={d.size} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function Tile({
  title,
  value,
  sub,
  legend,
  children,
}: {
  title: string;
  value: string;
  sub?: string;
  legend?: [string, string, boolean][];
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-800 bg-black p-3">
      <div className="flex items-center justify-between text-[11px] font-medium tracking-wider text-ink-400 uppercase">
        {title}
        {legend && (
          <span className="flex gap-3 normal-case tracking-normal">
            {legend.map(([name, color, dash]) => (
              <span key={name} className="flex items-center gap-1.5 text-ink-300">
                <LineKey color={color} dash={dash} />
                {name}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="font-display text-[26px] leading-none font-semibold text-ink-100 tabular-nums">{value}</span>
        {sub && <span className="text-[12px] text-ink-400">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4 rounded-lg border border-ink-800 bg-black p-3">
      <h3 className="mb-3 text-[11px] font-medium tracking-wider text-ink-400 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Meter({ label, detail, used, total }: { label: string; detail?: string; used: number; total: number }) {
  const p = total ? (100 * used) / total : 0;
  const critical = p >= 90;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-[12px]">
        <span className="font-mono text-ink-100">{label}</span>
        {detail && <span className="truncate text-ink-400">{detail}</span>}
        {critical && (
          <span className="flex items-center gap-1 text-[11px] text-ink-100">
            <TriangleAlert className="size-3.5" style={{ color: CRITICAL }} /> neredeyse dolu
          </span>
        )}
        <span className="ml-auto font-mono text-ink-300 tabular-nums">
          {formatSize(used)} / {formatSize(total)} · {p.toFixed(0)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-800">
        <div className="h-full rounded-full" style={{ width: `${p}%`, background: critical ? CRITICAL : RX }} />
      </div>
    </div>
  );
}

function Spark({
  series,
  max,
  format,
}: {
  series: { name: string; color: string; dash?: boolean; values: number[] }[];
  max?: number;
  format: (v: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const H = 64;
  const len = Math.max(0, ...series.map((s) => s.values.length));
  const top = max ?? Math.max(1, ...series.flatMap((s) => s.values)) * 1.15;
  const x = (i: number) => W - (len - 1 - i) * (W / (HISTORY - 1));
  const y = (v: number) => H - 2 - (Math.min(v, top) / top) * (H - 6);
  const idx = hover !== null && len ? Math.max(0, Math.min(len - 1, Math.round(len - 1 - (W - hover) / (W / (HISTORY - 1))))) : null;

  return (
    <div className="relative mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(((e.clientX - r.left) / r.width) * W);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {[0.5].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="rgb(255 255 255 / 0.05)" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={0} x2={W} y1={H - 1} y2={H - 1} stroke="rgb(255 255 255 / 0.1)" vectorEffect="non-scaling-stroke" />
        {series.map((s) => {
          if (s.values.length < 2) return null;
          const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
          return (
            <g key={s.name}>
              {series.length === 1 && <polygon points={`${x(0)},${H} ${pts} ${W},${H}`} fill={s.color} opacity={0.08} />}
              <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash ? "5 4" : undefined} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          );
        })}
        {idx !== null && <line x1={x(idx)} x2={x(idx)} y1={0} y2={H} stroke="rgb(255 255 255 / 0.35)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {idx !== null && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-md border border-ink-700 bg-ink-900/95 px-2 py-1 text-[11px] whitespace-nowrap shadow-lg"
          style={{ left: `${(x(idx) / W) * 100}%` }}
        >
          <div className="text-ink-400">{((len - 1 - idx) * INTERVAL) / 1000} sn önce</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5 text-ink-100">
              <LineKey color={s.color} dash={s.dash} />
              {s.name}: <span className="font-mono tabular-nums">{s.values[idx] !== undefined ? format(s.values[idx]) : "–"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineKey({ color, dash }: { color: string; dash?: boolean }) {
  return (
    <svg width="14" height="4" aria-hidden>
      <line x1="0" x2="14" y1="2" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dash ? "3 2" : undefined} />
    </svg>
  );
}
