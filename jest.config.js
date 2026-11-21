/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleFileExtensions: ["ts", "js"],
  roots: ["<rootDir>/src", "<rootDir>/test"],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  globalSetup: "<rootDir>/test/global-setup.ts",
  setupFiles: ["<rootDir>/jest.setup.ts"],
};