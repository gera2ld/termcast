import { chmod, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

export interface UpdateOptions {
  repo: string;
  currentVersion: string;
  baseName: string;
}

interface ReleaseAsset {
  id: number;
  name: string;
}

interface UpdateSource {
  getManifest(): Promise<string>;
  getAsset(name: string): Promise<Response>;
}

function githubHeaders(accept?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  if (accept) {
    headers.Accept = accept;
  }
  return headers;
}

function githubFetch(url: string, accept?: string): Promise<Response> {
  return fetch(url, { headers: githubHeaders(accept) });
}

function createApiSource(repo: string): UpdateSource {
  let assets: ReleaseAsset[] | null = null;
  return {
    async getManifest() {
      const res = await githubFetch(`https://api.github.com/repos/${repo}/releases/latest`);
      if (!res.ok) {
        throw new Error(`Failed to fetch version info (${res.status})`);
      }
      const release = (await res.json()) as { assets: ReleaseAsset[] };
      assets = release.assets;
      const version = assets.find((asset) => asset.name === "version.txt");
      if (!version) {
        throw new Error("Failed to fetch version info (404)");
      }
      const manifestRes = await githubFetch(
        `https://api.github.com/repos/${repo}/releases/assets/${version.id}`,
        "application/octet-stream",
      );
      if (!manifestRes.ok) {
        throw new Error(`Failed to fetch version info (${manifestRes.status})`);
      }
      return manifestRes.text();
    },
    async getAsset(name) {
      const asset = assets?.find((a) => a.name === name);
      if (!asset) {
        throw new Error(`Download failed (404) for ${name}`);
      }
      return githubFetch(
        `https://api.github.com/repos/${repo}/releases/assets/${asset.id}`,
        "application/octet-stream",
      );
    },
  };
}

function createDirectSource(repo: string): UpdateSource {
  const base = `https://github.com/${repo}/releases/latest/download`;
  return {
    async getManifest() {
      const res = await githubFetch(`${base}/version.txt`);
      if (!res.ok) {
        throw new Error(`Failed to fetch version info (${res.status})`);
      }
      return res.text();
    },
    getAsset(name) {
      return githubFetch(`${base}/${name}`);
    },
  };
}

export async function runUpdate(options: UpdateOptions): Promise<void> {
  const { repo, currentVersion, baseName } = options;
  const source = process.env.GITHUB_TOKEN ? createApiSource(repo) : createDirectSource(repo);
  const manifest = (await source.getManifest()).trim().split("\n");
  const remoteVersion = manifest[0].trim();
  if (remoteVersion === currentVersion) {
    console.log("already up to date");
    return;
  }
  const assets = new Map<string, string>();
  for (const line of manifest.slice(1)) {
    const [name, sha] = line.trim().split(/\s+/);
    if (name && sha) assets.set(name, sha);
  }
  console.log(`updating from ${currentVersion} to ${remoteVersion}`);
  const asset = `${baseName}-${process.platform}-${process.arch}.gz`;
  const expected = assets.get(asset);
  const res = await source.getAsset(asset);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) for ${asset}`);
  }
  const compressed = new Uint8Array(await res.arrayBuffer());
  if (expected) {
    const actual = createHash("sha256").update(compressed).digest("hex");
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${asset}`);
    }
  }
  const bytes = Bun.gunzipSync(compressed);
  const target = process.execPath;
  const tmp = join(dirname(target), `${asset}.tmp-${process.pid}`);
  await Bun.write(tmp, bytes);
  await chmod(tmp, 0o755);
  await rename(tmp, target);
  console.log("updated");
}
