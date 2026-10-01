set positional-arguments

# List all available recipes
default:
    just --list

# Build the Docker image
docker-build:
    docker buildx build -f Dockerfile --platform linux/amd64 --provenance=false --sbom=false --push -t gera2ld/termcast .

DATA_DIR := justfile_directory() + "/data"

# Run the web dev server
dev:
    cd apps/server && DATA_DIR="{{ DATA_DIR }}" bun run --parallel dev dev:server

# Build the server
build-client:
    cd apps/server && bun run build

# Build the CLI for the given formats (e.g. `just build-cli 'js exe'`)
build-cli formats:
    rm -rf apps/cli/dist
    cd apps/cli && bun run scripts/build.ts {{ formats }}

# Build the client and the CLI release distribution (embedded exes, gzipped, with version.txt manifest)
build: build-client
    @just build-cli exe
    cd apps/cli && bun run scripts/build.ts version

# Build the client, the CLI, and zip it for macOS distribution
bundle-macos: build-client
    @just build-cli exe
    rm -f apps/cli/dist/termcast-darwin-arm64.zip
    zip -j apps/cli/dist/termcast-darwin-arm64.zip apps/cli/dist/termcast-darwin-arm64 apps/cli/scripts/macos-unquarantine.sh

# Type-check and lint all packages (tsc/svelte-check + oxlint + oxfmt)
check:
    bun run --filter "*" --elide-lines=0 check && bunx oxlint && bunx oxfmt

# Run the test suite
test:
    bun test

# End-to-end smoke test for the binary /ws protocol (needs `just dev` running)
smoke-ws:
    DATA_DIR="{{ DATA_DIR }}" bun run scripts/smoke-ws.ts

# Type-check, lint and test everything
ci: check test

# Regenerate the web theme/color CSS
themes:
    cd apps/server && bun run themes

cli *args:
    cd apps/cli && DATA_DIR="{{ DATA_DIR }}" bun run src/index.ts "$@"
