import { describe, expect, it } from "vitest";

import { streamJsonInto, streamJsonToString } from "../src/json-stream.js";

/**
 * Every assertion here is differential: the streamed document must equal what
 * `JSON.stringify` produces, because the committed package digests were taken
 * from that output and must keep their meaning.
 */
function expectsSameAsStringify(value: unknown, label: string): void {
  expect(streamJsonToString(value), `${label} (compact)`).toBe(JSON.stringify(value));
  expect(streamJsonToString(value, { indent: 2 }), `${label} (indent 2)`).toBe(
    JSON.stringify(value, null, 2),
  );
}

/** A deterministic generator, so a failure is reproducible from the seed. */
function pseudoRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomValue(next: () => number, depth: number): unknown {
  const roll = next();
  if (depth > 3 || roll < 0.28) {
    const leaf = next();
    if (leaf < 0.14) return null;
    if (leaf < 0.28) return leaf < 0.2;
    if (leaf < 0.6) return (leaf - 0.4) * 1e6;
    return `s${Math.floor(leaf * 1e6)}\u00e9\u3042`;
  }
  if (roll < 0.64) {
    return Array.from({ length: Math.floor(next() * 4) }, () => randomValue(next, depth + 1));
  }
  const entry: Record<string, unknown> = {};
  for (let at = 0; at < Math.floor(next() * 4); at += 1) {
    entry[`k${Math.floor(next() * 1000)}`] = randomValue(next, depth + 1);
  }
  return entry;
}

