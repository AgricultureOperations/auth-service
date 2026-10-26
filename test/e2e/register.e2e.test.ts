import request from "supertest";
import app, { allowedOrigins } from "../../src/app";
import { bearer, resetDb, userWithRole } from "../helpers/db";

const register = (body: object) => request(app).post("/api/v1/auth/register").send(body);
const valid = { name: "Hacienda La Esperanza", email: "compras@esperanza.ec", password: "Segura-123", taxId: "0991234567001", phone: "042 123 456" };

describe("POST /api/v1/auth/register (customer self-registration)", () => {
    beforeEach(() => resetDb());

    it("creates a customer that can sign in and read its own profile", async () => {
        const resp = await register(valid);
        expect(resp.status).toBe(201);
        expect(resp.body).toEqual({ id: expect.any(String), email: "compras@esperanza.ec" });

        const login = await request(app).post("/api/v1/auth/login").send({ email: valid.email, password: valid.password });
        expect(login.status).toBe(200);
        const me = await request(app).get("/api/v1/auth/me").set(bearer(login.body.token));
        expect(me.body).toMatchObject({
            name: "Hacienda La Esperanza", email: "compras@esperanza.ec", taxId: "0991234567001", phone: "042 123 456",
            role: { key: "customer" }, permissions: [],
        });
    });

    it("can't reach back-office data", async () => {
        await register(valid);
        const { body } = await request(app).post("/api/v1/auth/login").send({ email: valid.email, password: valid.password });
        for (const path of ["/api/v1/user", "/api/v1/customers", "/api/v1/roles"]) {
            expect((await request(app).get(path).set(bearer(body.token))).status).toBe(403);
        }
    });

    it("upper-cases the tax ID and defaults the name to the email's local part", async () => {
        await register({ email: "finca@sol.ec", password: "Segura-123", taxId: "ab-12345" });
        const { body } = await request(app).post("/api/v1/auth/login").send({ email: "finca@sol.ec", password: "Segura-123" });
        const me = await request(app).get("/api/v1/auth/me").set(bearer(body.token));
        expect(me.body).toMatchObject({ name: "finca", taxId: "AB-12345", phone: null });
    });

    it.each([
        ["an existing email", { ...valid, taxId: "0912345678" }, 409, /email/],
        ["an existing tax ID", { ...valid, email: "otra@esperanza.ec" }, 409, /tax ID/],
    ])("rejects %s with 409", async (_, body, status, message) => {
        await register(valid);
        const resp = await register(body);
        expect(resp.status).toBe(status);
        expect(resp.body.message).toMatch(message);
    });

    it("a staff account's email is taken too", async () => {
        const operator = await userWithRole("operator");
        expect((await register({ ...valid, email: operator.email })).status).toBe(409);
    });

    it.each([
        ["no email", { password: "Segura-123" }],
        ["an invalid email", { email: "nope", password: "Segura-123" }],
        ["a short password", { email: "a@b.ec", password: "short" }],
        ["a one-letter name", { email: "a@b.ec", password: "Segura-123", name: "X" }],
        ["an invalid tax ID", { email: "a@b.ec", password: "Segura-123", taxId: "12" }],
        ["a long phone", { email: "a@b.ec", password: "Segura-123", phone: "1".repeat(31) }],
    ])("rejects %s with 400 and a message", async (_, body) => {
        const resp = await register(body);
        expect(resp.status).toBe(400);
        expect(resp.body.message).toEqual(expect.any(String));
    });
});

describe("allowedOrigins (CORS)", () => {
    it("accepts a comma-separated list for the dashboard and the customer portal", () => {
        expect(allowedOrigins("https://agricultureops.netlify.app, https://portal.example.com ,")).toEqual([
            "https://agricultureops.netlify.app", "https://portal.example.com",
        ]);
    });

    it("defaults to both local dev servers", () => {
        expect(allowedOrigins("")).toEqual(["http://localhost:5173", "http://localhost:3100"]);
    });
});
