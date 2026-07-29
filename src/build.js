/**
 * KyData build: validate -> seed layout -> bundle -> emit flat files.
 *
 *   node src/build.js [data/kypost.json] [--out dist]
 */

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

import { loadGraph, validateGraph } from "./validate.js";
import { seedPositions } from "./layout.js";
import { renderHtml } from "./emit.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Fonts are shared with the rest of KyPost; we copy rather than re-license or re-host. */
const FONT_SOURCE = path.join(ROOT, "assets", "fonts");

const fontFaces = (base) =>
  `
@font-face {
  font-family: "Space Grotesk";
  src: url("${base}fonts/Space_Grotesk/SpaceGrotesk-VariableFont_wght.ttf") format("truetype");
  font-weight: 300 700;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("${base}fonts/IBM_Plex_Mono/IBMPlexMono-Regular.ttf") format("truetype");
  font-weight: 400;
  font-display: swap;
}
@font-face {
  font-family: "IBM Plex Mono";
  src: url("${base}fonts/IBM_Plex_Mono/IBMPlexMono-Medium.ttf") format("truetype");
  font-weight: 500;
  font-display: swap;
}`.trim();

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  const outDir = path.resolve(ROOT, flag("--out") ?? "dist");

  /**
   * Where the logo and fonts are served from, relative to the page. Publishing into a site that
   * already ships these means pointing at its copy instead of shipping a second one — the fonts
   * alone are 2 MB. Left unset, the build stays self-contained and works off disk.
   */
  const assetBase = flag("--assets");
  const assets = assetBase ? assetBase.replace(/\/?$/, "/") : "assets/";

  const taken = new Set([flag("--out"), assetBase]);
  const dataPath = path.resolve(
    ROOT,
    args.find((a) => !a.startsWith("--") && !taken.has(a)) ?? "data/kypost.json"
  );

  console.log(`kydata: reading ${path.relative(ROOT, dataPath)}`);
  const graph = await loadGraph(dataPath);

  const problems = await validateGraph(graph);
  if (problems.length) {
    console.error(`kydata: ${problems.length} problem(s) in the graph:`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`kydata: ${graph.nodes.length} nodes, ${graph.edges.length} edges — valid`);

  console.log("kydata: seeding layout");
  const seeds = seedPositions(graph);

  console.log("kydata: bundling client");
  const bundle = await esbuild.build({
    entryPoints: [path.join(ROOT, "src/app/main.js")],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2022"],
    write: false,
    legalComments: "none"
  });
  const js = bundle.outputFiles[0].text;
  const css = await readFile(path.join(ROOT, "src/app/styles.css"), "utf8");

  const html = renderHtml({ graph, seeds, js, css, fontCss: fontFaces(assets), assets });

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "index.html"), html);

  // The raw graph alongside the page, so it can be diffed and reused without scraping HTML.
  await writeFile(path.join(outDir, "graph.json"), JSON.stringify(graph, null, 2) + "\n");

  // Stops GitHub Pages running the output through Jekyll.
  await writeFile(path.join(outDir, ".nojekyll"), "");

  if (!assetBase) {
    await mkdir(path.join(outDir, "assets"), { recursive: true });
    const logo = path.join(ROOT, "assets", "ky.png");
    if (existsSync(logo)) await cp(logo, path.join(outDir, "assets", "ky.png"));
    if (existsSync(FONT_SOURCE)) {
      await cp(FONT_SOURCE, path.join(outDir, "assets", "fonts"), { recursive: true });
    }
  }

  const kb = Math.round(Buffer.byteLength(html) / 1024);
  const note = assetBase ? `assets from ${assets}` : "self-contained";
  console.log(`kydata: wrote ${path.relative(ROOT, outDir)}/index.html (${kb} kB, ${note})`);
}

main().catch((err) => {
  console.error(`kydata: build failed\n${err.stack ?? err.message}`);
  process.exit(1);
});
