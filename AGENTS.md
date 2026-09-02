# TermCast Development Guide

## Tech Stack

- **Runtime**: Bun
- **Monorepo**: Bun workspaces with `packages/*`
- **CLI package** (`@termcast/cli`): Bun server with oRPC (RPC protocol) + WebSocket handling + CLI commands
- **Web package** (`@termcast/web`): SvelteKit SPA
- **Shared package** (`@termcast/shared`): Zod schemas, oRPC contract, types
- **Build**: Bun build for CLI (standalone binary), SvelteKit build for web
- **TypeScript**: Strict mode, checked with `tsc --noEmit` (cli) and `svelte-check` (web)
- **Linting**: oxlint + oxfmt

## Conventions

### Commands

- All commands go in `justfile`, not `package.json`
- Use `just <command>` to run tasks (e.g., `just dev`, `just build`, `just check`)
- Do NOT add scripts to `package.json` - use `justfile` instead

### Code Changes

- **Always ask before making changes to the code**
- Never assume what the user wants - clarify first
- Do not add utility functions, comments, or examples unless explicitly asked
- Write only what is explicitly requested

### Types

- When a lookup is exhaustive (e.g., keyed by a union/`enum` whose cases are all covered), model it as a total mapping (`Record<Union, T>`) and index directly. This makes the result typed as always-defined.
- Do NOT paper over exhaustiveness gaps with non-null assertions (`!`) or fallback defaults (`?? "..."`). Fix the type so the compiler proves the value exists instead.
- Only use `!` or a `??` fallback when the value can genuinely be absent at runtime; if it "can't happen" given the types, the type is wrong — correct it rather than suppress it.
- When defining internal types, prefer mandatory fields with default values over optional fields — this avoids scattering `if` checks (and `?.`) everywhere the field is read.

### Package Structure

- `@termcast/cli`: Server + CLI entry point — oRPC procedures (`src/routes/orpc/`), WebSocket handling (`src/routes/`), services (`src/services/`), standalone binary build
- `@termcast/web`: SvelteKit frontend that imports shared types from `@termcast/shared`
- `@termcast/shared`: Zod schemas, oRPC contract definitions, types shared between cli and web

### Development

- Run `just dev` to start both packages in development mode
- Run `just check` to lint and type-check
- Run `just build` to build both packages
- CLI builds to `packages/cli/dist/`, web builds to `packages/web/build/`
