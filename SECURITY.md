# Security policy

## Reporting

Report vulnerabilities privately via GitHub Security Advisories on this
repository. Please do not open a public issue.

Expect an acknowledgement within 72 hours.

## Supported versions

The latest minor release receives security fixes. Older minors do not.

## Threat model

This tool generates configuration that opens a port to the internet. The
security-relevant properties:

- **Only the proxy publishes a port.** Backends run `online-mode=false` and
  trust the proxy's word on player identity. A published backend port lets
  anyone claim any UUID, including an operator's.
- **The forwarding secret** is written mode `0600`, never logged, never sent to
  an AI provider, and never committed (`.gitignore` covers it and `.env`).
- **Container logs are attacker-influenced** — plugin names, player names, chat.
  When passed to `cloud explain`, they are framed as data to summarise, never
  as instructions. Template file *contents* are never sent to a model.
- **Version strings** come from the live PaperMC API, not model memory, so a
  hallucinated version cannot become a pinned image tag.

## Known limitations

- `cloud exec` runs arbitrary console commands. Filesystem permissions on the
  project directory are the access control.
- Remote hosts are reached via Docker contexts over SSH. Their security is your
  SSH configuration's.
