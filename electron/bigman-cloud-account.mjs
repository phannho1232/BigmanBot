import { randomBytes } from "node:crypto";
import { CHECKOUT_SOURCES, cloudMenuSublabel, cloudPlanSnapshot, createCloudAccountStore } from "./cloud-account.mjs";

export { CHECKOUT_SOURCES, cloudMenuSublabel, cloudPlanSnapshot, createCloudAccountStore };

export const BIGMAN_WEB_ORIGIN = "https://bigmanbot.com";
export const BIGMAN_SUPABASE_URL = "https://djokqsynkwoqpfyowbuz.supabase.co";
export const BIGMAN_SUPABASE_ANON_KEY = "sb_publishable_Sl17AdoCGFrcrnrZ0E9yqQ_b8HpCs8f";

export function bigmanCloudTarget() {
  return {
    origin: BIGMAN_WEB_ORIGIN,
    staging: false,
    file: "bigman-cloud-account.bin",
    saved: "bigman-cloud-accounts.bin",
    places: "bigman-account-places.json",
    environments: "environments.json",
    sync: "cloud-sync",
    look: "cloud-home-look.json",
  };
}

const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
const REFRESH_MARGIN_MS = 2 * 60 * 1_000;
const SYNC_INTERVAL_MS = 5 * 60 * 1_000;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function encodeSessionToken({ accessToken, refreshToken, tokenExpiresAt }) {
  const payload = JSON.stringify({
    accessToken,
    refreshToken: refreshToken || "",
    tokenExpiresAt: isTimestamp(tokenExpiresAt) ? tokenExpiresAt : 0,
  });
  return `bmb_${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeSessionToken(token) {
  if (typeof token !== "string" || !token.startsWith("bmb_")) return null;
  try {
    const raw = Buffer.from(token.slice(4), "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed) || typeof parsed.accessToken !== "string" || !parsed.accessToken) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
      tokenExpiresAt: isTimestamp(parsed.tokenExpiresAt) ? parsed.tokenExpiresAt : 0,
    };
  } catch {
    return null;
  }
}

function isStoredCredential(value) {
  return (
    isPlainObject(value) &&
    value.origin === BIGMAN_WEB_ORIGIN &&
    typeof value.token === "string" &&
    decodeSessionToken(value.token) !== null &&
    isTimestamp(value.expiresAt) &&
    isPlainObject(value.device) &&
    typeof value.device.id === "string" &&
    value.device.id.length >= 8 &&
    isPlainObject(value.account) &&
    typeof value.account.id === "string" &&
    value.account.id.length >= 8 &&
    typeof value.account.email === "string" &&
    value.account.email.includes("@")
  );
}

function normalizeServerOrigin(server) {
  if (typeof server?.origin === "string" && server.origin.startsWith("https://")) {
    try {
      return new URL(server.origin).origin;
    } catch {}
  }
  if (typeof server?.domain === "string" && server.domain.trim()) {
    try {
      return new URL(`https://${server.domain.trim()}`).origin;
    } catch {}
  }
  if (typeof server?.subdomain === "string" && server.subdomain.trim()) {
    try {
      return new URL(`https://${server.subdomain.trim()}.bigmanbot.com`).origin;
    } catch {}
  }
  return null;
}

