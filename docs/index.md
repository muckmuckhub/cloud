# cloud

Run a Minecraft network from one config file. No dashboard, no daemon, no
database.

```
internet ──▶ :25565 ──▶ velocity ──┬──▶ lobby-1
                                   ├──▶ lobby-2
                                   └──▶ survival
```

`cloud.toml` describes the network you want. `cloud apply` renders the Docker
artifacts and makes reality match. That is the whole model.

<video src="assets/demos/apply.mp4" controls muted playsinline preload="metadata" width="100%" aria-label="cloud apply --dry-run, then cloud apply"></video>

```toml
[network]
name       = "mynetwork"
entry_port = 25565

[groups.lobby]
version  = "1.21.10"
min      = 3          # three instances
fallback = true       # players land here

[groups.survival]
version = "1.21.10"
memory  = "4G"
static  = true        # its own directory under data/
```

```sh
cloud apply
```

## Where to go next

| | |
|---|---|
| [Install](install.md) | Binary, or from source with Bun |
| [Getting started](getting-started.md) | Your first network, end to end |
| [Configuration](configuration.md) | Every field in `cloud.toml` |
| [Commands](commands.md) | The ten commands |
| [Scaling and updates](scaling.md) | Several instances, rolling updates |
| [Server files](server-files.md) | Plugin configs and templates |
| [Forwarding](forwarding.md) | The security model, and the secret |
| [Integrations](integrations.md) | Databases, Prometheus, anything else |
| [Troubleshooting](troubleshooting.md) | Symptom to cause |

## What it is not

It is not a control plane. There is no agent running on your machine between
`cloud` invocations, nothing to keep alive, and no state anywhere except
`cloud.toml` and Docker itself. Every command is a short-lived process that
reads the config, talks to Docker, and exits.

That has consequences worth knowing before you start: there is no autoscaling,
no web UI, and no in-process plugin API. [Design](design.md) explains why each
of those is missing on purpose.

## The AI is optional

`cloud init` can be conversational if you have an API key or a local model, and
`cloud ask` proposes config changes as a diff. Neither is required: every other
command works with no provider configured and no internet. The model never
applies anything — see [AI features](ai.md).
