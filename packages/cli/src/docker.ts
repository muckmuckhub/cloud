import { spawn } from "node:child_process";
import { isWindows } from "./platform.ts";

export class DockerError extends Error {}

/**
 * We shell out to `docker compose` rather than reimplementing it. There is no
 * stable library binding for Compose, and its reconcile logic (create, update,
 * remove orphans) is precisely what we would otherwise have to write.
 */
export async function compose(
  root: string,
  args: string[],
  opts: { context?: string; stdio?: "inherit" | "pipe"; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string }> {
  const base = opts.context ? ["--context", opts.context] : [];
  const argv = [...base, "compose", ...args];
  return run("docker", argv, {
    cwd: root,
    stdio: opts.stdio ?? "inherit",
    timeoutMs: opts.timeoutMs,
  });
}

export async function docker(
  args: string[],
  opts: { context?: string; cwd?: string } = {},
): Promise<{ code: number; stdout: string }> {
  const base = opts.context ? ["--context", opts.context] : [];
  return run("docker", [...base, ...args], { cwd: opts.cwd, stdio: "pipe" });
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; stdio: "inherit" | "pipe"; timeoutMs?: number },
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: opts.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      // Prevents a console window flashing on Windows for piped calls.
      windowsHide: true,
    });
    // Killing the child, not just giving up on it: an abandoned `compose exec`
    // keeps its pipes open and the CLI would hang on exit anyway.
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(
            new DockerError(
              `\`docker ${args.join(" ")}\` did not finish within ${Math.round(
                opts.timeoutMs! / 1000,
              )}s.`,
            ),
          );
        }, opts.timeoutMs)
      : undefined;
    child.on("close", () => clearTimeout(timer));
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new DockerError(
            isWindows
              ? "docker not found on PATH.\n" +
                "  Install Docker Desktop: https://docs.docker.com/desktop/install/windows-install/\n" +
                "  If it is installed, make sure it is running — the CLI is only\n" +
                "  on PATH while the Docker Desktop engine is started."
              : "docker not found on PATH.\n" +
                "  Install Docker Engine: https://docs.docker.com/engine/install/",
          ),
        );
      } else reject(err);
    });
    child.on("close", (code, signal) => {
      // Ctrl+C out of `logs -f` reaches the child too. That is the user ending
      // the command, not a failure, so it must not print an error.
      if (signal === "SIGINT" || signal === "SIGTERM" || code === 130) {
        resolve({ code: 0, stdout });
        return;
      }
      if (code === 0) {
        resolve({ code: 0, stdout });
        return;
      }
      const msg = stderr.trim();
      if (/pipe\/dockerDesktopLinuxEngine|The system cannot find the file specified|daemon is not running/i.test(msg)) {
        reject(
          new DockerError(
            "cannot reach the Docker engine.\n" +
              "  Start Docker Desktop and wait for it to say \"Engine running\".",
          ),
        );
        return;
      }
      // With inherited stdio the output already went to the terminal, so
      // there is nothing to quote — but failing loudly still matters. Apply
      // used to report "network is up" after a failed `compose up`.
      reject(
        new DockerError(
          msg ||
            `\`docker ${args.join(" ")}\` exited with code ${code}.\n` +
              `  The output above says why.`,
        ),
      );
    });
  });
}

export interface ServiceStatus {
  name: string;
  state: string;
  health: string;
  uptime: string;
}

export async function status(
  root: string,
  context?: string,
  opts: { all?: boolean } = {},
): Promise<ServiceStatus[]> {
  // `ps` alone omits containers that are not running, which is fine for the
  // status table but hides exactly the case health polling needs to see.
  const args = opts.all ? ["ps", "-a", "--format", "json"] : ["ps", "--format", "json"];
  const { stdout } = await compose(root, args, {
    context,
    stdio: "pipe",
  });
  const out: ServiceStatus[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      out.push({
        name: j.Service ?? j.Name,
        state: j.State ?? "unknown",
        health: j.Health || "-",
        uptime: j.RunningFor ?? "-",
      });
    } catch {
      // compose versions differ in output shape; skip unparseable lines
    }
  }
  return out;
}

export interface PublishedPort {
  service: string;
  published: string;
  protocol: string;
  /** Empty means every interface, which is the case worth warning about. */
  hostIp: string;
}

/**
 * Ports published by the *merged* compose configuration.
 *
 * `docker compose` silently merges docker-compose.override.yml, which is how
 * you add a database or a Prometheus to a network — and also how the one
 * security property this tool guarantees can be bypassed without touching a
 * generated file. Reading the merged config is the only way to see that.
 */
export async function publishedPorts(
  root: string,
  context?: string,
): Promise<PublishedPort[]> {
  const { stdout } = await compose(root, ["config", "--format", "json"], {
    context,
    stdio: "pipe",
  });
  const out: PublishedPort[] = [];
  let cfg: {
    services?: Record<
      string,
      { ports?: { published?: string | number; protocol?: string; host_ip?: string }[] }
    >;
  };
  try {
    cfg = JSON.parse(stdout);
  } catch {
    return out; // compose versions differ; a warning is not worth failing over
  }
  for (const [service, svc] of Object.entries(cfg.services ?? {})) {
    for (const p of svc.ports ?? []) {
      if (p.published === undefined) continue;
      out.push({
        service,
        published: String(p.published),
        protocol: p.protocol ?? "tcp",
        hostIp: p.host_ip ?? "",
      });
    }
  }
  return out;
}

