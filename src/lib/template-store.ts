import { useEffect, useState, useCallback } from "react";
import type { MascotBodyId } from "../../shared/mascot-bodies";
import type { BotRoutineTemplate } from "../../shared/new-bot-defaults";
import type { MausColor } from "../../shared/wire";
import { openExternalLink } from "./app-links";
import { registerRemoteReadyBot, READY_BOT_CATEGORIES, type ReadyBot, type ReadyBotCategory } from "./ready-bots";

export const BIGMAN_WEB_ORIGIN = "https://bigmanbot.com";
export const BIGMAN_SUPABASE_URL = "https://djokqsynkwoqpfyowbuz.supabase.co";
export const BIGMAN_SUPABASE_ANON_KEY = "sb_publishable_Sl17AdoCGFrcrnrZ0E9yqQ_b8HpCs8f";

const SESSION_STORAGE_KEY = "bigman_template_session_v1";

export interface StoredTemplateSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email: string;
}

export interface RemoteTemplateCatalogEntry {
  id: string;
  kind: "bot" | "department";
  isPaid: boolean;
  priceVnd: number;
  category: ReadyBotCategory;
  name: string;
  title: string;
  description: string;
  tryAsking: string[];
  look: { color: MausColor; mascotBody: MascotBodyId };
  apps: string[];
  hasPausedRoutine: boolean;
  membersCount: number;
  skillsCount: number;
  setupMinutes: number | null;
  previewDetails: Record<string, unknown> | null;
  isFeatured: boolean;
  sortOrder: number;
}

export interface RemoteTemplatePayload {
  templateId: string;
  soul: string;
  notes: Record<string, string>;
  routines: BotRoutineTemplate[];
  packageManifest: unknown;
}

