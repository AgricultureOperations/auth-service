import crypto from "node:crypto";
import request from "supertest";
import app from "../../src/app";
import { adminToken, bearer, resetDb, roleId, userWithRole } from "../helpers/db";

type Method = "get" | "post" | "patch" | "put" | "delete";
interface Case { name: string; method: Method; path: () => string; body?: () => object; ok: number }

describe("RBAC: /api/v1/roles and /api/v1/permissions", () => {
    let admin: string;
    let custom: { id: string; key: string };
    let allPermissionIds: string[];

    beforeEach(async () => {
        resetDb();
        admin = await adminToken();
        custom = (await request(app).post("/api/v1/roles").set(bearer(admin)).send({ name: "Bodeguero" }).expect(201)).body;
        const matrix = (await request(app).get("/api/v1/permissions").set(bearer(admin))).body;
        allPermissionIds = matrix.resources.flatMap((r: { permissions: { id: string }[] }) => r.permissions.map((p) => p.id));
    });

    const call = (c: Case, token?: string) => {
        const req = request(app)[c.method](c.path());
        if (token) req.set(bearer(token));
        return c.body ? req.send(c.body()) : req;
    };

    const cases: Case[] = [
        { name: "GET /roles", method: "get", path: () => "/api/v1/roles", ok: 200 },
        { name: "GET /roles/:id", method: "get", path: () => `/api/v1/roles/${custom.id}`, ok: 200 },
        { name: "POST /roles", method: "post", path: () => "/api/v1/roles", ok: 201, body: () => ({ name: "Supervisor" }) },
        { name: "PATCH /roles/:id", method: "patch", path: () => `/api/v1/roles/${custom.id}`, ok: 200, body: () => ({ description: "Bodega" }) },
        { name: "PUT /roles/:id/permissions", method: "put", path: () => `/api/v1/roles/${custom.id}/permissions`, ok: 200, body: () => ({ permissionIds: [] }) },
        { name: "DELETE /roles/:id", method: "delete", path: () => `/api/v1/roles/${custom.id}`, ok: 204 },
        { name: "GET /permissions", method: "get", path: () => "/api/v1/permissions", ok: 200 },
    ];

    describe.each(cases)("$name", (c) => {
        it("401 without a token", async () => expect((await call(c)).status).toBe(401));
        it("403 for an operator", async () => {
            const operator = await userWithRole("operator");
            expect((await call(c, operator.token)).status).toBe(403);
        });
        it(`${c.ok} for an admin`, async () => expect((await call(c, admin)).status).toBe(c.ok));
    });

    it("a custom role granted roles:view can read but not edit", async () => {
        const rolesView = (await request(app).get("/api/v1/permissions").set(bearer(admin))).body
            .resources.find((r: { key: string }) => r.key === "roles").permissions.find((p: { actionKey: string }) => p.actionKey === "view").id;
        await request(app).put(`/api/v1/roles/${custom.id}/permissions`).set(bearer(admin)).send({ permissionIds: [rolesView] }).expect(200);
        const user = await userWithRole(custom.key);
        expect((await request(app).get("/api/v1/roles").set(bearer(user.token))).status).toBe(200);
        expect((await request(app).patch(`/api/v1/roles/${custom.id}`).set(bearer(user.token)).send({ name: "x" })).status).toBe(403);
    });

    it("GET /permissions is matrix-ready: 4 actions × 4 resources in order", async () => {
        const { body } = await request(app).get("/api/v1/permissions").set(bearer(admin));
        expect(body.actions.map((a: { key: string }) => a.key)).toEqual(["view", "create", "edit", "delete"]);
        expect(body.resources.map((r: { key: string }) => r.key)).toEqual(["products", "orders", "users", "roles"]);
        expect(body.resources[2]).toMatchObject({ key: "users", name: "Users", sortOrder: 30 });
        expect(body.resources[2].permissions.map((p: { code: string }) => p.code)).toEqual(["users:view", "users:create", "users:edit", "users:delete"]);
        expect(body.resources[2].permissions[0]).toEqual({ id: expect.any(String), code: "users:view", actionId: body.actions[0].id, actionKey: "view" });
    });

    it("GET /roles lists system roles first with user counts and grants, and filters", async () => {
        await userWithRole("operator");
        const { body } = await request(app).get("/api/v1/roles").set(bearer(admin));
        expect(body.map((r: { key: string }) => r.key)).toEqual(["admin", "operator", "viewer", "bodeguero"]);
        expect(body[1]).toMatchObject({ key: "operator", name: "Operator", isSystem: true, isActive: true, userCount: 1 });
        expect(body[1].permissionIds).toHaveLength(6);
        expect(body[0].permissionIds).toHaveLength(16);
        expect((await request(app).get("/api/v1/roles?search=bode").set(bearer(admin))).body.map((r: { key: string }) => r.key)).toEqual(["bodeguero"]);
        expect((await request(app).get("/api/v1/roles?isActive=false").set(bearer(admin))).body).toEqual([]);
    });

    describe("create", () => {
        const create = (body: object) => request(app).post("/api/v1/roles").set(bearer(admin)).send(body);

        it("generates the key from the name (accents stripped) and returns the role", async () => {
            const resp = await create({ name: "Coordinador de Admisión", description: "Coordina" });
            expect(resp.status).toBe(201);
            expect(resp.body).toMatchObject({
                key: "coordinador_de_admision", name: "Coordinador de Admisión", description: "Coordina",
                isSystem: false, isActive: true, userCount: 0, permissionIds: [],
            });
            expect(resp.body.id).toMatch(/^[0-9a-f-]{36}$/);
        });

        it.each([
            ["a duplicate key", { name: "Otro", key: "bodeguero" }, 409],
            ["a duplicate name (any case)", { name: "BODEGUERO", key: "otro" }, 409],
            ["a system role's name", { name: "Administrator", key: "admin2" }, 409],
            ["an invalid key", { name: "Otro", key: "Bad Key!" }, 400],
            ["a name that slugs to nothing", { name: "¡¡!!" }, 400],
            ["a missing name", {}, 400],
            ["is_system in the body", { name: "Otro", isSystem: true }, 400],
        ])("rejects %s", async (_, body, status) => {
            expect((await create(body)).status).toBe(status);
        });
    });

    describe("update and delete guards", () => {
        it("renames a role but never changes its key", async () => {
            const ok = await request(app).patch(`/api/v1/roles/${custom.id}`).set(bearer(admin)).send({ name: "Bodega central" });
            expect(ok.body).toMatchObject({ key: "bodeguero", name: "Bodega central" });
            expect((await request(app).patch(`/api/v1/roles/${custom.id}`).set(bearer(admin)).send({ key: "x" })).status).toBe(400);
            expect((await request(app).patch(`/api/v1/roles/${custom.id}`).set(bearer(admin)).send({ name: "Viewer" })).status).toBe(409);
        });

        it("409 when deactivating a system role or a role that still has users", async () => {
            expect((await request(app).patch(`/api/v1/roles/${roleId("viewer")}`).set(bearer(admin)).send({ isActive: false })).status).toBe(409);
            await userWithRole(custom.key);
            expect((await request(app).patch(`/api/v1/roles/${custom.id}`).set(bearer(admin)).send({ isActive: false })).status).toBe(409);
        });

        it("409 when deleting a system role or a role with users; 204 otherwise", async () => {
            for (const key of ["admin", "operator", "viewer"]) {
                const resp = await request(app).delete(`/api/v1/roles/${roleId(key)}`).set(bearer(admin));
                expect(resp.status).toBe(409);
                expect(resp.body.message).toMatch(/System roles/);
            }
            const user = await userWithRole(custom.key);
            expect((await request(app).delete(`/api/v1/roles/${custom.id}`).set(bearer(admin))).status).toBe(409);
            await request(app).patch(`/api/v1/user/${user.id}/role`).set(bearer(admin)).send({ roleId: roleId("viewer") }).expect(200);
            expect((await request(app).delete(`/api/v1/roles/${custom.id}`).set(bearer(admin))).status).toBe(204);
            expect((await request(app).get(`/api/v1/roles/${custom.id}`).set(bearer(admin))).status).toBe(404);
        });

        it.each([
            ["GET", () => request(app).get("/api/v1/roles/nope")],
            ["PATCH", () => request(app).patch("/api/v1/roles/nope").send({ name: "x" })],
            ["PUT param", () => request(app).put("/api/v1/roles/nope/permissions").send({ permissionIds: [] })],
            ["PUT body", () => request(app).put(`/api/v1/roles/${crypto.randomUUID()}/permissions`).send({ permissionIds: ["nope"] })],
            ["DELETE", () => request(app).delete("/api/v1/roles/nope")],
        ])("400 for an invalid UUID: %s", async (_, build) => {
            const resp = await build().set(bearer(admin));
            expect(resp.status).toBe(400);
            expect(resp.body.message).toMatch(/UUID/);
        });
    });

    describe("PUT /roles/:id/permissions", () => {
        const put = (id: string, permissionIds: unknown) =>
            request(app).put(`/api/v1/roles/${id}/permissions`).set(bearer(admin)).send({ permissionIds });

        it("replaces the grants (duplicates collapse)", async () => {
            const two = allPermissionIds.slice(0, 2);
            expect((await put(custom.id, [...two, two[0]])).body.permissionIds.sort()).toEqual([...two].sort());
            expect((await put(custom.id, [two[1]])).body.permissionIds).toEqual([two[1]]);
        });

        it("400 for unknown permission ids or a non-array", async () => {
            expect((await put(custom.id, [crypto.randomUUID()])).status).toBe(400);
            expect((await put(custom.id, "all")).status).toBe(400);
        });

        it("409 when reducing the admin role; the full set is accepted", async () => {
            const resp = await put(roleId("admin"), allPermissionIds.slice(1));
            expect(resp.status).toBe(409);
            expect(resp.body.message).toMatch(/admin role/);
            expect((await put(roleId("admin"), allPermissionIds)).status).toBe(200);
        });

        it("404 for a missing role", async () => {
            expect((await put(crypto.randomUUID(), [])).status).toBe(404);
        });
    });
});
