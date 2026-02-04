(() => {
  "use strict";

  /**
   * CloudVPS Demo App (Vanilla JS) — Tabs + Modals Edition
   * - Views (Home / Tasks / Dashboard) as tabs (no long scroll)
   * - Auth in modal (login/register/forgot/reset) + simulated OAuth
   * - Tasks: cooldown + daily (UTC 00:00)
   * - VPS: create/stop/extend + countdown
   * - Persistence via localStorage
   *
   * SECURITY NOTE:
   * This is a front-end demo. Do NOT store real passwords client-side in production.
   */

  // ---------------------------
  // Config
  // ---------------------------
  const CFG = {
    redeem: { points: 10, seconds: 6 * 60 * 60 }, // 6h
    extend: { points: 50, seconds: 60 * 60 }, // +1h
    tasks: {
      video: { reward: 5, cooldownSec: 0, label: "Watched Ad" },
      short: { reward: 2, cooldownSec: 25, label: "Short Link Completed" },
      daily: { reward: 10, cooldownSec: 0, label: "Daily Bonus Achieved" }, // 1/day (UTC)
    },
    simulateDelayMs: { min: 850, max: 1350 },
    activityMax: 6,
  };

  const KEYS = {
    app: "cloudvps_app_v3",
    users: "cloudvps_users_v3",
    session: "cloudvps_session_v3",
    reset: "cloudvps_reset_v3",
    sessionEarned: "cloudvps_sessionEarned_v3", // sessionStorage
  };

  // ---------------------------
  // Helpers
  // ---------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const nf = new Intl.NumberFormat(undefined);

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function nowMs() {
    return Date.now();
  }

  function utcDateKey(d = new Date()) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatHHMMSS(totalSec) {
    const s = Math.max(0, Math.floor(totalSec));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function escapeHTML(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------
  // Toast (a11y)
  // ---------------------------
  const toast = (() => {
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    document.body.appendChild(el);

    let t = null;

    function show(msg) {
      el.textContent = msg;
      el.classList.add("show");
      window.clearTimeout(t);
      t = window.setTimeout(() => el.classList.remove("show"), 2600);
    }

    return { show };
  })();

  // ---------------------------
  // Modals (Auth / Account / Confirm)
  // ---------------------------
  const modal = (() => {
    let active = null;
    let lastFocus = null;

    function getFocusable(root) {
      const sel =
        'a[href], button:not([disabled]), textarea, input, select, details > summary, [tabindex]:not([tabindex="-1"])';
      return $$(sel, root).filter((el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"));
    }

    function trap(e) {
      if (!active) return;
      if (e.key !== "Tab") return;

      const focusables = getFocusable(active);
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function onKeyDown(e) {
      if (!active) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      trap(e);
    }

    function open(id) {
      const m = document.getElementById(id);
      if (!m) return;

      if (active) close();

      active = m;
      lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      m.hidden = false;
      document.documentElement.classList.add("modal-open");

      // focus first focusable in modal card
      const card = $(".modal-card", m) || m;
      const focusables = getFocusable(card);
      (focusables[0] || card).focus?.();

      document.addEventListener("keydown", onKeyDown, true);
    }

    function close() {
      if (!active) return;
      active.hidden = true;
      active = null;
      document.documentElement.classList.remove("modal-open");
      document.removeEventListener("keydown", onKeyDown, true);
      lastFocus?.focus?.();
      lastFocus = null;
    }

    // backdrop / close buttons
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.matches("[data-modal-close]")) {
        close();
      }
    });

    return { open, close, isOpen: () => !!active };
  })();

  // Confirm modal -> Promise<boolean>
  const confirmModal = (() => {
    const el = $("#confirmModal");
    const titleEl = $("#confirmTitle");
    const descEl = $("#confirmDesc");
    const okBtn = $('[data-confirm="ok"]');
    const cancelBtn = $('[data-confirm="cancel"]');

    let resolver = null;

    function open({ title, desc, okText = "Confirm" }) {
      if (!el || !titleEl || !descEl || !okBtn || !cancelBtn) return Promise.resolve(false);

      titleEl.textContent = title || "Confirm";
      descEl.textContent = desc || "Are you sure?";
      okBtn.textContent = okText;

      modal.open("confirmModal");

      return new Promise((resolve) => {
        resolver = resolve;
      });
    }

    function settle(v) {
      if (resolver) resolver(v);
      resolver = null;
      modal.close();
    }

    okBtn?.addEventListener("click", () => settle(true));
    cancelBtn?.addEventListener("click", () => settle(false));

    return { open };
  })();

  // ---------------------------
  // Auth (Demo)
  // ---------------------------
  const auth = (() => {
    let users = loadJSON(KEYS.users, []);
    let session = loadJSON(KEYS.session, null);
    let pendingView = null;

    const authModalId = "authModal";

    const authTabButtons = $$("[data-auth-tab]");
    const authForms = $$("[data-auth-form]");

    function persistUsers() {
      saveJSON(KEYS.users, users);
    }

    function persistSession() {
      saveJSON(KEYS.session, session);
    }

    function setActiveAuthTab(tab) {
      for (const b of authTabButtons) {
        const is = b.getAttribute("data-auth-tab") === tab;
        b.classList.toggle("active", is);
        b.setAttribute("aria-selected", is ? "true" : "false");
      }
      for (const f of authForms) {
        const is = f.getAttribute("data-auth-form") === tab;
        f.hidden = !is;
      }

      const title = $("#authTitle");
      const sub = $("#authSub");

      const map = {
        login: ["Sign in", "Access Tasks and Dashboard."],
        register: ["Create account", "Join to earn points and manage VPS."],
        forgot: ["Forgot password", "Generate a reset code (demo)."],
        reset: ["Reset password", "Use the reset code to set a new password."],
      };

      const [t, s] = map[tab] || map.login;
      if (title) title.textContent = t;
      if (sub) sub.textContent = s;
    }

    function openAuth(tab = "login", viewAfter = null) {
      if (viewAfter) pendingView = viewAfter;
      setActiveAuthTab(tab);
      modal.open(authModalId);
    }

    function closeAuth() {
      modal.close();
    }

    function isLoggedIn() {
      return !!session?.userId;
    }

    function getSession() {
      return session;
    }

    function logout() {
      session = null;
      persistSession();
      toast.show("Logged out.");
      uiSync();
      // if user is on protected view, send to home
      setView("home", { skipAuthGuard: true, updateHash: true });
    }

    function ensureDemoUser(email, provider) {
      const existing = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (existing) return existing;

      const u = {
        id: cryptoRandomId(),
        email,
        password: `oauth:${provider}`, // demo only
        createdAt: nowMs(),
      };
      users.push(u);
      persistUsers();
      return u;
    }

    function loginWithEmail(email, password) {
      const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (!u) return { ok: false, error: "Account not found. Please register." };
      if (u.password !== password) return { ok: false, error: "Invalid password." };

      session = { userId: u.id, email: u.email, createdAt: nowMs() };
      persistSession();
      return { ok: true };
    }

    function register(email, password, confirm, tosChecked) {
      if (!tosChecked) return { ok: false, error: "You must agree to Terms of Service." };
      if (password.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
      if (password !== confirm) return { ok: false, error: "Passwords do not match." };

      const exists = users.some((u) => u.email.toLowerCase() === email.toLowerCase());
      if (exists) return { ok: false, error: "Email already registered. Please login." };

      const u = { id: cryptoRandomId(), email, password, createdAt: nowMs() };
      users.push(u);
      persistUsers();
      session = { userId: u.id, email: u.email, createdAt: nowMs() };
      persistSession();
      return { ok: true };
    }

    function resetStore() {
      return loadJSON(KEYS.reset, {});
    }

    function setResetStore(store) {
      saveJSON(KEYS.reset, store);
    }

    function genResetCode(email) {
      const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (!u) return { ok: false, error: "Email not found." };

      const code = String(randInt(100000, 999999));
      const store = resetStore();
      store[email.toLowerCase()] = { code, exp: nowMs() + 10 * 60 * 1000 }; // 10 minutes
      setResetStore(store);
      return { ok: true, code };
    }

    function doReset(email, code, newPassword) {
      if (newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };

      const store = resetStore();
      const rec = store[email.toLowerCase()];
      if (!rec) return { ok: false, error: "No reset request found. Use 'Forgot' first." };
      if (nowMs() > rec.exp) return { ok: false, error: "Reset code expired." };
      if (String(code).trim() !== rec.code) return { ok: false, error: "Invalid reset code." };

      const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
      if (!u) return { ok: false, error: "Account not found." };

      u.password = newPassword;
      persistUsers();
      delete store[email.toLowerCase()];
      setResetStore(store);

      return { ok: true };
    }

    function uiSync() {
      const loginBtn = $("#loginBtn");
      const headerChip = $("#headerUserChip");
      const nameEls = $$('[data-ui="userName"]');
      const nameDash = $('[data-ui="userNameDash"]');
      const emailEl = $('[data-ui="userEmail"]');
      const badgeEl = $('[data-ui="sessionBadge"]');
      const headerAvatar = $("#headerAvatar");
      const dashAvatar = $("#dashAvatar");

      if (isLoggedIn()) {
        loginBtn?.setAttribute("hidden", "");
        headerChip?.removeAttribute("hidden");

        const email = session.email;
        const display = email.split("@")[0] || "User";
        for (const el of nameEls) el.textContent = display;
        if (nameDash) nameDash.textContent = display;

        if (emailEl) emailEl.textContent = email;
        if (badgeEl) {
          badgeEl.textContent = "Logged in";
          badgeEl.classList.add("pill-good");
          badgeEl.classList.remove("pill-soft");
        }

        const av = display.slice(0, 2).toUpperCase();
        if (headerAvatar) headerAvatar.textContent = av;
        if (dashAvatar) dashAvatar.textContent = av;
      } else {
        headerChip?.setAttribute("hidden", "");
        loginBtn?.removeAttribute("hidden");

        for (const el of nameEls) el.textContent = "User";
        if (nameDash) nameDash.textContent = "User";
        if (emailEl) emailEl.textContent = "—";
        if (badgeEl) {
          badgeEl.textContent = "Guest";
          badgeEl.classList.remove("pill-good");
          badgeEl.classList.add("pill-soft");
        }
        if (headerAvatar) headerAvatar.textContent = "U";
        if (dashAvatar) dashAvatar.textContent = "U";
      }
    }

    function cryptoRandomId() {
      // small helper for demo-only IDs
      const a = new Uint8Array(10);
      crypto.getRandomValues(a);
      return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
    }

    // Bind auth tab buttons
    for (const b of authTabButtons) {
      b.addEventListener("click", () => {
        const tab = b.getAttribute("data-auth-tab") || "login";
        setActiveAuthTab(tab);
      });
    }

    // Open auth modal
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;

      if (t.matches("[data-auth-open]")) {
        e.preventDefault();
        openAuth("login");
      }
    });

    // OAuth simulated
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const btn = t.closest("[data-oauth]");
      if (!(btn instanceof HTMLElement)) return;

      const provider = btn.getAttribute("data-oauth");
      const email = provider === "google" ? "google_user@demo.com" : "github_user@demo.com";
      const u = ensureDemoUser(email, provider || "oauth");

      session = { userId: u.id, email: u.email, createdAt: nowMs() };
      persistSession();
      toast.show(`Signed in with ${provider}.`);
      uiSync();
      closeAuth();

      if (pendingView) {
        const pv = pendingView;
        pendingView = null;
        setView(pv, { skipAuthGuard: true, updateHash: true });
      }
    });

    // Forms
    const loginForm = $('[data-auth-form="login"]');
    const registerForm = $('[data-auth-form="register"]');
    const forgotForm = $('[data-auth-form="forgot"]');
    const resetForm = $('[data-auth-form="reset"]');

    loginForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(loginForm);
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "");
      if (!email || !password) return toast.show("Please enter email and password.");

      const r = loginWithEmail(email, password);
      if (!r.ok) return toast.show(r.error);

      toast.show("Signed in.");
      uiSync();
      closeAuth();

      if (pendingView) {
        const pv = pendingView;
        pendingView = null;
        setView(pv, { skipAuthGuard: true, updateHash: true });
      }
    });

    registerForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(registerForm);
      const email = String(fd.get("email") || "").trim();
      const password = String(fd.get("password") || "");
      const confirm = String(fd.get("confirm") || "");
      const tos = Boolean(fd.get("tos"));

      if (!email) return toast.show("Email is required.");
      const r = register(email, password, confirm, tos);
      if (!r.ok) return toast.show(r.error);

      toast.show("Account created.");
      uiSync();
      closeAuth();

      if (pendingView) {
        const pv = pendingView;
        pendingView = null;
        setView(pv, { skipAuthGuard: true, updateHash: true });
      }
    });

    forgotForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(forgotForm);
      const email = String(fd.get("email") || "").trim();
      if (!email) return toast.show("Email is required.");

      const r = genResetCode(email);
      if (!r.ok) return toast.show(r.error);

      toast.show(`Reset code: ${r.code} (demo)`);
      setActiveAuthTab("reset");
      // prefill reset email
      const resetEmail = $('[data-auth-form="reset"] input[name="email"]');
      if (resetEmail) resetEmail.value = email;
    });

    resetForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(resetForm);
      const email = String(fd.get("email") || "").trim();
      const code = String(fd.get("code") || "").trim();
      const password = String(fd.get("password") || "");

      if (!email || !code || !password) return toast.show("Please fill all fields.");
      const r = doReset(email, code, password);
      if (!r.ok) return toast.show(r.error);

      toast.show("Password reset. Please login.");
      setActiveAuthTab("login");
      const le = $('[data-auth-form="login"] input[name="email"]');
      if (le) le.value = email;
    });

    // Account modal open
    document.addEventListener("click", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      const btn = t.closest('[data-modal-open="account"]');
      if (!btn) return;
      modal.open("accountModal");
    });

    // Header user chip open account
    $("#headerUserChip")?.addEventListener("click", () => modal.open("accountModal"));

    // Logout
    $("#logoutBtn")?.addEventListener("click", logout);

    // init
    uiSync();

    return {
      isLoggedIn,
      getSession,
      openAuth,
      logout,
      setPendingView: (v) => (pendingView = v),
      uiSync,
    };
  })();

  // ---------------------------
  // App State (Points/VPS/Tasks)
  // ---------------------------
  const app = (() => {
    const today = utcDateKey();

    const initial = {
      pointsBalance: 0,
      vps: {
        status: "stopped", // stopped | provisioning | running
        timeLeftSec: 0,
        lastTickMs: nowMs(),
      },
      daily: {
        utcDate: today,
        earned: 0,
        dailyClaimedUtcDate: "",
      },
      tasks: {
        video: { cooldownUntilMs: 0 },
        short: { cooldownUntilMs: 0 },
      },
      activity: [],
    };

    let state = loadJSON(KEYS.app, initial);
    // normalize
    if (!state || typeof state !== "object") state = structuredClone(initial);
    if (!state.daily || state.daily.utcDate !== today) {
      state.daily = { utcDate: today, earned: 0, dailyClaimedUtcDate: "" };
    }
    if (state.daily.dailyClaimedUtcDate && state.daily.dailyClaimedUtcDate !== today) {
      state.daily.dailyClaimedUtcDate = "";
    }
    if (!state.tasks) state.tasks = structuredClone(initial.tasks);
    if (!state.activity) state.activity = [];

    // Session earned (not persisted to localStorage)
    let sessionEarned = 0;
    try {
      const se = sessionStorage.getItem(KEYS.sessionEarned);
      sessionEarned = se ? Number(se) : 0;
      if (!Number.isFinite(sessionEarned)) sessionEarned = 0;
    } catch {
      sessionEarned = 0;
    }

    function persist() {
      saveJSON(KEYS.app, state);
      try {
        sessionStorage.setItem(KEYS.sessionEarned, String(sessionEarned));
      } catch {
        // ignore
      }
    }

    function pushActivity(label, delta) {
      state.activity.unshift({ label, delta, ts: nowMs() });
      state.activity = state.activity.slice(0, CFG.activityMax);
      persist();
    }

    function ensureDaily() {
      const t = utcDateKey();
      if (state.daily.utcDate !== t) {
        state.daily.utcDate = t;
        state.daily.earned = 0;
        state.daily.dailyClaimedUtcDate = "";
        persist();
        toast.show("Daily missions refreshed (UTC).");
      }
    }

    // ---------------------------
    // Rendering
    // ---------------------------
    const ui = {
      // hero progress
      sessionEarned: $('[data-ui="sessionEarned"]'),
      sessionTarget: $('[data-ui="sessionTarget"]'),
      heroFill: $("#heroProgressFill"),

      // dashboard
      pointsBalance: $('[data-ui="pointsBalance"]'),
      timeRemaining: $('[data-ui="timeRemaining"]'),
      earnedToday: $('[data-ui="earnedToday"]'),
      activityList: $("#activityList"),

      // tasks
      taskCards: $$("[data-task]"),

      // actions
      createBtn: $('[data-action="createVps"]'),
      stopBtn: $('[data-action="stopVps"]'),
      extendBtn: $$('[data-action="extendVps"]'), // there are 2 extend buttons
    };

    function setBtnLoading(btn, loading, label = "Loading…") {
      if (!btn) return;
      btn.disabled = !!loading;
      btn.setAttribute("aria-busy", loading ? "true" : "false");
      if (loading) {
        btn.dataset._label = btn.textContent;
        btn.textContent = label;
      } else {
        if (btn.dataset._label) btn.textContent = btn.dataset._label;
        delete btn.dataset._label;
      }
    }

    function render() {
      // points
      ui.pointsBalance && (ui.pointsBalance.textContent = nf.format(state.pointsBalance));
      ui.earnedToday && (ui.earnedToday.textContent = nf.format(state.daily.earned));

      // hero progress
      ui.sessionEarned && (ui.sessionEarned.textContent = nf.format(sessionEarned));
      ui.sessionTarget && (ui.sessionTarget.textContent = nf.format(CFG.redeem.points));

      if (ui.heroFill) {
        const pct = clamp((sessionEarned / CFG.redeem.points) * 100, 0, 100);
        ui.heroFill.style.width = `${pct}%`;
      }

      // time
      ui.timeRemaining && (ui.timeRemaining.textContent = formatHHMMSS(state.vps.timeLeftSec));

      // activity
      if (ui.activityList) {
        ui.activityList.innerHTML = "";
        const items = state.activity.slice(0, 3);
        if (items.length === 0) {
          const li = document.createElement("li");
          li.className = "mini-item";
          li.innerHTML = `<span class="mini-dot info"></span> No recent activity <span class="mini-right">—</span>`;
          ui.activityList.appendChild(li);
        } else {
          for (const it of items) {
            const li = document.createElement("li");
            li.className = "mini-item";
            li.innerHTML = `
              <span class="mini-dot ${it.delta >= 0 ? "good" : "info"}"></span>
              ${escapeHTML(it.label)}
              <span class="mini-right">${it.delta >= 0 ? "+" : ""}${it.delta}</span>
            `;
            ui.activityList.appendChild(li);
          }
        }
      }

      renderTasks();
      renderActions();
    }

    function renderTasks() {
      const now = nowMs();
      const today = utcDateKey();

      for (const card of ui.taskCards) {
        const type = card.getAttribute("data-task");
        const btn = card.querySelector("[data-task-btn]");
        const pill = card.querySelector("[data-task-pill]");
        if (!type || !(btn instanceof HTMLButtonElement) || !(pill instanceof HTMLElement)) continue;

        if (type === "daily") {
          const claimed = state.daily.dailyClaimedUtcDate === today;
          btn.disabled = claimed;
          pill.textContent = claimed ? "Completed" : "Active";
          pill.classList.toggle("pill-good", !claimed);
          pill.classList.toggle("pill-soft", claimed);
          continue;
        }

        const cdUntil = state.tasks[type]?.cooldownUntilMs ?? 0;
        const remainingMs = Math.max(0, cdUntil - now);
        if (remainingMs > 0) {
          btn.disabled = true;
          pill.textContent = `Cooldown ${Math.ceil(remainingMs / 1000)}s`;
          pill.classList.remove("pill-good");
          pill.classList.add("pill-soft");
        } else {
          btn.disabled = false;
          pill.textContent = "Available";
          pill.classList.remove("pill-good");
          pill.classList.add("pill-soft");
        }
      }
    }

    function renderActions() {
      const { status, timeLeftSec } = state.vps;

      const canCreate = status !== "provisioning" && status !== "running" && state.pointsBalance >= CFG.redeem.points;
      const canStop = status === "running";
      const canExtend = timeLeftSec > 0 && state.pointsBalance >= CFG.extend.points;

      ui.createBtn && (ui.createBtn.disabled = !canCreate);
      ui.stopBtn && (ui.stopBtn.disabled = !canStop);
      for (const b of ui.extendBtn) {
        if (b instanceof HTMLButtonElement) b.disabled = !canExtend;
      }
    }

    // ---------------------------
    // Operations
    // ---------------------------
    async function runTask(type, card) {
      ensureDaily();
      if (!auth.isLoggedIn()) {
        auth.openAuth("login", "tasks");
        return;
      }

      const cfg = CFG.tasks[type];
      if (!cfg) return;

      // gate daily
      const today = utcDateKey();
      if (type === "daily") {
        if (state.daily.dailyClaimedUtcDate === today) {
          toast.show("Daily bonus already claimed today (UTC).");
          return;
        }
      } else {
        const cd = state.tasks[type]?.cooldownUntilMs ?? 0;
        if (nowMs() < cd) {
          toast.show("Task on cooldown. Please wait.");
          return;
        }
      }

      const btn = card.querySelector("[data-task-btn]");
      if (!(btn instanceof HTMLButtonElement)) return;

      setBtnLoading(btn, true, "Loading…");
      toast.show("Processing task…");
      await new Promise((r) => setTimeout(r, randInt(CFG.simulateDelayMs.min, CFG.simulateDelayMs.max)));

      // reward
      state.pointsBalance += cfg.reward;
      sessionEarned += cfg.reward;
      ensureDaily();
      state.daily.earned += cfg.reward;
      pushActivity(cfg.label, cfg.reward);

      if (type === "daily") {
        state.daily.dailyClaimedUtcDate = today;
      } else {
        state.tasks[type].cooldownUntilMs = nowMs() + cfg.cooldownSec * 1000;
      }

      persist();
      setBtnLoading(btn, false);
      toast.show(`+${cfg.reward} points earned.`);
      render();
    }

    async function createVps() {
      if (!auth.isLoggedIn()) {
        auth.openAuth("login", "dashboard");
        return;
      }
      if (state.vps.status === "running" || state.vps.status === "provisioning") {
        toast.show("VPS is already running/provisioning.");
        return;
      }
      if (state.pointsBalance < CFG.redeem.points) {
        toast.show(`Not enough points. Need ${CFG.redeem.points - state.pointsBalance} more.`);
        return;
      }

      state.pointsBalance -= CFG.redeem.points;
      state.vps.status = "provisioning";
      persist();
      render();

      setBtnLoading(ui.createBtn, true, "Provisioning…");
      toast.show("Provisioning VPS…");

      await new Promise((r) => setTimeout(r, randInt(CFG.simulateDelayMs.min, CFG.simulateDelayMs.max)));

      state.vps.status = "running";
      state.vps.timeLeftSec = CFG.redeem.seconds;
      state.vps.lastTickMs = nowMs();
      pushActivity("Redeemed VPS 6H", -CFG.redeem.points);
      persist();

      setBtnLoading(ui.createBtn, false);
      toast.show("VPS is running. Countdown started.");
      render();
    }

    async function stopVps() {
      if (!auth.isLoggedIn()) {
        auth.openAuth("login", "dashboard");
        return;
      }
      if (state.vps.status !== "running") {
        toast.show("VPS is not running.");
        return;
      }

      const ok = await confirmModal.open({
        title: "Stop VPS?",
        desc: "This will pause your remaining time (demo behavior).",
        okText: "Stop",
      });

      if (!ok) return;

      state.vps.status = "stopped";
      state.vps.lastTickMs = nowMs();
      persist();
      toast.show("VPS stopped (timer paused).");
      render();
    }

    function extendVps() {
      if (!auth.isLoggedIn()) {
        auth.openAuth("login", "dashboard");
        return;
      }
      if (state.vps.timeLeftSec <= 0) {
        toast.show("No active time to extend. Create a VPS first.");
        return;
      }
      if (state.pointsBalance < CFG.extend.points) {
        toast.show(`Not enough points. Need ${CFG.extend.points - state.pointsBalance} more.`);
        return;
      }

      state.pointsBalance -= CFG.extend.points;
      state.vps.timeLeftSec += CFG.extend.seconds;
      persist();
      pushActivity("Extended time", -CFG.extend.points);
      toast.show(`Extended +${Math.floor(CFG.extend.seconds / 3600)}h for ${CFG.extend.points} pts.`);
      render();
    }

    // countdown tick
    function tick() {
      ensureDaily();

      if (state.vps.status === "running" && state.vps.timeLeftSec > 0) {
        const now = nowMs();
        const last = state.vps.lastTickMs || now;
        const delta = Math.floor((now - last) / 1000);

        if (delta > 0) {
          state.vps.timeLeftSec = Math.max(0, state.vps.timeLeftSec - delta);
          state.vps.lastTickMs = last + delta * 1000;
          persist();
        }

        if (state.vps.timeLeftSec <= 0) {
          state.vps.timeLeftSec = 0;
          state.vps.status = "stopped";
          state.vps.lastTickMs = nowMs();
          persist();
          toast.show("Time ended. VPS stopped.");
        }
      }

      // fast partial renders
      ui.timeRemaining && (ui.timeRemaining.textContent = formatHHMMSS(state.vps.timeLeftSec));
      renderTasks();
      renderActions();
    }

    // Bind task buttons
    for (const card of ui.taskCards) {
      const type = card.getAttribute("data-task");
      const btn = card.querySelector("[data-task-btn]");
      if (!type || !(btn instanceof HTMLButtonElement)) continue;
      btn.addEventListener("click", () => runTask(type, card));
    }

    // Bind actions
    ui.createBtn?.addEventListener("click", createVps);
    ui.stopBtn?.addEventListener("click", stopVps);
    for (const b of ui.extendBtn) {
      if (b instanceof HTMLButtonElement) b.addEventListener("click", extendVps);
    }

    // expose debug
    window.CloudVPS = {
      getState: () => ({ state: structuredClone(state), sessionEarned }),
      reset: () => {
        localStorage.removeItem(KEYS.app);
        localStorage.removeItem(KEYS.session);
        localStorage.removeItem(KEYS.users);
        localStorage.removeItem(KEYS.reset);
        sessionStorage.removeItem(KEYS.sessionEarned);
        location.hash = "#home";
        location.reload();
      },
    };

    // init
    render();
    tick();
    window.setInterval(tick, 1000);

    return { render };
  })();

  // ---------------------------
  // View Router (Tabs)
  // ---------------------------
  const views = $$("[data-view]");
  const tabs = $$('[role="tab"][data-view-target]');
  const navLinks = $$("[data-view-target]");

  const PROTECTED = new Set(["tasks", "dashboard"]);

  function setActiveTab(viewName) {
    for (const t of tabs) {
      const is = t.getAttribute("data-view-target") === viewName;
      t.classList.toggle("active", is);
      t.setAttribute("aria-selected", is ? "true" : "false");
    }

    // also highlight header nav links
    for (const a of $$('a.nav-link[data-view-target], button.side-link[data-view-target]')) {
      const is = a.getAttribute("data-view-target") === viewName;
      a.classList.toggle("active", is);
    }
  }

  function setView(viewName, opts = {}) {
    const { updateHash = false, skipAuthGuard = false, scrollTarget = null } = opts;

    if (!skipAuthGuard && PROTECTED.has(viewName) && !auth.isLoggedIn()) {
      auth.openAuth("login", viewName);
      return;
    }

    for (const v of views) {
      const is = v.getAttribute("data-view") === viewName;
      v.hidden = !is;
    }

    setActiveTab(viewName);

    if (updateHash) {
      const hash = viewName === "home" ? "#home" : viewName === "tasks" ? "#tasks" : "#dashboard";
      if (location.hash !== hash) location.hash = hash;
    }

    // optional scroll inside view (e.g. FAQ)
    if (scrollTarget) {
      const el = $(scrollTarget);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    // keep UI fresh
    app.render();
  }

  function viewFromHash() {
    const h = (location.hash || "#home").replace("#", "").toLowerCase();
    if (h === "tasks") return "tasks";
    if (h === "dashboard") return "dashboard";
    return "home";
  }

  // Bind navigation clicks
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const btn = t.closest("[data-view-target]");
    if (!(btn instanceof HTMLElement)) return;

    const target = btn.getAttribute("data-view-target");
    if (!target) return;

    // if anchor, prevent jump; we manage view
    if (btn.tagName === "A") e.preventDefault();

    const scrollTarget = btn.getAttribute("data-scroll-target");
    setView(target, { updateHash: true, scrollTarget: scrollTarget || null });
  });

  // hash-based back/forward
  window.addEventListener("hashchange", () => {
    const view = viewFromHash();
    setView(view, { skipAuthGuard: false, updateHash: false });
  });

  // Initial view
  setView(viewFromHash(), { skipAuthGuard: true });

})();