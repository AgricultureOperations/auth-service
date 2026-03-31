import request from "supertest";
import app from "../../src/app";
import db from "../../src/data/database";

describe("User E2E", () => {
    beforeEach(() => {
      db.exec("DELETE FROM users");
    });

    it("should get user information using email", async () => {
        await request(app)
        .post("/api/v1/auth/register")
        .send({ email: "edward.cruzcruz27041996@gmail.com", password: "ecruz22"});
        
        const login = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "edward.cruzcruz27041996@gmail.com", password: "ecruz22"});

        //console.log(login.body)
        const getUserByEmail = await request(app)
        .get("/api/v1/user/edward.cruzcruz27041996@gmail.com")
        .set("Authorization", `Bearer ${login.body.token}`);
        
        console.log(getUserByEmail.text);
        expect(getUserByEmail.status).toBe(200);
    });
});