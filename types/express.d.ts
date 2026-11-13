import type { IUser } from "../models/User.js";

// The authenticated request user is always a lean, password-stripped
// projection of IUser (set by middleware/auth.ts's `authenticate`), not a
// hydrated Mongoose document — no Document methods (.save(), etc.) exist on it.
export type AuthUser = Omit<IUser, "password">;

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
