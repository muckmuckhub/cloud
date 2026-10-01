# Demos

Terminal recordings of `cloud`, made with [VHS](https://github.com/charmbracelet/vhs).
One MP4 per command for the docs (`docs/commands.md` embeds them with player
controls, so a reader can pause and scrub), plus `apply.gif` for the README,
where GitHub does not play repository videos.

## One story, one network

Every demo is a chapter of the same story about the same network, so someone
reading the docs never has to re-orient between videos:

| # | Tape | What happens to `mynetwork` |
|---|---|---|
| 1 | `init.tape` | `cloud init --manual` creates it: a lobby with two instances (1G each), a survival server (1G) |
| 2 | `validate.tape` | a mistake in that file, refused before anything starts |
| 3 | `apply.tape` | `--dry-run`, then `cloud apply` starts it |
| 4 | `add.tape` | `cloud add viaversion`, rolled out with `apply --rolling` |
| 5 | `status.tape` | `cloud status`, then `--json` |
| 6 | `logs.tape` | `cloud logs`, then `-f` with a line arriving live |
| 7 | `exec.tape` | console commands over RCON |
| 8 | `restart.tape` | one server, then the lobby group `--rolling` |
| 9 | `down.tape` | `cloud down`, and `--volumes` asking first; the network is gone |

`fixtures/story-init.toml` is the file chapter 1 writes and `story-added.toml`
the one after chapter 4. Each tape starts from the snapshot for its place in
the story, so any one of them can be recorded alone. After recording
`init.tape`, the script checks that what it wrote on camera is byte-identical
to `story-init.toml` — otherwise the docs would show one file being created
and another being applied.

## Recording

```sh
bun run demos              # the whole story, in order
bun run demos status       # one chapter
```

Needs Docker and nothing else. VHS runs in a container (`Dockerfile` here),
which brings its own ttyd, ffmpeg and browser, and drives a Linux build of
`cloud` against this machine's Docker through the mounted socket.

The network is real, on port 25565, so before recording anything the script
checks that:

- **the port is free** — stop a local Minecraft server for the recording;
- **Docker has about 7.5 GB** — measured: the network settles at ~4.6 GB and
  the recorder peaks near 1.5 GB. Short of that the WSL VM runs out of memory
  and freezes, Docker with it.
  On Docker Desktop with WSL 2 that is `memory=` in `%USERPROFILE%\.wslconfig`
  (10GB is plenty), then `wsl --shutdown` and start Docker Desktop again.

A fresh network downloads Paper from PaperMC's API, which rate-limits (429,
then 503) after many downloads in a short time. The story boots the network
once, which keeps a full run well clear of that; re-recording single chapters
over and over may not.

## How the tapes are put together

- `settings.tape` holds the shared look and pace; every tape `Source`s it.
  The pace is for reading: a command stays on screen a second before Enter,
  and output stays up long enough to read it.
- Each tape starts hidden — `fixtures/fresh.sh` or `fixtures/up.sh` puts the
  network into its state for that chapter — and only then does it `Show`.
- Waiting for servers to boot happens off camera (`Hide` … `Wait` … `Show`).
  Every line of output is still shown as it arrived; only dead time is cut.
- Projects live under `/tmp/cloud-demos`, mounted at that same path. Compose
  hands the daemon absolute bind-mount paths from inside the recorder, which
  resolve only if the daemon sees the directory at the same place.
- The recorder runs as root, so `fresh.sh` creates the servers' directories
  itself with open permissions. On a real host they belong to whoever runs
  `cloud apply`.
- Paths in a tape are relative to the repository root: VHS reads a leading
  `/` as the start of a regular expression.
