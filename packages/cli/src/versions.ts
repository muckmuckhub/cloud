/**
 * Ground the model against reality. Version strings are exactly the kind of
 * detail a language model recalls plausibly and wrongly, so we hand it the
 * live list and constrain it to choose from that, rather than trusting it to
 * remember which Paper builds exist.
 *
 * Falls back to a static list when offline — the tool must still work.
 */

const PAPER_API = "https://api.papermc.io/v2/projects/paper";

const FALLBACK = [
  "1.21.10", "1.21.9", "1.21.8", "1.21.7", "1.21.6", "1.21.5",
  "1.21.4", "1.21.3", "1.21.1", "1.20.6", "1.20.4", "1.20.1",
  "1.19.4", "1.18.2", "1.16.5", "1.12.2", "1.8.8",
];

let cache: string[] | null = null;

export async function fetchPaperVersions(): Promise<string[]> {
  if (cache) return cache;
  try {
    const res = await fetch(PAPER_API, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const body = (await res.json()) as { versions?: string[] };
    if (!body.versions?.length) throw new Error("empty version list");
    cache = body.versions.slice().reverse();
    return cache;
  } catch {
    cache = FALLBACK;
    return cache;
  }
}

export async function isValidVersion(v: string): Promise<boolean> {
  return (await fetchPaperVersions()).includes(v);
}

export async function latestVersion(): Promise<string> {
  return (await fetchPaperVersions())[0];
}