function normalizeBigmanServers(servers, orders) {
  const list = [];
  const seenIds = new Set();
  if (Array.isArray(servers)) {
    for (const srv of servers) {
      if (!isPlainObject(srv) || !srv.id) continue;
      const id = String(srv.id);
      seenIds.add(id);
      const origin = normalizeServerOrigin(srv);
      const isReady = srv.status === "active" && srv.bootstrap_status === "ready" && Boolean(origin);
      const status = isReady
        ? "ready"
        : srv.status === "suspended" || srv.power_status === "stopped"
          ? "stopped"
          : srv.status === "failed" || srv.bootstrap_status === "failed"
            ? "failed"
            : "provisioning";
      const domain =
        typeof srv.domain === "string" && srv.domain.trim()
          ? srv.domain.trim()
          : typeof srv.subdomain === "string" && srv.subdomain.trim()
            ? `${srv.subdomain.trim()}.bigmanbot.com`
            : origin
              ? new URL(origin).host
              : null;
      const expiresAt = typeof srv.date_end === "string" && Number.isFinite(Date.parse(srv.date_end)) ? Date.parse(srv.date_end) : null;
      list.push({
        id,
        name: (typeof srv.name === "string" && srv.name.trim()) || (typeof srv.subdomain === "string" && srv.subdomain.trim()) || "Bigman Cloud",
        planCode: (typeof srv.plan_code === "string" && srv.plan_code.trim().toLowerCase()) || "pro",
        domain,
        origin,
        ipAddress: typeof srv.ip_address === "string" && srv.ip_address.trim() ? srv.ip_address.trim() : null,
        status,
        rawStatus: typeof srv.status === "string" ? srv.status : "provisioning",
        bootstrapStatus: typeof srv.bootstrap_status === "string" ? srv.bootstrap_status : "pending",
        expiresAt,
      });
    }
  }
  if (Array.isArray(orders)) {
    for (const ord of orders) {
      if (!isPlainObject(ord) || !ord.id) continue;
      if (ord.server_id && seenIds.has(String(ord.server_id))) continue;
      if (!["pending_setup", "provisioning"].includes(ord.status)) continue;
      const subdomain = typeof ord.subdomain === "string" && ord.subdomain.trim() ? ord.subdomain.trim() : null;
      list.push({
        id: String(ord.server_id || ord.id),
        name: (typeof ord.cloud_name === "string" && ord.cloud_name.trim()) || subdomain || (typeof ord.plan_name === "string" && ord.plan_name.trim()) || "Bigman Cloud",
        planCode: (typeof ord.tier === "string" && ord.tier.trim().toLowerCase()) || "pro",
        domain: subdomain ? `${subdomain}.bigmanbot.com` : null,
        origin: subdomain ? `https://${subdomain}.bigmanbot.com` : null,
        ipAddress: null,
        status: "provisioning",
        rawStatus: ord.status,
        bootstrapStatus: typeof ord.step === "string" ? ord.step : "pending",
        expiresAt: null,
      });
    }
  }
  return list;
}

