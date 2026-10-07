# Versions and blueprints

Testing a plugin on another Minecraft version should not mean setting up
another network by hand. Two ways, depending on whether the network you have
should change or a second one should appear next to it.

## Switch the network you have

```sh
cloud apply --version 26.2
```

Every group moves to 26.2. The version is written into `cloud.toml` — shown as
a diff first, your comments and layout kept — so the file still says what runs
and `git diff` shows the switch. Whatever the new version needs follows on its
own: Minecraft 26.x runs on Java 25, so the servers get the Java 25 image; a
Fabric group gets the FabricProxy-Lite release for that version. If something
cannot follow — an image `pin` for the old Java, a version FabricProxy-Lite has
no release for — the switch is refused before anything changes, with the reason.

Combine it with `--rolling` to switch a multi-instance group one instance at a
time.

### Going back to an older version

Minecraft cannot open a world saved by a newer version. A server pointed at one
stops at startup — and under a restart policy, crash-loops. So on a network
that has run, a downgrade is refused:

```
error Minecraft cannot open a world saved by a newer version:
    lobby: 26.2 → 1.21.10
  Its servers would stop at startup and crash-loop. To start over with new
  worlds on 1.21.10, add --recreate (it deletes the current ones).
```

## Start over

```sh
cloud apply --recreate
cloud apply --version 1.21.10 --recreate
```

Deletes every world and server file of the network, then builds it again from
`cloud.toml`. It asks first. Plugin and mod configuration directories
(`data/<server>/plugins`, `data/<server>/config`) are kept: they are your
setup, not world state.

## A second network beside the first

```sh
mkdir ../mynetwork-26 && cd ../mynetwork-26
cloud init --from ../mynetwork --version 26.2
cloud apply
```

`--from` takes a **blueprint**: any `cloud.toml`. A file, a project directory
(its `templates/` are copied too), or a URL to a raw file:

```sh
cloud init --from https://raw.githubusercontent.com/me/mc/main/paper-dev.toml --version 26.2
```

The new network gets its own name and its own port, so both run at once:

```
from ../mynetwork
  name mynetwork-26-2 · port 25566 · every group on 26.2
  port 25565 is taken here, so this network gets 25566
```

Both are written into the new `cloud.toml` — `--name` and `--port` choose them
yourself. The blueprint's comments come along.

A blueprint is not a separate format and has no registry: keep the
`cloud.toml` of a setup you like somewhere, in a directory or a git repository,
and start new networks from it.

## Knowing when you can join

`cloud apply` waits until a player can actually join — the proxy and every
instance of the fallback group answering, which they only do after printing
`Done` — and shows what each server is doing meanwhile:

```
  ✓ proxy     ready in 6s
  … lobby-1   generating world 63%
  … lobby-2   installing plugins
  … survival  downloading server

✓ ready in 48s — join localhost:25565  (players land on lobby)
```

A server that crashes is named with the command to see why, instead of the
wait running into a timeout. `--no-wait` returns as soon as the containers
have started, for scripts that check readiness themselves.
