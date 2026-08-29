import type { CloudflareTunnelState } from "@termcast/shared";
import { access, chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DATA_DIR } from "../core/config";

const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const DOWNLOAD_URL =
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-";
const URL_TIMEOUT = 90_000;

let state: CloudflareTunnelState = { enabled: false };
let proc: ReturnType<typeof Bun.spawn> | undefined;
let resolvedPath: string | undefined;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function getTunnelState(): Promise<CloudflareTunnelState> {
  const path =
    resolvedPath ||
    (await findOnPath("cloudflared")) ||
    ((await exists(join(DATA_DIR, "bin", "cloudflared")))
      ? join(DATA_DIR, "bin", "cloudflared")
      : undefined);
  if (path && !resolvedPath) resolvedPath = path;
  return { ...state, resolved: !!path, binaryPath: path };
}

/** Prefers an installed binary, otherwise downloads one next to the data. */
export async function resolveCloudflared(): Promise<string> {
  const onPath = await findOnPath("cloudflared");
  if (onPath) {
    resolvedPath = onPath;
    return onPath;
  }
  const target = join(DATA_DIR, "bin", "cloudflared");
  if (await exists(target)) {
    resolvedPath = target;
    return target;
  }

  const suffix = platformSuffix();
  const url = DOWNLOAD_URL + suffix + (process.platform === "darwin" ? ".tgz" : "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download cloudflared: HTTP ${res.status} from ${url}`);
  await mkdir(dirname(target), { recursive: true });
  if (process.platform === "darwin") {
    const tgz = `${target}.tgz`;
    await writeFile(tgz, new Uint8Array(await res.arrayBuffer()));
    try {
      const extract = Bun.spawn(["tar", "-xzf", tgz, "-C", dirname(target)]);
      await extract.exited;
      if (extract.exitCode !== 0) throw new Error("Failed to extract the cloudflared archive");
    } finally {
      await rm(tgz, { force: true });
    }
  } else {
    await writeFile(target, new Uint8Array(await res.arrayBuffer()));
    await chmod(target, 0o755);
  }
  if (!(await exists(target))) throw new Error("cloudflared binary did not appear after download");
  resolvedPath = target;
  return target;
}

function platformSuffix() {
  const arch = process.arch === "arm64" ? "arm64" : "amd64";
  switch (process.platform) {
    case "darwin":
      return `darwin-${arch}`;
    case "linux":
      return `linux-${arch}`;
    case "win32":
      return `windows-${arch}.exe`;
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

async function findOnPath(name: string): Promise<string | undefined> {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (!dir) continue;
    const full = join(dir, name);
    if (await exists(full)) return full;
  }
  return undefined;
}

/** Resolves the binary and brings a quick tunnel up. Errors leave the tunnel off. */
export async function startTunnel(port: number): Promise<CloudflareTunnelState> {
  stopTunnel();
  try {
    const binary = await resolveCloudflared();
    const child = Bun.spawn(
      [binary, "tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
      { stdout: "pipe", stderr: "pipe" },
    );
    proc = child;
    child.exited.then((code) => {
      if (proc === child) {
        proc = undefined;
        state = {
          enabled: false,
          error: code === 0 ? undefined : `cloudflared exited (code ${code})`,
        };
      }
    });
    const url = await waitForUrl(child);
    state = { enabled: true, url };
    return getTunnelState();
  } catch (err) {
    proc = undefined;
    state = { enabled: false, error: (err as Error).message };
    return getTunnelState();
  }
}

function waitForUrl(child: ReturnType<typeof Bun.spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Timed out waiting for the tunnel URL from cloudflared"));
    }, URL_TIMEOUT);
    const feed = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const match = URL_RE.exec(buffer);
          if (match) {
            clearTimeout(timer);
            resolve(match[0]);
            return;
          }
          if (buffer.length > 64 * 1024) buffer = buffer.slice(-1024);
        }
      } catch {
        /* stream closed early */
      }
    };
    if (child.stdout) void feed(child.stdout as ReadableStream<Uint8Array>).catch(() => {});
    if (child.stderr) void feed(child.stderr as ReadableStream<Uint8Array>).catch(() => {});
  });
}

export async function stopTunnel(): Promise<CloudflareTunnelState> {
  proc?.kill();
  proc = undefined;
  state = { enabled: false };
  return getTunnelState();
}
