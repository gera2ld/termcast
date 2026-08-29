import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "path";

const BINARY = "termcast";
const UPDATE_REPO = "gera2ld/termcast";
const TARGETS = ["bun-darwin-arm64", "bun-linux-x64"] as const;

const packageRoot = resolve(import.meta.dir, "..");
const srcDir = resolve(packageRoot, "src");

const now = new Date();
const sha =
  Bun.spawnSync(["git", "rev-parse", "--short=7", "HEAD"]).stdout.toString().trim() || "unknown";
const VERSION_INFO = `${now.getUTCFullYear() - 2000}.${now.getUTCMonth() + 1}.${now.getUTCDate()}-${sha}`;

const webBuildDir = resolve(packageRoot, "../web/build");
const embedDir = resolve(packageRoot, "public");
const embeddedAssets = existsSync(webBuildDir) ? ["./public"] : [];

const buildDefines = {
  "process.env.TERMCAST_VERSION_INFO": JSON.stringify(VERSION_INFO),
  "process.env.TERMCAST_UPDATE_REPO": JSON.stringify(UPDATE_REPO),
};
const embeddedDefines = {
  ...buildDefines,
  "process.env.TERMCAST_EMBEDDED": JSON.stringify("1"),
};

function getFormats(): string[] {
  const args = process.argv.slice(2);
  const cleaned = args.filter((f) => f === "js" || f === "exe" || f === "version");
  if (cleaned.length === 0) return ["js", "exe"];
  return cleaned;
}

function fail(result: Bun.BuildOutput) {
  console.error("Build failed!");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

async function buildJs() {
  const result = await Bun.build({
    entrypoints: [resolve(srcDir, "cli/index.ts")],
    outdir: resolve(packageRoot, "dist"),
    target: "bun",
    naming: `${BINARY}.js`,
    define: buildDefines,
  });
  if (!result.success) fail(result);
  console.log(
    `Built js:`,
    result.outputs.map((o) => o.path),
  );
}

async function buildExe() {
  if (embeddedAssets.length > 0) {
    rmSync(embedDir, { recursive: true, force: true });
    cpSync(webBuildDir, embedDir, { recursive: true });
  }
  for (const target of TARGETS) {
    const outfile = `${BINARY}-${target.replace(/^bun-/, "")}`;
    const result = await Bun.build({
      entrypoints: [resolve(srcDir, "cli/index.ts")],
      outdir: resolve(packageRoot, "dist"),
      target: "bun",
      compile: { outfile, target, assets: embeddedAssets },
      minify: true,
      define: embeddedDefines,
    });
    if (!result.success) fail(result);
    console.log(
      `Built exe (${target}):`,
      result.outputs.map((o) => o.path),
    );
  }
}

const formats = getFormats();

if (formats.includes("js")) {
  await buildJs();
}
if (formats.includes("exe")) {
  await buildExe();
}
if (formats.includes("version")) {
  const lines = [VERSION_INFO];
  for (const target of TARGETS) {
    const exe = `${BINARY}-${target.replace(/^bun-/, "")}`;
    const src = resolve(packageRoot, "dist", exe);
    if (!existsSync(src)) continue;
    const raw = readFileSync(src);
    const rawSha = createHash("sha256").update(raw).digest("hex");
    lines.push(`${exe} ${rawSha}`);
    const gz = Bun.gzipSync(raw);
    writeFileSync(`${src}.gz`, gz);
    const gzSha = createHash("sha256").update(gz).digest("hex");
    lines.push(`${exe}.gz ${gzSha}`);
  }
  await Bun.write(resolve(packageRoot, "dist", "version.txt"), lines.join("\n") + "\n");
  console.log(`Wrote dist/version.txt (${VERSION_INFO})`);
}
