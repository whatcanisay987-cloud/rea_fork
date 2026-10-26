import { build, buildBinary } from "plist";
import { expect, it } from "vitest";

import { decodeKeyedArchiveBytes } from "../../../src/artifacts/apple/KeyedArchiveReader.js";

it.each([
  { name: "data", value: new Uint8Array([0]) },
  { name: "date", value: new Date(0) },
  { name: "real", value: Number.POSITIVE_INFINITY },
])(
  "rejects a $name scalar used as the top-level root dictionary in either encoding",
  ({ value }) => {
    const archive = {
      $archiver: "NSKeyedArchiver",
      $version: 100000,
      $objects: ["$null"],
      $top: value,
    };
    for (const encode of [build, buildBinary]) {
      const bytes = Buffer.from(encode(archive));
      expect(() =>
        decodeKeyedArchiveBytes(bytes, { offset: 0, limit: 10 }),
      ).toThrow("Keyed archive has no $top roots");
    }
  },
);

it("keeps literal wrapper-shaped dictionaries as real root maps", () => {
  const top = { $plist_type: "data", base64: "AA==" };
  const archive = {
    $archiver: "NSKeyedArchiver",
    $version: 100000,
    $objects: ["$null"],
    $top: top,
  };
  for (const encode of [build, buildBinary]) {
    const graph = decodeKeyedArchiveBytes(Buffer.from(encode(archive)), {
      offset: 0,
      limit: 10,
    });
    expect(graph.roots).toEqual(top);
    expect(graph.references).toEqual([]);
  }
});

it.each([
  { encoding: "XML", encode: build },
  { encoding: "binary", encode: buildBinary },
])(
  "retains own $encoding dictionary keys without changing the prototype",
  ({ encode }) => {
    const object = Object.fromEntries([
      ["__proto__", { inherited: "not an own fact" }],
      ["payload", "retained"],
    ]);
    const graph = decodeKeyedArchiveBytes(
      Buffer.from(
        encode({
          $archiver: "NSKeyedArchiver",
          $version: 100000,
          $objects: ["$null", object],
          $top: { root: { UID: 1 } },
        }),
      ),
      { offset: 0, limit: 10 },
    );
    expect(graph.objects[1]).toMatchObject({
      kind: "dictionary",
      value: { payload: "retained" },
    });
    const value = graph.objects[1]?.value;
    expect(value).toEqual(object);
    expect(Object.hasOwn(value!, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(value).not.toHaveProperty("inherited");
    expect(graph.limitations).not.toContainEqual(
      expect.stringContaining("__proto__"),
    );
  },
);
