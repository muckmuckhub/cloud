# Databases, Prometheus, anything else

There is no feature for this, and there does not need to be one.

`docker compose` merges `docker-compose.override.yml` with the generated file
automatically, so that is where anything this tool does not model goes. Nothing
in `cloud` reads or writes that file — it is yours.

## A database

```yaml
# docker-compose.override.yml
services:
  db:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: network
      MARIADB_USER: minecraft
      MARIADB_PASSWORD: ${DB_PASSWORD:?set DB_PASSWORD in .env}
      MARIADB_RANDOM_ROOT_PASSWORD: "yes"
    volumes:
      - db-data:/var/lib/mysql
    networks: [cloud]        # the network the servers are on

volumes:
  db-data:
```

Then point your plugins at it:

```toml
[groups.lobby.env]
DB_HOST = "db"
DB_PORT = "3306"
DB_NAME = "network"
```

```sh
cloud apply
```

Everything on the `cloud` network reaches everything else **by service name,
with no published port**. A plugin connects to `db:3306` the same way the proxy
connects to `lobby-1:25565`.

Put the password in `.env` next to `FORWARDING_SECRET`; it is gitignored
already.

## Prometheus

The metrics themselves come from a plugin on each server — a Prometheus
exporter that listens inside the container. It does not need a published port
either: Prometheus scrapes it over the same network.

```yaml
# docker-compose.override.yml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prom-data:/prometheus
    networks: [cloud]
    ports:
      - "127.0.0.1:9090:9090"     # localhost only

volumes:
  prom-data:
```

```yaml
# prometheus.yml
scrape_configs:
  - job_name: minecraft
    static_configs:
      - targets: ["lobby-1:9225", "lobby-2:9225", "survival:9225"]
```

Add the exporter to the group like any other plugin:

```toml
[groups.lobby]
plugins = ["https://.../minecraft-prometheus-exporter.jar"]
```

Target names are instance names, so a group with `min = 3` is `lobby-1`,
`lobby-2`, `lobby-3`.

## Backups

[itzg/mc-backup](https://github.com/itzg/docker-mc-backup) is a sidecar made
for these server images. It pauses saving over RCON, archives the world, turns
saving back on, and prunes old archives. One per server you care about —
usually the `static` ones; lobbies rebuilt from a template rarely need it.

```yaml
# docker-compose.override.yml
services:
  survival-backup:
    image: itzg/mc-backup
    restart: unless-stopped
    depends_on:
      survival:
        condition: service_healthy
    environment:
      RCON_HOST: survival          # the server's service name
      BACKUP_INTERVAL: "6h"
      PRUNE_BACKUPS_DAYS: "7"
      INITIAL_DELAY: "5m"
      PAUSE_IF_NO_PLAYERS: "true"  # skip backups nobody could have changed
    volumes:
      - survival-data:/data:ro     # the server's own /data, read-only
      - ./backups/survival:/backups
    networks: [cloud]
```

`survival-data` is the named volume `cloud apply` already declares for a server
called `survival`; the override shares it because Compose merges both files
into one project. For a `static` group under `storage = "bind"`, the world is
on the host instead — mount `./data/survival:/data:ro`.

There is no password to configure. `cloud` never sets an RCON password, so the
server image generates one and writes it to `/data/.rcon-cli.env`, and
mc-backup reads it from there because it mounts the same `/data`.

Plugin directories are bind-mounted from `./data/<server>/plugins` and are not
part of the volume, so the sidecar does not see them. They are already plain
files on the host; back them up with everything else in the project directory.

**Restoring** replaces the world, so stop the server first:

```sh
docker compose stop survival survival-backup
docker compose run --rm --no-deps --entrypoint sh \
  -v ./backups/survival:/restore survival \
  -c 'find /data -mindepth 1 -maxdepth 1 ! -name plugins -exec rm -rf {} + &&
      tar -xzf /restore/<archive>.tar.gz -C /data'
cloud apply
```

Archives are named `world-<date>-<time>.tar.gz`; `ls backups/survival` to pick one.
`docker compose run` starts a one-off container with the server's own volumes,
so this works whatever the project and volume are called. The `find` leaves
`plugins/` alone: it is a bind mount of your host directory, not part of the
world.

## How it behaves with `cloud apply`

- The override is merged automatically; no flag, no configuration.
- `--remove-orphans` does **not** remove your services. They are part of the
  merged project, so they are not orphans.
- `cloud status` lists them alongside the servers.
- `cloud down` stops them with everything else.
- Repeated `cloud apply` leaves them running untouched.

## The one thing to be careful with

An override can publish ports, which is the one way to bypass the security
model. `cloud apply` reads the *merged* configuration and warns:

```
  merging docker-compose.override.yml
warning db publishes 6379/tcp on every interface.
  Services on the cloud network reach each other by name without any
  published port — a plugin connects to db directly. Publish it only if
  something outside Docker needs it, and prefer "127.0.0.1:6379:..." so it
  is not exposed to the internet.

warning lobby publishes 25565/tcp, but it is a Minecraft server.
  Backends run online-mode=false and trust the proxy's word about who a
  player is. Anyone who can reach lobby directly can join it as any player,
  including an operator.
```

Binding to a specific address such as `127.0.0.1:` is not warned about — that
is the correct way to reach a dashboard from the machine itself.

These are warnings, not errors. It is your file and you may have a reason.

## Why not a `[services]` section in cloud.toml

Because it would mean reimplementing Compose inside the schema: images, ports,
volumes, environment, health checks, dependencies, and then the parts of them
someone needs next month. Compose already does that, already merges override
files, and is already a dependency.

The projects this tool exists as a reaction to grew exactly that way. See
[Design](design.md).
