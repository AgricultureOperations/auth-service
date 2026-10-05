import dotenv from "dotenv";

dotenv.config({
  path: ".env.test",
  //quiet: true,
});

// First admin for the seed (CI has no .env.test). Test-only values, never used outside the test DB.
process.env.ADMIN_EMAIL ??= "admin@agriops.test";
process.env.ADMIN_PASSWORD ??= "Admin-Pass-123";
