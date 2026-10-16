import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowRight, FolderOpen, KeyRound, LoaderCircle, Lock, Server, TriangleAlert, User } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Logo, Wordmark } from "../App";
import { api, errMsg, isErr, type ConnectParams, type ProfileSummary } from "../lib/api";
import { Cancelled, confirmDialog, toast, useStore } from "../lib/store";

export default function Login({ initialError }: { initialError: string | null }) {
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [username, setUsername] = useState("");
  const [authKind, setAuthKind] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  useEffect(() => {
    api.savedProfile().catch(() => null).then((p) => {
      if (!p) return;
      setProfile(p);
      setHost(p.host);
      setPort(String(p.port));
      setUsername(p.username);
      setAuthKind(p.authKind);
    });
  }, []);

  async function connect(params: ConnectParams, trust?: string): Promise<void> {
    try {
      const info = await api.connect(params, remember, trust);
      useStore.setState({ session: info, disconnected: false });
    } catch (e) {
      if (isErr(e, "UnknownHostKey") && e.fingerprint) {
        const ok = await confirmDialog({
          title: "Sunucu kimliğini doğrulayın",
          message: `${params.host} sunucusuna ilk kez bağlanıyorsunuz. Aşağıdaki parmak izinin sunucunuzunkiyle aynı olduğundan emin olun (sunucuda: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub).`,
          detail: e.fingerprint,
          confirmLabel: "Güven ve bağlan",
        });
        if (!ok) throw new Cancelled();
        return connect(params, e.fingerprint);
      }
      if (isErr(e, "HostKeyMismatch") && e.fingerprint) {
        const ok = await confirmDialog({
          title: "Sunucu anahtarı değişmiş!",
          message: `${e.message} Sunucuyu yeniden kurmadıysanız veya anahtarı siz değiştirmediyseniz DEVAM ETMEYİN.`,
          detail: e.fingerprint,
          confirmLabel: "Yeni anahtara güven",
          danger: true,
        });
        if (!ok) throw new Cancelled();
        return connect(params, e.fingerprint);
      }
      throw e;
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await connect({
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        auth:
          authKind === "password"
            ? { kind: "password", password }
            : { kind: "key", key, passphrase: passphrase || null },
      });
    } catch (err) {
      if (!(err instanceof Cancelled)) setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function pickKey() {
    const path = await openDialog({ multiple: false, title: "Özel anahtar dosyası seçin" });
    if (typeof path === "string") setKey(path);
  }

  async function forget() {
    await api.forgetProfile();
    setProfile(null);
    toast("Kayıtlı bağlantı bilgileri silindi", "success");
  }

  const canSubmit = host.trim() && username.trim() && (authKind === "password" ? password : key.trim());

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "radial-gradient(var(--color-ink-700) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, #000 30%, transparent 100%)",
        }}
      />

      <header className="absolute inset-x-0 top-0 flex items-center justify-between px-10 py-7">
        <div className="flex items-center gap-2.5">
          <Logo size={18} />
          <Wordmark className="text-[17px]" />
        </div>
        <span className="font-mono text-[11px] text-ink-400">v0.3.0</span>
      </header>

      <div className="relative mx-auto flex h-full max-w-6xl items-center justify-between gap-20 px-12">
        <section className="hidden max-w-lg flex-1 lg:block animate-rise">
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 px-3 py-1 font-mono text-[11px] text-ink-300">
            <span className="size-1.5 rounded-full bg-accent" />
            SSH masaüstü ortamı
          </span>
          <h1 className="mt-6 text-[64px] leading-[0.95] font-semibold tracking-[-0.045em]">
            Sunucun,
            <br />
            <span className="text-ink-400">masaüstün.</span>
          </h1>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-ink-400">
            Pencereler, dosya gezgini, terminal, editör ve canlı sistem izleme. Tek bir SSH bağlantısı üzerinden, sunucuya
            hiçbir şey kurmadan.
          </p>

          <div className="mt-10 overflow-hidden rounded-lg border border-ink-800 bg-ink-900/80">
            <div className="flex items-center gap-1.5 border-b border-ink-800 px-3 py-2">
              <span className="size-2 rounded-full bg-ink-700" />
              <span className="size-2 rounded-full bg-ink-700" />
              <span className="size-2 rounded-full bg-ink-700" />
            </div>
            <div className="truncate px-4 py-3.5 font-mono text-[13px] text-ink-300">
              <span className="text-ink-400">$ </span>ssh {username.trim() || "kullanıcı"}@{host.trim() || "sunucu"}
              {port && port !== "22" && <span className="text-ink-400"> -p {port}</span>}
              <span className="ml-0.5 inline-block h-[1.1em] w-[0.55em] translate-y-[0.2em] animate-pulse bg-accent" />
            </div>
          </div>
        </section>

        <form onSubmit={submit} className="panel w-full max-w-[420px] rounded-2xl p-8 animate-rise">
          <h2 className="text-[22px] font-semibold tracking-tight">Bağlan</h2>
          <p className="mt-1 text-[13px] text-ink-400">
            {profile ? (
              <>
                Kayıtlı: <span className="font-mono text-ink-300">{profile.username}@{profile.host}</span>
              </>
            ) : (
              "Sunucunun SSH bilgilerini girin."
            )}
          </p>

          <div className="mt-7 grid grid-cols-[1fr_92px] gap-3">
            <Field label="Sunucu" icon={<Server />}>
              <input className="field pl-9 font-mono text-sm" value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.10" autoFocus spellCheck={false} />
            </Field>
            <Field label="Port">
              <input className="field font-mono text-sm" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" />
            </Field>
          </div>
          <Field label="Kullanıcı adı" icon={<User />} className="mt-4">
            <input className="field pl-9 font-mono text-sm" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" spellCheck={false} />
          </Field>

          <div className="mt-5 grid grid-cols-2 rounded-lg bg-black p-1 text-[13px] ring-1 ring-ink-800">
            {(["password", "key"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setAuthKind(k)}
                className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 transition ${authKind === k ? "bg-ink-800 text-ink-100" : "text-ink-400 hover:text-ink-300"}`}
              >
                {k === "password" ? <Lock className="size-3.5" /> : <KeyRound className="size-3.5" />}
                {k === "password" ? "Şifre" : "Özel anahtar"}
              </button>
            ))}
          </div>

          {authKind === "password" ? (
            <Field label="Şifre" icon={<Lock />} className="mt-4">
              <input className="field pl-9" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </Field>
          ) : (
            <>
              <Field label="Özel anahtar (yapıştırın veya dosya seçin)" className="mt-4">
                <div className="relative">
                  <textarea
                    className="field h-24 resize-none pr-10 font-mono text-[11px] leading-snug"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n…"}
                    spellCheck={false}
                  />
                  <button type="button" className="icon-btn absolute top-1.5 right-1.5" onClick={pickKey} title="Dosyadan seç">
                    <FolderOpen className="size-4" />
                  </button>
                </div>
              </Field>
              <Field label="Anahtar parolası (varsa)" icon={<KeyRound />} className="mt-3">
                <input className="field pl-9" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              </Field>
            </>
          )}

          <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-[13px] text-ink-300">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-accent" />
            Beni hatırla
            <span className="text-ink-400">· sonraki açılışta otomatik bağlan</span>
          </label>

          {error && (
            <div className="mt-4 flex gap-2 rounded-lg border border-danger/40 bg-danger/5 p-3 text-[13px] text-danger">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{error}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary group mt-6 w-full py-2.5 text-sm" disabled={busy || !canSubmit}>
            {busy && <LoaderCircle className="size-4 animate-spin" />}
            {busy ? "Bağlanılıyor…" : "Masaüstüne bağlan"}
            {!busy && <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />}
          </button>

          {profile && (
            <button type="button" onClick={forget} className="mt-3 w-full text-center text-xs text-ink-400 hover:text-ink-300">
              Kayıtlı bağlantıyı unut
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function Field({ label, icon, className = "", children }: { label: string; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[12px] font-medium text-ink-400">{label}</span>
      <span className="relative block">
        {icon && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-400 [&>svg]:size-4">{icon}</span>}
        {children}
      </span>
    </label>
  );
}
