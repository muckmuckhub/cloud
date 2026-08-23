# Server files

Two questions, two answers:

- **"I want to look at what my server wrote."** Plugin files are on the host at
  `./data/<server>/plugins/`.
- **"I want to configure a group once, not once per instance."** Use a
  template.

## Plugin files are on your machine

```
mynetwork/
  data/
    proxy/plugins/                the proxy's plugins
    lobby-1/plugins/
      LuckPerms/config.yml        open it, edit it
    lobby-2/plugins/
    survival/                     static group: its whole directory
```

Every server's plugin directory is bind-mounted, whatever `storage` says. A
Docker named volume cannot be opened from the host, and plugin configuration is
the one thing people genuinely need to reach.

Worlds are *not* here unless the group is `static` with `storage = "bind"`.
That is deliberate: a world is what makes a bind mount slow on Docker Desktop,
and a handful of YAML files is not. So the files you want to edit are always
reachable, and the directory that would make your server stutter stays in the
volume.

`cloud apply` creates these directories before starting anything, so they
belong to you. Left to Docker they would be created as root, and you would need
`sudo` to edit your own plugin configs.

After editing, restart the server so it re-reads them:

```sh
cloud restart lobby-1
```

## Templates

A group running three lobbies has three plugin directories, and configuring it
by editing all three is not a plan. Point the group at a template instead:

```toml
[groups.lobby]
min      = 3
template = "hub"        # a directory under templates/
```

`templates/hub/` mirrors the server directory:

```
templates/hub/
  server.properties                  -> /data/server.properties
  plugins/LuckPerms/config.yml       -> /data/plugins/LuckPerms/config.yml
  plugins/Essentials/config.yml      -> /data/plugins/Essentials/config.yml
```

### The template owns those files

It is copied over every instance of the group **on every start**. So the loop
is:

```sh
vim templates/hub/plugins/LuckPerms/config.yml
cloud restart lobby --rolling        # all three updated, no outage
```

The consequence to know: for a group that has a template, editing the live
copies under `data/lobby-1/` does nothing lasting — they are overwritten on the
next start. Groups without a template are unaffected, and their live files are
yours to edit.

Files the template does not contain are left alone. The world, the logs, plugin
databases: all untouched. It is an overlay, not a wipe.

If you want the opposite — seed once, then never touch it again — set this in
the group:

```toml
[groups.lobby.env]
SYNC_SKIP_NEWER_IN_DESTINATION = "true"
```

### Creating a template

`cloud apply` creates `templates/<name>/` for you and warns while it is empty,
because seeding from an empty directory is a silent no-op:

```
warning templates/hub/ is empty, so it will seed nothing.
  Put files there mirroring the server directory, e.g.
    templates/hub/plugins/LuckPerms/config.yml
    templates/hub/server.properties
```

The usual way to fill it: start the server once, let the plugin generate its
default config, then copy the parts you care about out of
`data/lobby-1/plugins/` into `templates/hub/plugins/`.

### What not to put in a template

**Secrets.** A template is a normal directory in your project and will end up
in git. The forwarding secret is per-machine and gitignored; backends receive
it as the environment variable `CFG_FORWARDING_SECRET`.

**Things an environment variable already covers.** The image writes
`server.properties` from environment variables, so difficulty, gamemode,
view distance and the rest belong in `[groups.<name>.env]` rather than in a
template file that then fights with them.

## The environment API

Every backend gets these, and a plugin reads them with
`System.getenv("CLOUD_GROUP")`. No jar to ship, no version to match:

| Variable | Meaning |
|---|---|
| `CLOUD_NETWORK` | network name |
| `CLOUD_GROUP` | the group this server belongs to |
| `CLOUD_INSTANCE` | this server's name |
| `CLOUD_INSTANCE_INDEX` | position within the group, from 1 |
| `CLOUD_GROUP_SIZE` | how many instances the group runs |
| `CLOUD_FALLBACK` | where players land |
| `CLOUD_GROUPS` | every group on the network |
| `CLOUD_SERVERS` | every instance on the network |
| `CLOUD_PROXY` | the proxy's container name |
| `CLOUD_STATIC` | whether this server keeps its own directory |

Anything you set in `[groups.<name>.env]` overrides these, and is also how you
pass your own settings to a plugin:

```toml
[groups.lobby.env]
DB_HOST = "db"
MOTD    = "Lobby"
```
