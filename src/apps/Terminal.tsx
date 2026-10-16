import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { CornerDownLeft, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errMsg } from "../lib/api";
import { patchWin } from "../lib/store";
import type { AppProps } from "./registry";

const THEME = {
  background: "#00000000",
  foreground: "#e7eaf1",
  cursor: "#ffffff",
  cursorAccent: "#000000",
  selectionBackground: "#ffffff40",
  black: "#1c1f27",
  red: "#ff6b6b",
  green: "#8bd17c",
  yellow: "#ffcf6b",
  blue: "#6cb6ff",
  magenta: "#d8a2ff",
  cyan: "#5eead4",
  white: "#d4d8e2",
  brightBlack: "#5c6475",
  brightRed: "#ff8f8f",
  brightGreen: "#a8e89a",
  brightYellow: "#ffe08f",
  brightBlue: "#94cbff",
  brightMagenta: "#e6c2ff",
  brightCyan: "#8ff5e4",
  brightWhite: "#ffffff",
};

export default function Terminal({ winId, props }: AppProps) {
  const host = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<string[] | null>(null);
  const pendingRef = useRef<string[] | null>(null);
  const actions = useRef({ run: () => {}, cancel: () => {} });

  useEffect(() => {
    const el = host.current!;
    const term = new XTerm({
      fontFamily: '"Geist Mono Variable", "Cascadia Mono", monospace',
      fontSize: 13,
      lineHeight: 1.12,
      cursorBlink: true,
      scrollback: 10000,
      allowTransparency: true,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_, uri) => openUrl(uri)));
    term.open(el);

    let id: number | null = null;
    let disposed = false;
    let exited = false;

    const safeFit = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        try {
          fit.fit();
        } catch {}
      }
    };

    async function start() {
      exited = false;
      safeFit();
      try {
        const newId = await api.termOpen(term.cols, term.rows, props.cwd as string | undefined, (buf) => {
          if (buf.byteLength === 0) {
            exited = true;
            id = null;
            term.write("\r\n\x1b[2m[oturum sona erdi — yeniden başlatmak için Enter'a basın]\x1b[0m\r\n");
            return;
          }
          term.write(new Uint8Array(buf));
        });
        if (disposed) api.termClose(newId);
        else id = newId;
      } catch (e) {
        exited = true;
        term.write(`\r\n\x1b[31m${errMsg(e)}\x1b[0m\r\n\x1b[2m[yeniden denemek için Enter]\x1b[0m\r\n`);
      }
    }

    term.onData((d) => {
      if (exited) {
        if (d === "\r") start();
        return;
      }
      if (id !== null) api.termWrite(id, d).catch(() => {});
    });
    term.onResize(({ cols, rows }) => {
      if (id !== null) api.termResize(id, cols, rows).catch(() => {});
    });
    term.onTitleChange((t) => patchWin(winId, { title: t || "Terminal" }));
    const queue = (lines: string[] | null) => {
      pendingRef.current = lines;
      setPending(lines);
    };
    const run = async () => {
      const lines = pendingRef.current;
      queue(null);
      term.focus();
      if (!lines) return;
      for (const line of lines) {
        if (id === null) break;
        await api.termWrite(id, line + "\r").catch(() => {});
        await new Promise((r) => setTimeout(r, 40));
      }
    };
    actions.current = {
      run,
      cancel: () => {
        queue(null);
        term.focus();
      },
    };

    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (exited) return;
      const lines = (e.clipboardData?.getData("text/plain") ?? "")
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .filter((l) => l.trim());
      if (lines.length === 1) term.paste(lines[0]);
      else if (lines.length > 1) queue(lines);
    };
    el.addEventListener("paste", onPaste, true);

    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey && ev.code === "KeyC") {
        navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (ev.ctrlKey && !ev.altKey && ev.code === "KeyV") return false;
      if (pendingRef.current) {
        if (ev.type === "keydown") {
          ev.preventDefault();
          if (ev.key === "Enter") run();
          else if (ev.key === "Escape") actions.current.cancel();
        }
        return false;
      }
      return true;
    });

    const ro = new ResizeObserver(() => requestAnimationFrame(safeFit));
    ro.observe(el);
    start();
    term.focus();

    return () => {
      disposed = true;
      ro.disconnect();
      el.removeEventListener("paste", onPaste, true);
      if (id !== null) api.termClose(id);
      term.dispose();
    };
  }, [winId, props.cwd]);

  return (
    <div className="relative h-full bg-black">
      <div ref={host} className="h-full" />
      {pending && (
        <div className="panel absolute inset-x-3 bottom-3 overflow-hidden rounded-lg animate-rise">
          <div className="flex items-center justify-between border-b border-ink-800 px-3 py-2 text-[12px]">
            <span className="font-medium text-ink-100">{pending.length} komut yapıştırıldı</span>
            <span className="text-ink-400">sırayla çalıştırılacak</span>
          </div>
          <ol className="max-h-48 overflow-y-auto py-1.5 font-mono text-[12px]">
            {pending.map((line, i) => (
              <li key={i} className="flex gap-3 px-3 py-0.5">
                <span className="w-5 shrink-0 text-right text-ink-400">{i + 1}</span>
                <span className="min-w-0 break-all whitespace-pre-wrap text-ink-100">{line}</span>
              </li>
            ))}
          </ol>
          <div className="flex justify-end gap-2 border-t border-ink-800 px-3 py-2">
            <button className="btn py-1" onMouseDown={(e) => e.preventDefault()} onClick={() => actions.current.cancel()}>
              <X className="size-3.5" /> İptal <kbd className="font-mono text-[11px] text-ink-400">Esc</kbd>
            </button>
            <button className="btn btn-primary py-1" onMouseDown={(e) => e.preventDefault()} onClick={() => actions.current.run()}>
              <CornerDownLeft className="size-3.5" /> Çalıştır <kbd className="font-mono text-[11px] opacity-70">Enter</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
