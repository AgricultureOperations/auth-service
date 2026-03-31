import request from "supertest";
import app from "../../src/app"
import db from "../../src/data/database";

describe("Auth API", () => {
    beforeEach(() => {
      db.exec("DELETE FROM users");
    });
    
    it("should register user", async () => {
        const resp = await request(app)
        .post("/api/v1/auth/register")
        .send({email:"edward.cruzcruz27041996@gmail.com", password: "ecruz22"})
    
        expect(resp.status).toBe(201);
    });
});