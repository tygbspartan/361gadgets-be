import { api, prisma, describeIntegration, loginSuperadmin, tag } from "./helpers";
import type { Response } from "supertest";

// Fail fast with the actual status + body when a setup step doesn't succeed.
function ok(res: Response, label: string): Response {
  if (res.status >= 400 || !res.body?.data) {
    throw new Error(`${label} failed [${res.status}]: ${JSON.stringify(res.body)}`);
  }
  return res;
}

const shippingInfo = {
  fullName: "IT Buyer",
  phone: "9800000000",
  email: "it-buyer@example.com",
  addressLine1: "1 Test Street",
  city: "Kathmandu",
  postalCode: "44600",
};

describeIntegration("marketplace: ownership scoping + checkout (integration)", () => {
  const t = tag();
  const vendorAEmail = `it-vendorA-${t}@example.com`;
  const vendorBEmail = `it-vendorB-${t}@example.com`;
  const pw = "password123";

  let superToken = "";
  let vendorAToken = "";
  let vendorBToken = "";
  let vendorAId = 0;
  let vendorBId = 0;
  let categoryId = 0;
  let brandAId = 0;
  let brandBId = 0;
  let productAId = 0;
  let productBId = 0;

  beforeAll(async () => {
    superToken = await loginSuperadmin();

    const cat = ok(
      await api()
        .post("/api/categories")
        .set("Authorization", `Bearer ${superToken}`)
        .send({ name: `IT Category ${t}`, level: 1 }),
      "create category",
    );
    categoryId = cat.body.data.id;

    // A brand is exclusive to one vendor, so each vendor needs its own.
    const ba = ok(
      await api()
        .post("/api/brands")
        .set("Authorization", `Bearer ${superToken}`)
        .send({ name: `IT Brand A ${t}` }),
      "create brand A",
    );
    brandAId = ba.body.data.id;
    const bb = ok(
      await api()
        .post("/api/brands")
        .set("Authorization", `Bearer ${superToken}`)
        .send({ name: `IT Brand B ${t}` }),
      "create brand B",
    );
    brandBId = bb.body.data.id;

    const va = ok(
      await api()
        .post("/api/admin/vendors")
        .set("Authorization", `Bearer ${superToken}`)
        .send({ email: vendorAEmail, password: pw, companyName: `VendorA ${t}` }),
      "create vendor A",
    );
    vendorAId = va.body.data.id;

    const vb = ok(
      await api()
        .post("/api/admin/vendors")
        .set("Authorization", `Bearer ${superToken}`)
        .send({ email: vendorBEmail, password: pw, companyName: `VendorB ${t}` }),
      "create vendor B",
    );
    vendorBId = vb.body.data.id;

    vendorAToken = ok(
      await api().post("/api/auth/login").send({ email: vendorAEmail, password: pw }),
      "login vendor A",
    ).body.data.token;
    vendorBToken = ok(
      await api().post("/api/auth/login").send({ email: vendorBEmail, password: pw }),
      "login vendor B",
    ).body.data.token;

    // Assign each brand to its vendor — vendors can only build products under
    // brands assigned to them (strict ownership, no auto-claim).
    ok(
      await api()
        .put(`/api/admin/vendors/${vendorAId}/brands`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({ brandIds: [brandAId] }),
      "assign brand A to vendor A",
    );
    ok(
      await api()
        .put(`/api/admin/vendors/${vendorBId}/brands`)
        .set("Authorization", `Bearer ${superToken}`)
        .send({ brandIds: [brandBId] }),
      "assign brand B to vendor B",
    );

    const pa = ok(
      await api()
        .post("/api/products")
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({
          name: `Product A ${t}`,
          longDescription: "integration test product A",
          price: 1000,
          costPrice: 500,
          sku: `IT-A-${t}`,
          brandId: brandAId,
          categoryId,
          stockQuantity: 20,
        }),
      "create product A",
    );
    productAId = pa.body.data.id;

    const pb = ok(
      await api()
        .post("/api/products")
        .set("Authorization", `Bearer ${vendorBToken}`)
        .send({
          name: `Product B ${t}`,
          longDescription: "integration test product B",
          price: 1000,
          costPrice: 500,
          sku: `IT-B-${t}`,
          brandId: brandBId,
          categoryId,
          stockQuantity: 20,
        }),
      "create product B",
    );
    productBId = pb.body.data.id;
  });

  afterAll(async () => {
    // Delete test orders first (cascades their items/history), then fixtures.
    const ids = [productAId, productBId].filter(Boolean);
    if (ids.length) {
      const items = await prisma.orderItem.findMany({
        where: { productId: { in: ids } },
        select: { orderId: true },
      });
      const orderIds = [...new Set(items.map((i) => i.orderId))];
      if (orderIds.length) {
        await prisma.idempotencyKey.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      }
      await prisma.product.deleteMany({ where: { id: { in: ids } } });
    }
    const brandIds = [brandAId, brandBId].filter(Boolean);
    if (brandIds.length) {
      await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    }
    const vendorIds = [vendorAId, vendorBId].filter(Boolean);
    if (vendorIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: vendorIds } } });
    }
    if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.$disconnect();
  });

  it("sets up fixtures (two vendors each with a product)", () => {
    expect(productAId).toBeGreaterThan(0);
    expect(productBId).toBeGreaterThan(0);
    expect(vendorAId).not.toBe(vendorBId);
  });

  describe("vendor ownership scoping", () => {
    it("vendor A can read its OWN product (200)", async () => {
      const res = await api()
        .get(`/api/products/${productAId}`)
        .set("Authorization", `Bearer ${vendorAToken}`);
      expect(res.status).toBe(200);
    });

    it("vendor A CANNOT read vendor B's product (403)", async () => {
      const res = await api()
        .get(`/api/products/${productBId}`)
        .set("Authorization", `Bearer ${vendorAToken}`);
      expect(res.status).toBe(403);
    });

    it("vendor A CANNOT update vendor B's product (403)", async () => {
      const res = await api()
        .put(`/api/products/${productBId}`)
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({ price: 1 });
      expect(res.status).toBe(403);
    });

    it("superadmin CAN read any vendor's product (200)", async () => {
      const res = await api()
        .get(`/api/products/${productBId}`)
        .set("Authorization", `Bearer ${superToken}`);
      expect(res.status).toBe(200);
    });
  });

  describe("checkout idempotency + atomic stock", () => {
    it("a repeated Idempotency-Key returns the SAME order (no duplicate)", async () => {
      const key = `it-idem-${t}`;
      const body = {
        shippingInfo,
        paymentMethod: "cod",
        items: [{ productId: productAId, quantity: 1 }],
      };
      const r1 = await api().post("/api/orders/checkout").set("Idempotency-Key", key).send(body);
      const r2 = await api().post("/api/orders/checkout").set("Idempotency-Key", key).send(body);
      expect(r1.status).toBe(201);
      expect(r2.status).toBe(201);
      expect(r2.body.data.orderNumber).toBe(r1.body.data.orderNumber);
    });

    it("two simultaneous checkouts on the last unit never oversell", async () => {
      // Force exactly one unit left.
      await api()
        .put(`/api/products/${productAId}`)
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({ stockQuantity: 1 });

      const body = {
        shippingInfo,
        paymentMethod: "cod",
        items: [{ productId: productAId, quantity: 1 }],
      };
      const [a, b] = await Promise.all([
        api().post("/api/orders/checkout").send(body),
        api().post("/api/orders/checkout").send(body),
      ]);

      // Exactly one wins with 201, the other gets a clean 409 — never a 500,
      // never both succeeding.
      expect([a.status, b.status].sort()).toEqual([201, 409]);

      const check = await api()
        .get(`/api/products/${productAId}`)
        .set("Authorization", `Bearer ${vendorAToken}`);
      expect(check.body.data.stockQuantity).toBe(0);
    });
  });

  describe("strict brand ownership + non-destructive transfer", () => {
    let transferBrandId = 0;
    let transferProductId = 0;

    afterAll(async () => {
      if (transferProductId) {
        await prisma.product.deleteMany({ where: { id: transferProductId } });
      }
      if (transferBrandId) {
        await prisma.brand.deleteMany({ where: { id: transferBrandId } });
      }
    });

    it("rejects a vendor creating a product under an UNASSIGNED brand (403)", async () => {
      const b = ok(
        await api()
          .post("/api/brands")
          .set("Authorization", `Bearer ${superToken}`)
          .send({ name: `IT Transfer Brand ${t}` }),
        "create transfer brand",
      );
      transferBrandId = b.body.data.id;

      const res = await api()
        .post("/api/products")
        .set("Authorization", `Bearer ${vendorAToken}`)
        .send({
          name: `Transfer Product ${t}`,
          longDescription: "x",
          price: 1000,
          costPrice: 500,
          sku: `IT-T-${t}`,
          brandId: transferBrandId,
          categoryId,
          stockQuantity: 5,
        });
      expect(res.status).toBe(403);
    });

    it("allows creation once assigned, then deactivates + unassigns the product on release", async () => {
      // Assign the transfer brand to vendor A (keep brand A too).
      ok(
        await api()
          .put(`/api/admin/vendors/${vendorAId}/brands`)
          .set("Authorization", `Bearer ${superToken}`)
          .send({ brandIds: [brandAId, transferBrandId] }),
        "assign transfer brand",
      );

      const created = ok(
        await api()
          .post("/api/products")
          .set("Authorization", `Bearer ${vendorAToken}`)
          .send({
            name: `Transfer Product ${t}`,
            longDescription: "x",
            price: 1000,
            costPrice: 500,
            sku: `IT-T-${t}`,
            brandId: transferBrandId,
            categoryId,
            stockQuantity: 5,
          }),
        "create transfer product",
      );
      transferProductId = created.body.data.id;

      // Release the transfer brand (keep brand A) — non-destructive transfer.
      ok(
        await api()
          .put(`/api/admin/vendors/${vendorAId}/brands`)
          .set("Authorization", `Bearer ${superToken}`)
          .send({ brandIds: [brandAId] }),
        "release transfer brand",
      );

      // The product still exists but is deactivated + unassigned (not deleted).
      const dbProduct = await prisma.product.findUnique({
        where: { id: transferProductId },
        select: { isActive: true, ownerId: true, brandId: true },
      });
      expect(dbProduct?.isActive).toBe(false);
      expect(dbProduct?.ownerId).toBeNull();
      expect(dbProduct?.brandId).toBe(transferBrandId); // brand link preserved

      // The old vendor can no longer access it; superadmin still can.
      const vendorView = await api()
        .get(`/api/products/${transferProductId}`)
        .set("Authorization", `Bearer ${vendorAToken}`);
      expect(vendorView.status).toBe(403);

      const superView = await api()
        .get(`/api/products/${transferProductId}`)
        .set("Authorization", `Bearer ${superToken}`);
      expect(superView.status).toBe(200);
    });
  });
});
