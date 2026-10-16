import type { LucideIcon } from "lucide-react";
import { create } from "zustand";
import { api, errMsg, isErr, type SessionInfo } from "./api";
import { APPS, type AppId } from "./appMeta";

export type Win = {
  id: string;
  app: AppId;
  title: string;
  props: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  dirty?: boolean;
};

export type MenuItem =
  | { label: string; icon?: LucideIcon; onClick: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | "sep";

export type Toast = {
  id: string;
  text: string;
  kind: "info" | "error" | "success";
  progress?: number | null;
  action?: { label: string; onClick: () => void };
};

export type DialogReq = {
  title: string;
  message?: string;
  detail?: string;
  input?: { value?: string; placeholder?: string; password?: boolean; selectStem?: boolean };
  confirmLabel?: string;
  cancelLabel?: string | null;
  danger?: boolean;
};

type State = {
  session: SessionInfo | null;
  disconnected: boolean;
  settings: Record<string, string>;
  windows: Win[];
  zTop: number;
  fsTick: number;
  toasts: Toast[];
  dialog: (DialogReq & { resolve: (v: string | boolean | null) => void }) | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
  clipboard: { mode: "copy" | "cut"; paths: string[] } | null;
};

export const useStore = create<State>(() => ({
  session: null,
  disconnected: false,
  settings: {},
  windows: [],
  zTop: 10,
  fsTick: 0,
  toasts: [],
  dialog: null,
  menu: null,
  clipboard: null,
}));

const set = useStore.setState;
const get = useStore.getState;

export const TOP_BAR = 34;
export const DOCK_SPACE = 96;

export function desktopArea() {
  return { top: TOP_BAR, w: window.innerWidth, h: window.innerHeight - TOP_BAR - DOCK_SPACE };
}


let winSeq = 0;

export function openApp(app: AppId, props: Record<string, unknown> = {}, title?: string): string {
  const meta = APPS[app];
  const { windows, zTop } = get();
  const existing = windows.find(
    (w) => w.app === app && (meta.single || (props.path && (app === "editor" || app === "viewer") && w.props.path === props.path)),
  );
  if (existing) {
    focusWin(existing.id);
    return existing.id;
  }
  const area = desktopArea();
  const w = Math.min(meta.size[0], area.w - 40);
  const h = Math.min(meta.size[1], area.h - 20);
  const n = (windows.length % 7) - 3;
  const x = Math.max(8, Math.round((area.w - w) / 2 + n * 28));
  const y = Math.max(area.top + 8, Math.round(area.top + (area.h - h) / 2 + n * 22));
  const id = `w${++winSeq}`;
  set({
    windows: [...windows, { id, app, title: title ?? meta.title, props, x, y, w, h, z: zTop + 1, minimized: false, maximized: false }],
    zTop: zTop + 1,
  });
  return id;
}

export function patchWin(id: string, patch: Partial<Win>) {
  set({ windows: get().windows.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
}

export function focusWin(id: string) {
  const { zTop, windows } = get();
  const w = windows.find((x) => x.id === id);
  if (!w || (w.z === zTop && !w.minimized)) return;
  set({ zTop: zTop + 1 });
  patchWin(id, { z: zTop + 1, minimized: false });
}

export function minimizeWin(id: string) {
  patchWin(id, { minimized: true });
}

export function toggleMaxWin(id: string) {
  const w = get().windows.find((x) => x.id === id);
  if (w) patchWin(id, { maximized: !w.maximized });
}

export async function closeWin(id: string) {
  const w = get().windows.find((x) => x.id === id);
  if (!w) return;
  if (w.dirty) {
    const ok = await confirmDialog({
      title: "Kaydedilmemiş değişiklikler",
      message: `"${w.title.replace(/^● /, "")}" içindeki değişiklikler kaybolacak. Yine de kapatılsın mı?`,
      confirmLabel: "Kaydetmeden kapat",
      danger: true,
    });
    if (!ok) return;
  }
  set({ windows: get().windows.filter((x) => x.id !== id) });
}

export function focusedWinId(): string | null {
  const visible = get().windows.filter((w) => !w.minimized);
  if (!visible.length) return null;
  return visible.reduce((a, b) => (a.z > b.z ? a : b)).id;
}


function ask(req: DialogReq): Promise<string | boolean | null> {
  get().dialog?.resolve(null);
  return new Promise((resolve) => set({ dialog: { cancelLabel: "Vazgeç", ...req, resolve } }));
}

export function closeDialog(value: string | boolean | null) {
  const d = get().dialog;
  set({ dialog: null });
  d?.resolve(value);
}

export async function confirmDialog(req: DialogReq): Promise<boolean> {
  return (await ask(req)) === true;
}

export async function promptDialog(req: DialogReq & { input: NonNullable<DialogReq["input"]> }): Promise<string | null> {
  const v = await ask(req);
  return typeof v === "string" ? v : null;
}


let toastSeq = 0;
const timers = new Map<string, number>();

export function toast(
  text: string,
  kind: Toast["kind"] = "info",
  opts: { id?: string; progress?: number | null; action?: Toast["action"]; sticky?: boolean } = {},
): string {
  const id = opts.id ?? `t${++toastSeq}`;
  const t: Toast = { id, text, kind, progress: opts.progress, action: opts.action };
  const list = get().toasts;
  set({ toasts: list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? t : x)) : [...list, t] });
  clearTimeout(timers.get(id));
  if (!opts.sticky) timers.set(id, window.setTimeout(() => dismissToast(id), kind === "error" ? 7000 : opts.action ? 6000 : 3500));
  return id;
}

export function dismissToast(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  set({ toasts: get().toasts.filter((t) => t.id !== id) });
}

export class Cancelled extends Error {}

export function report(e: unknown) {
  if (!(e instanceof Cancelled)) toast(errMsg(e), "error");
}


export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  set({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function closeMenu() {
  if (get().menu) set({ menu: null });
}

export function bumpFs() {
  set({ fsTick: get().fsTick + 1 });
}

export function setClipboard(mode: "copy" | "cut", paths: string[]) {
  set({ clipboard: { mode, paths } });
}

export function setSetting(key: string, value: string) {
  set({ settings: { ...get().settings, [key]: value } });
  api.setSetting(key, value).catch(report);
}

export async function logout() {
  await api.disconnect().catch(() => {});
  set({ session: null, windows: [], disconnected: false, menu: null, clipboard: null });
}

export async function withSudo<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isErr(e, "SudoRequired")) throw e;
      const pw = await promptDialog({
        title: "Yönetici yetkisi gerekiyor",
        message: "Bu işlem sudo gerektiriyor. Sunucudaki kullanıcı şifrenizi girin (yalnızca bu oturum boyunca bellekte tutulur).",
        input: { password: true, placeholder: "sudo şifresi" },
        confirmLabel: "Onayla",
      });
      if (pw === null) throw new Cancelled("İptal edildi");
      try {
        await api.setSudoPassword(pw);
      } catch (e2) {
        if (!isErr(e2, "SudoRequired")) throw e2;
        toast("sudo şifresi kabul edilmedi", "error");
      }
    }
  }
}
