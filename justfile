# List all available recipes
default:
    just --list

# Build the Docker image
docker-build:
    docker buildx build -f Dockerfile --platform linux/amd64 --provenance=false --sbom=false --push -t gera2ld/termcast .

# Run the web dev server
dev:
    cd packages/web && bun run --parallel dev dev:server

# Build the web frontend
build-client:
    cd packages/web && bun run build

# Build the CLI for the given formats (e.g. `just build-cli 'js exe'`)
build-cli formats:
    rm -rf packages/cli/dist
    cd packages/cli && bun run scripts/build.ts {{ formats }}

# Build the client and the CLI release distribution (embedded exes, gzipped, with version.txt manifest)
build: build-client
    @just build-cli exe
    cd packages/cli && bun run scripts/build.ts version

# Build the client, the CLI, and zip it for macOS distribution
bundle-macos: build-client
    @just build-cli exe
    rm -f packages/cli/dist/termcast-darwin-arm64.zip
    zip -j packages/cli/dist/termcast-darwin-arm64.zip packages/cli/dist/termcast-darwin-arm64 packages/cli/scripts/macos-unquarantine.sh

# Type-check and lint all packages (tsc/svelte-check + oxlint + oxfmt)
check:
    bun run --filter "*" --elide-lines=0 check && bunx oxlint && bunx oxfmt

# Regenerate the web theme/color CSS
themes:
    cd packages/web && bun run themes
