import { listen } from "@tauri-apps/api/event";
import { LoaderCircle, LogOut, RotateCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import ContextMenu from "./components/ContextMenu";
import Desktop from "./components/Desktop";
import Dialog from "./components/Dialog";
import Login from "./components/Login";
import Toasts from "./components/Toasts";
import { api, errMsg } from "./lib/api";
import { bumpFs, logout, toast, useStore } from "./lib/store";

let booted = false;

export function onColor(hex: string): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#000000" : "#ffffff";
}

export default function App() {
  const session = useStore((s) => s.session);
  const disconnected = useStore((s) => s.disconnected);
  const accent = useStore((s) => s.settings.accent) || "#ffffff";
  const [ready, setReady] = useState(booted);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty("--user-accent", accent);
    root.setProperty("--user-on-accent", onColor(accent));
  }, [accent]);

  useEffect(() => {
    const unlisten = [
      listen("ssh-disconnected", () => useStore.setState({ disconnected: true })),
      listen<string>("notice", (e) => toast(e.payload, "error")),
    ];
    if (!booted) {
      booted = true;
      (async () => {
        try {
          useStore.setState({ settings: await api.getSettings() });
        } catch {}
        try {
          const info = await api.autoConnect();
          if (info) useStore.setState({ session: info });
        } catch (e) {
          setBootError(errMsg(e));
        }
        setReady(true);
      })();
    }
    const noMenu = (e: MouseEvent) => {
      if (import.meta.env.PROD && !(e.target as HTMLElement).closest("input,textarea")) e.preventDefault();
    };
    window.addEventListener("contextmenu", noMenu);
    return () => {
      unlisten.forEach((p) => p.then((f) => f()));
      window.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  return (
    <>
      {!ready ? <Splash /> : session ? <Desktop /> : <Login initialError={bootError} />}
      {session && disconnected && <Disconnected />}
      <ContextMenu />
      <Dialog />
      <Toasts />
    </>
  );
}

function Splash() {
  return (
    <div className="fixed inset-0 grid place-items-center bg-black">
      <div className="flex flex-col items-center gap-5 animate-rise">
        <Logo size={56} grid />
        <Wordmark className="text-2xl" />
        <div className="flex items-center gap-2 text-sm text-ink-400">
          <LoaderCircle className="size-4 animate-spin" /> Kayıtlı sunucuya bağlanılıyor…
        </div>
      </div>
    </div>
  );
}

export function Logo({ size = 16, grid = false }: { size?: number; grid?: boolean }) {
  return (
    <svg
      height={size}
      width={(size * 13.8) / 8.8}
      viewBox="-0.4 -0.4 13.8 8.8"
      aria-hidden
      className="shrink-0 text-ink-100"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {grid && (
        <g stroke="var(--color-ink-600)" strokeWidth={0.07}>
          <rect width="13" height="8" />
          <path d="M8 0V8M8 5H13M10 5V8M8 6H10M9 5V6" />
        </g>
      )}
      <path d="M0 8A8 8 0 0 1 8 0A5 5 0 0 1 13 5A3 3 0 0 1 10 8A2 2 0 0 1 8 6A1 1 0 0 1 9 5" stroke="currentColor" strokeWidth={size < 24 ? 0.95 : 0.6} />
      <rect x="9.3" y="5.1" width="0.54" height="0.8" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.03em] text-ink-100 ${className}`}>
      ammonite<span className="text-accent">.</span>
    </span>
  );
}

function Disconnected() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const info = await api.reconnect();
      useStore.setState({ session: info, disconnected: false });
      bumpFs();
      toast("Yeniden bağlanıldı. Açık terminaller yeniden başlatılmalı.", "success");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9700] grid place-items-center bg-black/70 animate-fade">
      <div className="panel w-[400px] rounded-xl p-6 text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full border border-ink-700 text-danger">
          <WifiOff className="size-7" />
        </div>
        <h2 className="text-lg font-semibold">Bağlantı koptu</h2>
        <p className="mt-2 text-sm text-ink-300">
          Sunucuyla SSH bağlantısı kesildi. Ağ bağlantınızı kontrol edip yeniden bağlanmayı deneyin.
        </p>
        {error && <p className="mt-3 rounded-lg bg-danger/10 p-2 text-xs text-danger">{error}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <button className="btn" onClick={logout}>
            <LogOut className="size-4" /> Giriş ekranı
          </button>
          <button className="btn btn-primary" onClick={retry} disabled={busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <RotateCw className="size-4" />} Yeniden bağlan
          </button>
        </div>
      </div>
    </div>
  );
}
