import { readFileSync } from "node:fs";

export const isWindows = process.platform === "win32";

/**
 * WSL looks like Linux to Node, but its filesystem story is different enough
 * to matter: a project under /mnt/c goes through the Windows drive bridge and
 * is slow for world I/O, while a project under ~ is on ext4 and fast.
 */
export const isWSL = (() => {
  if (process.platform !== "linux") return false;
  try {
    return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
  } catch {
    return false;
  }
})();

/** True when the project directory lives on a Windows drive seen from WSL. */
export function isOnWindowsDrive(path: string): boolean {
  return isWSL && /^\/mnt\/[a-z](\/|$)/i.test(path);
}

/**
 * Legacy Windows consoles run codepage 437/850 and render box-drawing and
 * check marks as mojibake. Windows Terminal and VS Code set marker variables;
 * anything else gets ASCII.
 */
export const unicodeOk =
  !isWindows ||
  !!process.env.WT_SESSION ||
  !!process.env.TERM_PROGRAM ||
  process.env.ConEmuANSI === "ON";

export const sym = unicodeOk
  ? { ok: "✓", warn: "!", arrow: "›", bullet: "·" }
  : { ok: "+", warn: "!", arrow: ">", bullet: "-" };

/**
 * Whether host file ownership reaches the containers. On Linux a bind mount
 * shows the container the host's uid and gid as they are, so a directory
 * `cloud apply` creates as root is root's inside the container too — and the
 * server, which runs as uid 1000, cannot write to it. Docker Desktop on
 * Windows and macOS translates ownership itself, and there is nothing to fix.
 * WSL is Linux here: its Docker sees ext4 ownership as it is.
 */
export const ownershipMatters = process.platform === "linux";

/** The uid this process runs as. Null where there is none (Windows). */
export function processUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

/**
 * Gives a directory tree to uid:gid, changing only entries that are wrong —
 * so on a large world it costs a stat per file, not a write. Symlinks are
 * neither followed nor changed: a link in a server directory pointing
 * elsewhere must not hand that elsewhere to the server.
 */
export async function ownTree(path: string, uid: number, gid: number): Promise<void> {
  const { lstat, lchown, readdir } = await import("node:fs/promises");
  let st;
  try {
    st = await lstat(path);
  } catch {
    return; // not there (yet): nothing to own
  }
  if (st.isSymbolicLink()) return;
  if (st.uid !== uid || st.gid !== gid) await lchown(path, uid, gid);
  if (!st.isDirectory()) return;
  for (const entry of await readdir(path)) {
    await ownTree(`${path}/${entry}`, uid, gid);
  }
}

/**
 * Node's fs.chmod on Windows only toggles the read-only bit — it cannot make a
 * file owner-only. The forwarding secret would otherwise be readable by every
 * account on the machine, so we fall back to icacls, which is the real ACL
 * tool.
 */
export async function restrictToOwner(path: string): Promise<boolean> {
  if (!isWindows) {
    const { chmod } = await import("node:fs/promises");
    try {
      await chmod(path, 0o600);
      return true;
    } catch {
      // Returns false rather than throwing, on every platform: the file is
      // already written at this point, and aborting mid-apply over a
      // permission bit is worse than telling the caller it failed. The caller
      // warns — a secret nobody knows is unprotected is the bad outcome.
      return false;
    }
  }
  const { spawn } = await import("node:child_process");
  const user = process.env.USERNAME
    ? `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME}`.replace(/^\\/, "")
    : null;
  if (!user) return false;

  return new Promise((resolve) => {
    // Drop inherited ACEs, then grant only the current user full control.
    const child = spawn(
      "icacls",
      [path, "/inheritance:r", "/grant:r", `${user}:F`],
      { stdio: "ignore", windowsHide: true },
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

/** Advice worth printing once, not a hard error. */
export function platformNotes(root: string): string[] {
  const notes: string[] = [];
  if (isWindows) {
    notes.push(
      "Windows detected. Docker Desktop must be running and using the WSL 2 backend.",
    );
    notes.push(
      "For persistent worlds, storage = \"volume\" avoids the slow Windows drive bridge.",
    );
  }
  if (isOnWindowsDrive(root)) {
    notes.push(
      "This project is on a Windows drive (/mnt/...). World I/O will be slow.",
    );
    notes.push("Move it into the WSL filesystem (e.g. ~/networks) for a large speedup.");
  }
  return notes;
}
