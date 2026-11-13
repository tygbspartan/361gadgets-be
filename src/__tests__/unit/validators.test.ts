import {
  registerSchema,
  loginSchema,
  checkoutSchema,
  refundSchema,
  addressSchema,
  createReviewSchema,
  createDiscountSchema,
  updateDiscountSchema,
} from "../../validators/schemas";

describe("registerSchema", () => {
  it("accepts a valid registration and normalizes the email", () => {
    const parsed = registerSchema.parse({
      email: "  USER@Example.COM ",
      password: "password123",
      firstName: "Ada",
    });
    expect(parsed.email).toBe("user@example.com"); // trimmed + lowercased
  });

  it("rejects a malformed email", () => {
    expect(registerSchema.safeParse({ email: "nope", password: "password123" }).success).toBe(false);
  });

  it("rejects a password shorter than 6 chars", () => {
    expect(registerSchema.safeParse({ email: "a@b.com", password: "12345" }).success).toBe(false);
  });

  it("strips unknown fields (no mass-assignment through the schema)", () => {
    const parsed: any = registerSchema.parse({
      email: "a@b.com",
      password: "password123",
      role: "superadmin", // attacker-supplied — must be dropped
    });
    expect(parsed.role).toBeUndefined();
  });
});

describe("loginSchema", () => {
  it("requires a non-empty password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  const shippingInfo = {
    fullName: "Ada Lovelace",
    phone: "9800000000",
    email: "ada@example.com",
    addressLine1: "1 Analytical Ave",
    landmark: "Near the clock tower",
    city: "Kathmandu",
    province: "Bagmati Province",
    postalCode: "44600",
  };
  const withShipping = (overrides: Record<string, string>) =>
    checkoutSchema.safeParse({ shippingInfo: { ...shippingInfo, ...overrides }, paymentMethod: "cod" });

  it("accepts a valid COD checkout", () => {
    expect(
      checkoutSchema.safeParse({ shippingInfo, paymentMethod: "cod" }).success,
    ).toBe(true);
  });

  it("rejects an unknown payment method", () => {
    expect(
      checkoutSchema.safeParse({ shippingInfo, paymentMethod: "bitcoin" }).success,
    ).toBe(false);
  });

  it("rejects a missing required shipping field", () => {
    const { city, ...incomplete } = shippingInfo;
    expect(
      checkoutSchema.safeParse({ shippingInfo: incomplete, paymentMethod: "cod" }).success,
    ).toBe(false);
  });

  it("normalizes the phone and accepts 97x numbers", () => {
    const parsed = withShipping({ phone: "+977 976-8988420" });
    expect(parsed.success && parsed.data.shippingInfo.phone).toBe("9768988420");
  });

  it("rejects a phone that isn't a Nepali mobile number", () => {
    expect(withShipping({ phone: "9612345678" }).success).toBe(false); // 96 prefix
    expect(withShipping({ phone: "98000000" }).success).toBe(false); // too short
    expect(withShipping({ phone: "anything" }).success).toBe(false);
  });

  it("only accepts a district as the city, stored in the list spelling", () => {
    const parsed = withShipping({ city: "  kathmandu " });
    expect(parsed.success && parsed.data.shippingInfo.city).toBe("Kathmandu");
    // Fuzzy valley matches used to get the cheaper rate; now they're rejected.
    expect(withShipping({ city: "a" }).success).toBe(false);
    expect(withShipping({ city: "Kathmandu Valley" }).success).toBe(false);
  });

  it("requires a valid province and a landmark", () => {
    expect(withShipping({ province: "" }).success).toBe(false);
    expect(withShipping({ province: "Bagmati" }).success).toBe(false);
    expect(withShipping({ landmark: "  " }).success).toBe(false);
  });

  it("requires a 5-digit postal code", () => {
    expect(withShipping({ postalCode: "4460" }).success).toBe(false);
    expect(withShipping({ postalCode: "44600a" }).success).toBe(false);
  });

  it("rejects a non-positive item quantity", () => {
    expect(
      checkoutSchema.safeParse({
        shippingInfo,
        paymentMethod: "cod",
        items: [{ productId: 1, quantity: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe("refundSchema", () => {
  it("requires a reason", () => {
    expect(refundSchema.safeParse({}).success).toBe(false);
  });
  it("accepts a reason with an optional positive amount", () => {
    expect(refundSchema.safeParse({ reason: "fake product", amount: 100 }).success).toBe(true);
  });
  it("rejects a negative amount", () => {
    expect(refundSchema.safeParse({ reason: "x", amount: -5 }).success).toBe(false);
  });
});

describe("addressSchema", () => {
  it("accepts a valid address", () => {
    expect(
      addressSchema.safeParse({
        fullName: "Ada",
        phone: "9800000000",
        addressLine1: "1 Ave",
        landmark: "Opposite the school",
        city: "Lalitpur",
        province: "Bagmati Province",
        postalCode: "44700",
      }).success,
    ).toBe(true);
  });
  it("requires a city", () => {
    expect(
      addressSchema.safeParse({
        fullName: "Ada",
        phone: "9800000000",
        addressLine1: "1 Ave",
        postalCode: "44700",
      }).success,
    ).toBe(false);
  });
});

describe("createReviewSchema", () => {
  it("rejects a rating outside 1..5", () => {
    expect(createReviewSchema.safeParse({ productId: 1, rating: 6, comment: "hi" }).success).toBe(false);
    expect(createReviewSchema.safeParse({ productId: 1, rating: 0, comment: "hi" }).success).toBe(false);
  });
  it("accepts a valid review", () => {
    expect(createReviewSchema.safeParse({ productId: 1, rating: 5, comment: "great" }).success).toBe(true);
  });
});

describe("createDiscountSchema", () => {
  const base = {
    name: "Launch",
    code: "launch-10",
    type: "percentage",
    value: 10,
    startDate: "2026-11-01T00:00:00.000Z",
    endDate: "2026-12-01T00:00:00.000Z",
  };

  it("accepts a valid discount and uppercases the code", () => {
    const parsed = createDiscountSchema.safeParse(base);
    expect(parsed.success && parsed.data.code).toBe("LAUNCH-10");
  });

  it("drops server-managed fields (usedCount, ownerId)", () => {
    const parsed: any = createDiscountSchema.parse({ ...base, usedCount: 0, ownerId: 1 });
    expect(parsed.usedCount).toBeUndefined();
    expect(parsed.ownerId).toBeUndefined();
  });

  it("rejects a percentage over 100, a non-positive value and bad dates", () => {
    expect(createDiscountSchema.safeParse({ ...base, value: 150 }).success).toBe(false);
    expect(createDiscountSchema.safeParse({ ...base, value: -5 }).success).toBe(false);
    expect(createDiscountSchema.safeParse({ ...base, endDate: base.startDate }).success).toBe(false);
    expect(createDiscountSchema.safeParse({ ...base, startDate: "not a date" }).success).toBe(false);
  });

  it("rejects codes with spaces or symbols", () => {
    expect(createDiscountSchema.safeParse({ ...base, code: "SAVE 10" }).success).toBe(false);
    expect(createDiscountSchema.safeParse({ ...base, code: "SAVE%" }).success).toBe(false);
  });
});

describe("updateDiscountSchema", () => {
  it("accepts null to clear a limit, and a partial body", () => {
    expect(updateDiscountSchema.safeParse({ usageLimit: null, maxDiscountAmount: null }).success).toBe(true);
    expect(updateDiscountSchema.safeParse({ oncePerUser: true }).success).toBe(true);
  });

  it("rejects a usage limit below 1", () => {
    expect(updateDiscountSchema.safeParse({ usageLimit: 0 }).success).toBe(false);
  });
});
