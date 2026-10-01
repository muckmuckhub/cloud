/**
 * Records the terminal demos in demos/*.tape into docs/assets/demos/ — an MP4
 * per command for the docs, plus the GIF the README shows.
 *
 *   bun run demos              every tape, in ORDER
 *   bun run demos status exec  just these
 *
 * Needs Docker and nothing else: VHS runs in a container (demos/Dockerfile)
 * with its own ttyd, ffmpeg and browser. The tapes run a Linux build of `cloud`
 * against this machine's Docker through the mounted socket.
 *
 * The tapes tell one story about one network, so a reader of the docs never
 * switches context: init creates mynetwork, apply starts it, add extends it,
 * the operating commands run against it, and down removes it. It is a real
 * network on port 25565 — a proxy, two lobbies and a survival server — so the
 * port must be free and Docker needs room for it. Each tape starts from a
 * snapshot in demos/fixtures/, so any one of them can be recorded alone.
 *
 * Projects live under /tmp/cloud-demos, mounted at that same path. Compose
 * hands the daemon absolute bind-mount paths from inside the recorder; they
 * resolve only if the daemon sees the directory at the same place.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const image = "cloud-vhs";

/** The order of the story. `down` ends it, so it goes last. */
const ORDER = [
  "init",
  "validate",
  "apply",
  "add",
  "status",
  "logs",
  "exec",
  "restart",
  "down",
];

/**
 * Memory Docker must have, measured rather than estimated: the story's
 * network settles at about 4.6G (a 1G-heap Paper server is ~1.25G resident),
 * the recorder peaks near 1.5G while it renders compose's busy output, plus
 * headroom for anything else running. With 7G the WSL VM ran out while the
 * servers booted — and a WSL VM out of memory does not kill a process, it
 * swaps until the whole VM, Docker and every distro with it, stops answering.
 */
const NEEDED_MIB = 7680;

/**
 * The recorder's own ceiling. If it ever needs more, Docker kills it and the
 * run fails with an error — instead of the VM freezing for everyone.
 */
const RECORDER_MEMORY = "3g";

/**
 * Longest any one tape may take. The longest waits — servers booting — are a
 * few minutes; past this, Docker is stuck and waiting longer only hides it.
 */
const TAPE_TIMEOUT_MS = 20 * 60 * 1000;

const wanted = process.argv.slice(2);
const unknown = wanted.filter((w) => !ORDER.includes(w));
if (unknown.length) {
  console.error(`no such tape: ${unknown.join(", ")}\n  tapes: ${ORDER.join(", ")}`);
  process.exit(1);
}
const tapes = ORDER.filter((t) => !wanted.length || wanted.includes(t));
for (const t of tapes) {
  if (!existsSync(join(root, "demos", `${t}.tape`))) {
    console.error(`demos/${t}.tape is listed in ORDER but does not exist`);
    process.exit(1);
  }
}

await preflight();

const mounts = [
  "-v", "/var/run/docker.sock:/var/run/docker.sock",
  "-v", `${root}:/repo`,
  "-v", `${join(root, "demos", ".bin", "cloud")}:/usr/local/bin/cloud:ro`,
  "-v", "/tmp/cloud-demos:/tmp/cloud-demos",
];

// The recorder is Debian on x86_64. Same flags as a release build, so the
// demo shows the binary people actually install.
run("bun", [
  "build",
  "packages/cli/src/index.ts",
  "--compile",
  "--minify",
  "--no-compile-autoload-dotenv",
  "--target=bun-linux-x64",
  "--outfile",
  "demos/.bin/cloud",
]);
run("docker", ["build", "-q", "-t", image, "demos"]);

for (const tape of tapes) {
  console.log(`\nrecording ${tape}`);
  run("docker", [
    "run",
    "--rm",
    ...mounts,
    "--memory", RECORDER_MEMORY,
    "--memory-swap", RECORDER_MEMORY,
    // No AI provider in a recording: every demo must work without one.
    "-e", "CLOUD_AI_PROVIDER=none",
    // Tapes name their output and settings relative to the repository.
    "-w", "/repo",
    image,
    `demos/${tape}.tape`,
  ], TAPE_TIMEOUT_MS);
  if (tape === "init") checkStoryStart();
  if (tape === "apply") readmeGif();
}

