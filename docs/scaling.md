# Scaling and updates

## Running several instances

```toml
[groups.lobby]
version  = "1.21.10"
min      = 3          # lobby-1, lobby-2, lobby-3
fallback = true
```

Three containers, each registered with the proxy, each with its position in the
group in its environment (`CLOUD_INSTANCE_INDEX`, `CLOUD_GROUP_SIZE`).

A `static` group cannot do this — it owns a single world directory, so the
schema caps it at one instance.

## Failover, not load balancing

Every instance of the fallback group is written into the proxy's failover list
(`try` for Velocity, `priorities` for BungeeCord):

```toml
try = ["lobby-1", "lobby-2", "lobby-3"]
```

Both proxies walk that list **in order**. So:

- Everyone still *joins* on `lobby-1`.
- When an instance becomes unreachable, the players on it are moved to the next
  one that answers instead of being disconnected.

That second point is what makes updates survivable. It is not load balancing,
and neither Velocity nor BungeeCord has a built-in balancer — spreading players
evenly on join needs a proxy plugin that hooks server selection.

## Rolling updates

Change something in `cloud.toml` — a version, memory, a plugin list — and:

```sh
cloud apply --rolling
```

```
  cycling lobby (3 instances)
    ✓ lobby-1 ready in 17s
    ✓ lobby-2 ready in 16s
    ✓ lobby-3 ready in 18s
+ network is up on port 25565
```

Each instance is recreated on its own and must report healthy before the next
one is touched. Players on the instance being replaced are moved to a sibling
by the failover list above, so the group stays available the whole time.

Here a preset adds ViaVersion to both groups, and the change is rolled out —
the two lobbies one after the other, then the single survival server:

<video src="assets/demos/add.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud add viaversion, rolled out with cloud apply --rolling"></video>

Without `--rolling`, `cloud apply` recreates everything at once and says so
first:

```
  lobby (3) will be recreated at once — every player on them drops.
  Use `cloud apply --rolling` to cycle them one at a time instead.
```

That warning also appears during `--dry-run`, which is where you would look
before deciding how to run the real thing.

### It waits for health, not for a clock

A Paper container is `running` about a second after it starts and cannot accept
a login for another minute. The rollout polls Docker's healthcheck and only
moves on when the instance is actually ready. A container with no healthcheck
at all has to stay up for a grace period before it counts, because Docker
reports an empty health field both for "no healthcheck" and for the brief
window before the first check registers — and a crash-looping container passes
through that window on every restart.

### A failed instance stops the rollout

```
  cycling lobby (2 instances)
error lobby-1 was still not ready after 300s.
  Nothing else was touched — the remaining instances are still running.
  A first boot generates a world and can be slow: cloud logs lobby-1
```

The rest of the group keeps running the previous version. A bad update costs
you one instance instead of the whole group.

### Restarting without a change

Plugin files or a template changed, but `cloud.toml` did not — so there is
nothing to apply, only a restart. The same one-at-a-time rule:

```sh
cloud restart lobby --rolling
```

<video src="assets/demos/restart.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud restart survival, then cloud restart lobby --rolling"></video>

## What rolling updates cannot do

**The proxy.** There is one of it, so recreating it reconnects everybody.
Rolling protects backends only. A change that only affects backends (a version
bump, a plugin, a template) leaves the proxy untouched.

**Single-instance groups.** With `min = 1` there is nothing to fail over to, so
taking it down is an outage however slowly you do it. `cloud restart <group>
--rolling` says so rather than pretending:

```
  survival runs one instance, so this is a restart with an outage.
  Nothing can catch its players — set min = 2 or higher to change that.
```

## There is no autoscaling

Instance counts change when `cloud.toml` changes, and at no other time.

Reacting to player counts would need a process watching them continuously, and
this tool has no daemon — that is the constraint the whole design rests on, not
an oversight. See [Design](design.md).

If you want to scale on a schedule, that is a cron job away: edit `cloud.toml`
and run `cloud apply --rolling -y`.
