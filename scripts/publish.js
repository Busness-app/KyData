/**
 * Publishes dist/ to the gh-pages branch.
 *
 * Uses a detached worktree rather than switching branches, so an in-progress working tree is
 * never disturbed by a deploy.
 *
 *   node scripts/publish.js [--branch gh-pages] [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { cp, mkdtemp, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = path.join(ROOT, "dist");

const args = process.argv.slice(2);
const branch = args.includes("--branch") ? args[args.indexOf("--branch") + 1] : "gh-pages";
const dryRun = args.includes("--dry-run");

function git(cwd, ...cmd) {
  // Inherit stdout/stderr only on failure paths we handle ourselves, so probing for a missing
  // remote doesn't print git's own error on top of our clearer one.
  return execFileSync("git", cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

async function main() {
  if (!existsSync(path.join(DIST, "index.html"))) {
    fail("dist/index.html is missing. Run `npm run build` first.");
  }

  let remote;
  try {
    remote = git(ROOT, "remote", "get-url", "origin");
  } catch {
    fail(
      "No `origin` remote is configured, so there is nowhere to publish.\n" +
        "       Add one with: git remote add origin <url>"
    );
  }

  console.log(`kydata: publishing dist/ to ${branch} on ${remote}`);

  if (dryRun) {
    const files = await readdir(DIST);
    console.log(`kydata: dry run — would publish ${files.length} entries:\n  ${files.join("\n  ")}`);
    return;
  }

  const worktree = await mkdtemp(path.join(tmpdir(), "kydata-pages-"));

  try {
    // Reuse the remote branch if it exists; otherwise start an orphan with no history.
    const exists = safe(() => git(ROOT, "ls-remote", "--exit-code", "origin", branch));
    if (exists) {
      git(ROOT, "fetch", "origin", branch);
      git(ROOT, "worktree", "add", "--force", worktree, `origin/${branch}`);
      git(worktree, "switch", "-C", branch);
      // Clear the old build so removed files don't linger.
      for (const entry of await readdir(worktree)) {
        if (entry !== ".git") await rm(path.join(worktree, entry), { recursive: true, force: true });
      }
    } else {
      git(ROOT, "worktree", "add", "--force", "--detach", worktree);
      git(worktree, "checkout", "--orphan", branch);
      git(worktree, "rm", "-rf", "--quiet", ".");
    }

    await cp(DIST, worktree, { recursive: true });

    git(worktree, "add", "-A");

    const status = git(worktree, "status", "--porcelain");
    if (!status) {
      console.log("kydata: no change since the last publish");
      return;
    }

    const sha = git(ROOT, "rev-parse", "--short", "HEAD");
    git(worktree, "commit", "-m", `Publish architecture map from ${sha}`);
    git(worktree, "push", "origin", branch);

    const page = remote
      .replace(/^git@github\.com:/, "https://")
      .replace(/^https:\/\/github\.com\//, "https://")
      .replace(/\.git$/, "");
    const [owner, repo] = page.split("/").slice(-2);
    console.log(`kydata: published — https://${owner}.github.io/${repo}/`);
  } finally {
    safe(() => git(ROOT, "worktree", "remove", "--force", worktree));
    await rm(worktree, { recursive: true, force: true });
  }
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function fail(message) {
  console.error(`kydata: ${message}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`kydata: publish failed\n${err.stack ?? err.message}`);
  process.exit(1);
});
