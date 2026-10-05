import crypto from "node:crypto";
import request from "supertest";
import app from "../../src/app";
import { ADMIN, adminToken, bearer, PASSWORD, resetDb, roleId, userId, userWithRole } from "../helpers/db";

type Method = "get" | "post" | "patch" | "delete";
interface Case { name: string; method: Method; path: () => string; body?: () => object; ok: number }

describe("RBAC: /api/v1/user", () => {
    let admin: string;
    let target: { id: string; email: string; token: string };

    beforeEach(async () => {
        resetDb();
        admin = await adminToken();
        target = await userWithRole("operator");
    });

    const call = (c: Case, token?: string) => {
        const req = request(app)[c.method](c.path());
        if (token) req.set(bearer(token));
        return c.body ? req.send(c.body()) : req;
    };

    // viewer has no users:* permission, so each call must be 403 for viewer and 2xx for admin.
    const cases: Case[] = [
        { name: "GET /user", method: "get", path: () => "/api/v1/user", ok: 200 },
        { name: "GET /user/:id", method: "get", path: () => `/api/v1/user/${target.id}`, ok: 200 },
        { name: "POST /user", method: "post", path: () => "/api/v1/user", ok: 201,
          body: () => ({ name: "Nueva Persona", email: "nueva@agriops.test", password: PASSWORD, roleId: roleId("viewer") }) },
        { name: "PATCH /user/:id", method: "patch", path: () => `/api/v1/user/${target.id}`, ok: 200, body: () => ({ name: "Renamed" }) },
        { name: "PATCH /user/:id/role", method: "patch", path: () => `/api/v1/user/${target.id}/role`, ok: 200, body: () => ({ roleId: roleId("viewer") }) },
        { name: "PATCH /user/:id/status", method: "patch", path: () => `/api/v1/user/${target.id}/status`, ok: 200, body: () => ({ isActive: false }) },
        { name: "DELETE /user/:id", method: "delete", path: () => `/api/v1/user/${target.id}`, ok: 204 },
    ];

    describe.each(cases)("$name", (c) => {
        it("401 without a token", async () => expect((await call(c)).status).toBe(401));
        it("403 for a viewer", async () => {
            const viewer = await userWithRole("viewer");
            const resp = await call(c, viewer.token);
            expect(resp.status).toBe(403);
            expect(resp.body.message).toEqual(expect.any(String));
        });
        it(`${c.ok} for an admin, with no password in the body`, async () => {
            const resp = await call(c, admin);
            expect(resp.status).toBe(c.ok);
            expect(JSON.stringify(resp.body ?? {})).not.toMatch(/password/i);
        });
    });

    it("an operator (users:* not granted) is forbidden too", async () => {
        expect((await request(app).get("/api/v1/user").set(bearer(target.token))).status).toBe(403);
    });

    it.each([
        ["GET /user/:id", () => request(app).get("/api/v1/user/not-a-uuid")],
        ["PATCH /user/:id", () => request(app).patch("/api/v1/user/123").send({ name: "x" })],
        ["PATCH /user/:id/role param", () => request(app).patch("/api/v1/user/123/role").send({ roleId: crypto.randomUUID() })],
        ["PATCH /user/:id/role body", () => request(app).patch(`/api/v1/user/${crypto.randomUUID()}/role`).send({ roleId: "admin" })],
        ["PATCH /user/:id/status", () => request(app).patch("/api/v1/user/abc/status").send({ isActive: true })],
        ["DELETE /user/:id", () => request(app).delete("/api/v1/user/abc")],
        ["POST /user roleId", () => request(app).post("/api/v1/user").send({ name: "A", email: "a@agriops.test", password: PASSWORD, roleId: "1" })],
        ["GET /user?roleId", () => request(app).get("/api/v1/user?roleId=admin")],
        // v1 (not v4) UUIDs are rejected too
        ["GET /user/:id v1 uuid", () => request(app).get("/api/v1/user/c232ab00-9414-11ec-b3c8-9f6bdeced846")],
    ])("400 for an invalid UUID: %s", async (_, build) => {
        const resp = await build().set(bearer(admin));
        expect(resp.status).toBe(400);
        expect(resp.body.message).toMatch(/UUID/);
    });

    describe("list: search, filters and pagination", () => {
        beforeEach(async () => {
            for (let i = 1; i <= 11; i++) await userWithRole("viewer", { email: `farmer${String(i).padStart(2, "0")}@agriops.test`, name: `Farmer ${String(i).padStart(2, "0")}` });
        });
        const list = (query: string) => request(app).get(`/api/v1/user${query}`).set(bearer(admin));

        it("paginates 10 per page by default, ordered by name", async () => {
            const resp = await list("");
            expect(resp.status).toBe(200);
            expect(resp.body.meta).toEqual({ page: 1, pageSize: 10, total: 13, totalPages: 2 });
            expect(resp.body.data).toHaveLength(10);
            expect(resp.body.data[0]).toEqual({
                id: expect.any(String), name: "Administrator", email: ADMIN.email, isActive: true,
                role: { id: roleId("admin"), key: "admin", name: "Administrator" },
                createdAt: expect.any(String), updatedAt: expect.any(String), lastLoginAt: expect.any(String),
            });
            const page2 = await list("?page=2&pageSize=5");
            expect(page2.body.meta).toEqual({ page: 2, pageSize: 5, total: 13, totalPages: 3 });
            expect(page2.body.data.map((u: { name: string }) => u.name)).toEqual(["Farmer 05", "Farmer 06", "Farmer 07", "Farmer 08", "Farmer 09"]);
        });

        it("searches name and email case-insensitively, treating % and _ literally", async () => {
            expect((await list("?search=FARMER 1")).body.meta.total).toBe(2); // Farmer 10, 11
            expect((await list("?search=farmer03@")).body.data.map((u: { email: string }) => u.email)).toEqual(["farmer03@agriops.test"]);
            expect((await list("?search=%25")).body.meta.total).toBe(0);
        });

        it("filters by role and by active state", async () => {
            expect((await list(`?roleId=${roleId("viewer")}`)).body.meta.total).toBe(11);
            expect((await list(`?roleId=${roleId("operator")}`)).body.data.map((u: { id: string }) => u.id)).toEqual([target.id]);
            await request(app).patch(`/api/v1/user/${userId("farmer01@agriops.test")}/status`).set(bearer(admin)).send({ isActive: false });
            expect((await list("?isActive=false")).body.data.map((u: { email: string }) => u.email)).toEqual(["farmer01@agriops.test"]);
            expect((await list("?isActive=true")).body.meta.total).toBe(12);
        });

        it.each(["?page=0", "?pageSize=101", "?pageSize=abc", "?isActive=yes"])("400 for %s", async (q) => {
            expect((await list(q)).status).toBe(400);
        });
    });

    describe("create and edit", () => {
        const create = (body: object) => request(app).post("/api/v1/user").set(bearer(admin)).send(body);
        const valid = () => ({ name: "Ana Pérez", email: "ana@agriops.test", password: PASSWORD, roleId: roleId("operator") });

        it("creates a user with the given role and returns it", async () => {
            const resp = await create(valid());
            expect(resp.status).toBe(201);
            expect(resp.body).toMatchObject({ name: "Ana Pérez", email: "ana@agriops.test", isActive: true, role: { key: "operator" }, lastLoginAt: null });
        });

        // Overrides are thunks: the table is built before beforeEach sets `target`.
        it.each<[string, () => object, number]>([
            ["a duplicate email (any case)", () => ({ email: target.email.toUpperCase() }), 409],
            ["a short password", () => ({ password: "1234567" }), 400],
            ["an invalid email", () => ({ email: "not-an-email" }), 400],
            ["a missing name", () => ({ name: "  " }), 400],
            ["an unknown role", () => ({ roleId: crypto.randomUUID() }), 404],
            ["an unknown field", () => ({ isAdmin: true }), 400],
        ])("rejects %s", async (_, override, status) => {
            const resp = await create({ ...valid(), ...override() });
            expect(resp.status).toBe(status);
            expect(resp.body.message).toEqual(expect.any(String));
        });

        it("409 when the role is inactive", async () => {
            const role = await request(app).post("/api/v1/roles").set(bearer(admin)).send({ name: "Temporal" });
            await request(app).patch(`/api/v1/roles/${role.body.id}`).set(bearer(admin)).send({ isActive: false }).expect(200);
            expect((await create({ ...valid(), roleId: role.body.id })).status).toBe(409);
        });

        it("404 for a missing user", async () => {
            expect((await request(app).get(`/api/v1/user/${crypto.randomUUID()}`).set(bearer(admin))).status).toBe(404);
        });

        it("PATCH /user/:id renames but never changes the email", async () => {
            const ok = await request(app).patch(`/api/v1/user/${target.id}`).set(bearer(admin)).send({ name: "Operador Norte" });
            expect(ok.body).toMatchObject({ name: "Operador Norte", email: target.email });
            const resp = await request(app).patch(`/api/v1/user/${target.id}`).set(bearer(admin)).send({ email: "new@agriops.test" });
            expect(resp.status).toBe(400);
            expect(resp.body.message).toBe("email can't be changed");
        });

        it("400 for malformed JSON", async () => {
            const resp = await request(app).post("/api/v1/user").set(bearer(admin)).set("Content-Type", "application/json").send("{bad");
            expect(resp.status).toBe(400);
        });
    });

    describe("last active admin guard", () => {
        const adminId = () => userId(ADMIN.email);

        it("409 when demoting, deactivating or deleting the only active admin", async () => {
            const demote = await request(app).patch(`/api/v1/user/${adminId()}/role`).set(bearer(admin)).send({ roleId: roleId("viewer") });
            const deactivate = await request(app).patch(`/api/v1/user/${adminId()}/status`).set(bearer(admin)).send({ isActive: false });
            const remove = await request(app).delete(`/api/v1/user/${adminId()}`).set(bearer(admin));
            [demote, deactivate, remove].forEach((r) => {
                expect(r.status).toBe(409);
                expect(r.body.message).toMatch(/last active admin/);
            });
            expect((await request(app).get(`/api/v1/user/${adminId()}`).set(bearer(admin))).body).toMatchObject({ isActive: true, role: { key: "admin" } });
        });

        it("an inactive second admin doesn't count", async () => {
            const second = await userWithRole("admin");
            await request(app).patch(`/api/v1/user/${second.id}/status`).set(bearer(admin)).send({ isActive: false }).expect(200);
            expect((await request(app).delete(`/api/v1/user/${adminId()}`).set(bearer(admin))).status).toBe(409);
        });

        it("allows it once another active admin exists", async () => {
            const second = await userWithRole("admin");
            await request(app).patch(`/api/v1/user/${adminId()}/role`).set(bearer(second.token)).send({ roleId: roleId("viewer") }).expect(200);
            // now `second` is the last admin
            expect((await request(app).delete(`/api/v1/user/${second.id}`).set(bearer(second.token))).status).toBe(409);
        });
    });
});
