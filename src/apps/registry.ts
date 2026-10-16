import { lazy, memo, type ComponentType } from "react";
import type { AppId } from "../lib/appMeta";

export type AppProps = { winId: string; props: Record<string, unknown> };

const app = (load: () => Promise<{ default: ComponentType<AppProps> }>) => memo(lazy(load));

export const REGISTRY: Record<AppId, ComponentType<AppProps>> = {
  files: app(() => import("./Files")),
  terminal: app(() => import("./Terminal")),
  editor: app(() => import("./Editor")),
  viewer: app(() => import("./ImageViewer")),
  monitor: app(() => import("./Monitor")),
  processes: app(() => import("./Processes")),
  services: app(() => import("./Services")),
  tunnels: app(() => import("./Tunnels")),
  settings: app(() => import("./Settings")),
};
