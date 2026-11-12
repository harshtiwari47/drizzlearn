import crypto from "node:crypto";
import { query } from "./db.js";
import { sendError } from "./http.js";

const COOKIE_NAME = "learnos_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    const error = new Error("Set SESSION_SECRET to a random value of at least 32 characters.");
    error.code = "SESSION_SECRET_MISSING";
    throw error;
  }
  return value;
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function parseCookies(header = "") {
  return Object.fromEntries(header.split(";").map(part => {
    const at = part.indexOf("=");
    return at < 0 ? ["", ""] : [part.slice(0, at).trim(), decodeURIComponent(part.slice(at + 1).trim())];
  }).filter(([key]) => key));
}

export function createSessionCookie(userId) {
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp: Date.now() + SESSION_SECONDS * 1000 })).toString("base64url");
  const token = payload + "." + sign(payload);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return COOKIE_NAME + "=" + encodeURIComponent(token) + "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + SESSION_SECONDS + secure;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return COOKIE_NAME + "=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" + secure;
}

export function sessionUserId(req) {
  try {
    const token = parseCookies(req.headers.cookie || "")[COOKIE_NAME];
    if (!token) return null;
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = sign(payload);
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Date.now() ? session.sub : null;
  } catch {
    return null;
  }
}

export async function requireUser(req, res) {
  const userId = sessionUserId(req);
  if (!userId) {
    sendError(res, 401, "UNAUTHENTICATED", "Sign in to continue.");
    return null;
  }
  const result = await query(
    "SELECT id, email, full_name, timezone, preferred_study_days, session_minutes, weekly_minutes, notification_preferences FROM users WHERE id = $1",
    [userId],
  );
  if (!result.rows[0]) {
    sendError(res, 401, "UNAUTHENTICATED", "Your session is no longer valid. Sign in again.");
    return null;
  }
  return result.rows[0];
}

export async function userFromRequest(req) {
  const userId = sessionUserId(req);
  if (!userId) return null;
  const result = await query(
    "SELECT id, email, full_name, timezone, preferred_study_days, session_minutes, weekly_minutes, notification_preferences FROM users WHERE id = $1",
    [userId],
  );
  return result.rows[0] || null;
}
