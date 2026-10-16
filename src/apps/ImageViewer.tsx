import { Download, ImageOff, LoaderCircle, Maximize, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errMsg } from "../lib/api";
import { baseName, downloadEntry, ext } from "../lib/files";
import type { AppProps } from "./registry";

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
};

export default function ImageViewer({ props }: AppProps) {
  const path = props.path as string;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [natural, setNatural] = useState<[number, number] | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    let alive = true;
    api
      .readBytes(path)
      .then((buf) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(new Blob([buf], { type: MIME[ext(path)] ?? "application/octet-stream" }));
        setUrl(objectUrl);
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  const step = (f: number) => setZoom((z) => Math.min(8, Math.max(0.1, (z === "fit" ? 1 : z) * f)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-ink-800 px-2 py-1.5 text-[12px]">
        <button className="icon-btn" onClick={() => step(1 / 1.25)} title="Uzaklaştır">
          <ZoomOut className="size-4" />
        </button>
        <span className="w-12 text-center font-mono text-ink-300">{zoom === "fit" ? "sığdır" : `${Math.round(zoom * 100)}%`}</span>
        <button className="icon-btn" onClick={() => step(1.25)} title="Yakınlaştır">
          <ZoomIn className="size-4" />
        </button>
        <button className="icon-btn" onClick={() => setZoom("fit")} title="Pencereye sığdır">
          <Maximize className="size-4" />
        </button>
        <button className="btn ml-1 py-1" onClick={() => setZoom(1)}>
          1:1
        </button>
        {natural && (
          <span className="ml-2 font-mono text-ink-400">
            {natural[0]}×{natural[1]}
          </span>
        )}
        <button className="icon-btn ml-auto" onClick={() => downloadEntry({ path, name: baseName(path), isDir: false })} title="İndir">
          <Download className="size-4" />
        </button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{ background: "repeating-conic-gradient(#111 0% 25%, #000 0% 50%) 50% / 20px 20px" }}
        onWheel={(e) => e.ctrlKey && step(e.deltaY < 0 ? 1.1 : 1 / 1.1)}
      >
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-[13px] text-ink-300">
            <ImageOff className="size-9 text-ink-400" />
            {error}
          </div>
        ) : !url ? (
          <div className="grid h-full place-items-center text-ink-400">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        ) : (
          <div className="grid min-h-full min-w-full place-items-center p-4">
            <img
              src={url}
              alt={baseName(path)}
              draggable={false}
              onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
              className={zoom === "fit" ? "max-h-full max-w-full object-contain" : ""}
              style={
                zoom === "fit" ? { maxHeight: "calc(100% - 0px)" } : natural ? { width: natural[0] * zoom, maxWidth: "none" } : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
