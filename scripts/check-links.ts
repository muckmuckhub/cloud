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
import { PRESETS } from "../packages/cli/src/presets/registry.ts";

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
}

const targets: Target[] = [];
for (const preset of Object.values(PRESETS)) {
  for (const url of [...(preset.proxyPlugins ?? []), ...(preset.allGroupPlugins ?? [])]) {
    targets.push({ preset: preset.name, url, docs: preset.docs });
  }
}

console.log(`checking ${targets.length} plugin URL(s)\n`);

for (const { preset, url, docs } of targets) {
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
    ok = res.ok && JAR_TYPES.includes(type);
    verdict = `${res.status} ${type || "(no content-type)"}`;
    if (res.ok && !ok) {
      // The failure mode that started this: 200 OK, text/html, a homepage.
      verdict += ` — served a page, not a jar (redirected to ${res.url})`;
    }
    await res.body?.cancel();
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
