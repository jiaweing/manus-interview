import { createAuth } from "@session-seven/auth";
import { createDb } from "@session-seven/db";

import { ENV } from "./env.server";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db);
