/**
 * Minimal static server for previewing dist/ locally.
 *
 * The build output is designed to work straight off disk, so this exists only because some
 * tooling refuses to load file:// URLs.
 *
 *   node scripts/serve.js [port]
 */

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.argv[2] ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".ttf": "font/ttf",
  ".css": "text/css",
  ".js": "text/javascript"
};

createServer(async (req, res) => {
  // Strip the query and hash before touching the filesystem.
  let pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (pathname.endsWith("/")) pathname += "index.html";

  const file = path.join(DIST, pathname);

  // Refuse anything that escapes dist/.
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
      // Always revalidate, so a rebuild shows up on refresh during development.
      "cache-control": "no-store"
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(PORT, () => {
  console.log(`kydata: serving dist/ at http://localhost:${PORT}`);
});
