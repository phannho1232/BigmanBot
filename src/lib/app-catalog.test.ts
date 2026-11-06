import { describe, expect, it } from "vitest";
import { appCategoryLabel, CATEGORY_SECTION_SIZE, catalogSections, connectorDescription, curateVietnamCatalog, inCategory, rankCategories, VIETNAM_BROWSER_APPS, VIETNAM_CURATED_CARDS } from "./app-catalog";
import { loadLocale, setLocale } from "./i18n";

const card = (slug: string, ...categories: string[]) => ({ slug, categories });

describe("rankCategories", () => {
  it("ranks by how many apps carry a category, ties by name, and folds the rest under More", () => {
    const cards = [card("a", "Productivity", "Files"), card("b", "Productivity"), card("c", "Design"), card("d", "Communication", "Communication"), card("e"), { slug: "f" }];
    expect(rankCategories(cards, 2)).toEqual({ inline: ["Productivity", "Communication"], more: ["Design", "Files"] });
    expect(rankCategories([])).toEqual({ inline: [], more: [] });
  });

  it("keeps a category OpenMausBot's own app lives in among the inline ones, taking the last place", () => {
    const cards = [card("a", "Productivity"), card("b", "Productivity"), card("c", "Design"), card("d", "Design"), card("e", "Files"), card("postiz", "Social")];
    expect(rankCategories(cards, 2, ["Social"])).toEqual({ inline: ["Design", "Social"], more: ["Productivity", "Files"] });
    expect(rankCategories(cards, 3, ["Social"]).inline).toEqual(["Design", "Productivity", "Social"]);
    expect(rankCategories(cards, 4, ["Social"]).inline).toEqual(["Design", "Productivity", "Files", "Social"]);
    expect(rankCategories(cards, 2, ["Missing"])).toEqual(rankCategories(cards, 2));
  });
});

describe("inCategory", () => {
  it("lets everything through without a category", () => {
    expect(inCategory({ slug: "x" }, null)).toBe(true);
    expect(inCategory(card("x", "Design"), "Design")).toBe(true);
    expect(inCategory({ slug: "x" }, "Design")).toBe(false);
  });
});

describe("catalogSections", () => {
  const cards = [
    card("slack", "Communication"),
    card("gmail", "Communication"),
    ...Array.from({ length: 6 }, (_, index) => card(`p${index}`, "Productivity")),
    card("figma", "Design"),
  ];
  const connected = (slug: string) => slug === "slack";

  it("leads with connected apps, previews categories with what is left, then the whole catalog", () => {
    const sections = catalogSections(cards, connected, ["Productivity", "Communication", "Design", "Files"]);
    expect(sections.map((section) => section.kind === "category" ? section.category : section.kind)).toEqual(["connected", "Productivity", "Communication", "Design", "all"]);
    expect(sections[0]!.cards.map((entry) => entry.slug)).toEqual(["slack"]);
    const productivity = sections[1]!;
    expect(productivity.cards).toHaveLength(CATEGORY_SECTION_SIZE);
    expect(productivity.kind === "category" && productivity.more).toBe(true);
    expect(sections[2]!.cards.map((entry) => entry.slug)).toEqual(["gmail"]);
    expect(sections.at(-1)!.cards.some((entry) => entry.slug === "slack")).toBe(false);
  });

  it("keeps the catalog section even when empty, and skips empty ones", () => {
    expect(catalogSections([], connected, ["Design"])).toEqual([{ kind: "all", cards: [] }]);
    expect(VIETNAM_BROWSER_APPS).toHaveLength(16);
    expect(curateVietnamCatalog([{ slug: "hackernews", label: "Hacker News" }])).toHaveLength(29);
  });

  it("resolves localized descriptions and categories for every curated card in English and Vietnamese", async () => {
    for (const locale of ["en", "vi"] as const) {
      await loadLocale(locale);
      for (const entry of VIETNAM_CURATED_CARDS) {
        expect(connectorDescription(entry).trim().length).toBeGreaterThan(0);
        expect(connectorDescription(entry).startsWith("apps.catalog.")).toBe(false);
        for (const cat of entry.categories ?? []) {
          expect(appCategoryLabel(cat).trim().length).toBeGreaterThan(0);
          expect(appCategoryLabel(cat).startsWith("apps.category.")).toBe(false);
        }
      }
      for (const entry of VIETNAM_BROWSER_APPS) {
        for (const cat of entry.categories ?? []) {
          expect(appCategoryLabel(cat).trim().length).toBeGreaterThan(0);
          expect(appCategoryLabel(cat).startsWith("apps.category.")).toBe(false);
        }
      }
    }
    setLocale("en");
  });
});
