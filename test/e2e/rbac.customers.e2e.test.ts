import crypto from "node:crypto";
import request from "supertest";
import app from "../../src/app";
import db from "../../src/data/database";
import { adminToken, bearer, resetDb, UUID_V4, userWithRole } from "../helpers/db";

const create = (token: string, body: object) => request(app).post("/api/v1/customers").set(bearer(token)).send(body);

describe("RBAC: /api/v1/customers", () => {
    let admin: string;

    beforeEach(async () => {
        resetDb();
        admin = await adminToken();
    });

    describe("permissions", () => {
        it("401 without a token", async () => {
            expect((await request(app).get("/api/v1/customers")).status).toBe(401);
        });

        it("viewer can list but not create or edit (customers:view only)", async () => {
            const viewer = await userWithRole("viewer");
            expect((await request(app).get("/api/v1/customers").set(bearer(viewer.token))).status).toBe(200);
            const denied = await create(viewer.token, { name: "Finca Sol", email: "sol@cliente.ec" });
            expect(denied.status).toBe(403);
            expect(denied.body.message).toEqual(expect.any(String));
        });

        it("operator can create and edit customers (customers:view/create/edit)", async () => {
            const operator = await userWithRole("operator");
            const created = await create(operator.token, { name: "Finca Sol", email: "sol@cliente.ec" });
            expect(created.status).toBe(201);
            const patched = await request(app).patch(`/api/v1/customers/${created.body.id}`).set(bearer(operator.token)).send({ phone: "0991234567" });
            expect(patched.status).toBe(200);
        });

        it("a customer account has no back-office permissions", async () => {
            const customer = await userWithRole("customer");
            expect((await request(app).get("/api/v1/customers").set(bearer(customer.token))).status).toBe(403);
            const me = await request(app).get("/api/v1/auth/me").set(bearer(customer.token));
            expect(me.body.permissions).toEqual([]);
        });

        it("settings:* are granted to admin only", async () => {
            const operator = await userWithRole("operator");
            const meOf = async (token: string) => (await request(app).get("/api/v1/auth/me").set(bearer(token))).body.permissions as string[];
            expect(await meOf(admin)).toEqual(expect.arrayContaining(["settings:view", "settings:edit"]));
            expect((await meOf(operator.token)).filter((p) => p.startsWith("settings:"))).toEqual([]);
        });
    });

    describe("create", () => {
        it("creates a user with the customer role, an upper-cased tax ID and an unusable password", async () => {
            const resp = await create(admin, { name: "Hacienda La Esperanza", email: "compras@esperanza.ec", taxId: "0991234567001", phone: "042 123 456" });
            expect(resp.status).toBe(201);
            expect(resp.body).toEqual({
                id: expect.stringMatching(UUID_V4), name: "Hacienda La Esperanza", email: "compras@esperanza.ec",
                taxId: "0991234567001", phone: "042 123 456", isActive: true, createdAt: expect.any(String), updatedAt: expect.any(String),
            });
            expect(JSON.stringify(resp.body)).not.toMatch(/password|role/i);

            const row = db.prepare("SELECT r.key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(resp.body.id) as { key: string };
            expect(row.key).toBe("customer");
            // Nobody knows the password, so the account can't sign in.
            const login = await request(app).post("/api/v1/auth/login").send({ email: "compras@esperanza.ec", password: "anything-123" });
            expect(login.status).not.toBe(200);
        });

        it("stores the tax ID upper-cased and treats it as unique, ignoring case", async () => {
            const first = await create(admin, { name: "Pasaporte", email: "p1@cliente.ec", taxId: "ab-12345" });
            expect(first.body.taxId).toBe("AB-12345");
            const dup = await create(admin, { name: "Otro", email: "p2@cliente.ec", taxId: "AB-12345" });
            expect(dup.status).toBe(409);
            expect(dup.body.message).toMatch(/tax ID/);
        });

        it.each([
            ["a duplicate email", { name: "Otra", email: "dup@cliente.ec" }, 409],
            ["a short name", { name: "X", email: "x@cliente.ec" }, 400],
            ["an invalid email", { name: "Finca", email: "nope" }, 400],
            ["an invalid tax ID", { name: "Finca", email: "t@cliente.ec", taxId: "12" }, 400],
            ["a long phone", { name: "Finca", email: "ph@cliente.ec", phone: "1".repeat(31) }, 400],
            ["an unknown field", { name: "Finca", email: "u@cliente.ec", roleId: crypto.randomUUID() }, 400],
        ])("rejects %s", async (_, body, status) => {
            await create(admin, { name: "Existente", email: "dup@cliente.ec" });
            expect((await create(admin, body)).status).toBe(status);
        });
    });

    describe("list, get and update", () => {
        beforeEach(async () => {
            await create(admin, { name: "Hacienda La Esperanza", email: "esperanza@cliente.ec", taxId: "0991234567001" });
            await create(admin, { name: "Finca El Sol", email: "sol@cliente.ec", taxId: "0912345678" });
            await userWithRole("operator", { name: "Not A Customer" });
        });
        const list = (query = "") => request(app).get(`/api/v1/customers${query}`).set(bearer(admin));

        it("lists only customers, by name, paginated", async () => {
            const resp = await list();
            expect(resp.body.meta).toEqual({ page: 1, pageSize: 10, total: 2, totalPages: 1 });
            expect(resp.body.data.map((c: { name: string }) => c.name)).toEqual(["Finca El Sol", "Hacienda La Esperanza"]);
        });

        it("searches by name, email or tax ID", async () => {
            expect((await list("?search=esperanza")).body.meta.total).toBe(1);
            expect((await list("?search=0912345")).body.data[0].name).toBe("Finca El Sol");
            expect((await list("?search=not a")).body.meta.total).toBe(0);
        });

        it("updates name, tax ID and phone; null clears; email can't change", async () => {
            const { body } = await list("?search=sol");
            const id = body.data[0].id;
            const patch = (b: object) => request(app).patch(`/api/v1/customers/${id}`).set(bearer(admin)).send(b);

            expect((await patch({ name: "Finca El Sol S.A.", phone: "0990000000" })).body).toMatchObject({ name: "Finca El Sol S.A.", phone: "0990000000", taxId: "0912345678" });
            expect((await patch({ taxId: null })).body.taxId).toBeNull();
            expect((await patch({ taxId: "0991234567001" })).status).toBe(409);
            expect((await patch({ email: "new@cliente.ec" })).status).toBe(400);
        });

        it("a non-customer user is not found through /customers", async () => {
            const operator = await userWithRole("operator");
            expect((await request(app).get(`/api/v1/customers/${operator.id}`).set(bearer(admin))).status).toBe(404);
            expect((await request(app).patch(`/api/v1/customers/${operator.id}`).set(bearer(admin)).send({ name: "Hack" })).status).toBe(404);
            expect((await request(app).get(`/api/v1/customers/${crypto.randomUUID()}`).set(bearer(admin))).status).toBe(404);
        });

        it("customers also show in /user with their tax ID and phone", async () => {
            const resp = await request(app).get("/api/v1/user?search=0991234567001").set(bearer(admin));
            expect(resp.body.data[0]).toMatchObject({ name: "Hacienda La Esperanza", taxId: "0991234567001", phone: null, role: { key: "customer" } });
        });
    });
});
