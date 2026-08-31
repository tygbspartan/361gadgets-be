import { api, prisma, describeIntegration, tag } from "./helpers";

describeIntegration("auth flows (integration)", () => {
  const email = `it-auth-${tag()}@example.com`;
  const password = "password123";

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  it("registers a new customer (201) without leaking the password hash", async () => {
    const res = await api()
      .post("/api/auth/register")
      .send({ email, password, firstName: "IT" });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("customer");
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(typeof res.body.data.token).toBe("string");
  });

  it("rejects a duplicate registration (409)", async () => {
    const res = await api().post("/api/auth/register").send({ email, password });
    expect(res.status).toBe(409);
  });

  it("rejects invalid input (400)", async () => {
    const res = await api()
      .post("/api/auth/register")
      .send({ email: "not-an-email", password: "x" });
    expect(res.status).toBe(400);
  });

  it("logs in and returns a token (200)", async () => {
    const res = await api().post("/api/auth/login").send({ email, password });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.token).toBe("string");
  });

  it("rejects a wrong password (401)", async () => {
    const res = await api()
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("blocks /auth/me without a token (401)", async () => {
    const res = await api().get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("revokes the existing token after a password change (tokenVersion)", async () => {
    const login = await api().post("/api/auth/login").send({ email, password });
    const token = login.body.data.token;

    const before = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    const change = await api()
      .post("/api/auth/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send({ currentPassword: password, newPassword: "newpassword456" });
    expect(change.status).toBe(200);

    // The old token must now be rejected — its tokenVersion is stale.
    const after = await api()
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});