// A full run has already taken the network down in down.tape; a partial one
// (say, `bun run demos status`) would otherwise leave it running.
teardown();
console.log(`\nrecorded ${tapes.join(", ")} into docs/assets/demos/`);

function run(cmd: string, args: string[], timeout?: number): void {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root, timeout });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
    console.error(
      `\n${args.at(-1)} did not finish in ${timeout! / 60_000} minutes. Docker is probably\n` +
        "  stuck — if `docker info` fails or hangs, restart Docker Desktop.",
    );
    teardown();
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\n\`${cmd} ${args.join(" ")}\` failed.`);
    teardown();
    process.exit(r.status ?? 1);
  }
}

/**
 * Takes down anything a tape left running, so a failed run leaves no network.
 *
 * By Compose project name rather than with `cloud down` in the project: the
 * project lives in the Docker VM's /tmp, which a Docker Desktop restart
 * empties, and then there is no cloud.toml left to run `cloud down` against —
 * while containers with restart policies come straight back.
 */
function teardown(): void {
  spawnSync("docker", ["compose", "-p", "mynetwork", "down", "--volumes"], {
    stdio: "ignore",
    cwd: root,
  });
}

/** Fails before recording anything if the story's network could not run. */
async function preflight(): Promise<void> {
  const info = spawnSync("docker", ["info", "--format", "{{.MemTotal}}"], { encoding: "utf8" });
  const engineMiB = Math.floor(Number(info.stdout?.trim()) / 1024 / 1024);
  if (!(engineMiB >= NEEDED_MIB)) {
    console.error(
      `Docker has ${engineMiB || "an unknown amount of"} MiB; the demo network needs ${NEEDED_MIB}.\n` +
        "  Docker Desktop on WSL 2: raise memory= in %USERPROFILE%\\.wslconfig\n" +
        "  (10GB is plenty), run `wsl --shutdown`, and start Docker Desktop again.",
    );
    process.exit(1);
  }
  // The story uses the default port, as `cloud init` suggests it.
  const portFree = await new Promise<boolean>((done) => {
    const server = createServer()
      .once("error", () => done(false))
      .once("listening", () => server.close(() => done(true)))
      .listen(25565, "0.0.0.0");
  });
  if (!portFree) {
    console.error(
      "port 25565 is in use. The demo network publishes it: stop whatever is\n" +
        "  listening there (a local Minecraft server?) for the recording.",
    );
    process.exit(1);
  }
}

/**
 * The README's GIF, made from apply.mp4 rather than by VHS. GitHub plays no
 * video from the repository, so the README needs a GIF — but encoding one at
 * full size and frame rate inside the tape took more memory than the recorder
 * may have, and got it killed. From the finished video, at 1000px and 12 fps,
 * it is cheap, and far smaller to download.
 */
function readmeGif(): void {
  run("docker", [
    "run", "--rm", "-v", `${root}:/repo`, "-w", "/repo", "--entrypoint", "ffmpeg", image,
    "-loglevel", "error", "-y", "-i", "docs/assets/demos/apply.mp4",
    "-vf",
    "fps=12,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer",
    "docs/assets/demos/apply.gif",
  ]);
}

/**
 * Every later tape starts from fixtures/story-init.toml, standing in for what
 * init produced on camera. If the two ever differ, the docs would show one
 * file being written and another being applied — the context switch this
 * whole layout exists to avoid.
 */
function checkStoryStart(): void {
  const written = spawnSync(
    "docker",
    ["run", "--rm", ...mounts, "--entrypoint", "cat", image, "/tmp/cloud-demos/story/mynetwork/cloud.toml"],
    { encoding: "utf8", cwd: root },
  ).stdout;
  const fixture = readFileSync(join(root, "demos", "fixtures", "story-init.toml"), "utf8");
  if (written !== fixture) {
    console.error(
      "init.tape wrote a different cloud.toml than demos/fixtures/story-init.toml.\n" +
        "  Change the answers in init.tape or regenerate the fixture, so the story\n" +
        "  applies the file it was just shown creating.",
    );
    teardown();
    process.exit(1);
  }
}
