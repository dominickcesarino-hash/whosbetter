// Shared header, accounts (Firebase sign-in) and saved comparisons for every page.
// Pages use: WB.token(), WB.user, WB.onAuth(cb), WB.signIn(), WB.openSaved()

(() => {
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAYbOHkDHruMjlQEbOizq_8_Ylihfj09C0",
  authDomain: "quorvyn1.firebaseapp.com",
  projectId: "quorvyn1",
  appId: "1:555584065909:web:bd14ff5338f66092a0833c"
};
const FB = "https://www.gstatic.com/firebasejs/10.14.1/";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const listeners = [];
let A = null, auth = null;

const WB = window.WB = {
  user: null, admin: false, esc,
  onAuth(cb) { listeners.push(cb); if (WB.ready) cb(WB.user); },
  async token() { try { return auth && auth.currentUser ? await auth.currentUser.getIdToken() : null; } catch { return null; } },
  async api(path, opts = {}) {
    const t = await WB.token();
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (t) headers.Authorization = "Bearer " + t;
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({ error: "Something went wrong. Please try again." }));
    if (!res.ok && !data.error) data.error = "Something went wrong. Please try again.";
    return data;
  },
  signIn: () => openModal(),
  openSaved: () => openDrawer()
};

// ---------- Header ----------
const page = document.body.dataset.page || "";
const head = document.createElement("header");
head.className = "wb-head";
head.innerHTML = `
  <a class="wb-logo" href="/"><img src="/brand/icon.svg" alt="" width="32" height="32"><b style="font-weight:inherit">Who's <span>Better?</span></b></a>
  <nav class="wb-nav">
    <a href="/" class="${page === "home" ? "on" : ""}">Compare</a>
    <a href="/stats" class="${page === "stats" ? "on" : ""}">Stats</a>
  </nav>
  <div class="wb-acct" id="wbAcct"><button class="wb-btn" id="wbSignBtn" type="button">Sign in</button></div>`;
document.querySelector("main").prepend(head);

document.body.insertAdjacentHTML("beforeend", `
<div class="wb-over" id="wbOver" role="dialog" aria-modal="true" aria-labelledby="wbTitle">
  <div class="wb-modal">
    <button class="wb-x" id="wbX" type="button" aria-label="Close">×</button>
    <h2 id="wbTitle">Sign in</h2>
    <p class="sub" id="wbSub">Save your comparisons and see them on any device.</p>
    <button class="wb-btn full" id="wbGoogle" type="button">
      <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      Continue with Google</button>
    <div class="wb-or">or</div>
    <form id="wbForm" autocomplete="on">
      <input id="wbName" placeholder="Your name" autocomplete="name" hidden>
      <input id="wbEmail" type="email" placeholder="Email" autocomplete="email" required>
      <input id="wbPw" type="password" placeholder="Password (6+ characters)" autocomplete="current-password" required minlength="6">
      <div class="wb-msg" id="wbMsg" hidden></div>
      <button class="wb-btn primary full" id="wbSubmit" type="submit">Sign in</button>
    </form>
    <div class="wb-links"><button type="button" id="wbMode">Create an account</button><button type="button" id="wbReset">Forgot password?</button></div>
  </div>
</div>
<div class="wb-scrim" id="wbScrim"></div>
<aside class="wb-drawer" id="wbDrawer" aria-label="Saved comparisons">
  <div class="dh"><h3>My comparisons</h3><button class="wb-x" style="position:static" id="wbDX" type="button" aria-label="Close">×</button></div>
  <div class="list" id="wbList"></div>
</aside>`);

let creating = false;
function setMode(c) {
  creating = c;
  $("wbTitle").textContent = c ? "Create your account" : "Sign in";
  $("wbSubmit").textContent = c ? "Create account" : "Sign in";
  $("wbMode").textContent = c ? "I already have an account" : "Create an account";
  $("wbName").hidden = !c; $("wbReset").hidden = c;
  $("wbPw").autocomplete = c ? "new-password" : "current-password";
  msg("");
}
function msg(t, ok) { const m = $("wbMsg"); m.textContent = t; m.hidden = !t; m.className = "wb-msg" + (ok ? " ok" : ""); }
function openModal(c = false) { setMode(c); $("wbOver").classList.add("open"); setTimeout(() => $("wbEmail").focus(), 50); }
function closeModal() { $("wbOver").classList.remove("open"); }
$("wbX").onclick = closeModal;
$("wbOver").addEventListener("click", e => { if (e.target.id === "wbOver") closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeModal(); closeDrawer(); } });
$("wbMode").onclick = () => setMode(!creating);

function friendly(e) {
  const c = (e && e.code) || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "That email or password isn't right.";
  if (/email-already-in-use/.test(c)) return "There's already an account with that email. Try signing in.";
  if (/weak-password/.test(c)) return "Use a password with at least 6 characters.";
  if (/invalid-email/.test(c)) return "That email doesn't look right.";
  if (/popup-closed|cancelled-popup/.test(c)) return "";
  if (/unauthorized-domain/.test(c)) return "Sign-in isn't enabled for this website yet. (Site owner: add this domain in Firebase.)";
  if (/too-many-requests/.test(c)) return "Too many tries. Wait a minute and try again.";
  if (/network/.test(c)) return "Couldn't connect. Check your internet.";
  return "Sign-in didn't work. Please try again.";
}

