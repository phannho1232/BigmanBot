import { t } from "./i18n";
import type { LocaleKey } from "@/locales";

export interface CatalogCard {
  slug: string;
  categories?: string[];
}

export const INLINE_CATEGORY_COUNT = 5;
export const CATEGORY_SECTION_COUNT = 3;
export const CATEGORY_SECTION_SIZE = 4;

/** Categories by how many apps they hold; `keep` ones (an app of OpenMausBot's own lives there) always show inline. */
export function rankCategories(cards: readonly CatalogCard[], inline = INLINE_CATEGORY_COUNT, keep: readonly string[] = []): { inline: string[]; more: string[] } {
  const counts = new Map<string, number>();
  for (const card of cards) for (const category of new Set(card.categories ?? [])) counts.set(category, (counts.get(category) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
  const kept = keep.filter((name) => ranked.indexOf(name) >= inline);
  const shown = [...ranked.slice(0, Math.max(0, inline - kept.length)), ...kept];
  return { inline: shown, more: ranked.filter((name) => !shown.includes(name)) };
}

export function inCategory(card: CatalogCard, category: string | null): boolean {
  return category === null || (card.categories ?? []).includes(category);
}

export type CatalogSection<Card> =
  | { kind: "connected"; cards: Card[] }
  | { kind: "category"; category: string; cards: Card[]; more: boolean }
  | { kind: "all"; cards: Card[] };

export function catalogSections<Card extends CatalogCard>(
  cards: readonly Card[],
  isConnected: (slug: string) => boolean,
  categories: readonly string[],
): CatalogSection<Card>[] {
  const sections: CatalogSection<Card>[] = [];
  const connected = cards.filter((card) => isConnected(card.slug));
  if (connected.length) sections.push({ kind: "connected", cards: connected });
  for (const category of categories.slice(0, CATEGORY_SECTION_COUNT)) {
    const open = cards.filter((card) => !isConnected(card.slug) && inCategory(card, category));
    if (open.length) sections.push({ kind: "category", category, cards: open.slice(0, CATEGORY_SECTION_SIZE), more: open.length > CATEGORY_SECTION_SIZE });
  }
  sections.push({ kind: "all", cards: cards.filter((card) => !isConnected(card.slug)) });
  return sections;
}

// Catalog categories and blurbs come in English; the known ones show in the app's language.
const APP_CATEGORY_COPY: Record<string, string> = {
  productivity: "productivity",
  "developer tools": "developerTools",
  communication: "communication",
  files: "files",
  "sales and crm": "salesCrm",
  design: "design",
  marketing: "marketing",
  analytics: "analytics",
  social: "social",
  automation: "automation",
  finance: "finance",
};

const CONNECTOR_COPY: Record<string, string> = {
  "google calendar": "googleCalendar",
  "google sheets": "googleSheets",
  "google docs": "googleDocs",
  notion: "notion",
  github: "github",
  linear: "linear",
  sentry: "sentry",
  jira: "jira",
  slack: "slack",
  gmail: "gmail",
  discord: "discord",
  "google drive": "googleDrive",
  posthog: "posthog",
  "x (twitter)": "xTwitter",
  reddit: "reddit",
  zapier: "zapier",
  hubspot: "hubspot",
  salesforce: "salesforce",
  asana: "asana",
  trello: "trello",
  dropbox: "dropbox",
  airtable: "airtable",
  figma: "figma",
  stripe: "stripe",
  canva: "canva",
  youtube: "youtube",
  facebook: "facebook",
  "google analytics": "googleAnalytics",
  "google meet": "googleMeet",
  zoom: "zoom",
  "microsoft outlook": "outlook",
  "microsoft onedrive": "onedrive",
  "microsoft teams": "microsoftTeams",
  linkedin: "linkedin",
};

export function appCategoryLabel(name: string): string {
  const id = APP_CATEGORY_COPY[name.trim().toLowerCase()];
  return id ? t(`apps.category.${id}` as LocaleKey) : name;
}

export function connectorDescription(card: { label: string; blurb: string }): string {
  const id = CONNECTOR_COPY[card.label.trim().toLowerCase()];
  return id ? t(`apps.catalog.${id}.blurb` as LocaleKey) : card.blurb;
}

export interface VietnamCatalogCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
  categories?: string[];
}

export const VIETNAM_CURATED_CARDS: readonly VietnamCatalogCard[] = [
  { slug: "googlesheets", label: "Google Sheets", blurb: "Đọc, cập nhật bảng tính và báo cáo dữ liệu", domain: "sheets.google.com", logo: null, categories: ["Productivity"] },
  { slug: "googledocs", label: "Google Docs", blurb: "Đọc và soạn thảo tài liệu, hợp đồng, kịch bản", domain: "docs.google.com", logo: null, categories: ["Productivity"] },
  { slug: "googledrive", label: "Google Drive", blurb: "Lưu trữ, tìm kiếm và quản lý tệp đám mây", domain: "drive.google.com", logo: null, categories: ["Files"] },
  { slug: "gmail", label: "Gmail", blurb: "Đọc, phân loại và gửi email công việc", domain: "gmail.com", logo: null, categories: ["Communication"] },
  { slug: "googlecalendar", label: "Google Calendar", blurb: "Xem lịch biểu, tạo cuộc họp và lời nhắc", domain: "calendar.google.com", logo: null, categories: ["Productivity"] },
  { slug: "canva", label: "Canva", blurb: "Thiết kế hình ảnh, banner và ấn phẩm truyền thông", domain: "canva.com", logo: null, categories: ["Design"] },
  { slug: "youtube", label: "YouTube", blurb: "Quản lý kênh video, mô tả chuẩn SEO và thống kê", domain: "youtube.com", logo: null, categories: ["Social"] },
  { slug: "facebook", label: "Facebook", blurb: "Đăng bài Fanpage, quản lý nội dung và tương tác", domain: "facebook.com", logo: null, categories: ["Social"] },
  { slug: "notion", label: "Notion", blurb: "Quản lý trang ghi chú, tài liệu và cơ sở dữ liệu", domain: "notion.so", logo: null, categories: ["Productivity"] },
  { slug: "trello", label: "Trello", blurb: "Quản lý bảng công việc, thẻ nhiệm vụ và tiến độ", domain: "trello.com", logo: null, categories: ["Productivity"] },
  { slug: "figma", label: "Figma", blurb: "Xem thiết kế giao diện, tệp và ghi chú phản hồi", domain: "figma.com", logo: null, categories: ["Design"] },
  { slug: "google_analytics", label: "Google Analytics", blurb: "Phân tích lưu lượng truy cập website và chuyển đổi", domain: "analytics.google.com", logo: null, categories: ["Analytics"] },
  { slug: "googlemeet", label: "Google Meet", blurb: "Tạo phòng họp trực tuyến và quản lý lịch họp", domain: "meet.google.com", logo: null, categories: ["Communication"] },
  { slug: "zoom", label: "Zoom", blurb: "Lên lịch phòng họp trực tuyến và hội thảo", domain: "zoom.us", logo: null, categories: ["Communication"] },
  { slug: "outlook", label: "Microsoft Outlook", blurb: "Quản lý email và lịch làm việc Microsoft 365", domain: "outlook.office.com", logo: null, categories: ["Communication"] },
  { slug: "one_drive", label: "Microsoft OneDrive", blurb: "Lưu trữ và đồng bộ tài liệu Microsoft 365", domain: "onedrive.live.com", logo: null, categories: ["Files"] },
  { slug: "microsoft_teams", label: "Microsoft Teams", blurb: "Nhắn tin nội bộ, nhóm làm việc và họp trực tuyến", domain: "teams.microsoft.com", logo: null, categories: ["Communication"] },
  { slug: "airtable", label: "Airtable", blurb: "Quản lý bảng cơ sở dữ liệu và bản ghi trực quan", domain: "airtable.com", logo: null, categories: ["Productivity"] },
  { slug: "jira", label: "Jira", blurb: "Quản lý dự án, đầu việc và tiến độ sprint", domain: "atlassian.com", logo: null, categories: ["Developer tools"] },
  { slug: "slack", label: "Slack", blurb: "Nhắn tin kênh nội bộ và nhận thông báo nhóm", domain: "slack.com", logo: null, categories: ["Communication"] },
  { slug: "discord", label: "Discord", blurb: "Quản lý tin nhắn và kênh cộng đồng", domain: "discord.com", logo: null, categories: ["Communication"] },
  { slug: "github", label: "GitHub", blurb: "Quản lý mã nguồn, pull request và issue kỹ thuật", domain: "github.com", logo: null, categories: ["Developer tools"] },
  { slug: "zapier", label: "Zapier", blurb: "Tự động hóa kết nối dữ liệu giữa hàng nghìn ứng dụng", domain: "zapier.com", logo: null, categories: ["Automation"] },
  { slug: "dropbox", label: "Dropbox", blurb: "Lưu trữ và chia sẻ tệp, thư mục dung lượng lớn", domain: "dropbox.com", logo: null, categories: ["Files"] },
  { slug: "hubspot", label: "HubSpot", blurb: "Quản lý thông tin khách hàng và lịch sử chăm sóc CRM", domain: "hubspot.com", logo: null, categories: ["Sales and CRM"] },
  { slug: "linkedin", label: "LinkedIn", blurb: "Xây dựng thương hiệu chuyên nghiệp và tuyển dụng B2B", domain: "linkedin.com", logo: null, categories: ["Social"] },
];

export function curateVietnamCatalog(cards: readonly VietnamCatalogCard[]): VietnamCatalogCard[] {
  const bySlug = new Map(cards.map((card) => [card.slug.toLowerCase(), card]));
  return VIETNAM_CURATED_CARDS.map((curated) => {
    const remote = bySlug.get(curated.slug);
    return {
      ...curated,
      logo: remote?.logo ?? curated.logo,
      ...(remote?.noAuth !== undefined ? { noAuth: remote.noAuth } : {}),
    };
  });
}