export function createBigmanCloudAccountClient({
  store,
  openBrowser,
  openAuthWindow = null,
  fetch = globalThis.fetch,
  now = () => Date.now(),
  onState = () => {},
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let currentState = { status: "signed-out", message: "restoring" };
  let storedCredential = null;
  let lastVerifiedSnapshot = null;
  let syncTimer = null;
  let closed = false;
  let activeAuthAbort = null;

  function clock() {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  }

  function publish(next) {
    currentState = next;
    if (!closed) {
      try {
        onState(currentState);
      } catch {}
    }
    return currentState;
  }

  function clearSyncTimer() {
    if (syncTimer) {
      clearTimer(syncTimer);
      syncTimer = null;
    }
  }

  function scheduleSync(delayMs = SYNC_INTERVAL_MS) {
    clearSyncTimer();
    if (closed || !storedCredential) return;
    syncTimer = setTimer(() => {
      syncTimer = null;
      void synchronize().catch(() => {});
    }, delayMs);
    syncTimer?.unref?.();
  }

  function supabaseHeaders(accessToken) {
    return {
      apikey: BIGMAN_SUPABASE_ANON_KEY,
      authorization: `Bearer ${accessToken || BIGMAN_SUPABASE_ANON_KEY}`,
      accept: "application/json",
      "content-type": "application/json",
    };
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { ok: response.ok, status: response.status, body };
  }

  async function saveSupabaseSession({ accessToken, refreshToken, expiresIn, user, deviceId }) {
    const nowMs = clock();
    const tokenExpiresAt = nowMs + (typeof expiresIn === "number" && expiresIn > 0 ? expiresIn * 1_000 : 3600_000);
    const credential = {
      origin: BIGMAN_WEB_ORIGIN,
      token: encodeSessionToken({ accessToken, refreshToken, tokenExpiresAt }),
      expiresAt: nowMs + SESSION_LIFETIME_MS,
      device: {
        id: deviceId || storedCredential?.device?.id || `dev_${randomBytes(12).toString("base64url")}`,
      },
      account: {
        id: String(user.id),
        email: String(user.email || "").trim().toLowerCase(),
      },
    };
    await store.write(credential);
    storedCredential = credential;
    return credential;
  }

  async function refreshSupabaseToken(decoded) {
    if (!decoded?.refreshToken) return null;
    const { ok, status, body } = await requestJson(`${BIGMAN_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: supabaseHeaders(null),
      body: JSON.stringify({ refresh_token: decoded.refreshToken }),
    });
    if (!ok || !isPlainObject(body) || typeof body.access_token !== "string") {
      if (status === 400 || status === 401 || status === 403) {
        return { expired: true };
      }
      return null;
    }
    const user = isPlainObject(body.user) && body.user.id ? body.user : storedCredential?.account;
    if (!user?.id) return null;
    await saveSupabaseSession({
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : decoded.refreshToken,
      expiresIn: body.expires_in,
      user,
      deviceId: storedCredential?.device?.id,
    });
    return {
      accessToken: body.access_token,
      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : decoded.refreshToken,
      user,
    };
  }

  async function ensureValidAccessToken() {
    if (!storedCredential) return null;
    const decoded = decodeSessionToken(storedCredential.token);
    if (!decoded) return null;
    if (decoded.tokenExpiresAt && decoded.tokenExpiresAt - clock() < REFRESH_MARGIN_MS && decoded.refreshToken) {
      const refreshed = await refreshSupabaseToken(decoded);
      if (refreshed?.expired) return { expired: true };
      if (refreshed?.accessToken) return { accessToken: refreshed.accessToken, decoded };
    }
    return { accessToken: decoded.accessToken, decoded };
  }

  async function synchronize() {
    if (!storedCredential) {
      clearSyncTimer();
      return publish({ status: "signed-out" });
    }
    try {
      let tokenInfo = await ensureValidAccessToken();
      if (!tokenInfo) {
        return publish({ status: "signed-out" });
      }
      if (tokenInfo.expired) {
        clearSyncTimer();
        return publish({
          status: "reauth-required",
          account: storedCredential.account,
          deviceId: storedCredential.device.id,
          ...(lastVerifiedSnapshot?.lastPlan ? { lastPlan: lastVerifiedSnapshot.lastPlan } : {}),
          message: "Phiên đăng nhập Bigman Bot đã hết hạn. Vui lòng đăng nhập lại.",
        });
      }

      let accessToken = tokenInfo.accessToken;
      let userRes = await requestJson(`${BIGMAN_SUPABASE_URL}/auth/v1/user`, {
        method: "GET",
        headers: supabaseHeaders(accessToken),
      });

      if ((userRes.status === 401 || userRes.status === 403) && tokenInfo.decoded?.refreshToken) {
        const refreshed = await refreshSupabaseToken(tokenInfo.decoded);
        if (refreshed?.accessToken) {
          accessToken = refreshed.accessToken;
          userRes = await requestJson(`${BIGMAN_SUPABASE_URL}/auth/v1/user`, {
            method: "GET",
            headers: supabaseHeaders(accessToken),
          });
        } else if (refreshed?.expired) {
          clearSyncTimer();
          return publish({
            status: "reauth-required",
            account: storedCredential.account,
            deviceId: storedCredential.device.id,
            ...(lastVerifiedSnapshot?.lastPlan ? { lastPlan: lastVerifiedSnapshot.lastPlan } : {}),
            message: "Phiên đăng nhập Bigman Bot đã hết hạn. Vui lòng đăng nhập lại.",
          });
        }
      }

      if (!userRes.ok || !isPlainObject(userRes.body) || typeof userRes.body.id !== "string") {
        if (userRes.status === 401 || userRes.status === 403) {
          clearSyncTimer();
          return publish({
            status: "reauth-required",
            account: storedCredential.account,
            deviceId: storedCredential.device.id,
            ...(lastVerifiedSnapshot?.lastPlan ? { lastPlan: lastVerifiedSnapshot.lastPlan } : {}),
            message: "Phiên đăng nhập Bigman Bot đã hết hạn. Vui lòng đăng nhập lại.",
          });
        }
        throw new Error(`HTTP ${userRes.status}`);
      }

      const uid = userRes.body.id;
      const email = String(userRes.body.email || storedCredential.account.email).trim().toLowerCase();
      const account = { id: uid, email };

      const [subRes, roleRes, serversRes, ordersRes] = await Promise.all([
        requestJson(
          `${BIGMAN_SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${encodeURIComponent(uid)}&select=plan_code,status,billing_cycle,started_at,expires_at`,
          { method: "GET", headers: supabaseHeaders(accessToken) },
        ).catch(() => ({ ok: false, body: null })),
        requestJson(
          `${BIGMAN_SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(uid)}&select=role`,
          { method: "GET", headers: supabaseHeaders(accessToken) },
        ).catch(() => ({ ok: false, body: null })),
        requestJson(
          `${BIGMAN_SUPABASE_URL}/rest/v1/cloud_servers?user_id=eq.${encodeURIComponent(uid)}&status=neq.deleted&select=id,order_id,vps_id,plan_code,name,subdomain,domain,origin,ip_address,status,power_status,bootstrap_status,date_end,sandbox,created_at&order=created_at.desc`,
          { method: "GET", headers: supabaseHeaders(accessToken) },
        ).catch(() => ({ ok: false, body: null })),
        requestJson(
          `${BIGMAN_SUPABASE_URL}/rest/v1/orders?user_id=eq.${encodeURIComponent(uid)}&status=in.(pending_setup,provisioning,ready)&select=id,order_code,server_id,tier,plan_name,status,step,cloud_name,subdomain,vps_info,created_at&order=created_at.desc`,
          { method: "GET", headers: supabaseHeaders(accessToken) },
        ).catch(() => ({ ok: false, body: null })),
      ]);

      const roles = Array.isArray(roleRes.body) ? roleRes.body : [];
      const isAdmin = roles.some(r => r?.role === "admin");
      const sub = Array.isArray(subRes.body) && subRes.body.length > 0 ? subRes.body[0] : null;
      const bigmanServers = normalizeBigmanServers(serversRes.body, ordersRes.body);

      let paidTier = null;
      let paidActive = false;
      let paidExpiresAt = null;

      if (isAdmin) {
        paidTier = "enterprise";
        paidActive = true;
      } else if (sub && typeof sub.plan_code === "string" && sub.plan_code !== "community") {
        const subExp = typeof sub.expires_at === "string" && Number.isFinite(Date.parse(sub.expires_at)) ? Date.parse(sub.expires_at) : null;
        const notExpired = !subExp || subExp > clock();
        if ((sub.status === "active" || sub.status === "trial") && notExpired) {
          paidTier = sub.plan_code.toLowerCase();
          paidActive = true;
          paidExpiresAt = subExp;
        }
      }

      if (!paidActive && bigmanServers.length > 0) {
        const activeServer = bigmanServers.find(s => s.status === "ready" || s.status === "provisioning") ?? bigmanServers[0];
        if (activeServer) {
          paidTier = activeServer.planCode || "pro";
          paidActive = activeServer.status === "ready" || activeServer.status === "provisioning";
          paidExpiresAt = activeServer.expiresAt;
        }
      }

      const entitlement = paidActive
        ? {
            plan: "pro",
            tier: paidTier || "pro",
            status: "active",
            expiresAt: paidExpiresAt,
            version: 1,
          }
        : {
            plan: "free",
            ...(paidTier ? { tier: paidTier } : {}),
            status: "inactive",
            expiresAt: paidExpiresAt,
            version: 1,
          };

      const primaryServer = bigmanServers.find(s => s.status === "ready" && s.origin) ?? bigmanServers[0] ?? null;
      const machine = primaryServer
        ? primaryServer.status === "ready" && primaryServer.origin
          ? { status: "ready", origin: primaryServer.origin }
          : primaryServer.status === "stopped"
            ? { status: "stopped", ...(primaryServer.origin ? { origin: primaryServer.origin } : {}) }
            : primaryServer.status === "failed"
              ? { status: "failed" }
              : { status: "provisioning", setup: { step: "starting", slow: false } }
        : undefined;

      const clouds = bigmanServers.map((srv, index) => ({
        id: srv.id,
        kind: index === 0 ? "personal" : "own",
        name: srv.name,
        color: null,
        role: "owner",
        tier: srv.planCode,
        status: srv.status,
        ...(srv.status === "ready" && srv.origin ? { origin: srv.origin } : {}),
        ...(index > 0 ? { removable: false } : {}),
      }));

      const verifiedAt = clock();
      const verifiedUntil = verifiedAt + 15 * 60_000;
      const lastPlan = entitlement.plan === "pro" ? { ...(entitlement.tier ? { tier: entitlement.tier } : {}), active: entitlement.status === "active" } : undefined;

      lastVerifiedSnapshot = {
        account,
        deviceId: storedCredential.device.id,
        expiresAt: storedCredential.expiresAt,
        entitlement,
        verifiedAt,
        verifiedUntil,
        ...(lastPlan ? { lastPlan } : {}),
        ...(machine ? { machine } : {}),
        ...(clouds.length > 0 ? { clouds } : {}),
        bigmanServers,
      };

      scheduleSync(SYNC_INTERVAL_MS);
      return publish({
        status: "connected",
        ...lastVerifiedSnapshot,
      });
    } catch {
      scheduleSync(60_000);
      if (lastVerifiedSnapshot && lastVerifiedSnapshot.verifiedUntil > clock()) {
        return publish({
          status: "connected",
          ...lastVerifiedSnapshot,
          checking: true,
        });
      }
      return publish({
        status: "unavailable",
        account: storedCredential?.account,
        deviceId: storedCredential?.device?.id,
        expiresAt: storedCredential?.expiresAt,
        ...(lastVerifiedSnapshot?.lastPlan ? { lastPlan: lastVerifiedSnapshot.lastPlan } : {}),
        message: "Không thể kết nối tới máy chủ Bigman Bot lúc này. Vui lòng kiểm tra mạng và thử lại.",
      });
    }
  }

  async function start() {
    try {
      const saved = await store.read();
      if (!isStoredCredential(saved)) {
        if (saved !== null && saved !== undefined) {
          await store.write(null).catch(() => {});
        }
        storedCredential = null;
        return publish({ status: "signed-out" });
      }
      storedCredential = saved;
      return await synchronize();
    } catch {
      storedCredential = null;
      return publish({ status: "signed-out" });
    }
  }

  async function signInPassword(rawEmail, rawPassword) {
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const password = typeof rawPassword === "string" ? rawPassword : "";
    if (!email || !email.includes("@")) {
      return { outcome: "invalid-email", message: "Vui lòng nhập địa chỉ email hợp lệ." };
    }
    if (!password) {
      return { outcome: "invalid-credentials", message: "Vui lòng nhập mật khẩu." };
    }
    try {
      const { ok, status, body } = await requestJson(`${BIGMAN_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: supabaseHeaders(null),
        body: JSON.stringify({ email, password }),
      });
      if (!ok || !isPlainObject(body) || typeof body.access_token !== "string" || !isPlainObject(body.user)) {
        if (status === 429) {
          return { outcome: "rate-limited", message: "Bạn đã thử quá nhiều lần. Vui lòng đợi một lát rồi thử lại." };
        }
        const errorCode = body?.error_code || body?.error || "";
        if (status === 400 || errorCode === "invalid_credentials") {
          return { outcome: "invalid-credentials", message: "Email hoặc mật khẩu không chính xác." };
        }
        return {
          outcome: "failed",
          message: body?.msg || body?.error_description || body?.message || "Không thể đăng nhập lúc này.",
        };
      }
      await saveSupabaseSession({
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresIn: body.expires_in,
        user: body.user,
      });
      const state = await synchronize();
      return { outcome: "signed-in", state };
    } catch {
      return { outcome: "failed", message: "Không thể kết nối tới Bigman Bot. Vui lòng kiểm tra mạng và thử lại." };
    }
  }

  async function begin(options = {}) {
    if (activeAuthAbort) {
      try {
        activeAuthAbort();
      } catch {}
      activeAuthAbort = null;
    }

    const googleAuthUrl = `${BIGMAN_SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(`${BIGMAN_WEB_ORIGIN}/`)}`;
    const targetUrl = options?.mode === "web" ? `${BIGMAN_WEB_ORIGIN}/login` : googleAuthUrl;

    if (typeof openAuthWindow !== "function") {
      await openBrowser(targetUrl);
      return currentState;
    }

    const previousState = currentState;
    const connectingState = publish({
      status: "connecting",
      enrollment: {
        userCode: "BIGMAN",
        expiresAt: clock() + 10 * 60_000,
      },
    });

    void (async () => {
      try {
        const sessionTokens = await openAuthWindow({
          url: targetUrl,
          onAbort: abortFn => {
            activeAuthAbort = abortFn;
          },
        });
        activeAuthAbort = null;
        if (closed) return;
        if (!sessionTokens || typeof sessionTokens.accessToken !== "string") {
          if (currentState.status === "connecting") {
            publish(storedCredential ? previousState : { status: "signed-out" });
          }
          return;
        }

        const userRes = await requestJson(`${BIGMAN_SUPABASE_URL}/auth/v1/user`, {
          method: "GET",
          headers: supabaseHeaders(sessionTokens.accessToken),
        });
        if (!userRes.ok || !isPlainObject(userRes.body) || typeof userRes.body.id !== "string") {
          publish({
            status: storedCredential ? "unavailable" : "signed-out",
            message: "Không thể xác thực tài khoản từ phiên đăng nhập.",
          });
          return;
        }

        await saveSupabaseSession({
          accessToken: sessionTokens.accessToken,
          refreshToken: sessionTokens.refreshToken || "",
          expiresIn: sessionTokens.expiresIn || 3600,
          user: userRes.body,
        });
        await synchronize();
      } catch {
        activeAuthAbort = null;
        if (!closed && currentState.status === "connecting") {
          publish(storedCredential ? previousState : { status: "signed-out" });
        }
      }
    })();

    return connectingState;
  }

  async function signInAgain() {
    storedCredential = null;
    lastVerifiedSnapshot = null;
    await store.write(null).catch(() => {});
    return begin();
  }

  async function reopen() {
    return begin();
  }

  async function cancel() {
    if (activeAuthAbort) {
      try {
        activeAuthAbort();
      } catch {}
      activeAuthAbort = null;
    }
    return publish(storedCredential && lastVerifiedSnapshot ? { status: "connected", ...lastVerifiedSnapshot } : { status: "signed-out" });
  }

  async function refresh() {
    if (!storedCredential) return publish({ status: "signed-out" });
    return synchronize();
  }

  async function signOut() {
    clearSyncTimer();
    if (activeAuthAbort) {
      try {
        activeAuthAbort();
      } catch {}
      activeAuthAbort = null;
    }
    const current = storedCredential;
    storedCredential = null;
    lastVerifiedSnapshot = null;
    await store.write(null).catch(() => {});
    if (current) {
      const decoded = decodeSessionToken(current.token);
      if (decoded?.accessToken) {
        void requestJson(`${BIGMAN_SUPABASE_URL}/auth/v1/logout`, {
          method: "POST",
          headers: supabaseHeaders(decoded.accessToken),
        }).catch(() => {});
      }
    }
    return publish({ status: "signed-out" });
  }

  async function openDashboard() {
    await openBrowser(`${BIGMAN_WEB_ORIGIN}/pricing`);
    return currentState;
  }

  async function pairHome(cloudId = null) {
    if (!storedCredential) throw new Error("Vui lòng đăng nhập tài khoản Bigman Bot trước.");
    const tokenInfo = await ensureValidAccessToken();
    if (!tokenInfo?.accessToken) throw new Error("Phiên đăng nhập Bigman Bot đã hết hạn. Vui lòng đăng nhập lại.");

    const servers = currentState.bigmanServers ?? lastVerifiedSnapshot?.bigmanServers ?? [];
    const targetServer = cloudId
      ? servers.find(s => s.id === cloudId)
      : servers.find(s => s.status === "ready") ?? servers[0] ?? null;

    if (!targetServer?.id) {
      throw new Error("Tài khoản của bạn chưa có máy chủ Bigman Cloud nào sẵn sàng.");
    }

    const { ok, body } = await requestJson(`${BIGMAN_SUPABASE_URL}/functions/v1/vpsmmo-proxy`, {
      method: "POST",
      headers: supabaseHeaders(tokenInfo.accessToken),
      body: JSON.stringify({
        provider: "mint_pairing",
        serverId: targetServer.id,
      }),
    });

    if (!ok || !isPlainObject(body) || body.status !== "success" || typeof body.code !== "string" || typeof body.origin !== "string") {
      throw new Error(body?.message || "Không thể lấy mã ghép nối tự động từ Bigman Cloud.");
    }

    const cleanCode = body.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const expiresAt = typeof body.expiresAt === "number" && Number.isFinite(body.expiresAt)
      ? body.expiresAt
      : typeof body.expiresAt === "string" && Number.isFinite(Date.parse(body.expiresAt))
        ? Date.parse(body.expiresAt)
        : clock() + 5 * 60_000;

    return {
      origin: new URL(body.origin).origin,
      code: cleanCode,
      expiresAt,
    };
  }

  function homeTarget() {
    if (currentState.status !== "connected") return null;
    const origin = currentState.machine?.status === "ready" ? currentState.machine.origin : null;
    return origin ? { origin } : null;
  }

  function isOwnCloud(origin) {
    if (!origin || currentState.status !== "connected") return false;
    if (currentState.machine?.status === "ready" && currentState.machine.origin === origin) return true;
    const servers = currentState.bigmanServers ?? [];
    return servers.some(s => s.origin === origin);
  }

  function quiesce() {
    clearSyncTimer();
  }

  async function reload() {
    clearSyncTimer();
    storedCredential = null;
    lastVerifiedSnapshot = null;
    return start();
  }

  async function revokeSaved(record) {
    if (!isStoredCredential(record)) return;
    const decoded = decodeSessionToken(record.token);
    if (!decoded?.accessToken) return;
    await requestJson(`${BIGMAN_SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: supabaseHeaders(decoded.accessToken),
    }).catch(() => {});
  }

  function close() {
    closed = true;
    clearSyncTimer();
    if (activeAuthAbort) {
      try {
        activeAuthAbort();
      } catch {}
      activeAuthAbort = null;
    }
  }

  return {
    state: () => currentState,
    start,
    begin,
    signInPassword,
    signInGoogle: () => begin({ mode: "google" }),
    signInAgain,
    reopen,
    cancel,
    refresh,
    signOut,
    openDashboard,
    offer: async () => null,
    checkout: async () => {
      await openBrowser(`${BIGMAN_WEB_ORIGIN}/pricing`);
      return { outcome: "opened", state: currentState };
    },
    emailStart: async () => ({ outcome: "browser" }),
    emailVerify: async () => ({ outcome: "failed" }),
    emailCancel: () => {},
    reopenCheckout: async () => {
      await openBrowser(`${BIGMAN_WEB_ORIGIN}/pricing`);
      return { outcome: "opened", state: currentState };
    },
    checkoutLink: () => `${BIGMAN_WEB_ORIGIN}/pricing`,
    checkoutDone: () => {},
    checkoutPending: () => false,
    interest: async () => {},
    upgradePreview: async () => ({ outcome: "browser" }),
    upgrade: async () => ({ outcome: "failed" }),
    cancelPlan: async () => {
      await openBrowser(`${BIGMAN_WEB_ORIGIN}/pricing`);
      return { outcome: "browser" };
    },
    keepPlan: async () => ({ outcome: "kept", state: currentState }),
    roomNotNow: async () => false,
    restartNow: async () => "failed",
    homeTarget,
    power: () => null,
    wakeHome: async () => "awake",
    setWaking: () => {},
    pairHome,
    isOwnCloud,
    addCloud: async () => {
      await openBrowser(`${BIGMAN_WEB_ORIGIN}/pricing`);
      return { outcome: "opened", state: currentState };
    },
    addOrganization: async () => ({ outcome: "unsupported" }),
    setCloudColor: async () => ({ outcome: "unsupported" }),
    hideCloud: async () => ({ outcome: "unsupported" }),
    reopenAdd: async () => {
      await openBrowser(`${BIGMAN_WEB_ORIGIN}/pricing`);
      return true;
    },
    addLink: () => `${BIGMAN_WEB_ORIGIN}/pricing`,
    addDone: () => {},
    pairTeam: async () => {
      throw new Error("Không hỗ trợ ghép nối nhóm riêng.");
    },
    exportHome: async () => ({ notHeld: true }),
    reportMove: async () => false,
    reportKept: async () => false,
    movedTo: async () => null,
    reportMoveStatus: async () => false,
    growDisk: async () => ({ supported: false }),
    xResearchAccess: async () => null,
    pagesAccess: async () => null,
    updatesConsent: async () => null,
    recordUpdatesConsent: async () => {},
    updatesConsentByEmail: async () => "",
    withdrawUpdatesConsent: async () => {},
    quiesce,
    reload,
    revokeSaved,
    close,
  };
}
