import { describe, expect, it } from "vitest";
import { diffPayload } from "../diff";

describe("diffPayload", () => {
  it("returns an empty diff for identical payloads", () => {
    expect(diffPayload({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toEqual([]);
  });

  it("reports changed scalar fields", () => {
    expect(diffPayload({ amountCents: 9500, reasonCode: "other" }, { amountCents: 7000, reasonCode: "late" })).toEqual([
      { path: "amountCents", before: 9500, after: 7000 },
      { path: "reasonCode", before: "other", after: "late" },
    ]);
  });

  it("flattens nested objects to dotted paths", () => {
    expect(diffPayload({ addr: { city: "A", zip: "1" } }, { addr: { city: "B", zip: "1" } })).toEqual([
      { path: "addr.city", before: "A", after: "B" },
    ]);
  });

  it("reports added and removed fields against null", () => {
    expect(diffPayload({ a: { line2: "Unit 5" } }, { a: {} })).toEqual([{ path: "a.line2", before: "Unit 5", after: null }]);
    expect(diffPayload({}, { x: true })).toEqual([{ path: "x", before: null, after: true }]);
  });
});
