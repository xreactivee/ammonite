import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, Folder, ImagePlus, Trash } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { confirmDialog, report, setSetting, toast, useStore } from "../lib/store";
import { DEFAULT_WALLPAPER, WALLPAPERS, wallpaperCss } from "../lib/wallpapers";

export default function Settings() {
  const session = useStore((s) => s.session)!;
  const settings = useStore((s) => s.settings);
  const current = settings.wallpaper ?? DEFAULT_WALLPAPER;
  const custom = current.startsWith("data:");

  async function pickImage() {
    const path = await openDialog({
      multiple: false,
      title: "Duvar kağıdı seçin",
      filters: [{ name: "Resim", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
    });
    if (typeof path !== "string") return;
    try {
      setSetting("wallpaper", await api.readLocalImage(path));
    } catch (e) {
      report(e);
    }
  }

  async function forget() {
    const ok = await confirmDialog({
      title: "Kayıtlı giriş bilgileri silinsin mi?",
      message: "Bir sonraki açılışta otomatik bağlanılmaz; bilgileri yeniden girmeniz gerekir. Mevcut oturum açık kalır.",
      confirmLabel: "Sil",
      danger: true,
    });
    if (!ok) return;
    await api.forgetProfile().then(() => toast("Kayıtlı giriş bilgileri silindi", "success"), report);
  }

  return (
    <div className="h-full space-y-5 overflow-y-auto p-5 text-[13px]">
      <Group title="Duvar kağıdı">
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(WALLPAPERS).map(([id, w]) => (
            <Swatch key={id} label={w.name} css={w.css} active={current === id} onClick={() => setSetting("wallpaper", id)} />
          ))}
          {custom && <Swatch label="Özel resim" css={wallpaperCss(current)} active onClick={() => {}} />}
          <button
            onClick={pickImage}
            className="flex aspect-[16/10] flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-ink-700 text-ink-300 hover:border-ink-400 hover:text-ink-100"
          >
            <ImagePlus className="size-5" />
            <span className="text-[12px]">Bilgisayardan seç</span>
          </button>
        </div>
      </Group>

      <Group title="Vurgu rengi">
        <AccentPicker value={settings.accent || "#ffffff"} wallpaper={custom ? current : null} />
      </Group>

      <Group title="Dosyalar">
        <Toggle label="Masaüstünde gizli dosyaları göster" on={settings.desktopHidden === "1"} set={(v) => setSetting("desktopHidden", v ? "1" : "0")} />
        <Toggle label="Dosya gezgininde gizli dosyaları göster" on={settings.filesHidden === "1"} set={(v) => setSetting("filesHidden", v ? "1" : "0")} />
      </Group>

      <Group title="Bağlantı">
        <dl className="grid grid-cols-[140px_1fr] gap-y-1.5">
          <dt className="text-ink-400">Sunucu</dt>
          <dd className="font-mono">
            {session.host}:{session.port}
          </dd>
          <dt className="text-ink-400">Kullanıcı</dt>
          <dd className="font-mono">{session.username}</dd>
          <dt className="text-ink-400">Ana dizin</dt>
          <dd className="font-mono">{session.home}</dd>
          <dt className="text-ink-400">İşletim sistemi</dt>
          <dd>{session.os || "—"}</dd>
          <dt className="text-ink-400">Çekirdek</dt>
          <dd className="font-mono">{session.kernel || "—"}</dd>
          <dt className="text-ink-400">Host key (SHA256)</dt>
          <dd className="font-mono text-[12px] break-all text-ink-100 select-text">{session.fingerprint}</dd>
        </dl>
        <button className="btn btn-danger mt-3" onClick={forget}>
          <Trash className="size-4" /> Kayıtlı giriş bilgilerini unut
        </button>
      </Group>

      <p className="text-[12px] text-ink-400">
        Ammonite 0.2.0 — kayıtlı şifreler XChaCha20-Poly1305 ile şifrelenir, anahtar Windows Kimlik Bilgileri Yöneticisi'nde
        saklanır.
      </p>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[11px] font-semibold tracking-widest text-ink-400 uppercase">{title}</h3>
      <div className="rounded-lg border border-ink-800 bg-black p-3.5">{children}</div>
    </section>
  );
}

function Swatch({ label, css, active, onClick }: { label: string; css: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group text-left">
      <span
        className={`relative block aspect-[16/10] overflow-hidden rounded-lg border border-ink-700 ring-2 ring-offset-2 ring-offset-ink-900 ${active ? "ring-ink-100" : "ring-transparent group-hover:ring-ink-600"}`}
      >
        <span className="absolute top-0 left-0 h-[900px] w-[1440px] origin-top-left scale-[0.11]" style={{ background: css }} />
        {active && (
          <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-ink-100 text-black">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
      </span>
      <span className="mt-1 block text-[12px] text-ink-300">{label}</span>
    </button>
  );
}

function Toggle({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-1.5">
      {label}
      <button
        role="switch"
        aria-checked={on}
        onClick={() => set(!on)}
        className={`relative h-5 w-9 rounded-full transition ${on ? "bg-accent" : "bg-ink-700"}`}
      >
        <span className={`absolute top-0.5 size-4 rounded-full transition-all ${on ? "left-[18px] bg-on-accent" : "left-0.5 bg-ink-300"}`} />
      </button>
    </label>
  );
}

const ACCENTS = ["#ffffff", "#a1a1a1", "#3b82f6", "#06b6d4", "#22c55e", "#eab308", "#f97316", "#ef4444", "#ec4899", "#a855f7"];

function usePalette(dataUrl: string | null): string[] {
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    if (!dataUrl) return setColors([]);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 48;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, 48, 48);
      const px = ctx.getImageData(0, 0, 48, 48).data;
      const counts = new Map<string, number>();
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        if (Math.max(r, g, b) < 40) continue;
        const key = [r, g, b].map((v) => Math.min(255, Math.round(v / 32) * 32)).map((v) => v.toString(16).padStart(2, "0")).join("");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      setColors([...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => `#${k}`));
    };
    img.src = dataUrl;
  }, [dataUrl]);
  return colors;
}

