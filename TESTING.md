# 361 Gadgets — Backend Tests

## Automated tests (Jest)

```bash
npm test              # unit suite + integration (integration skips w/o a test DB)
npm run test:unit     # pure unit tests only — no database needed
npm run test:integration   # runs the integration suites (requires a test DB)
```

- **Unit** (`src/__tests__/unit`, no DB): Zod validators, `withTxRetry` (retries
  transient P2028/P2034, never business/idempotency errors), custom error → HTTP
  status mapping.
- **Integration** (`src/__tests__/integration`, real DB via supertest): auth flows
  (register/duplicate/validation/login/**token revocation on password change**),
  **vendor ownership scoping** (vendor A cannot read/update vendor B's product;
  superadmin can), and **checkout idempotency + atomic stock** (repeated
  Idempotency-Key → same order; two simultaneous checkouts on the last unit →
  one 201, one 409, never oversell).

Integration tests **only run when `TEST_DATABASE_URL` is set** — otherwise they
skip, so `npm test` stays green anywhere. Point it at a **throwaway** database
(never dev/prod); each suite seeds its own fixtures and deletes them afterward.

```bash
# one-time: migrate the test DB, then run
TEST_DATABASE_URL="postgresql://.../scratch_db" npm run migrate:deploy
TEST_DATABASE_URL="postgresql://.../scratch_db" npm run test:integration
```

Notes: the superadmin login uses `ADMIN_EMAIL` / `ADMIN_PASSWORD` from env (seed
the test DB or ensure that account exists). Rate limiters and Redis are disabled
under `NODE_ENV=test` so suites can fire many requests without tripping limits.

---

## Manual test checklist (Postman)

Run the Postman collection **`361-gadgets.postman_collection.json`** top-to-bottom (folders 00 → 12).
Tokens and ids auto-save between requests. Requests named `[400]/[401]/[403]/[404]` are negative cases —
they "pass" when they return that status. Each request has a `pm.test`, so the **Collection Runner** shows green/red.

## Preconditions
- [ ] Backend running (`npm run dev`), migrations applied (`npx prisma migrate dev`).
- [ ] One user is `role = superadmin` in the DB (manual). Put its email/password in collection variables
      `superadminEmail` / `superadminPassword`.
- [ ] Fully restart the server before a run (clears any leaked DB connections).

## Recommended flow
Use **Collection Runner** for a full pass, or click through folder-by-folder for deep testing.
Order matters: superadmin login → create vendors → vendor login → catalog → products → everything else.

---

## 00 · Health
- [ ] Health check → 200
- [ ] admin-only without token → 401

## 01 · Auth
- [ ] Register Customer → 201 (or 409 if re-running)
- [ ] Register duplicate → 409
- [ ] Register missing password / bad email / weak password → 400 each
- [ ] **Login Superadmin → 200**, role asserts `superadmin`, token saved
- [ ] Login Customer → 200, token saved
- [ ] Login wrong password / unknown email → 401 each
- [ ] Get Me (customer) → 200
- [ ] Get Me no token / bad token → 401 each
- [ ] Verify email bad token → 400
- [ ] Forgot password → 200 (generic, no enumeration)
- [ ] Reset password bad token → 400

## 02 · Superadmin · Vendors
- [ ] **Create Vendor A → 201**, `vendorId` saved, response has **no passwordHash**, `role:admin`, `isActive:true`, `isEmailVerified:true`, `createdById` set
- [ ] Create Vendor B → 201, `vendorBId` saved
- [ ] Create duplicate → 409
- [ ] Create missing fields / weak password → 400
- [ ] Create vendor **as vendor** → 403 (superadmin-only)
- [ ] **Login Vendor A → 200**, token saved
- [ ] **Login Vendor B → 200**, token saved
- [ ] List Vendors → 200, body is a **plain array** (no pagination)
- [ ] List Vendors as vendor → 403
- [ ] Get Vendor A → 200, has `_count.ownedProducts` / `_count.ownedDiscounts`
- [ ] Get Vendor nonexistent id → 404
- [ ] Update Vendor A (companyName/phone) → 200
- [ ] Set status non-boolean → 400
- [ ] Reset password missing field → 400

## 03 · Catalog (Brands & Categories)
- [ ] Create Brand → 201, `brandId` saved
- [ ] Create Brand no name → 400
- [ ] Create Category L1 → 201, `categoryL1Id` saved
- [ ] Create Category L2 (parent = L1) → 201, `categoryId` saved
- [ ] Create Category bad level (9) → 400
- [ ] Create Category L2 missing parent → 400
- [ ] Get Brands / Category Tree (public) → 200
- [ ] Create Brand no token → 401

## 04 · Products
- [ ] **Create Product (Vendor A) → 201**, `productId` saved, `ownerId` = Vendor A
- [ ] **Create Product (Vendor B) → 201**, `productBId` saved
- [ ] Create missing required / missing costPrice → 400
- [ ] Admin Product List (Vendor A) → 200, only A's products
- [ ] Admin Product List (Superadmin, `?ownerId`) → 200, all / filtered
- [ ] Get Product By ID (Vendor A own) → 200
- [ ] **Ownership: Vendor A views B's product → 403**
- [ ] **Ownership: Vendor A updates B's product → 403**
- [ ] Update Product (Vendor A own) → 200
- [ ] Superadmin updates any product → 200
- [ ] Get All Products / By Slug (public) → 200
- [ ] Add Image by URL → 200/201
- [ ] Upload Image FILE → **select a file first**, then 200/201
- [ ] Add Specifications → 200/201

## 05 · Discounts
- [ ] Create Discount (Vendor A) → 201, `discountId` saved, `ownerId` = Vendor A
- [ ] **Ownership: Vendor A attaches B's product → 400**
- [ ] Get All Discounts (Vendor A) → 200, only A's
- [ ] Get Discount By ID → 200
- [ ] **Ownership: Vendor B edits A's discount → 403**
- [ ] Validate Code (customer) → 200
- [ ] Validate Code missing subtotal → 400

## 06 · Cart (customer)
- [ ] Add To Cart → 200/201, `cartItemId` saved
- [ ] Add no productId / quantity 0 → 400 each
- [ ] Get Cart → 200
- [ ] Get Cart no token → 401
- [ ] Update Cart Item → 200

## 07 · Wishlist (customer)
- [ ] Add To Wishlist → 200/201 (400 if already in)
- [ ] Get Wishlist → 200
- [ ] Add no productId → 400

## 08 · Orders
- [ ] **Checkout (Guest, COD) → 201**, `orderNumber`/`orderId` saved — verify product stock decremented
- [ ] Checkout (Logged-in, COD, discount LAUNCH10) → 201 — verify `discount` > 0 and discount `usedCount` incremented
- [ ] Checkout online pay no txn → 400
- [ ] Checkout invalid payment method → 400
- [ ] Checkout missing shipping field → 400
- [ ] Checkout guest no items → 400
- [ ] Checkout insufficient stock → 400 (nothing committed)
- [ ] Get Order By Number (guest) → 200
- [ ] Get Order By Number wrong email → 404
- [ ] Get My Orders (customer) → 200
- [ ] Admin Get All Orders → 200
- [ ] Admin Get Order By ID → 200
- [ ] Admin Update Status invalid → 400
- [ ] Admin Update Status → confirmed → 200
- [ ] Admin Update Payment → paid → 200
- [ ] **Admin Cancel Order → 200 — verify stock restored + discount usedCount decremented**
- [ ] Admin Double Cancel → 400
- [ ] Admin Order not found → 404

## 09 · Reviews
- [ ] Create Review → 200/201 (400 if rules block, e.g. not purchased)
- [ ] Create Review rating out of range → 400
- [ ] Get Product Reviews (public) → 200
- [ ] Get My Reviews → 200
- [ ] Admin Get All Reviews → 200
- [ ] Admin Moderate (approve) → 200
- [ ] Admin Moderate missing isApproved → 400

## 10 · Hero
- [ ] Get Active Hero (public) → 200
- [ ] Get All Hero (admin) → 200
- [ ] Upload Hero Image → **select a file first**, then 200/201

## 11 · Dashboard
- [ ] Admin Dashboard Stats → 200

## 12 · Role & Access Negatives
- [ ] Customer → admin product list → 403
- [ ] Vendor → superadmin vendors → 403
- [ ] **Deactivation Step 1** — deactivate Vendor B → 200
- [ ] **Deactivation Step 2** — Vendor B's existing token → 403, message contains "deactivat"
- [ ] **Deactivation Step 3** — reactivate Vendor B → 200 (cleanup)
- [ ] KNOWN GAP — deactivated vendor can still LOGIN → 200 (documents the gap)

---

## Known gaps (expected — not bugs in this work)
- Login has **no `isActive` check** → a deactivated vendor can still log in and get a token (blocked only on first privileged call).
- `/auth/me` returns 200 for a deactivated user (no `isActive` check there either).
- **Orders are not vendor-scoped** — every vendor sees/edits all orders.
- Email verification is **not enforced** — unverified customers can still checkout.

## Side effects to verify manually (Prisma Studio / GET checks)
- Checkout decrements `product.stockQuantity`; cancel restores it.
- Applying a discount increments `discount.usedCount`; cancelling the order decrements it.
- Logged-in checkout deletes only the checked-out cart items.
- New products/discounts get `ownerId` = the creating vendor.
