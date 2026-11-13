import { parseId, parseIntParam } from "../../utils/parseId.util";

describe("parseId", () => {
  it("parses a positive integer id", () => {
    expect(parseId("42")).toBe(42);
    expect(parseId(7)).toBe(7);
  });

  it("rejects non-numeric, partial, zero, negative and oversized ids with a 400", () => {
    for (const bad of ["abc", "12abc", "1.5", "0", "-3", "", undefined, "99999999999"]) {
      expect(() => parseId(bad)).toThrow(expect.objectContaining({ statusCode: 400 }));
    }
  });

  it("names the field in the message", () => {
    expect(() => parseId("x", "product ID")).toThrow("Invalid product ID");
  });
});

describe("parseIntParam", () => {
  it("allows zero", () => {
    expect(parseIntParam("0", "display order")).toBe(0);
  });
});