function AccentPicker({ value, wallpaper }: { value: string; wallpaper: string | null }) {
  const suggested = usePalette(wallpaper);
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const set = (c: string) => setSetting("accent", c.toLowerCase());

  const Dot = ({ c }: { c: string }) => (
    <button
      title={c}
      onClick={() => set(c)}
      className={`size-7 rounded-full border border-ink-600 outline-offset-2 ${value.toLowerCase() === c.toLowerCase() ? "outline-2 outline-ink-100" : ""}`}
      style={{ background: c }}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Folder className="size-10 text-accent" fill="currentColor" fillOpacity={0.16} strokeWidth={1.5} />
        <span className="rounded bg-accent px-1.5 py-0.5 text-[12px] text-on-accent">seçili öğe</span>
        <button className="btn btn-primary py-1">Birincil buton</button>
        <span className="text-[12px] text-ink-400">Klasörler, seçimler, butonlar ve dock göstergeleri bu rengi kullanır.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {ACCENTS.map((c) => (
          <Dot key={c} c={c} />
        ))}
        <label className="ml-2 flex items-center gap-2">
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff"} onChange={(e) => set(e.target.value)} className="size-7 cursor-pointer rounded border border-ink-600 bg-transparent" />
          <input
            className="field w-24 py-1 font-mono text-[12px]"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            onBlur={() => /^#[0-9a-f]{6}$/i.test(hex) && set(hex)}
            onKeyDown={(e) => e.key === "Enter" && /^#[0-9a-f]{6}$/i.test(hex) && set(hex)}
            spellCheck={false}
          />
        </label>
      </div>
      {suggested.length > 0 && (
        <div className="flex items-center gap-2.5">
          <span className="text-[12px] text-ink-400">Duvar kağıdından:</span>
          {suggested.map((c) => (
            <Dot key={c} c={c} />
          ))}
        </div>
      )}
    </div>
  );
}
