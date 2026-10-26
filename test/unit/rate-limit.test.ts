import express from "express";
import request from "supertest";
import { authRateLimit } from "../../src/middlewares/rate-limit.middleware";

describe("authRateLimit", () => {
    const appWith = (limit: number) => {
        const app = express();
        app.post("/login", authRateLimit({ limit, skip: false }), (_req, res) => { res.json({ ok: true }); });
        return app;
    };

    it("answers 429 with { status, message } once the limit is reached", async () => {
        const app = appWith(2);
        expect((await request(app).post("/login")).status).toBe(200);
        expect((await request(app).post("/login")).status).toBe(200);
        const blocked = await request(app).post("/login");
        expect(blocked.status).toBe(429);
        expect(blocked.body).toEqual({ status: "error", message: "Too many attempts. Try again in a few minutes." });
        expect(blocked.headers["ratelimit-policy"]).toBeDefined();
    });

    it("is skipped when asked to (the test environment)", async () => {
        const app = express();
        app.post("/login", authRateLimit({ limit: 1, skip: true }), (_req, res) => { res.json({ ok: true }); });
        for (let i = 0; i < 3; i++) expect((await request(app).post("/login")).status).toBe(200);
    });
});
