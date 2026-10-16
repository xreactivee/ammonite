import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
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
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type === "keydown" && ev.ctrlKey && ev.shiftKey) {
        if (ev.code === "KeyC") {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        if (ev.code === "KeyV") return false;
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
      if (id !== null) api.termClose(id);
      term.dispose();
    };
  }, [winId, props.cwd]);

  return (
    <div className="h-full bg-black">
      <div ref={host} className="h-full" />
    </div>
  );
}
