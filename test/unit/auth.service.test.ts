import { AuthService } from "../../src/services/auth.service";
import { resetDb } from "../helpers/db";

describe("AuthService", () => {
    beforeEach(() => {
      resetDb();
    });

    const service = new AuthService();
    it("Should register a new user", async () => {
        const user = await service.register("edward.cruzcruz27041996@gmail.com","ecruz123")
        expect(user.email).toBe("edward.cruzcruz27041996@gmail.com")
    });

    it("should throw error if user not found", async () => {
        await expect(service.login("edward.cruzcruz@hotmail.com","ecruz22"))
        .rejects
        .toThrow("Invalid credentials")
    });
});