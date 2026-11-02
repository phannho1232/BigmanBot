import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./system-prompt.ts";
import { TIKTOK_SHOP_CORE_PROMPT, tiktokShopCorePart } from "./tiktok-shop-prompt.ts";

describe("tiktokShopCorePart", () => {
  it("stays in the stable prompt half and includes all core TikTok Shop operational modules", () => {
    const part = tiktokShopCorePart();
    const built = buildSystemPrompt("You are ShopBot.", "", [part]);

    expect(part.id).toBe("tiktok-shop-core");
    expect(built.stable).toContain(TIKTOK_SHOP_CORE_PROMPT);
    expect(built.volatile).toBe("");
    expect(built.text).toContain("seller-vn.tiktok.com");
    expect(built.text).toContain("Anti-Violation Guard");
    expect(built.text).toContain("GMV = Lượt hiển thị (Impressions)");
    expect(built.text).toContain("Unit Economics");
    expect(built.text).toContain("Multi-Shop Browser Operations");
  });
});

