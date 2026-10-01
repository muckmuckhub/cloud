import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { CloudConfigSchema, type CloudConfig } from "@cloud/schema";
import { editCloudToml } from "../src/edit.ts";
import { applyPreset } from "../src/presets/types.ts";
import { PRESETS } from "../src/presets/registry.ts";

const read = (text: string): CloudConfig => CloudConfigSchema.parse(parseToml(text));

/** Edits `text` towards `change(config)` and checks the result means exactly that. */
function edit(text: string, change: (cfg: CloudConfig) => void) {
  const next = structuredClone(read(text));
  change(next);
  const parsed = CloudConfigSchema.parse(next);
  const result = editCloudToml(text, parsed);
  expect(read(result.text)).toEqual(parsed);
  return result;
}

const handWritten = `# Our network. Ask Sam before changing the proxy.

[network]
name = "friends"     # also the container prefix
entry_port = 25565

# Lobbies: two, so updates do not kick anyone.
[groups.lobby]
version  = "1.21.10"
min      = 2
fallback = true

# The SMP. Backed up nightly.
[groups.smp]
version = "1.21.10"
memory  = "4G"   # bumped in March
static  = true

[groups.smp.env]
DIFFICULTY = "hard"
`;

describe("editCloudToml", () => {
  test("no change leaves the file byte for byte", () => {
    const r = edit(handWritten, () => {});
    expect(r).toEqual({ text: handWritten, inPlace: true });
  });

  test("a preset keeps every comment and only adds its lines", () => {
    const r = edit(handWritten, (c) => {
      c.groups.lobby.hangar = ["ViaVersion:5.11.0"];
      c.groups.smp.hangar = ["ViaVersion:5.11.0"];
    });
    expect(r.inPlace).toBe(true);
    for (const line of handWritten.split("\n")) expect(r.text).toContain(line);
    expect(r.text.split("\n").length).toBe(handWritten.split("\n").length + 2);
    // Lined up with its neighbours, after the table's last key.
    expect(r.text).toContain('fallback = true\nhangar   = ["ViaVersion:5.11.0"]\n');
    expect(r.text).toContain('static  = true\nhangar  = ["ViaVersion:5.11.0"]\n');
  });

  test("a changed value keeps the key, its spacing and its comment", () => {
    const r = edit(handWritten, (c) => {
      c.groups.smp.memory = "6G";
    });
    expect(r.text).toContain('memory  = "6G"   # bumped in March');
    expect(r.text.replace('"6G"', '"4G"')).toBe(handWritten);
  });

  test("a new group is appended in init's format, nothing else moves", () => {
    const r = edit(handWritten, (c) => {
      c.groups.creative = { ...c.groups.smp, env: {}, memory: "2G" };
    });
    expect(r.text.startsWith(handWritten.trimEnd())).toBe(true);
    expect(r.text).toContain("[groups.creative]\nsoftware = \"paper\"");
  });

  test("a removed group takes its own comment with it, and only that", () => {
    const withThird = handWritten + '\n# Creative world.\n[groups.creative]\nversion = "1.21.10"\n';
    const r = edit(withThird, (c) => {
      delete c.groups.smp;
    });
    expect(r.text).not.toContain("The SMP");
    expect(r.text).not.toContain("DIFFICULTY");
    expect(r.text).toContain("# Creative world.\n[groups.creative]");
    expect(r.text).toContain("# Lobbies: two");
  });

  test("an env key joins its existing table", () => {
    const r = edit(handWritten, (c) => {
      c.groups.smp.env.PVP = "false";
    });
    expect(r.text).toContain('DIFFICULTY = "hard"\nPVP = "false"');
  });

  test("a new env table goes after its group, not between the next comment and header", () => {
    const r = edit(handWritten, (c) => {
      c.groups.lobby.env = { MODE: "adventure" };
    });
    expect(r.text).toContain('fallback = true\n\n[groups.lobby.env]\nMODE = "adventure"\n\n# The SMP.');
  });

  test("a missing [proxy] table is added before the groups, with their comments intact", () => {
    const r = edit(handWritten, (c) => {
      c.proxy.ports = ["19132:19132/udp"];
    });
    expect(r.inPlace).toBe(true);
    expect(r.text).toMatch(/entry_port = 25565\n\n\[proxy\][\s\S]*ports {4}= \["19132:19132\/udp"\][^\n]*\n\n# Lobbies: two/);
  });

  test("a removed key removes its line", () => {
    const text = handWritten.replace("# bumped in March\n", '# bumped in March\nmemory_limit = "6G"\n');
    const r = edit(text, (c) => {
      c.groups.smp.memory_limit = undefined;
    });
    expect(r.text).toBe(handWritten);
  });

  test("a multi-line array elsewhere does not stop an edit", () => {
    const text = handWritten.replace(
      "min      = 2\n",
      'min      = 2\nplugins  = [\n  "https://example.com/a.jar",  # the important one\n  "https://example.com/b.jar",\n]\n',
    );
    const r = edit(text, (c) => {
      c.groups.smp.memory = "6G";
    });
    expect(r.inPlace).toBe(true);
    expect(r.text).toContain("# the important one");
  });

  test("forms it does not edit fall back to the canonical file, and say why", () => {
    const inline = handWritten.replace(
      '[groups.smp.env]\nDIFFICULTY = "hard"\n',
      "",
    ).replace('static  = true', 'static  = true\nenv     = { DIFFICULTY = "hard" }');
    const r = edit(inline, (c) => {
      c.groups.smp.env.PVP = "false";
    });
    expect(r.inPlace).toBe(false);
    expect(r.reason).toBeTruthy();

    const dotted = '[network]\nname = "x"\n\n[groups.lobby]\nversion = "1.21.10"\nfallback = true\nenv.MODE = "a"\n';
    const d = edit(dotted, (c) => {
      c.groups.lobby.memory = "1G";
    });
    expect(d.inPlace).toBe(false);
    expect(d.reason).toContain("dotted key");
  });
});

describe("every preset on every example", () => {
  // The examples are real cloud.toml files with comments throughout: the
  // closest thing to what users have.
  const dir = join(import.meta.dir, "..", "..", "..", "examples");
  const examples = readdirSync(dir).filter((d) => !d.startsWith("."));
  for (const example of examples) {
    test.each(Object.keys(PRESETS))(`${example} + %s edits in place and keeps every comment`, async (name) => {
      const text = await Bun.file(join(dir, example, "cloud.toml")).text();
      const next = CloudConfigSchema.parse(applyPreset(read(text), PRESETS[name]));
      const r = editCloudToml(text, next);
      expect(r.inPlace).toBe(true);
      expect(read(r.text)).toEqual(next);
      const comments = text.split("\n").filter((l) => l.includes("#"));
      for (const c of comments) expect(r.text).toContain(c.slice(c.indexOf("#")));
    });
  }
});
