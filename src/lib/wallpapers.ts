export const WALLPAPERS: Record<string, { name: string; css: string }> = {
  black: { name: "Siyah", css: "#000" },
  charcoal: { name: "Kömür", css: "#0a0a0a" },
  graphite: { name: "Grafit", css: "#1a1a1a" },
  dots: { name: "Noktalar", css: "radial-gradient(#ffffff26 1px, transparent 1px) 0 0 / 24px 24px, #000" },
  grid: {
    name: "Izgara",
    css: "linear-gradient(#ffffff0f 1px, transparent 1px) 0 0 / 48px 48px, linear-gradient(90deg, #ffffff0f 1px, transparent 1px) 0 0 / 48px 48px, #000",
  },
};

export const DEFAULT_WALLPAPER = "black";

export function wallpaperCss(value?: string): string {
  if (value?.startsWith("data:")) return `center / cover no-repeat url("${value}"), #000`;
  return (WALLPAPERS[value ?? ""] ?? WALLPAPERS[DEFAULT_WALLPAPER]).css;
}