async function loadFirebase() {
  if (A) return A;
  const [app, a] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js")]);
  A = a; auth = a.getAuth(app.initializeApp(FIREBASE_CONFIG));
  return A;
}

$("wbGoogle").onclick = async () => {
  msg("");
  try { await loadFirebase(); await A.signInWithPopup(auth, new A.GoogleAuthProvider()); closeModal(); }
  catch (e) { msg(friendly(e)); }
};
$("wbForm").addEventListener("submit", async e => {
  e.preventDefault(); msg("");
  const email = $("wbEmail").value.trim(), pw = $("wbPw").value, name = $("wbName").value.trim();
  $("wbSubmit").disabled = true;
  try {
    await loadFirebase();
    if (creating) {
      const cred = await A.createUserWithEmailAndPassword(auth, email, pw);
      if (name) await A.updateProfile(cred.user, { displayName: name });
      A.sendEmailVerification(cred.user).catch(() => {});
    } else await A.signInWithEmailAndPassword(auth, email, pw);
    closeModal();
  } catch (err) { msg(friendly(err)); }
  finally { $("wbSubmit").disabled = false; }
});
$("wbReset").onclick = async () => {
  const email = $("wbEmail").value.trim();
  if (!email) { msg("Type your email above first."); return; }
  try { await loadFirebase(); await A.sendPasswordResetEmail(auth, email); msg("Check your inbox for a reset link.", true); }
  catch (e) { msg(friendly(e)); }
};

// ---------- Account button ----------
function renderAcct() {
  const box = $("wbAcct"), u = WB.user;
  if (!u) {
    box.innerHTML = `<button class="wb-btn" id="wbSignBtn" type="button">Sign in</button>`;
    $("wbSignBtn").onclick = () => openModal();
    return;
  }
  const name = u.displayName || (u.email || "").split("@")[0];
  const av = u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : esc((name[0] || "?").toUpperCase());
  box.innerHTML = `<button class="wb-btn" id="wbMe" type="button" aria-haspopup="true"><span class="wb-av">${av}</span>${esc(name.split(" ")[0])}</button>
    <div class="wb-menu" id="wbMenu" hidden>
      <div class="who"><b>${esc(name)}</b>${esc(u.email || "")}</div>
      <button type="button" id="wbSaved">My comparisons</button>
      ${WB.admin ? `<a href="/admin">Admin dashboard</a>` : ""}
      <button type="button" id="wbOut">Sign out</button>
    </div>`;
  $("wbMe").onclick = e => { e.stopPropagation(); $("wbMenu").hidden = !$("wbMenu").hidden; };
  $("wbSaved").onclick = () => { $("wbMenu").hidden = true; openDrawer(); };
  $("wbOut").onclick = async () => { await A.signOut(auth); };
}
document.addEventListener("click", () => { const m = $("wbMenu"); if (m) m.hidden = true; });
$("wbSignBtn").onclick = () => openModal();

// ---------- Saved comparisons drawer ----------
function closeDrawer() { $("wbDrawer").classList.remove("open"); $("wbScrim").classList.remove("open"); }
$("wbDX").onclick = closeDrawer; $("wbScrim").onclick = closeDrawer;
async function openDrawer() {
  if (!WB.user) { openModal(); return; }
  $("wbDrawer").classList.add("open"); $("wbScrim").classList.add("open");
  const list = $("wbList");
  list.innerHTML = `<div class="wb-empty">Loading…</div>`;
  const d = await WB.api("/api/history");
  if (d.error) { list.innerHTML = `<div class="wb-empty">${esc(d.error)}</div>`; return; }
  if (!d.items.length) { list.innerHTML = `<div class="wb-empty">No saved comparisons yet.<br>Everything you compare while signed in shows up here.</div>`; return; }
  list.innerHTML = d.items.map(i => `<div class="wb-item" data-id="${i.id}">
      <button class="open" type="button"><div class="t">${esc(i.a_name)} vs ${esc(i.b_name)}</div>
      <div class="m">${esc(i.sport)} · ${new Date(i.ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</div></button>
      <button class="del" type="button" title="Delete" aria-label="Delete">✕</button></div>`).join("")
    + `<div style="text-align:center;padding:12px"><button class="wb-btn" id="wbClear" type="button">Delete all</button></div>`;
  list.querySelectorAll(".wb-item").forEach(el => {
    const id = el.dataset.id;
    el.querySelector(".open").onclick = () => { closeDrawer(); location.href = "/?saved=" + id; };
    el.querySelector(".del").onclick = async () => { await WB.api("/api/history?id=" + id, { method: "DELETE" }); el.remove(); };
  });
  $("wbClear").onclick = async () => {
    if (!confirm("Delete all your saved comparisons?")) return;
    await WB.api("/api/history?id=all", { method: "DELETE" }); openDrawer();
  };
}

// ---------- Start ----------
loadFirebase().then(() => {
  A.onAuthStateChanged(auth, async u => {
    WB.user = u; WB.admin = false;
    if (u) { const me = await WB.api("/api/me"); WB.admin = !!me.admin; }
    WB.ready = true; renderAcct();
    listeners.forEach(cb => { try { cb(u); } catch (e) { console.error(e); } });
  });
}).catch(() => { WB.ready = true; listeners.forEach(cb => cb(null)); });
})();
