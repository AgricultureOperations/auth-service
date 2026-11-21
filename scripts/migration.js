#!/usr/bin/env node
// Database migrations for auth-service. Run from any folder, e.g.:
//   APP_ENV=DEV auth-service/scripts/migration.js status
//   APP_ENV=DEV auth-service/scripts/migration.js auth-service/migrations/004_add_user_locale.sql
// `--help` lists every command. The code lives in src/cli/migration.ts: from a checkout it runs the TypeScript
// source through ts-node (no build needed); in the Docker image, which has no src/, it runs dist/cli/migration.js.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const run = () => {
    let cli;
    if (fs.existsSync(path.join(root, "src", "cli", "migration.ts"))) {
        require("ts-node").register({ project: path.join(root, "tsconfig.json"), transpileOnly: true });
        cli = require(path.join(root, "src", "cli", "migration.ts"));
    } else {
        cli = require(path.join(root, "dist", "cli", "migration.js"));
    }
    return cli.main(process.argv.slice(2));
};

try {
    process.exitCode = run();
} catch (error) {
    // better-sqlite3 is a native module: it only loads on the Node version that ran `npm install`.
    if (error && error.code === "ERR_DLOPEN_FAILED" && /NODE_MODULE_VERSION/.test(error.message)) {
        console.error(
            `better-sqlite3 was installed with a different Node.js version than the one running now (${process.version}).\n` +
            `Switch to the project's version (auth-service/.nvmrc) and run again:  cd auth-service && nvm use\n` +
            `Or rebuild it for this Node:  cd auth-service && npm rebuild better-sqlite3`);
        process.exitCode = 1;
    } else {
        throw error;
    }
}
