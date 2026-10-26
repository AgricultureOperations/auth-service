import request from "supertest"
import app from "../../src/app";
import { adminToken, bearer, resetDb, userId } from "../helpers/db";

describe("User E2E", () => {
    beforeEach(() => {
      resetDb();
    });

    // GET /user/:email was replaced by GET /user/:id (users:view) in the RBAC change.
    it("should get user information by id", async () => {
        const registered = await request(app)
        .post("/api/v1/auth/register")
        .send({ email: "edward.cruzcruz27041996@gmail.com", password: "ecruz2222"});

        expect(registered.status).toBe(201);

        const getUserById = await request(app)
        .get(`/api/v1/user/${userId("edward.cruzcruz27041996@gmail.com")}`)
        .set(bearer(await adminToken()));

        expect(getUserById.status).toBe(200);
        expect(getUserById.body).toMatchObject({ email: "edward.cruzcruz27041996@gmail.com", role: { key: "customer" } });
        expect(getUserById.body).not.toHaveProperty("password");
    });
});
