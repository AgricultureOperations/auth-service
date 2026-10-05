import jwt from "jsonwebtoken";
import request from "supertest";
import app from "../../src/app";
import { ADMIN, adminToken, bearer, login, PASSWORD, resetDb, roleId, userWithRole } from "../helpers/db";

const me = (token: string) => request(app).get("/api/v1/auth/me").set(bearer(token));

describe("RBAC: tokens and authentication", () => {
    beforeEach(() => resetDb());

    it("issues the documented claims with the shared issuer and audience", async () => {
        const token = await adminToken();
        const claims = jwt.verify(token, process.env.JWT_SECRET!, {
            issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE, algorithms: ["HS256"],
        }) as jwt.JwtPayload;

        expect(claims.sub).toBe(claims.id);
        expect(claims).toMatchObject({ email: ADMIN.email, role: "admin", tv: 0 });
        expect(claims.permissions).toHaveLength(16);
        expect(claims.permissions).toEqual(expect.arrayContaining(["users:delete", "roles:edit", "orders:view"]));
        expect(claims.exp).toBeGreaterThan(claims.iat!);
    });

    it("registration always assigns viewer, even when the body asks for admin", async () => {
        const resp = await request(app).post("/api/v1/auth/register")
            .send({ email: "sneaky@agriops.test", password: PASSWORD, roleId: roleId("admin"), role: "admin" });
        expect(resp.status).toBe(201);
        expect(resp.body).toEqual({ id: expect.any(String), email: "sneaky@agriops.test" });

        const claims = jwt.decode(await login("sneaky@agriops.test")) as jwt.JwtPayload;
        expect(claims).toMatchObject({ role: "viewer", permissions: ["orders:view", "products:view"] });
    });

    it("GET /auth/me returns the caller with role and permissions, never the password", async () => {
        expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
        const resp = await me(await adminToken());
        expect(resp.status).toBe(200);
        expect(resp.body).toMatchObject({ email: ADMIN.email, name: "Administrator", isActive: true, role: { key: "admin" } });
        expect(resp.body.permissions).toHaveLength(16);
        expect(resp.body.lastLoginAt).toEqual(expect.any(String));
        expect(JSON.stringify(resp.body)).not.toContain("password");
    });

    it.each([
        ["no header", undefined],
        ["a non-Bearer scheme", (t: string) => `Token ${t}`],
        ["a tampered signature", (t: string) => `Bearer ${t.slice(0, -2)}xx`],
        ["another issuer", () => `Bearer ${jwt.sign({ sub: "x", tv: 0 }, process.env.JWT_SECRET!, { issuer: "evil", audience: process.env.JWT_AUDIENCE })}`],
        ["another audience", () => `Bearer ${jwt.sign({ sub: "x", tv: 0 }, process.env.JWT_SECRET!, { issuer: process.env.JWT_ISSUER, audience: "other" })}`],
        ["an expired token", () => `Bearer ${jwt.sign({ sub: "x", tv: 0, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET!, { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE })}`],
    ])("returns 401 with a message for %s", async (_, header) => {
        const token = await adminToken();
        const req = request(app).get("/api/v1/auth/me");
        if (header) req.set("Authorization", header(token));
        const resp = await req;
        expect(resp.status).toBe(401);
        expect(resp.body.message).toEqual(expect.any(String));
    });

    it("rejects a token that predates the old-format payload ({ id, email } without tv)", async () => {
        const { id, email } = await userWithRole("viewer");
        const legacy = jwt.sign({ id, email }, process.env.JWT_SECRET!, { issuer: process.env.JWT_ISSUER, audience: process.env.JWT_AUDIENCE });
        expect((await me(legacy)).status).toBe(401);
    });

    it("a role change makes the old token stale (401); logging in again works", async () => {
        const admin = await adminToken();
        const user = await userWithRole("viewer");
        expect((await me(user.token)).status).toBe(200);

        await request(app).patch(`/api/v1/user/${user.id}/role`).set(bearer(admin)).send({ roleId: roleId("operator") }).expect(200);
        expect((await me(user.token)).status).toBe(401);

        const fresh = jwt.decode(await login(user.email)) as jwt.JwtPayload;
        expect(fresh).toMatchObject({ role: "operator", tv: 1 });
    });

    it("deactivation makes the token stale and blocks login", async () => {
        const admin = await adminToken();
        const user = await userWithRole("operator");
        await request(app).patch(`/api/v1/user/${user.id}/status`).set(bearer(admin)).send({ isActive: false }).expect(200);
        expect((await me(user.token)).status).toBe(401);
        const resp = await request(app).post("/api/v1/auth/login").send({ email: user.email, password: PASSWORD });
        expect(resp.status).toBe(401);
        expect(resp.body.message).toBe("Invalid credentials");
    });

    it("changing a role's permissions makes every holder's token stale", async () => {
        const admin = await adminToken();
        const a = await userWithRole("operator");
        const b = await userWithRole("operator");
        const other = await userWithRole("viewer");
        const matrix = (await request(app).get("/api/v1/permissions").set(bearer(admin))).body;
        const productsView = matrix.resources[0].permissions[0].id;

        await request(app).put(`/api/v1/roles/${roleId("operator")}/permissions`).set(bearer(admin))
            .send({ permissionIds: [productsView] }).expect(200);
        expect((await me(a.token)).status).toBe(401);
        expect((await me(b.token)).status).toBe(401);
        expect((await me(other.token)).status).toBe(200);
    });

    it("returns 403 (not 401) when a valid token lacks the permission", async () => {
        const viewer = await userWithRole("viewer");
        const resp = await request(app).get("/api/v1/user").set(bearer(viewer.token));
        expect(resp.status).toBe(403);
        expect(resp.body.message).toEqual(expect.any(String));
    });
});
