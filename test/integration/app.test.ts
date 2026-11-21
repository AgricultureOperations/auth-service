import request from "supertest";
import app from "../../src/app"
import { resetDb } from "../helpers/db";

describe("Auth API", () => {
    beforeEach(() => {
      resetDb();
    });
    
    it("should register user", async () => {
        const resp = await request(app)
        .post("/api/v1/auth/register")
        .send({email:"edward.cruzcruz27041996@gmail.com", password: "ecruz2222"})
    
        expect(resp.status).toBe(201);
    });

    it("reports health without a token: no pending migrations on the migrated test DB", async () => {
        const resp = await request(app).get("/api/v1/health");

        expect(resp.status).toBe(200);
        expect(resp.body).toEqual({ status: "ok", pendingMigrations: 0 });
    });
});