# The recorder: VHS plus a Docker CLI, so a tape can run `cloud apply` against
# the host's Docker through the mounted socket. Built by scripts/record-demos.ts;
# nothing else uses it.
FROM docker:28-cli AS docker

FROM ghcr.io/charmbracelet/vhs:v0.12.1
# Static Go binaries, so the Alpine-built CLI runs on the Debian-based image.
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
