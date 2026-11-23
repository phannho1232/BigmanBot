// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readyBot, registerRemoteReadyBot } from "./ready-bots";
import {
  BIGMAN_SUPABASE_URL,
  fetchRemoteTemplateCatalog,
  fetchTemplatePayload,
  fetchUnlockedTemplateIds,
  readStoredTemplateSession,
  toReadyBot,
  writeStoredTemplateSession,
} from "./template-store";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("template-store", () => {
  it("persists and reads the template auth session in localStorage", () => {
    expect(readStoredTemplateSession()).toBeNull();
    writeStoredTemplateSession({
      accessToken: "jwt-123",
      refreshToken: "ref-123",
      expiresAt: 1_900_000_000_000,
      userId: "user-1",
      email: "VIP@BIGMANBOT.COM",
    });
    const read = readStoredTemplateSession();
    expect(read?.accessToken).toBe("jwt-123");
    expect(read?.email).toBe("vip@bigmanbot.com");
    writeStoredTemplateSession(null);
    expect(readStoredTemplateSession()).toBeNull();
  });

  it("maps remote catalog rows and payloads into ReadyBot entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/template_catalog`)) {
          return new Response(
            JSON.stringify([
              {
                id: "bot-ke-toan-vip",
                kind: "bot",
                is_paid: true,
                price_vnd: 299000,
                category: "work",
                name: "Tax Pro",
                title: "Chuyên gia Kế toán & Thuế",
                description: "Kiểm tra hóa đơn và lập tờ khai thuế.",
                try_asking: ["Rà soát bảng kê hóa đơn đầu vào quý này"],
                look: { color: "teal", mascotBody: "shield" },
                apps: ["gmail"],
                has_paused_routine: true,
                members_count: 1,
                skills_count: 2,
                sort_order: 1,
                is_active: true,
              },
            ]),
            { status: 200 }
          );
        }
        if (url.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/user_template_unlocks`)) {
          return new Response(JSON.stringify([{ template_id: "bot-ke-toan-vip" }]), {
            status: 200,
          });
        }
        if (url.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/template_payloads`)) {
          return new Response(
            JSON.stringify([
              {
                template_id: "bot-ke-toan-vip",
                soul: "Bạn là Kế toán trưởng 15 năm kinh nghiệm.",
                notes: { "MEMORY.md": "- Hồ sơ mã số thuế doanh nghiệp\n" },
                routines: [
                  {
                    name: "Rà soát hóa đơn sáng",
                    prompt: "Kiểm tra hóa đơn đầu vào mới.",
                    schedule: { type: "daily", time: "08:30", weekdays: [1, 2, 3, 4, 5] },
                    enabled: false,
                    overlap: "skip",
                  },
                ],
                package_manifest: {
                  skills: {
                    version: 1,
                    entries: [
                      {
                        name: "vat-audit",
                        description: "Kiểm tra thuế GTGT",
                        instructions: "---\nname: vat-audit\ndescription: Kiểm tra thuế GTGT\n---\n\nĐối chiếu bảng kê.",
                      },
                      {
                        name: "cit-report",
                        description: "Quyết toán thuế TNDN",
                        instructions: "---\nname: cit-report\ndescription: Quyết toán thuế TNDN\n---\n\nLập tờ khai.",
                      },
                    ],
                  },
                },
              },
            ]),
            { status: 200 }
          );
        }
        return new Response("[]", { status: 200 });
      })
    );

    const catalog = await fetchRemoteTemplateCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.id).toBe("bot-ke-toan-vip");
    expect(catalog[0]?.priceVnd).toBe(299000);

    const unlocked = await fetchUnlockedTemplateIds("jwt-token");
    expect(unlocked.has("bot-ke-toan-vip")).toBe(true);

    writeStoredTemplateSession({
      accessToken: "jwt-token",
      refreshToken: "ref-token",
      expiresAt: Date.now() + 3600_000,
      userId: "u-1",
      email: "buyer@bigmanbot.com",
    });

    const payload = await fetchTemplatePayload("bot-ke-toan-vip");
    expect(payload?.soul).toBe("Bạn là Kế toán trưởng 15 năm kinh nghiệm.");

    const bot = toReadyBot(catalog[0]!, payload);
    registerRemoteReadyBot(bot);
    expect(readyBot("bot-ke-toan-vip")?.soul).toBe("Bạn là Kế toán trưởng 15 năm kinh nghiệm.");
    expect(readyBot("bot-ke-toan-vip")?.notes?.["MEMORY.md"]).toContain("Hồ sơ mã số thuế");
    expect(readyBot("bot-ke-toan-vip")?.routines).toHaveLength(1);
    expect(readyBot("bot-ke-toan-vip")?.skills?.map((s) => s.name)).toEqual(["vat-audit", "cit-report"]);
  });

  it("retries fetchUnlockedTemplateIds with a refreshed token on 401 and clears session if refresh is revoked", async () => {
    writeStoredTemplateSession({
      accessToken: "expired-jwt",
      refreshToken: "valid-refresh",
      expiresAt: Date.now() + 3600_000,
      userId: "u-1",
      email: "doanhoang1910@bigmanbot.com",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
        if (url.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/user_template_unlocks`)) {
          if (auth === "Bearer expired-jwt") {
            return new Response(JSON.stringify({ message: "JWT expired" }), { status: 401 });
          }
          if (auth === "Bearer fresh-jwt") {
            return new Response(JSON.stringify([{ template_id: "aaaa" }]), { status: 200 });
          }
        }
        if (url.startsWith(`${BIGMAN_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`)) {
          return new Response(
            JSON.stringify({
              access_token: "fresh-jwt",
              refresh_token: "fresh-refresh",
              expires_in: 3600,
              user: { id: "u-1", email: "doanhoang1910@bigmanbot.com" },
            }),
            { status: 200 }
          );
        }
        return new Response("[]", { status: 200 });
      })
    );

    const unlocked = await fetchUnlockedTemplateIds("expired-jwt");
    expect(unlocked.has("aaaa")).toBe(true);
    expect(readStoredTemplateSession()?.accessToken).toBe("fresh-jwt");

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith(`${BIGMAN_SUPABASE_URL}/rest/v1/user_template_unlocks`)) {
          return new Response(JSON.stringify({ message: "JWT expired" }), { status: 401 });
        }
        if (url.startsWith(`${BIGMAN_SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`)) {
          return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
        }
        return new Response("[]", { status: 200 });
      })
    );

    const afterRevoked = await fetchUnlockedTemplateIds("fresh-jwt");
    expect(afterRevoked.size).toBe(0);
    expect(readStoredTemplateSession()).toBeNull();
  });
});
