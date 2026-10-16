import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ClipboardPaste,
  Copy,
  Database,
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileKey,
  FileMusic,
  FilePlus,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileVideoCamera,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Link,
  Lock,
  Pencil,
  Scissors,
  SquareTerminal,
  Trash,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { api, type Entry } from "./api";
import {
  bumpFs,
  confirmDialog,
  openApp,
  promptDialog,
  report,
  setClipboard,
  toast,
  useStore,
  type MenuItem,
} from "./store";

export const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"];

export function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function baseName(path: string): string {
  const t = path.replace(/\/+$/, "");
  return t.slice(t.lastIndexOf("/") + 1) || "/";
}

export function parentDir(path: string): string {
  const t = path.replace(/\/+$/, "");
  const i = t.lastIndexOf("/");
  return i <= 0 ? "/" : t.slice(0, i);
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? dir + name : `${dir}/${name}`;
}

const GROUPS: [string[], LucideIcon][] = [
  [IMAGE_EXT, FileImage],
  [["zip", "gz", "tgz", "xz", "bz2", "7z", "rar", "tar", "zst", "deb"], FileArchive],
  [["mp4", "mkv", "webm", "mov", "avi"], FileVideoCamera],
  [["mp3", "wav", "flac", "ogg", "m4a"], FileMusic],
  [["json", "yaml", "yml", "toml", "xml"], FileBraces],
  [["conf", "cfg", "ini", "env", "service", "properties"], FileCog],
  [["sh", "bash", "zsh", "fish"], FileTerminal],
  [["pem", "key", "pub", "crt", "cer"], FileKey],
  [["csv", "tsv", "xlsx", "ods"], FileSpreadsheet],
  [["sql", "db", "sqlite", "sqlite3"], Database],
  [["md", "txt", "log", "rst"], FileText],
  [
    ["js", "ts", "tsx", "jsx", "py", "rs", "go", "c", "h", "cpp", "java", "php", "rb", "lua", "html", "css", "scss", "vue", "svelte", "kt", "swift", "cs"],
    FileCode,
  ],
];

export function iconFor(e: Pick<Entry, "name" | "isDir">): { Icon: LucideIcon; color: string } {
  if (e.isDir) return { Icon: Folder, color: "var(--color-accent)" };
  const x = ext(e.name);
  const hit = GROUPS.find(([exts]) => exts.includes(x));
  return { Icon: hit ? hit[1] : File, color: "var(--color-ink-300)" };
}

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatMode(mode: number, isDir: boolean): string {
  const r = "rwxrwxrwx";
  let s = isDir ? "d" : "-";
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? r[i] : "-";
  return s;
}

const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" });
export const formatDate = (unix: number) => (unix ? dateFmt.format(new Date(unix * 1000)) : "—");

export function openEntry(e: Pick<Entry, "path" | "name" | "isDir">) {
  if (e.isDir) openApp("files", { path: e.path });
  else if (IMAGE_EXT.includes(ext(e.name))) openApp("viewer", { path: e.path }, e.name);
  else openApp("editor", { path: e.path }, e.name);
}


export async function newFolder(dir: string) {
  const name = await promptDialog({ title: "Yeni klasör", input: { value: "Yeni Klasör" }, confirmLabel: "Oluştur" });
  if (!name) return;
  await api.mkdir(joinPath(dir, name)).then(bumpFs, report);
}

export async function newFile(dir: string) {
  const name = await promptDialog({ title: "Yeni dosya", input: { value: "yeni.txt", selectStem: true }, confirmLabel: "Oluştur" });
  if (!name) return;
  await api.createFile(joinPath(dir, name)).then(bumpFs, report);
}

export async function renameEntry(e: Pick<Entry, "path" | "name">) {
  const name = await promptDialog({ title: "Yeniden adlandır", input: { value: e.name, selectStem: true }, confirmLabel: "Kaydet" });
  if (!name || name === e.name) return;
  await api.rename(e.path, joinPath(parentDir(e.path), name)).then(bumpFs, report);
}

export async function deleteEntries(paths: string[]) {
  if (!paths.length) return;
  const ok = await confirmDialog({
    title: paths.length === 1 ? `"${baseName(paths[0])}" silinsin mi?` : `${paths.length} öğe silinsin mi?`,
    message: "Bu işlem geri alınamaz. Klasörler içerikleriyle birlikte kalıcı olarak silinir.",
    confirmLabel: "Kalıcı olarak sil",
    danger: true,
  });
  if (!ok) return;
  await api.remove(paths).then(bumpFs, report);
}

export async function chmodEntry(e: Pick<Entry, "path" | "name" | "mode">) {
  const v = await promptDialog({
    title: `İzinler: ${e.name}`,
    message: "Sekizlik (octal) izin değeri girin, ör. 644 veya 755.",
    input: { value: (e.mode & 0o7777).toString(8).padStart(3, "0") },
    confirmLabel: "Uygula",
  });
  if (v === null) return;
  if (!/^[0-7]{3,4}$/.test(v)) return toast("Geçersiz izin değeri", "error");
  await api.chmod(e.path, parseInt(v, 8)).then(bumpFs, report);
}

