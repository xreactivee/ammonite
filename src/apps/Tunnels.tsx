import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, Cable, Globe, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { api, type TunnelInfo } from "../lib/api";
import { report, toast } from "../lib/store";

export default function Tunnels() {
  const [tunnels, setTunnels] = useState<TunnelInfo[]>([]);
  const [localPort, setLocalPort] = useState("8080");
  const [remoteHost, setRemoteHost] = useState("127.0.0.1");
  const [remotePort, setRemotePort] = useState("80");

  const refresh = () => api.tunnelList().then(setTunnels).catch(report);
  useEffect(() => {
    refresh();
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      const t = await api.tunnelOpen(Number(localPort) || 0, remoteHost.trim() || "127.0.0.1", Number(remotePort));
      toast(`Tünel açıldı: localhost:${t.localPort} → ${t.remoteHost}:${t.remotePort}`, "success");
      refresh();
    } catch (err) {
      report(err);
    }
  }

  async function close(id: number) {
    await api.tunnelClose(id).catch(report);
    refresh();
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-[13px]">
      <p className="text-ink-300">
        Sunucunun içinden erişilebilen bir servisi (ör. yalnızca <span className="font-mono">127.0.0.1</span>'de dinleyen bir web paneli
        veya veritabanı) SSH üzerinden bu bilgisayardaki bir porta bağlar.
      </p>

      <form onSubmit={add} className="flex items-end gap-2 rounded-lg border border-ink-700 p-3">
        <label className="w-24">
          <span className="mb-1 block text-[11px] text-ink-400 uppercase">Yerel port</span>
          <input className="field py-1.5 font-mono" value={localPort} onChange={(e) => setLocalPort(e.target.value.replace(/\D/g, ""))} />
        </label>
        <ArrowRight className="mb-2.5 size-4 shrink-0 text-ink-400" />
        <label className="flex-1">
          <span className="mb-1 block text-[11px] text-ink-400 uppercase">Sunucu tarafında hedef</span>
          <input className="field py-1.5 font-mono" value={remoteHost} onChange={(e) => setRemoteHost(e.target.value)} />
        </label>
        <label className="w-24">
          <span className="mb-1 block text-[11px] text-ink-400 uppercase">Port</span>
          <input className="field py-1.5 font-mono" value={remotePort} onChange={(e) => setRemotePort(e.target.value.replace(/\D/g, ""))} />
        </label>
        <button className="btn btn-primary py-1.5" disabled={!remotePort}>
          <Plus className="size-4" /> Aç
        </button>
      </form>

      <div className="space-y-2">
        {tunnels.length === 0 && (
          <div className="flex flex-col items-center gap-2 p-8 text-ink-400">
            <Cable className="size-8" />
            Açık tünel yok
          </div>
        )}
        {tunnels.map((t) => (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-ink-700 px-3 py-2.5">
            <span className="size-2 rounded-full bg-[#46a758]" />
            <span className="font-mono">localhost:{t.localPort}</span>
            <ArrowRight className="size-3.5 text-ink-400" />
            <span className="font-mono text-ink-300">
              {t.remoteHost}:{t.remotePort}
            </span>
            <div className="flex-1" />
            <button className="btn py-1" onClick={() => openUrl(`http://localhost:${t.localPort}`)}>
              <Globe className="size-3.5" /> Tarayıcıda aç
            </button>
            <button className="icon-btn" onClick={() => close(t.id)} title="Tüneli kapat">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
