import request from "supertest"
import app from "../../src/app";
import db from "../../src/data/database";

describe("Auth E2E", () => {
    beforeEach(() => {
      db.exec("DELETE FROM users");
    });

    it("should register and login", async () => {
        await request(app)
        .post("/api/v1/auth/register")
        .send({ email: "edward.cruzcruz27041996@gmail.com", password: "ecruz22"});
        
        const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "edward.cruzcruz27041996@gmail.com", password: "ecruz22"});

        expect(login.body.token).toBeDefined();
    });
});