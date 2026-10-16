import { indentWithTab } from "@codemirror/commands";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { Download, FileExclamationPoint, LoaderCircle, Save, ShieldCheck, TextWrap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errMsg, isErr } from "../lib/api";
import { baseName, downloadEntry, joinPath } from "../lib/files";
import { bumpFs, confirmDialog, patchWin, promptDialog, report, toast, useStore, withSudo } from "../lib/store";
import type { AppProps } from "./registry";

type Phase = "loading" | "ready" | "binary" | "denied" | "error";

const DENIED = /permission\s*denied/i;

const chrome = EditorView.theme({
  "&": { backgroundColor: "transparent" },
  ".cm-gutters": { backgroundColor: "transparent", borderRight: "1px solid #1a1a1a", color: "#555" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgb(255 255 255 / 0.04)" },
});

export default function Editor({ winId, props }: AppProps) {
  const home = useStore((s) => s.session!.home);
  const [path, setPath] = useState(props.path as string | undefined);
  const [phase, setPhase] = useState<Phase>(path ? "loading" : "ready");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sudo, setSudo] = useState(false);
  const [lang, setLang] = useState("Düz metin");
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [wrap, setWrap] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const langSlot = useRef(new Compartment());
  const wrapSlot = useRef(new Compartment());
  const saveRef = useRef<() => void>(() => {});

  async function applyLanguage(p: string) {
    const desc = LanguageDescription.matchFilename(languages, baseName(p));
    if (!desc || !view.current) return;
    const support = await desc.load();
    view.current?.dispatch({ effects: langSlot.current.reconfigure(support) });
    setLang(desc.name);
  }

  function mount(text: string) {
    view.current?.destroy();
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (saveRef.current(), true) }, indentWithTab]),
          oneDark,
          chrome,
          langSlot.current.of([]),
          wrapSlot.current.of([]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setDirty(true);
            if (u.docChanged || u.selectionSet) {
              const pos = u.state.selection.main.head;
              const line = u.state.doc.lineAt(pos);
              setCursor({ line: line.number, col: pos - line.from + 1 });
            }
          }),
        ],
      }),
    });
    setPhase("ready");
    setDirty(false);
    if (path) applyLanguage(path);
    view.current.focus();
  }

  async function load(useSudo: boolean) {
    if (!path) return mount("");
    setPhase("loading");
    try {
      const text = useSudo ? await withSudo(() => api.readTextSudo(path)) : await api.readText(path);
      setSudo(useSudo);
      mount(text);
    } catch (e) {
      setError(errMsg(e));
      if (isErr(e, "Binary") || isErr(e, "TooLarge")) setPhase("binary");
      else if (!useSudo && DENIED.test(errMsg(e))) setPhase("denied");
      else setPhase("error");
    }
  }

  useEffect(() => {
    load(false);
    return () => {
      view.current?.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const name = path ? baseName(path) : "Adsız";
    patchWin(winId, { dirty, title: `${dirty ? "● " : ""}${name}${sudo ? " (sudo)" : ""}` });
  }, [dirty, path, sudo, winId]);

  async function save() {
    const v = view.current;
    if (!v || saving) return;
    let target = path;
    if (!target) {
      const p = await promptDialog({ title: "Farklı kaydet", message: "Sunucudaki tam dosya yolu:", input: { value: joinPath(home, "yeni.txt"), selectStem: true }, confirmLabel: "Kaydet" });
      if (!p) return;
      target = p;
    }
    const dest = target;
    const text = v.state.doc.toString();
    setSaving(true);
    try {
      if (sudo) await withSudo(() => api.writeTextSudo(dest, text));
      else {
        try {
          await api.writeText(dest, text);
        } catch (e) {
          if (!DENIED.test(errMsg(e))) throw e;
          const ok = await confirmDialog({
            title: "Yazma izni yok",
            message: `${dest} dosyasına yazma izniniz yok. sudo ile (root olarak) kaydedilsin mi?`,
            confirmLabel: "sudo ile kaydet",
          });
          if (!ok) return;
          await withSudo(() => api.writeTextSudo(dest, text));
          setSudo(true);
        }
      }
      setDirty(false);
      if (!path) {
        setPath(dest);
        applyLanguage(dest);
      }
      bumpFs();
      toast(`Kaydedildi: ${baseName(dest)}`, "success");
    } catch (e) {
      report(e);
    } finally {
      setSaving(false);
    }
  }
  saveRef.current = save;

  function toggleWrap() {
    const next = !wrap;
    setWrap(next);
    view.current?.dispatch({ effects: wrapSlot.current.reconfigure(next ? EditorView.lineWrapping : []) });
  }

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="flex shrink-0 items-center gap-2 border-b border-ink-800 px-2 py-1.5 text-[12px]">
        <button className="btn py-1" onClick={save} disabled={phase !== "ready" || saving}>
          {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Kaydet
        </button>
        <button className={`icon-btn ${wrap ? "text-accent" : ""}`} onClick={toggleWrap} title="Satır kaydırma">
          <TextWrap className="size-4" />
        </button>
        {sudo && (
          <span className="flex items-center gap-1 rounded-md border border-ink-700 px-2 py-0.5 text-ink-100">
            <ShieldCheck className="size-3.5" /> root olarak düzenleniyor
          </span>
        )}
        <span className="ml-auto truncate font-mono text-ink-400">{path ?? "kaydedilmemiş dosya"}</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={host} className={phase === "ready" ? "h-full" : "hidden"} />
        {phase === "loading" && (
          <div className="grid h-full place-items-center text-ink-400">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        )}
        {phase !== "ready" && phase !== "loading" && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-[13px] text-ink-300">
            <FileExclamationPoint className="size-9 text-ink-400" />
            <p className="max-w-md">{phase === "denied" ? "Bu dosyayı okuma izniniz yok." : error}</p>
            <div className="flex gap-2">
              {phase === "denied" && (
                <button className="btn btn-primary" onClick={() => load(true).catch(report)}>
                  <ShieldCheck className="size-4" /> sudo ile aç
                </button>
              )}
              {path && phase !== "error" && (
                <button className="btn" onClick={() => downloadEntry({ path, name: baseName(path), isDir: false })}>
                  <Download className="size-4" /> İndir
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-4 border-t border-ink-800 px-3 py-1 font-mono text-[11px] text-ink-400">
        <span>
          Satır {cursor.line}, Sütun {cursor.col}
        </span>
        <span>{lang}</span>
        <span>UTF-8</span>
        <span className="ml-auto">{dirty ? "değiştirildi" : "kaydedildi"}</span>
      </div>
    </div>
  );
}
