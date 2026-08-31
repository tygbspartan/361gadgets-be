import {
  registerSchema,
  loginSchema,
  checkoutSchema,
  refundSchema,
  addressSchema,
  createReviewSchema,
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
    city: "Kathmandu",
    postalCode: "44600",
  };

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
        city: "Lalitpur",
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
