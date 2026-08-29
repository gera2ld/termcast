# List all available recipes
default:
    just --list

# Build the Docker image and load it into the local Docker daemon
docker-build:
    docker compose build

# Push the built image to the registry
docker-push:
    docker compose push

# Run the web frontend dev server (SvelteKit)
dev-client:
    cd packages/web && bun run dev

# Run the host dev server (Bun + Hono)
dev-host:
    cd packages/host && bun run dev

# Run both dev servers in parallel
dev:
    #!/usr/bin/env bash
    trap 'kill 0' EXIT INT TERM
    just dev-client &
    just dev-host &
    wait

# Build the web frontend
build-client:
    cd packages/web && bun run build

# Build the host for the given formats (e.g. `just build-host 'js exe'`)
build-host formats:
    rm -rf packages/host/dist
    cd packages/host && bun run scripts/build.ts {{formats}}

# Build the client and the host release distribution (embedded exes, gzipped, with version.txt manifest)
build: build-client
    @just build-host exe
    cd packages/host && bun run scripts/build.ts version

# Build the client, the host, and zip it for macOS distribution
bundle-macos: build-client
    @just build-host exe
    rm -f packages/host/dist/termcast-darwin-arm64.zip
    zip -j packages/host/dist/termcast-darwin-arm64.zip packages/host/dist/termcast-darwin-arm64 packages/host/scripts/macos-unquarantine.sh

# Type-check and lint all packages (tsc/svelte-check + oxlint + oxfmt)
check:
    bun run --filter "*" --elide-lines=0 check && bunx oxlint && bunx oxfmt

# Regenerate the web theme/color CSS
themes:
    cd packages/web && bun run themes
