import { Command } from "commander";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { signGrantToken } from "@termcast/shared/server";
import { runUpdate } from "./update";

const VERSION_INFO = process.env.TERMCAST_VERSION_INFO ?? "dev";
const REPO = process.env.TERMCAST_UPDATE_REPO ?? "";
const BASE_NAME = "termcast";

function stripPrelude(argv: string[]): string[] {
  return argv.slice(2);
}

function resolveBuildDir(): string {
  if (process.env.TERMCAST_WEB_DIR) return process.env.TERMCAST_WEB_DIR;
  const fromPublic = join(import.meta.dir, "public");
  if (existsSync(join(fromPublic, "index.js"))) return fromPublic;
  return join(import.meta.dir, "..", "..", "web", "build");
}

let serverStarted = false;
async function startServer() {
  if (serverStarted) return;
  serverStarted = true;
  if (!process.env.PORT) process.env.PORT = "9998";
  if (!process.env.HOST) process.env.HOST = "0.0.0.0";
  const buildDir = resolveBuildDir();
  const indexJs = join(buildDir, "index.js");
  if (!existsSync(indexJs)) {
    console.error(
      `Web build not found at ${indexJs}.\nRun 'just build-client' before starting the server.`,
    );
    process.exit(1);
  }

  // @sveltejs/adapter-bun does not pass a `websocket` handler to Bun.serve, and it only
  // gives SvelteKit the normalized request rather than the original one Bun handed to
  // `fetch`, so `server.upgrade()` cannot be called from the handle hook. Handle upgrades
  // here with the original request before delegating to the adapter's fetch handler.
  const hooksEntry = join(buildDir, "server", "entries", "hooks.server.js");
  if (existsSync(hooksEntry)) {
    type ServeOptions = Parameters<typeof Bun.serve>[0];
    type FetchHandler = NonNullable<ServeOptions["fetch"]>;
    type BunServer = Parameters<FetchHandler>[1];
    const { websocket, tryUpgrade } = (await import(hooksEntry)) as {
      websocket?: ServeOptions["websocket"];
      tryUpgrade?: (req: Request, server: BunServer) => Response | null;
    };
    if (websocket && tryUpgrade) {
      const serve = Bun.serve;
      Bun.serve = ((options: ServeOptions) => {
        const fetchHandler = options.fetch;
        if (!fetchHandler) return serve({ ...options, websocket } as ServeOptions);
        return serve({
          ...options,
          fetch: (req, server) => tryUpgrade(req, server) ?? fetchHandler.call(server, req, server),
          websocket,
        } as ServeOptions);
      }) as typeof Bun.serve;
    }
  }

  await import(indexJs);
  // Give the server a moment to bind.
  await new Promise((r) => setTimeout(r, 300));
}

export async function runCli(argv: string[]) {
  const tokens = stripPrelude(argv);
  const program = new Command("termcast")
    .description("TermCast — a web terminal in your browser")
    .showHelpAfterError()
    .helpOption("-h, --help")
    .version(VERSION_INFO)
    .option("-v, --verbose", "Enable verbose logging (errors + HTTP request logs)");

  program
    .command("serve")
    .description("Run the server (the default command)")
    .action(async () => {
      await startServer();
    });

  program
    .command("share")
    .description("Run a session with a public share link")
    .option("-c, --command <shell>", "Command to run in the shared session.")
    .option("-t, --ttl <seconds>", "Time to live in seconds (default: 3600)", parseInt)
    .action(async (opts) => {
      process.env.HOST = process.env.HOST ?? "127.0.0.1";
      await startServer();
      const port = process.env.PORT ?? "9998";
      const res = await fetch(`http://127.0.0.1:${port}/api/share`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: opts.command, ttl: opts.ttl }),
      });
      if (!res.ok) {
        console.error(`Failed to start share session: ${res.status}`);
        process.exit(1);
      }
      const data = (await res.json()) as { friendUrl?: string; ownerUrl?: string; error?: string };
      if (data.error) console.error(data.error);
      if (data.friendUrl) console.log(`Share URL: ${data.friendUrl}`);
      if (data.ownerUrl) console.log(`Owner URL: ${data.ownerUrl}`);
    });

  program
    .command("grant")
    .description("Generate a one-time owner access grant")
    .option("-t, --token", "Only print the grant token")
    .option("-u, --url", "Only print the openable URL")
    .action(async (opts: { token?: boolean; url?: boolean }) => {
      const port = process.env.PORT ?? "9998";
      const token = await signGrantToken();
      const url = `http://localhost:${port}/?grant=${token}`;
      if (opts.token) console.log(token);
      else if (opts.url) console.log(url);
      else {
        console.log("Owner grant created (one-time, expires in 5 minutes).");
        console.log("Open this URL to claim owner access:");
        console.log(url);
      }
    });

  if (REPO) {
    program
      .command("update")
      .description("Update termcast to the latest release")
      .action(() => runUpdate({ repo: REPO, currentVersion: VERSION_INFO, baseName: BASE_NAME }));
  }

  try {
    await program.parseAsync(tokens, { from: "user" });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}

if (import.meta.main) {
  await runCli(process.argv);
}