function randomHex(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function supabaseHeaders(accessToken?: string | null): Record<string, string> {
  return {
    apikey: BIGMAN_SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || BIGMAN_SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export function readStoredTemplateSession(): StoredTemplateSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTemplateSession>;
    if (
      !parsed ||
      typeof parsed.accessToken !== "string" ||
      !parsed.accessToken ||
      typeof parsed.email !== "string"
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === "string" ? parsed.refreshToken : "",
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : Date.now() + 3600_000,
      userId: typeof parsed.userId === "string" ? parsed.userId : "",
      email: parsed.email.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export function writeStoredTemplateSession(session: StoredTemplateSession | null): void {
  try {
    if (!session) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } else {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    }
    window.dispatchEvent(new Event("bigman-template-session-changed"));
  } catch {
    // ignore storage errors
  }
}

export async function ensureValidTemplateToken(): Promise<StoredTemplateSession | null> {
  const current = readStoredTemplateSession();
  if (!current) return null;
  if (current.expiresAt - Date.now() > 90_000 || !current.refreshToken) {
    return current;
  }
  try {
    const res = await fetch(`${BIGMAN_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: supabaseHeaders(null),
      body: JSON.stringify({ refresh_token: current.refreshToken }),
    });
    if (!res.ok) return current;
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      user?: { id?: string; email?: string };
    };
    if (typeof data?.access_token !== "string") return current;
    const next: StoredTemplateSession = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || current.refreshToken,
      expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
      userId: data.user?.id || current.userId,
      email: (data.user?.email || current.email).toLowerCase(),
    };
    writeStoredTemplateSession(next);
    return next;
  } catch {
    return current;
  }
}

function normalizeCategory(raw: unknown): ReadyBotCategory {
  const s = typeof raw === "string" ? (raw as ReadyBotCategory) : "work";
  return READY_BOT_CATEGORIES.includes(s) ? s : "work";
}

function mapCatalogRow(r: Record<string, unknown>): RemoteTemplateCatalogEntry {
  const lookObj =
    r.look && typeof r.look === "object" ? (r.look as Record<string, unknown>) : {};
  const tryArr = Array.isArray(r.try_asking)
    ? r.try_asking.map((x) => String(x || "")).filter(Boolean)
    : [];
  const appsArr = Array.isArray(r.apps)
    ? r.apps.map((x) => String(x || "")).filter(Boolean)
    : [];

  return {
    id: String(r.id || ""),
    kind: r.kind === "department" ? "department" : "bot",
    isPaid: Boolean(r.is_paid),
    priceVnd: Number(r.price_vnd || 0),
    category: normalizeCategory(r.category),
    name: String(r.name || ""),
    title: String(r.title || ""),
    description: String(r.description || ""),
    tryAsking: tryArr.length > 0 ? tryArr : [String(r.description || r.name || "")],
    look: {
      color: (typeof lookObj.color === "string" ? lookObj.color : "orange") as MausColor,
      mascotBody: (typeof lookObj.mascotBody === "string"
        ? lookObj.mascotBody
        : "star") as MascotBodyId,
    },
    apps: appsArr,
    hasPausedRoutine: Boolean(r.has_paused_routine),
    membersCount: Number(r.members_count || 1),
    skillsCount: Number(r.skills_count || 0),
    setupMinutes: r.setup_minutes != null ? Number(r.setup_minutes) : null,
    previewDetails:
      r.preview_details && typeof r.preview_details === "object"
        ? (r.preview_details as Record<string, unknown>)
        : null,
    isFeatured: Boolean(r.is_featured),
    sortOrder: Number(r.sort_order ?? 0),
  };
}

export async function fetchRemoteTemplateCatalog(): Promise<RemoteTemplateCatalogEntry[]> {
  try {
    const res = await fetch(
      `${BIGMAN_SUPABASE_URL}/rest/v1/template_catalog?is_active=eq.true&select=*&order=sort_order.asc,created_at.desc`,
      { method: "GET", headers: supabaseHeaders(null) }
    );
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object" && (r as { id?: unknown }).id))
      .map(mapCatalogRow);
  } catch {
    return [];
  }
}

export async function fetchUnlockedTemplateIds(
  accessToken?: string | null
): Promise<Set<string>> {
  const token = accessToken || (await ensureValidTemplateToken())?.accessToken;
  if (!token) return new Set();
  try {
    const res = await fetch(
      `${BIGMAN_SUPABASE_URL}/rest/v1/user_template_unlocks?select=template_id`,
      { method: "GET", headers: supabaseHeaders(token) }
    );
    if (!res.ok) return new Set();
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return new Set();
    const ids = new Set<string>();
    for (const r of rows) {
      if (r && typeof r === "object" && typeof (r as { template_id?: unknown }).template_id === "string") {
        ids.add((r as { template_id: string }).template_id);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

export async function fetchTemplatePayload(
  templateId: string
): Promise<RemoteTemplatePayload | null> {
  const session = await ensureValidTemplateToken();
  try {
    const res = await fetch(
      `${BIGMAN_SUPABASE_URL}/rest/v1/template_payloads?template_id=eq.${encodeURIComponent(
        templateId
      )}&select=*&limit=1`,
      { method: "GET", headers: supabaseHeaders(session?.accessToken) }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const row = rows[0] as Record<string, unknown>;
    return {
      templateId: String(row.template_id || templateId),
      soul: String(row.soul || ""),
      notes:
        row.notes && typeof row.notes === "object" && !Array.isArray(row.notes)
          ? (row.notes as Record<string, string>)
          : {},
      routines: Array.isArray(row.routines) ? (row.routines as BotRoutineTemplate[]) : [],
      packageManifest: row.package_manifest ?? null,
    };
  } catch {
    return null;
  }
}

export function toReadyBot(
  entry: RemoteTemplateCatalogEntry,
  payload?: RemoteTemplatePayload | null
): ReadyBot {
  return {
    id: entry.id,
    category: entry.category,
    name: entry.name,
    title: entry.title,
    description: entry.description,
    soul: payload?.soul || entry.description,
    look: entry.look,
    tryAsking: entry.tryAsking.length > 0 ? entry.tryAsking : [entry.description],
    apps: entry.apps,
    ...(payload?.notes && Object.keys(payload.notes).length > 0 ? { notes: payload.notes } : {}),
    ...(payload?.routines && payload.routines.length > 0 ? { routines: payload.routines } : {}),
  };
}

let activePollTimer: ReturnType<typeof setInterval> | null = null;

export async function openWebAuthOrTemplateCheckout(options?: {
  buyTemplateId?: string;
  onCompleted?: () => void;
}): Promise<void> {
  if (activePollTimer) {
    clearInterval(activePollTimer);
    activePollTimer = null;
  }

  const buyId = options?.buyTemplateId?.trim() || "";
  const sessionId = `bmb_sess_${randomHex(16)}`;
  const pollSecret = randomHex(24);
  const pollSecretHash = await sha256Hex(pollSecret);

  let sessionCreated = false;
  try {
    const res = await fetch(`${BIGMAN_SUPABASE_URL}/rest/v1/rpc/create_app_auth_session`, {
      method: "POST",
      headers: supabaseHeaders(null),
      body: JSON.stringify({
        p_session_id: sessionId,
        p_poll_secret_hash: pollSecretHash,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { ok?: boolean };
      sessionCreated = Boolean(data?.ok);
    }
  } catch {
    sessionCreated = false;
  }

  const existingSession = await ensureValidTemplateToken();
  const params = new URLSearchParams();
  if (sessionCreated) params.set("app_session", sessionId);
  if (buyId) params.set("buy", buyId);

  const targetUrl =
    existingSession && buyId
      ? `${BIGMAN_WEB_ORIGIN}/templates?${params.toString()}`
      : `${BIGMAN_WEB_ORIGIN}/login?${params.toString()}`;

  await openExternalLink(targetUrl);

  const startedAt = Date.now();
  activePollTimer = setInterval(async () => {
    if (Date.now() - startedAt > 10 * 60_000) {
      if (activePollTimer) clearInterval(activePollTimer);
      activePollTimer = null;
      return;
    }

    if (sessionCreated) {
      try {
        const pollRes = await fetch(
          `${BIGMAN_SUPABASE_URL}/rest/v1/rpc/consume_app_auth_session`,
          {
            method: "POST",
            headers: supabaseHeaders(null),
            body: JSON.stringify({
              p_session_id: sessionId,
              p_poll_secret: pollSecret,
            }),
          }
        );
        if (pollRes.ok) {
          const body = (await pollRes.json()) as {
            status?: string;
            accessToken?: string;
            refreshToken?: string;
            expiresIn?: number;
            userId?: string;
            email?: string;
          };
          if (body?.status === "completed" && typeof body.accessToken === "string") {
            sessionCreated = false;
            writeStoredTemplateSession({
              accessToken: body.accessToken,
              refreshToken: body.refreshToken || "",
              expiresAt: Date.now() + Number(body.expiresIn || 3600) * 1000,
              userId: body.userId || "",
              email: (body.email || "").toLowerCase(),
            });
            options?.onCompleted?.();
            if (!buyId && activePollTimer) {
              clearInterval(activePollTimer);
              activePollTimer = null;
              return;
            }
          }
        }
      } catch {
        // ignore poll error
      }
    }

    if (buyId) {
      const unlocked = await fetchUnlockedTemplateIds();
      if (unlocked.has(buyId)) {
        if (activePollTimer) clearInterval(activePollTimer);
        activePollTimer = null;
        window.dispatchEvent(new Event("bigman-template-session-changed"));
        options?.onCompleted?.();
      }
    }
  }, 2500);
}

export function useRemoteTemplateMarketplace() {
  const isTest = import.meta.env?.MODE === "test";
  const [entries, setEntries] = useState<RemoteTemplateCatalogEntry[]>([]);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<StoredTemplateSession | null>(() =>
    isTest ? null : readStoredTemplateSession()
  );
  const [desktopEmail, setDesktopEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (isTest) return;
    setLoading(true);
    try {
      const [cat, curSession] = await Promise.all([
        fetchRemoteTemplateCatalog(),
        ensureValidTemplateToken(),
      ]);
      setSession(curSession);
      setEntries(cat);
      for (const item of cat) {
        if (item.kind === "bot") {
          registerRemoteReadyBot(toReadyBot(item, null));
        }
      }
      if (curSession) {
        const unl = await fetchUnlockedTemplateIds(curSession.accessToken);
        setUnlockedIds(unl);
      } else {
        setUnlockedIds(new Set());
      }
    } finally {
      setLoading(false);
    }
  }, [isTest]);

  useEffect(() => {
    if (isTest) return;
    void reload();
    const onChanged = () => void reload();
    const onFocus = () => void reload();
    window.addEventListener("bigman-template-session-changed", onChanged);
    window.addEventListener("focus", onFocus);

    const bridge = window.ogb?.cloudAccount;
    let unsub: (() => void) | undefined;
    if (bridge?.onState) {
      unsub = bridge.onState((next) => {
        const email = next.status === "connected" ? next.account?.email ?? null : null;
        setDesktopEmail(email);
        void reload();
      });
      void bridge
        .state()
        .then((next) => {
          const email = next.status === "connected" ? next.account?.email ?? null : null;
          setDesktopEmail(email);
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener("bigman-template-session-changed", onChanged);
      window.removeEventListener("focus", onFocus);
      unsub?.();
    };
  }, [isTest, reload]);

  const activeEmail = session?.email || desktopEmail || null;

  return {
    entries,
    botEntries: entries.filter((e) => e.kind === "bot"),
    departmentEntries: entries.filter((e) => e.kind === "department"),
    unlockedIds,
    session,
    activeEmail,
    loading,
    reload,
  };
}
