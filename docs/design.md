# Design

## Why this exists

The established Minecraft cloud systems — CloudNet, SimpleCloud, TimoCloud,
ReformCloud — collapsed under their own surface area. Module systems,
in-process Java APIs, years-long release candidates, abandoned repositories.
They are applications you talk to, which is why they grow dashboards,
permission systems, module ecosystems and 200-class APIs, and then spend years
maintaining all of it.

This one inverts that. Desired state lives in a file. `cloud apply` makes
reality match. The CLI edits files and reads state; it is not a control plane.

Every constraint below is a reaction to a specific one of those failures.
Removing one because it seems inconvenient reintroduces the failure it was
preventing.

## The constraints

### 1. Renderers are pure functions of the config

No platform checks, no clock, no environment reads in the rendering code. The
same `cloud.toml` produces byte-identical output on every machine, and CI
audits it.

Platform differences are resolved once, by `cloud init`, and *written into*
`cloud.toml` — which is why `storage` is a config field rather than an
if-statement. A generated file that depends on who generated it cannot be
reviewed, diffed or reproduced.

### 2. Only the proxy publishes a port

Backends run `online-mode=false` and trust the proxy's word on player identity.
A published backend port lets anyone connect directly and claim any UUID,
including an operator's. This is the security model, not a convenience.

See [Forwarding](forwarding.md).

### 3. The AI never applies anything

It proposes; a human confirms; deterministic code executes. `apply` never calls
a model. `ask` and `explain` print and stop.

### 4. The tool works with no AI provider

`init` falls back to prompts. Anything that requires an API key is a feature
most users will not have.

### 5. `cloud.toml` is the only source of truth

Generated files are marked `GENERATED`, gitignored, and never read back for
state. There is no database, no lock file, no cache of what was deployed. The
config plus Docker is the entire state of the system.

### 6. Extra services go in a Compose override

A database or a metrics stack needs no schema field and no code here, because
Compose already merges `docker-compose.override.yml`. Adding a `[services]`
table to `cloud.toml` would mean reimplementing Compose inside the schema — and
then the parts of it someone needs next month.

See [Integrations](integrations.md).

### 7. No in-process plugin API, ever

Extensions read state and react; they never participate in producing it.
Presets are data validated by the normal schema. The server-side API is
environment variables.

This is the single biggest lesson from the projects that died. An in-process
API means every extension can break the core, every core change breaks
extensions, and the maintainers end up owning both.

### 8. Ten commands

An eleventh needs justifying. Feature creep is how the existing cloud systems
became unmaintainable. Rotating the forwarding secret is a flag on `apply`
rather than a `cloud secret`, because the new secret is useless until every
backend restarts and `apply` is what restarts them.

## Things that follow from this

**No daemon**, so no autoscaling. Reacting to player counts needs a process
watching them. Fixed instance counts fit the architecture; autoscaling would
make this the control plane the design rejects.

**No web UI.** The interface is a file and a diff.

**One schema definition.** The Zod schema in `packages/schema` validates
hand-edited TOML, generates the AI tool schema, and parses model output. Change
it in one place and all three follow. A hand-written JSON Schema alongside it
would drift.

**Compose does the reconciling.** `up -d --remove-orphans` creates what is
missing, recreates what changed, and removes what is no longer declared. That
logic is precisely what would otherwise have to be written and maintained here.

## How the constraints are enforced

Not by convention. `scripts/check-invariants.ts` renders every example and
asserts the design rules as executable checks: only the proxy publishes a port,
every backend has `ONLINE_MODE=FALSE`, exactly one forwarding style is enabled,
the failover list covers every instance a rollout can take down, the checked-in
example artifacts match what the renderers produce today.

It has caught real bugs, including a fixture that would have shipped wrong
volume mounts. When a new constraint is added, an assertion is added with it.

```sh
bun run check      # typecheck + tests + invariants
```
