import { createAuth } from "@tetherterm/auth";
import { createDb } from "@tetherterm/db";

import { ENV } from "./env.server";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db);
