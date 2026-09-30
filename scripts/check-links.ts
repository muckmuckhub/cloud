/**
 * Checks that every plugin URL in the preset registry still serves a jar.
 *
 * This is separate from check-invariants because it needs the network, and the
 * rest of the test suite deliberately does not. Run it on a schedule, not on
 * every PR: link rot happens on upstream's clock, not on ours.
 *
 *   bun run links
 *
 * It exists because two presets shipped URLs that had quietly started
 * redirecting to a project homepage. The downloader then wrote an HTML page
 * where a jar should be, and the server crash-looped with a Java stack trace
 * that says nothing about a bad URL. A dead link in here is a broken server
 * for whoever runs `cloud add`, so it is worth finding on our side.
 */
import { FABRIC_PROXY_LITE, PROXY_COMPATIBLE_FORGE } from "@cloud/schema";
import { PRESETS } from "../packages/cli/src/presets/registry.ts";
import { hangarUrl } from "../packages/cli/src/render/compose.ts";
import { BUNGEEGUARD_JAR } from "../packages/cli/src/render/forwarding.ts";

const JAR_TYPES = [
  "application/java-archive",
  "application/octet-stream",
  "application/zip",
];

let failures = 0;

interface Target {
  preset: string;
  url: string;
  docs?: string;
  /** "jar": must serve a jar. "modrinth": must be a Modrinth version with files. */
  kind: "jar" | "modrinth";
}

// Jars the tool installs by itself, not through a preset. They rot the same way.
const targets: Target[] = [
  {
    preset: "(bungeeguard forwarding)",
    url: BUNGEEGUARD_JAR,
    docs: "https://github.com/lucko/BungeeGuard/releases",
    kind: "jar",
  },
];
// The FabricProxy-Lite pins every Fabric group gets, one per version range.
for (const { version } of FABRIC_PROXY_LITE) {
  targets.push({
    preset: "(fabric servers)",
    url: `https://api.modrinth.com/v2/project/fabricproxy-lite/version/${version}`,
    docs: "https://modrinth.com/mod/fabricproxy-lite/versions",
    kind: "modrinth",
  });
}
targets.push({
  preset: "(neoforge servers)",
  url: `https://api.modrinth.com/v2/project/proxy-compatible-forge/version/${PROXY_COMPATIBLE_FORGE}`,
  docs: "https://modrinth.com/mod/proxy-compatible-forge/versions",
  kind: "modrinth",
});
for (const preset of Object.values(PRESETS)) {
  for (const url of [...(preset.proxyPlugins ?? []), ...(preset.allGroupPlugins ?? [])]) {
    targets.push({ preset: preset.name, url, docs: preset.docs, kind: "jar" });
  }
  // Hangar references are checked through the same function that renders
  // them, so this tests the URL the container will actually fetch.
  for (const ref of preset.proxyHangar ?? []) {
    targets.push({ preset: preset.name, url: hangarUrl(ref, "VELOCITY"), docs: preset.docs, kind: "jar" });
  }
  for (const ref of preset.allGroupHangar ?? []) {
    targets.push({ preset: preset.name, url: hangarUrl(ref, "PAPER"), docs: preset.docs, kind: "jar" });
  }
  // Modrinth references are resolved by the image at container start. The
  // version endpoint accepts a version number or ID, the same as the image.
  for (const ref of [...(preset.proxyModrinth ?? []), ...(preset.allGroupModrinth ?? [])]) {
    const [slug, version] = ref.split(":");
    targets.push({
      preset: preset.name,
      url: `https://api.modrinth.com/v2/project/${slug}/version/${version}`,
      docs: preset.docs,
      kind: "modrinth",
    });
  }
}

console.log(`checking ${targets.length} plugin URL(s) and reference(s)\n`);

for (const { preset, url, docs, kind } of targets) {
  let verdict: string;
  let ok = false;
  try {
    // GET, not HEAD: some CDNs answer HEAD differently, and the whole point is
    // to see what the downloader would actually receive.
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    });
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (kind === "modrinth") {
      const body = res.ok ? ((await res.json()) as { files?: unknown[] }) : {};
      ok = res.ok && !!body.files?.length;
      verdict = `${res.status} ${ok ? "version exists" : "no such version"}`;
    } else {
      ok = res.ok && JAR_TYPES.includes(type);
      verdict = `${res.status} ${type || "(no content-type)"}`;
    }
    if (kind === "jar" && res.ok && !ok) {
      // The failure mode that started this: 200 OK, text/html, a homepage.
      verdict += ` — served a page, not a jar (redirected to ${res.url})`;
    }
    if (!res.bodyUsed) await res.body?.cancel();
  } catch (err) {
    verdict = `request failed: ${(err as Error).message}`;
  }

  if (ok) {
    console.log(`  ok   ${preset}  ${verdict}`);
  } else {
    failures++;
    console.error(`  DEAD ${preset}  ${verdict}\n       ${url}`);
    if (docs) console.error(`       current download: ${docs}`);
  }
}

console.log("");
if (failures) {
  console.error(
    `${failures} plugin URL(s) no longer serve a jar.\n` +
      `Fix them in packages/cli/src/presets/registry.ts — each preset's comment\n` +
      `says which upstream API lists the current version.`,
  );
  process.exit(1);
}
console.log("every preset URL still serves a jar");