export type HealthVerdict = "ready" | "ready-unverified" | "waiting" | "failed";

/**
 * Whether an instance is ready to take players.
 *
 * Split out from the polling so the decision is testable without Docker. The
 * distinction that matters is "running" versus "healthy": a Paper container is
 * running within a second and cannot accept a login for another minute, which
 * is why a rolling restart that waits for `running` — or worse, for a fixed
 * number of seconds — takes the next instance down while the previous one is
 * still booting, and drops everyone.
 */
export function healthVerdict(s: ServiceStatus | undefined): HealthVerdict {
  if (!s) return "waiting"; // not created yet
  if (s.state === "exited" || s.state === "dead") return "failed";
  if (s.health === "unhealthy") return "failed";
  // "restarting" is a crash loop in progress; let it run into the timeout
  // rather than calling it a failure on the first sample.
  if (s.state !== "running") return "waiting";
  if (s.health === "starting") return "waiting";
  if (s.health === "healthy") return "ready";
  // An empty health field means one of two very different things: the image
  // has no healthcheck, or the container started so recently that Docker has
  // not registered the first check yet. A crash-looping container passes
  // through that second state on every restart — observed live as
  // `restarting -> running (health empty) -> running (starting) -> restarting`
  // — so treating it as ready lets a rollout call a dying server healthy and
  // take down the rest of the group. The caller resolves the ambiguity by
  // requiring it to hold still for a while.
  return "ready-unverified";
}

/**
 * Polls until a service is ready to take players, or gives up.
 *
 * Returns how long it waited, so the caller can print something true rather
 * than a spinner that means nothing.
 */
export async function waitForHealthy(
  root: string,
  service: string,
  opts: {
    context?: string;
    timeoutMs?: number;
    pollMs?: number;
    graceMs?: number;
  } = {},
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const pollMs = opts.pollMs ?? 3_000;
  // How long a container with no health information must stay up before we
  // believe it. Long enough to outlast the gap between two crash-loop
  // restarts, short enough not to matter for an image that simply has no
  // healthcheck.
  const graceMs = opts.graceMs ?? 15_000;
  const started = Date.now();
  let unverifiedSince: number | null = null;

  for (;;) {
    // -a so an exited container is still reported: without it the row simply
    // vanishes and a crashed service looks like one that has not started yet.
    const rows = await status(root, opts.context, { all: true });
    const row = rows.find((r) => r.name === service);
    const verdict = healthVerdict(row);

    if (verdict === "ready") return Date.now() - started;
    if (verdict === "ready-unverified") {
      unverifiedSince ??= Date.now();
      if (Date.now() - unverifiedSince >= graceMs) return Date.now() - started;
    } else {
      unverifiedSince = null;
    }
    if (verdict === "failed") {
      throw new DockerError(
        `${service} did not come back up (${row?.state}${
          row?.health && row.health !== "-" ? `, ${row.health}` : ""
        }).\n` +
          `  Nothing else was touched — the remaining instances are still running.\n` +
          `  See what happened: cloud logs ${service}`,
      );
    }
    if (Date.now() - started > timeoutMs) {
      throw new DockerError(
        `${service} was still not ready after ${Math.round(timeoutMs / 1000)}s.\n` +
          `  Nothing else was touched — the remaining instances are still running.\n` +
          `  A first boot generates a world and can be slow: cloud logs ${service}`,
      );
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** Sends a console command to a running Minecraft server via RCON. */
export async function rcon(
  root: string,
  service: string,
  command: string,
  context?: string,
  timeoutMs?: number,
): Promise<string> {
  const { stdout } = await compose(
    root,
    ["exec", "-T", service, "rcon-cli", command],
    { context, stdio: "pipe", timeoutMs },
  );
  return stdout.trim();
}

export interface PlayerList {
  online: number;
  max: number;
  names: string[];
}

/**
 * Parses the reply to `list`:
 *   There are 3 of a max of 20 players online: alice, bob, carol
 *
 * Returns null for anything else rather than guessing: a plugin that rewrites
 * the message, or a server still booting, is "unknown", not "0 players".
 * Colour codes are stripped — both the § codes a server may send and the ANSI
 * escapes rcon-cli translates them to.
 */
export function parsePlayerList(out: string): PlayerList | null {
  const plain = out.replace(/\x1b\[[0-9;]*m/g, "").replace(/§./g, "").trim();
  const m = /There are (\d+) (?:of a max(?: of)?|out of maximum) (\d+) players online\.?:?\s*(.*)$/s.exec(
    plain,
  );
  if (!m) return null;
  const names = m[3]
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return { online: Number(m[1]), max: Number(m[2]), names };
}
