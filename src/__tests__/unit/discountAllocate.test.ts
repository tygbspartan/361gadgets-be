import { allocate } from "../../services/discount.service";

describe("allocate (splitting a discount across order lines)", () => {
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

  it("splits in proportion to each line's subtotal", () => {
    expect(allocate(100, [600, 400])).toEqual([60, 40]);
  });

  it("gives ineligible lines (weight 0) nothing", () => {
    expect(allocate(50, [0, 1000, 0])).toEqual([0, 50, 0]);
  });

  it("always adds up exactly to the discount, despite rounding", () => {
    const parts = allocate(100, [333, 333, 334]);
    expect(sum(parts)).toBe(100);
    const odd = allocate(10.01, [1, 1, 1]);
    expect(sum(odd)).toBe(10.01);
  });

  it("returns zeros when there's nothing to split", () => {
    expect(allocate(0, [100, 200])).toEqual([0, 0]);
    expect(allocate(50, [0, 0])).toEqual([0, 0]);
  });
});