describe("streaming JSON writer", () => {
  it("matches JSON.stringify on the shapes a compiled document uses", () => {
    expectsSameAsStringify(
      {
        asset: { version: "2.0", generator: "naru" },
        nodes: [
          { name: "beam", mesh: 0, translation: [1.5, -2.25, 0] },
          { name: "wall", children: [0, 1, 2] },
        ],
        accessors: [{ componentType: 5126, count: 12, type: "VEC3", min: [0, 0, 0] }],
        extras: { madi: { progressive: { chunks: [] } } },
      },
      "compiled document",
    );
  });

  it("delegates every escape, so strings cannot drift", () => {
    const control = Array.from({ length: 0x20 }, (_, at) => String.fromCharCode(at)).join("");
    expectsSameAsStringify(
      {
        quote: 'a "quoted" name',
        backslash: "C:\\models\\wall.ifc",
        whitespace: "line\nreturn\rtab\tbell\bform\f",
        control,
        unicode: "\u00e9\u3042\u4e2d\ud83d\ude00",
        loneHigh: "\ud800",
        loneLow: "\udfff",
        pair: "\ud83d\ude00",
        del: "\u007f",
        separators: "\u2028\u2029",
      },
      "escapes",
    );
  });

  it("matches JSON.stringify on every number form", () => {
    expectsSameAsStringify(
      {
        zero: 0,
        negativeZero: -0,
        integer: 4_294_967_296,
        fraction: 0.1 + 0.2,
        tiny: 5e-324,
        huge: 1.797_693_134_862_315_7e308,
        exponent: 1e21,
        notFinite: [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        maxSafe: Number.MAX_SAFE_INTEGER,
      },
      "numbers",
    );
  });

  it("drops object keys but writes null for the same values in an array", () => {
    const symbol = Symbol("mark");
    expectsSameAsStringify(
      {
        kept: 1,
        missing: undefined,
        callable: () => 0,
        marked: symbol,
        array: [1, undefined, () => 0, symbol, 2],
      },
      "dropped values",
    );
    expect(streamJsonToString({ onlyDropped: undefined })).toBe("{}");
    expect(streamJsonToString({ onlyDropped: undefined }, { indent: 2 })).toBe("{}");
  });

  it("writes null for array holes", () => {
    // Built by assignment rather than as a literal: the holes are the point.
    const sparse: unknown[] = [];
    sparse[0] = 1;
    sparse[2] = 3;
    sparse.length = 5;
    expectsSameAsStringify(sparse, "sparse array");
  });
});

describe("streaming JSON writer, delegated semantics", () => {
  it("enumerates keys in the order JSON.stringify does", () => {
    const value: Record<string, unknown> = {};
    value.zulu = 1;
    value["10"] = 2;
    value.alpha = 3;
    value["2"] = 4;
    value["-1"] = 5;
    value["01"] = 6;
    expectsSameAsStringify(value, "key order");
    expect(streamJsonToString(value)).toContain('{"2":4,"10":2,');
  });

  it("applies toJSON with the key, at every depth", () => {
    const keyed = { toJSON: (key: string) => `for:${key}` };
    expectsSameAsStringify(
      {
        stamped: new Date(0),
        keyed,
        nested: { keyed },
        listed: [keyed, keyed],
        replaced: { toJSON: () => ({ inner: [1, { deep: true }] }) },
      },
      "toJSON",
    );
  });

  it("delegates boxed primitives instead of walking them as objects", () => {
    expectsSameAsStringify(
      {
        number: new Number(4.5),
        text: new String('boxed "quote"'),
        flag: new Boolean(false),
      },
      "boxed primitives",
    );
  });

  it("writes empty containers without indentation", () => {
    expectsSameAsStringify(
      { object: {}, array: [], nested: [{}, [], { inner: [] }] },
      "empty containers",
    );
    expect(streamJsonToString([], { indent: 2 })).toBe("[]");
    expect(streamJsonToString({}, { indent: 2 })).toBe("{}");
  });

  it("refuses a document that has no JSON form", () => {
    expect(() => streamJsonToString(undefined)).toThrow(TypeError);
    expect(() => streamJsonToString(() => 0)).toThrow(TypeError);
    expect(() => streamJsonToString(Symbol("x"))).toThrow(TypeError);
    expect(() => streamJsonToString({ big: 1n })).toThrow(TypeError);
  });
});

describe("streaming JSON writer, chunking", () => {
  const document = {
    nodes: Array.from({ length: 2_000 }, (_, at) => ({
      name: `node ${at}`,
      mesh: at % 7,
      translation: [at, at * 0.5, -at],
    })),
  };

  it("splits a document into chunks that concatenate to the whole", () => {
    for (const indent of [0, 2]) {
      const chunks: string[] = [];
      streamJsonInto(document, (chunk) => chunks.push(chunk), {
        indent,
        chunkCharacters: 64,
      });
      expect(chunks.length, `indent ${indent} chunk count`).toBeGreaterThan(100);
      expect(chunks.some((chunk) => chunk.length === 0)).toBe(false);
      expect(chunks.join("")).toBe(JSON.stringify(document, null, indent === 0 ? undefined : 2));
    }
  });

  it("holds no more than one chunk of characters at a time", () => {
    let live = 0;
    let peak = 0;
    streamJsonInto(document, (chunk) => {
      live = chunk.length;
      peak = Math.max(peak, live);
    }, { indent: 2, chunkCharacters: 4_096 });
    // The writer flushes as soon as the threshold is crossed, so the buffer
    // never grows with the document; only the last fragment can be shorter.
    expect(peak).toBeLessThan(4_096 + 256);
  });

  it("emits one chunk when the document is smaller than the threshold", () => {
    const chunks: string[] = [];
    streamJsonInto({ a: 1 }, (chunk) => chunks.push(chunk));
    expect(chunks).toEqual(['{"a":1}']);
  });
});

describe("streaming JSON writer, randomized corpus", () => {
  it("matches JSON.stringify over 300 generated documents", () => {
    const next = pseudoRandom(0x5eed);
    for (let sample = 0; sample < 300; sample += 1) {
      const value = randomValue(next, 0);
      expect(streamJsonToString(value)).toBe(JSON.stringify(value));
      expect(streamJsonToString(value, { indent: 2 })).toBe(JSON.stringify(value, null, 2));
    }
  });
});
