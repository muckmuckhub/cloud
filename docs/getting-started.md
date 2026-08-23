# Getting started

## 1. Create a project directory

Everything lives in one directory: your config, your generated files, your
worlds.

```sh
mkdir mynetwork && cd mynetwork
```

## 2. Write the config

```sh
cloud init
```

With an AI provider configured this is a conversation; without one it is a
short series of prompts. Either way it writes `cloud.toml`, and shows it to you
before doing so.

`--manual` skips the AI wizard even when a provider is available.

You can also skip `init` entirely and write `cloud.toml` by hand — see
[Configuration](configuration.md).

## 3. Apply

```sh
cloud apply
```

This:

1. generates the forwarding secret if there isn't one,
2. renders `docker-compose.yml`, the proxy config and the Paper patches,
3. shows you a diff of what changed,
4. waits for you to confirm,
5. runs `docker compose up -d --remove-orphans`.

Nothing is written before you confirm. `cloud apply --dry-run` stops at the
diff and touches nothing at all.

## 4. Connect

```sh
cloud status
```

```
mynetwork · port 25565 · modern forwarding

SERVICE   STATE    HEALTH   UPTIME
proxy     running  healthy  About a minute
lobby     running  healthy  About a minute
survival  running  healthy  About a minute
```

Join `localhost:25565`. You land on the fallback group. `/server survival`
moves you between backends.

First boot takes a minute or two: the image downloads the server jar and Paper
generates a world. `cloud logs lobby -f` shows the progress.

## What is on disk now

```
mynetwork/
  cloud.toml                  the only file you edit
  .env                        FORWARDING_SECRET, gitignored
  .gitignore
  data/
    proxy/plugins/            plugin files, editable
    lobby/plugins/
    survival/                 this group is static: its whole directory
  templates/                  optional seed files
  docker-compose.yml          GENERATED
  proxy/
    velocity.toml             GENERATED
    forwarding.secret         gitignored, mode 0600
    patches/                  GENERATED
```

Files marked GENERATED are rewritten on every apply. Edit `cloud.toml` instead;
`cloud apply` will show you the resulting diff.

## Next

- Run more than one lobby and update without kicking anyone: [Scaling](scaling.md)
- Configure plugins across a whole group: [Server files](server-files.md)
- Add a database or Prometheus: [Integrations](integrations.md)
