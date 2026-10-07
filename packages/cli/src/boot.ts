import type { CloudConfig } from "./types.ts";
import { compose, healthVerdict, status } from "./docker.ts";
import { instanceNames } from "./render/compose.ts";
import { c, sym } from "./ui.ts";

/**
 * Following a network from `docker compose up` to the moment a player can
 * actually join.
 *
 * `apply` used to say "network is up" the instant the containers started — a
 * minute before any of them could accept a login. This watches instead: each
 * server's phase read from its own log, and "ready" only once Docker's
 * healthcheck passes, which needs the server to answer a status ping — after
 * it has printed Done. The network is joinable when the proxy and every
 * instance of the fallback group are ready; that is the moment worth
 * announcing, and the one `apply` waits for.
 */

/**
 * What a server is doing, from the last lines of its log. Read backwards: the
 * newest line that says anything recognisable wins.
 */
export function bootPhase(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/Done \([\d.,]+s\)!/.test(l)) return "Done";
    const spawn = /Preparing spawn area: (\d+)%/.exec(l);
    if (spawn) return `generating world ${spawn[1]}%`;
    if (/Preparing (start region|level)/.test(l)) return "generating world";
    if (/Loading \d+ mods/.test(l)) return "loading mods";
    if (/Starting minecraft server|Loading Paper|Starting org\.bukkit|Booting up Velocity|Enabled (BungeeCord|Waterfall)|Starting net\.minecraft|Starting server/i.test(l)) {
      return "starting server";
    }
    if (/Downloading mojang_|Applying patches/.test(l)) return "preparing server jar";
    if (/Downloaded \/data\/(plugins|mods)\//.test(l)) return "installing plugins";
    if (/Downloaded \/(data|server)\/\S+\.jar|Downloading .*(paper|purpur|folia|fabric|neoforge|velocity|waterfall|bungeecord)|[Ii]nstalling (NeoForge|Fabric)/i.test(l)) {
      return "downloading server";
    }
  }
  return "starting container";
}

export interface BootResult {
  /** Milliseconds until the proxy and the fallback group were ready. */
  joinableAfter: number | null;
  /** Services that crashed or never became ready. */
  failed: string[];
  timedOut: boolean;
}

interface Line {
  service: string;
  phase: string;
  ready: boolean;
  failed: boolean;
  at: number;
}

export async function watchBoot(
  root: string,
  cfg: CloudConfig,
  opts: { context?: string; timeoutMs?: number; pollMs?: number } = {},
): Promise<BootResult> {
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const pollMs = opts.pollMs ?? 2_000;
  const started = Date.now();
  const fallback = Object.entries(cfg.groups).find(([, g]) => g.fallback)!;
  const mustBeReady = ["proxy", ...instanceNames(fallback[0], fallback[1].min)];
  const services = [
    "proxy",
    ...Object.entries(cfg.groups).flatMap(([name, g]) => instanceNames(name, g.min)),
  ];
  const lines = new Map<string, Line>(
    services.map((s) => [s, { service: s, phase: "starting container", ready: false, failed: false, at: 0 }]),
  );
  const restartsSeen = new Map<string, number>();
  const view = new Board(services);
  let joinableAfter: number | null = null;

  for (;;) {
    const rows = await status(root, opts.context, { all: true }).catch(() => []);
    const pending = services.filter((s) => !lines.get(s)!.ready && !lines.get(s)!.failed);
    await Promise.all(
      pending.map(async (s) => {
        const line = lines.get(s)!;
        const row = rows.find((r) => r.name === s);
        const verdict = healthVerdict(row);
        if (row?.state === "restarting") restartsSeen.set(s, (restartsSeen.get(s) ?? 0) + 1);
        if (verdict === "ready") {
          line.ready = true;
          line.phase = "ready";
          line.at = Date.now() - started;
          return;
        }
        // A server restarting on two polls in a row is crash-looping, not
        // slow: say so now rather than wait out the timeout.
        if (verdict === "failed" || (restartsSeen.get(s) ?? 0) >= 2) {
          line.failed = true;
          line.phase = `crashed — see: cloud logs ${s}`;
          return;
        }
        const { stdout } = await compose(root, ["logs", "--no-log-prefix", "--tail", "40", s], {
          context: opts.context,
          stdio: "pipe",
        }).catch(() => ({ stdout: "" }));
        // The last 40 lines can hold nothing recognisable — a burst of plugin
        // output — and a phase that slides back to "starting container" reads
        // as a restart. Keep the last phase seen until a newer one shows up.
        const phase = bootPhase(stdout.split("\n"));
        if (phase !== "starting container" || line.phase === "starting container") {
          line.phase = phase;
        }
      }),
    );

    if (joinableAfter === null && mustBeReady.every((s) => lines.get(s)!.ready)) {
      joinableAfter = Date.now() - started;
    }
    view.draw([...lines.values()]);

    const failed = services.filter((s) => lines.get(s)!.failed);
    const done = services.every((s) => lines.get(s)!.ready || lines.get(s)!.failed);
    if (done) return { joinableAfter, failed, timedOut: false };
    if (Date.now() - started > timeoutMs) {
      return {
        joinableAfter,
        failed: [...failed, ...services.filter((s) => !lines.get(s)!.ready && !failed.includes(s))],
        timedOut: true,
      };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * The progress display. In a terminal it redraws one block in place; piped
 * (CI, a log file) it prints a line only when a server's phase changes, so the
 * output stays readable instead of filling with escape codes.
 */
class Board {
  private drawn = 0;
  private last = new Map<string, string>();
  private readonly width: number;
  private readonly tty = !!process.stdout.isTTY;

  constructor(services: string[]) {
    this.width = Math.max(...services.map((s) => s.length));
  }

  draw(lines: Line[]): void {
    const text = (l: Line) => {
      const name = l.service.padEnd(this.width);
      if (l.ready) return `  ${c.green(sym.ok)} ${name}  ${c.dim(`ready in ${Math.round(l.at / 1000)}s`)}`;
      if (l.failed) return `  ${c.red(sym.fail)} ${name}  ${c.red(l.phase)}`;
      return `  ${c.dim("…")} ${name}  ${l.phase}`;
    };
    if (!this.tty) {
      for (const l of lines) {
        const t = text(l);
        if (this.last.get(l.service) !== t) {
          this.last.set(l.service, t);
          console.log(t);
        }
      }
      return;
    }
    if (this.drawn) process.stdout.write(`\x1b[${this.drawn}A`);
    for (const l of lines) process.stdout.write(`\x1b[2K${text(l)}\n`);
    this.drawn = lines.length;
  }
}
