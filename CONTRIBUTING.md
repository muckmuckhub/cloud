# Contributing

## Easiest place to start

**Presets.** Add an entry to
`packages/cli/src/presets/registry.ts` and open a PR. That is the whole
process — no build step, no loader, no registration API.

```ts
const MY_PRESET: Preset = {
  name: "example",
  description: "One line, shown in `cloud add`",
  docs: "https://link-to-what-this-installs",
  proxyPlugins: ["https://..."],
  allGroupPlugins: ["https://..."],
  allGroupHangar: ["ViaVersion:5.11.0"],   // preferred over URLs: slug:version
  allGroupModrinth: ["some-plugin:1.2.3"],
  allGroupEnv: { SOME_SETTING: "value" },
  proxyEnv: { SOME_SETTING: "value" },
  proxyPorts: ["19132:19132/udp"],   // proxy only; backends never publish
  groups: { creative: { memory: "2G" } },
  notes: ["Anything the user still has to do by hand"],
};
```

Rules: config only — if it needs code, it is not a preset. Prefer official
download URLs over mirrors, and pin a version rather than using a `/latest/`
path unless you have checked that it really serves a jar — several do not, and
the failure reaches the user as a crash-looping server. Anything the user already set by hand wins over
what the preset supplies. CI asserts every preset validates, is idempotent,
does not mutate its input, and opens ports on the proxy and nowhere else.

## Design constraints

These are not preferences. Changes that break them will be asked to change.

1. **The tool works with no AI provider.** Any feature that requires a key is a
   feature most users will not have. `init` must fall back to prompts.
2. **The AI never applies anything.** It proposes; a human confirms;
   deterministic code executes. `apply` must never call a model.
3. **Only the proxy publishes a port.** This is the security model. A change
   that publishes a backend port needs a very good argument.
4. **`cloud.toml` is the only source of truth.** Generated files are marked
   `GENERATED` and gitignored. Never read state back out of them.
5. **Extensions read state and react; they never participate in producing it.**
   Presets are data validated by the normal schema. The server-side API is
   environment variables. There is no in-process plugin API and there will not
   be one — that is what made the older cloud systems unmaintainable.
6. **Extra services belong in `docker-compose.override.yml`.** Compose merges
   it automatically. A database or a metrics stack needs no schema field and no
   code — do not add a services section to `cloud.toml`.
7. **Ten commands.** An eleventh needs justifying. Feature creep is how the
   existing cloud systems ended up unmaintainable.

## Adding an AI provider

Implement `Provider` in `packages/cli/src/ai/`, register it in
`resolveProvider()`. Keep tool schemas simple enough that a 7B local model can
fill them — that constraint improves reliability for large models too.

## Adding a container backend

Podman is the obvious next one; its API is largely Docker-compatible. Put it
behind the same interface as `docker.ts` rather than branching inside it.

## Before opening a PR

```sh
bun run check          # typecheck + tests + invariants
```

or the pieces individually:

```sh
bun run typecheck
bun test
bun run scripts/check-invariants.ts   # after touching anything in render/
bun run examples                      # regenerate examples/ after a renderer change
bun run links                         # preset download URLs still serve jars
```

## Docs

The site under `docs/` is plain Markdown with no generator-specific syntax, so
it renders anywhere. MkDocs Material builds it and GitHub Pages serves it:

```sh
pip install -r requirements-docs.txt
bun run docs                          # http://127.0.0.1:8000
```

The Python toolchain is pinned in `requirements-docs.txt`, and it is the only
Python in the repository — the CLI is Bun, and `bun run check` validates the
docs navigation and links without it. CI installs from that file, so adding a
docs plugin means adding it there.

`bun run check` already verifies that every page is in the nav and every
internal link resolves, so you do not need Python to catch a broken link. Add
new pages to `nav:` in `mkdocs.yml` or the check fails.

Publishing is GitHub Pages, which has to be switched on once per repository:
**Settings → Pages → Build and deployment → Source: "GitHub Actions"**. Until
that is set, the docs workflow builds and verifies the site but skips the
deploy with a warning rather than failing — so a fork that does not want a docs
site is not permanently red.

`links` needs the network, so it is not part of the PR gate — CI runs it
weekly. If it goes red, a preset needs its pinned version bumped; each preset's
comment names the upstream API that lists the current one.

`check-invariants.ts` is the important one: it turns the constraints above into
assertions, renders every example, and fails if the artifacts checked into
`examples/` are not what the renderers currently produce. When you add a
constraint, add an assertion there.

Conventional commits (`feat:`, `fix:`, `docs:`) — changelogs are generated from
them.

## Releasing

1. Bump the version in three places — `packages/cli/src/index.ts`,
   `packages/cli/package.json`, `packages/schema/package.json` — and commit.
2. Tag and push:

   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

CI refuses to publish if those three do not match the tag, before anything is
compiled, so a forgotten bump costs a re-tag rather than a release whose
`cloud --version` lies. To fix one:

```sh
git tag -d v0.2.0 && git push origin :refs/tags/v0.2.0   # drop it
# bump, commit, then tag again
```

Pushing the tag then makes CI:

1. run the full check and the invariants, on Linux and Windows;
2. verify the version matches the tag;
3. compile a binary for linux-x64, linux-arm64, darwin-arm64 and windows-x64,
   each with a SHA-256 checksum and a build provenance attestation;
4. publish `install.sh` and `install.ps1` as release assets, with the tag
   stamped in as their default version;
5. create the GitHub release with generated notes and attach everything.

The release is created by the workflow — there is nothing to click, and no
domain, gist or separate hosting to maintain. Watch it in the Actions tab; if
any job fails, no release is published.

## The installers

Users install by piping a release asset into a shell:

```sh
curl -fsSL https://github.com/muckmuckhub/cloud/releases/latest/download/install.sh | sh
```

`scripts/install.sh` and `scripts/install.ps1` in this repository are the source
of truth. The release job copies them, stamping the tag in as the default
`CLOUD_VERSION`, so a pinned installer installs the release it shipped with
rather than whatever is newest:

```sh
curl -fsSL https://github.com/muckmuckhub/cloud/releases/download/v0.2.0/install.sh | sh
```

That stamp is a `sed`, and a `sed` that matches nothing fails silently, so the
job greps for the tag afterwards and fails the release if it is missing.

A gist would also work, but only for a personal account: GitHub has no
organization-owned gists, so the install URL would carry a member's username
and break if that account went away. Release assets belong to the repository.

Test an installer change by running it against a real release:

```sh
CLOUD_VERSION=v0.1.0 CLOUD_BIN_DIR=/tmp/bin sh scripts/install.sh
/tmp/bin/cloud --version
```
