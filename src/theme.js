/**
 * Theme tokens.
 *
 * The base eight (bg, panel, ink, ink-strong, accent, accent-soft, line, glow) are copied
 * verbatim from kypost-server/frontend/src/theme.ts so KyData matches the apps exactly, and
 * use the same custom-property names as kypost-site/css/styles.css so this page can later be
 * dropped into the site with no restyling.
 *
 * The remaining tokens are KyData's own: colours for node kinds and for the security and
 * performance lenses.
 */

export const THEMES = {
  dark: {
    name: "Patina Ky",
    vars: {
      bg: "#0d0f14",
      panel: "#161a22",
      ink: "#64748b",
      "ink-strong": "#e2e8f0",
      accent: "#4deeea",
      "accent-soft": "#0e4a48",
      line: "#1e293b",
      glow: "rgba(77, 238, 234, 0.22)",

      // --line is a border colour and too faint for strokes people need to trace.
      edge: "#475569",

      "kind-service": "#4deeea",
      "kind-client": "#7dd3fc",
      "kind-module": "#94a3b8",
      "kind-datastore": "#fbbf24",
      "kind-external": "#64748b",

      "surface-public": "#f87171",
      "surface-paired": "#fbbf24",
      "surface-internal": "#4ade80",
      "surface-none": "#64748b",
      "surface-unknown": "#334155",

      "sens-public": "#64748b",
      "sens-pii": "#fbbf24",
      "sens-secret": "#f87171",
      "sens-e2ee": "#4deeea",

      "lat-realtime": "#f472b6",
      "lat-interactive": "#4deeea",
      "lat-batch": "#94a3b8",
      "lat-unknown": "#334155"
    }
  },

  light: {
    name: "Polished Ky",
    vars: {
      bg: "#eef2f6",
      panel: "#ffffff",
      ink: "#475569",
      "ink-strong": "#0f172a",
      accent: "#0891b2",
      "accent-soft": "#cffafe",
      line: "#cbd5e1",
      glow: "rgba(8, 145, 178, 0.18)",

      edge: "#94a3b8",

      "kind-service": "#0891b2",
      "kind-client": "#0369a1",
      "kind-module": "#475569",
      "kind-datastore": "#b45309",
      "kind-external": "#94a3b8",

      "surface-public": "#dc2626",
      "surface-paired": "#b45309",
      "surface-internal": "#15803d",
      "surface-none": "#94a3b8",
      "surface-unknown": "#cbd5e1",

      "sens-public": "#64748b",
      "sens-pii": "#b45309",
      "sens-secret": "#dc2626",
      "sens-e2ee": "#0891b2",

      "lat-realtime": "#be185d",
      "lat-interactive": "#0891b2",
      "lat-batch": "#475569",
      "lat-unknown": "#cbd5e1"
    }
  }
};

/** Render both themes as CSS custom properties, dark by default and light under [data-theme]. */
export function themeCss() {
  const block = (vars) =>
    Object.entries(vars)
      .map(([k, v]) => `  --${k}: ${v};`)
      .join("\n");

  return [
    `:root {\n${block(THEMES.dark.vars)}\n}`,
    `:root[data-theme="light"] {\n${block(THEMES.light.vars)}\n}`,
    `@media (prefers-color-scheme: light) {\n  :root:not([data-theme]) {\n${block(
      THEMES.light.vars
    )}\n  }\n}`
  ].join("\n\n");
}
