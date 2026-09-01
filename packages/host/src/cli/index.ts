import { Command } from "commander";
import { runUpdate } from "./update";
import "reflect-metadata";
import { buildApp } from "../routes";
import { startTunnel, stopTunnel } from "../services/cloudflared";
import { PORT } from "../core/config";
import { setShareMode } from "../core/mode";
import { signGrantToken } from "../services/grant";
import { getDevices } from "../services/store";
import { getSettings } from "../services/settings";
import { tabRegistry } from "../services/tab";
import { startServer } from "./serve";
import { startShareSession } from "./share";

export interface CliOptions {
  development: boolean;
  verbose?: boolean;
}

const VERSION_INFO = process.env.TERMCAST_VERSION_INFO ?? "dev";
const REPO = process.env.TERMCAST_UPDATE_REPO ?? "";
const BASE_NAME = "termcast";

function stripPrelude(argv: string[]): string[] {
  // Other args like `--bun run` are already stripped by Bun.
  const rest = argv.slice(2);
  return rest;
}

async function runServeMode(options?: CliOptions) {
  const app = await buildApp({ verbose: options?.verbose ?? false });
  startServer(app, { development: options?.development ?? false });
  installShutdownHook();
  await maybeStartTunnelFromSetting();
}

export async function runCli(argv: string[], options: CliOptions = { development: false }) {
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
    .action(async (_opts, cmd) => {
      const { verbose } = cmd.optsWithGlobals();
      await runServeMode({ ...options, verbose });
      if (getDevices().length === 0) {
        const token = await signGrantToken();
        const ownerUrl = `http://localhost:${PORT}/?grant=${token}`;
        console.log("TermCast isn't set up yet.");
        console.log(`Owner URL (open within 5min to sign in): ${ownerUrl}`);
      }
    });

  program
    .command("share")
    .description("Run a session with a public share link")
    .option("-c, --command <shell>", "Command to run in the shared session.")
    .option("-t, --ttl <seconds>", "Time to live in seconds (default: 3600)", parseInt)
    .action(async (opts, cmd) => {
      const { verbose } = cmd.optsWithGlobals();
      setShareMode(true);
      await runServeMode({ ...options, verbose });
      await startShareSession(opts.command ? [opts.command] : undefined, PORT, opts.ttl);
    });

  program
    .command("grant")
    .description("Generate a one-time owner access grant")
    .option("-t, --token", "Only print the grant token")
    .option("-u, --url", "Only print the openable URL")
    .action(async (opts: { token?: boolean; url?: boolean }) => {
      const token = await signGrantToken();
      const url = `http://localhost:${PORT}/?grant=${token}`;
      if (opts.token) {
        console.log(token);
      } else if (opts.url) {
        console.log(url);
      } else {
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
    // Commander may throw on unknown command; print and exit.
    console.error((err as Error).message);
    process.exit(1);
  }
}

/** Re-opens the persisted tunnel after a restart, so sharing survives a reboot. */
async function maybeStartTunnelFromSetting() {
  const settings = getSettings();
  if (!settings.cloudflaredTunnel) return;
  const state = await startTunnel(PORT);
  if (state.enabled && state.url) console.log(`Public tunnel: ${state.url}`);
  else console.warn(`Tunnel failed to start: ${state.error ?? "unknown"}`);
}

function installShutdownHook() {
  let stopping = false;
  function shutdown() {
    if (stopping) return;
    stopping = true;
    console.log("Shutting down...");
    for (const tab of tabRegistry.list()) {
      tab.pty.dispose();
    }
    stopTunnel().finally(() => process.exit(0));
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (import.meta.main) {
  await runCli(process.argv);
}
