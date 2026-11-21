import { createAuth } from "@caret/auth";
import { createDb } from "@caret/db";

import { ENV } from "./env.server";

export const db = await createDb(ENV);
export const auth = createAuth(ENV, db);
