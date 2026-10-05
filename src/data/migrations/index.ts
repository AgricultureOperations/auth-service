import type { Migration } from "../migrate";
import { baseline } from "./001_baseline";
import { rbac } from "./002_rbac";

// Append only. Never edit or reorder a migration that has shipped: it has already run on Render.
export const migrations: Migration[] = [baseline, rbac];