export function entryMenu(targets: Entry[]): MenuItem[] {
  const one = targets.length === 1 ? targets[0] : null;
  const paths = targets.map((t) => t.path);
  const items: MenuItem[] = [];
  if (one) {
    items.push({ label: "Aç", icon: one.isDir ? FolderOpen : ExternalLink, hint: "Enter", onClick: () => openEntry(one) });
    if (one.isDir) items.push({ label: "Burada terminal aç", icon: SquareTerminal, onClick: () => openApp("terminal", { cwd: one.path }) });
    else items.push({ label: "Editörde aç", icon: FileCode, onClick: () => openApp("editor", { path: one.path }, one.name) });
    items.push({ label: one.isDir ? "İndir (.tar.gz)" : "İndir", icon: Download, onClick: () => downloadEntry(one) }, "sep");
  }
  items.push(
    { label: "Kopyala", icon: Copy, hint: "Ctrl+C", onClick: () => setClipboard("copy", paths) },
    { label: "Kes", icon: Scissors, hint: "Ctrl+X", onClick: () => setClipboard("cut", paths) },
  );
  if (one) {
    items.push(
      { label: "Yeniden adlandır", icon: Pencil, hint: "F2", onClick: () => renameEntry(one) },
      { label: "İzinler…", icon: Lock, onClick: () => chmodEntry(one) },
      { label: "Yolu kopyala", icon: Link, onClick: () => navigator.clipboard.writeText(one.path) },
    );
  }
  items.push("sep", { label: "Sil", icon: Trash, hint: "Del", danger: true, onClick: () => deleteEntries(paths) });
  return items;
}

export function dirMenu(dir: string, extra: MenuItem[] = []): MenuItem[] {
  const clip = useStore.getState().clipboard;
  return [
    { label: "Yeni klasör", icon: FolderPlus, onClick: () => newFolder(dir) },
    { label: "Yeni dosya", icon: FilePlus, onClick: () => newFile(dir) },
    "sep",
    { label: "Dosya yükle…", icon: Upload, onClick: () => uploadTo(dir) },
    { label: "Klasör yükle…", icon: FolderUp, onClick: () => uploadTo(dir, undefined, true) },
    {
      label: clip ? `Yapıştır (${clip.paths.length} öğe)` : "Yapıştır",
      icon: ClipboardPaste,
      hint: "Ctrl+V",
      disabled: !clip,
      onClick: () => pasteInto(dir),
    },
    "sep",
    { label: "Burada terminal aç", icon: SquareTerminal, onClick: () => openApp("terminal", { cwd: dir }) },
    ...extra,
  ];
}

export function fileKeys(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; preventDefault(): void },
  sel: Entry[],
  dir: string,
): boolean {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  const paths = sel.map((s) => s.path);
  if (k === "enter" && sel.length === 1) openEntry(sel[0]);
  else if (k === "delete" && sel.length) deleteEntries(paths);
  else if (k === "f2" && sel.length === 1) renameEntry(sel[0]);
  else if (mod && k === "c" && sel.length) setClipboard("copy", paths);
  else if (mod && k === "x" && sel.length) setClipboard("cut", paths);
  else if (mod && k === "v") pasteInto(dir);
  else return false;
  e.preventDefault();
  return true;
}

export async function pasteInto(dir: string) {
  const clip = useStore.getState().clipboard;
  if (!clip?.paths.length) return;
  try {
    if (clip.mode === "copy") await api.copyPaths(clip.paths, dir);
    else {
      await api.movePaths(clip.paths, dir);
      useStore.setState({ clipboard: null });
    }
    bumpFs();
  } catch (e) {
    report(e);
  }
}

function progressText(verb: string, done: number, total: number, name: string) {
  return total > 0
    ? `${verb}: ${name} — ${formatSize(done)} / ${formatSize(total)}`
    : `${verb}: ${name} — ${formatSize(done)}`;
}

export async function downloadEntry(e: Pick<Entry, "path" | "name" | "isDir">) {
  const fileName = e.isDir ? `${e.name}.tar.gz` : e.name;
  const local = await saveDialog({ defaultPath: fileName, title: "Nereye kaydedilsin?" });
  if (!local) return;
  const id = toast(`İndiriliyor: ${fileName}`, "info", { sticky: true, progress: 0 });
  try {
    await api.download(e.path, local, (p) =>
      toast(progressText("İndiriliyor", p.done, p.total, fileName), "info", {
        id,
        sticky: true,
        progress: p.total ? p.done / p.total : null,
      }),
    );
    toast(`İndirildi: ${fileName}`, "success", { id, action: { label: "Klasörde göster", onClick: () => revealItemInDir(local) } });
  } catch (err) {
    toast(`İndirme başarısız: ${String((err as { message?: string })?.message ?? err)}`, "error", { id });
  }
}

export async function uploadTo(dir: string, localPaths?: string[], directories = false) {
  let paths = localPaths;
  if (!paths) {
    const picked = await openDialog({ multiple: true, directory: directories, title: "Yüklenecek öğeleri seçin" });
    if (!picked) return;
    paths = Array.isArray(picked) ? picked : [picked];
  }
  if (!paths.length) return;
  const id = toast(`Yükleniyor (${paths.length} öğe)…`, "info", { sticky: true, progress: 0 });
  try {
    await api.upload(paths, dir, (p) =>
      toast(progressText("Yükleniyor", p.done, p.total, p.name || "…"), "info", {
        id,
        sticky: true,
        progress: p.total ? p.done / p.total : 1,
      }),
    );
    toast(`Yüklendi: ${paths.length} öğe → ${dir}`, "success", { id });
  } catch (err) {
    toast(`Yükleme başarısız: ${String((err as { message?: string })?.message ?? err)}`, "error", { id });
  }
  bumpFs();
}
