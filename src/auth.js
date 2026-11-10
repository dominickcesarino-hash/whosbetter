// Accounts use Firebase Authentication (Google or email + password), the same sign-in system as Quorvyn.
// The browser signs in with Firebase and sends its ID token; we check that token with Google here.

export const FIREBASE_WEB_API_KEY = "AIzaSyAYbOHkDHruMjlQEbOizq_8_Ylihfj09C0"; // public web key, safe to share

const seen = new Map(); // token -> { user, until }

export async function getUser(request, env) {
  const h = request.headers.get("Authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token || token.length > 4000) return null;
  const hit = seen.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  try {
    const key = env.FIREBASE_API_KEY || FIREBASE_WEB_API_KEY;
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${key}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: token })
    });
    if (!r.ok) return null;
    const u = ((await r.json()).users || [])[0];
    if (!u || !u.localId) return null;
    const user = { uid: u.localId, email: (u.email || "").toLowerCase(), emailVerified: !!u.emailVerified, name: u.displayName || "" };
    if (seen.size > 500) seen.clear();
    seen.set(token, { user, until: Date.now() + 5 * 60 * 1000 });
    return user;
  } catch { return null; }
}

// Only the site owner: ADMIN_EMAIL (set in Cloudflare) must match a verified email.
export function isAdmin(user, env) {
  const admins = String(env.ADMIN_EMAIL || "").toLowerCase().split(/[,\s]+/).filter(Boolean);
  return !!(user && user.emailVerified && admins.includes(user.email));
}
