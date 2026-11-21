import { createAuth } from "@patchbay/auth";
import { createDb } from "@patchbay/db";

import { ENV } from "./env.server";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db);
