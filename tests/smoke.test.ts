import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";

const Manifest = Type.Object({
  pi: Type.Object({ extensions: Type.Array(Type.String()) }),
});

const root = new URL("../", import.meta.url);

async function manifestEntries(): Promise<string[]> {
  const data: unknown = JSON.parse(
    await readFile(new URL("package.json", root), "utf8"),
  );

  if (!Value.Check(Manifest, data)) throw new Error("Invalid pi manifest");

  return data.pi.extensions;
}

test("every manifest extension exports a default factory", async () => {
  const entries = await manifestEntries();
  expect(entries.length).toBeGreaterThan(0);

  for (const entry of entries) {
    const loaded: unknown = await import(new URL(entry, root).href);
    expect(loaded).toHaveProperty("default", expect.any(Function));
  }
});
