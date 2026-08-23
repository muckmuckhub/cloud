# AI features

Optional. Everything except `ask` and `explain` works with no provider
configured and no internet.

| Provider | Setup |
|---|---|
| none (default) | Works. `cloud init` uses prompts. |
| Anthropic | `export ANTHROPIC_API_KEY=...` |
| Ollama | `export CLOUD_AI_PROVIDER=ollama` — local, no account, no cost |

`CLOUD_AI_MODEL` overrides the model. `CLOUD_AI_PROVIDER=none` disables the
layer entirely.

## The rule

**The AI never applies anything.** It proposes; you confirm; deterministic code
executes. `cloud apply` never calls a model at all. `ask` and `explain` print
and stop.

## `cloud init`

With a provider configured, `init` is a conversation:

```
? Describe the network you want:
  velocity proxy, a paper 1.21.10 lobby and a paper survival server

? Which port should players connect to? (25565)
? How much RAM for the survival server? (4G)
? Which server should players land on when they join? (lobby)

cloud.toml
  [network]
  name       = "mynetwork"
  ...

Write this config? [Y/n]
```

The model never writes TOML or YAML. It fills a typed schema through a tool
call, and deterministic code renders the files from it. A hallucinated field is
a parse error, not a broken deploy — and if the config it produces fails
validation, the errors go back to the model to correct.

It is also constrained on things models get plausibly wrong:

- **Minecraft versions** come from the live PaperMC API, and the model chooses
  from that list rather than recalling one.
- **Backend ports** are not asked about, because there are none.
- **Java versions, image names, online-mode** are derived, not decided.

Without a provider, `init` falls back to a plain prompt wizard that asks the
same questions.

## `cloud ask`

```sh
cloud ask "add a creative server with 2G"
```

Sends the current config and your request, gets a complete new config back, and
shows you the diff of `cloud.toml` plus the diff of the generated files it
would produce. Then it stops:

```
Write cloud.toml? [y/N]
```

Saying yes writes `cloud.toml` and nothing else. You still run `cloud apply`.

## `cloud explain`

```sh
cloud explain lobby-1
```

Reads the last 200 log lines and says what went wrong in at most five
sentences. It knows the failure modes specific to this setup: a secret
mismatch, the online-mode pair set wrong, a class-file version that needs a
newer Java, out-of-memory.

## Security notes

Worth knowing if you are handling other people's servers:

- **The forwarding secret never enters a prompt.**
- **Container logs are treated as data, never as instructions.** Log lines
  contain plugin names, player names and chat, all of which an attacker can
  influence. They go to the model as material to summarise.
- **Template files are described by name and size only**, never by content, for
  the same reason.

## Running a local model

```sh
export CLOUD_AI_PROVIDER=ollama
export CLOUD_AI_MODEL=qwen2.5-coder:7b     # the default
ollama serve
```

`OLLAMA_HOST` points at a remote instance if you run one.

The tool schemas are deliberately kept simple enough for a 7B local model to
fill. That constraint improves reliability for large models too.
