import { LogOut, Power, Settings } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { Logo, Wordmark } from "../App";
import { APPS, type AppId } from "../lib/appMeta";
import { confirmDialog, logout, openApp, openMenu, useStore, type MenuItem } from "../lib/store";

const clockFmt = new Intl.DateTimeFormat("tr-TR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function TopBar() {
  const session = useStore((s) => s.session)!;
  const focusedTitle = useStore((s) => {
    const visible = s.windows.filter((w) => !w.minimized);
    if (!visible.length) return "Masaüstü";
    return APPS[visible.reduce((a, b) => (a.z > b.z ? a : b)).app].title;
  });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  async function askLogout() {
    const ok = await confirmDialog({
      title: "Oturum kapatılsın mı?",
      message: "SSH bağlantısı kapanır, açık terminaller sonlanır. Kayıtlı giriş bilgileriniz silinmez.",
      confirmLabel: "Oturumu kapat",
    });
    if (ok) logout();
  }

  function appMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const items: MenuItem[] = (Object.keys(APPS) as AppId[])
      .filter((a) => APPS[a].dock && a !== "settings")
      .map((a) => ({ label: APPS[a].title, icon: APPS[a].icon, onClick: () => openApp(a) }));
    items.push("sep", { label: "Ayarlar", icon: Settings, onClick: () => openApp("settings") }, {
      label: "Oturumu kapat",
      icon: LogOut,
      onClick: askLogout,
    });
    openMenu({ clientX: r.left, clientY: r.bottom + 4, preventDefault() {}, stopPropagation() {} }, items);
  }

  return (
    <header className="absolute inset-x-0 top-0 z-[9000] flex h-[34px] items-center gap-4 border-b border-ink-800 bg-black px-3 text-[13px]">
      <button onClick={appMenu} className="flex items-center gap-2 rounded-md px-1.5 py-0.5 hover:bg-ink-800">
        <Logo size={12} />
        <Wordmark />
      </button>
      <span className="font-medium text-ink-100">{focusedTitle}</span>
      <div className="flex-1" />
      <span className="flex items-center gap-2 font-mono text-[12px] text-ink-300" title={`${session.os} · ${session.kernel}`}>
        <span className="size-1.5 rounded-full bg-[#46a758]" />
        {session.username}@{session.hostname || session.host}
      </span>
      <span className="tabular-nums text-ink-100">{clockFmt.format(now)}</span>
      <button onClick={askLogout} className="icon-btn size-6" title="Oturumu kapat">
        <Power className="size-3.5" />
      </button>
    </header>
  );
}
