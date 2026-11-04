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
  instagram: "instagram",
  "google analytics": "googleAnalytics",
  "google search console": "googleSearchConsole",
  "google meet": "googleMeet",
  zoom: "zoom",
  "microsoft outlook": "outlook",
  "microsoft onedrive": "onedrive",
  "microsoft teams": "microsoftTeams",
  "microsoft excel": "microsoftExcel",
  excel: "microsoftExcel",
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
  { slug: "instagram", label: "Instagram", blurb: "Đăng ảnh, Reels, quản lý bình luận và tin nhắn Instagram", domain: "instagram.com", logo: "https://logos.composio.dev/api/instagram", categories: ["Social"] },
  { slug: "notion", label: "Notion", blurb: "Quản lý trang ghi chú, tài liệu và cơ sở dữ liệu", domain: "notion.so", logo: null, categories: ["Productivity"] },
  { slug: "trello", label: "Trello", blurb: "Quản lý bảng công việc, thẻ nhiệm vụ và tiến độ", domain: "trello.com", logo: null, categories: ["Productivity"] },
  { slug: "figma", label: "Figma", blurb: "Xem thiết kế giao diện, tệp và ghi chú phản hồi", domain: "figma.com", logo: null, categories: ["Design"] },
  { slug: "google_analytics", label: "Google Analytics", blurb: "Phân tích lưu lượng truy cập website và chuyển đổi", domain: "analytics.google.com", logo: null, categories: ["Analytics"] },
  { slug: "google_search_console", label: "Google Search Console", blurb: "Theo dõi thứ hạng từ khóa SEO, lượt nhấp tìm kiếm và lập chỉ mục website", domain: "search.google.com", logo: "https://logos.composio.dev/api/google_search_console", categories: ["Analytics"] },
  { slug: "googlemeet", label: "Google Meet", blurb: "Tạo phòng họp trực tuyến và quản lý lịch họp", domain: "meet.google.com", logo: null, categories: ["Communication"] },
  { slug: "zoom", label: "Zoom", blurb: "Lên lịch phòng họp trực tuyến và hội thảo", domain: "zoom.us", logo: null, categories: ["Communication"] },
  { slug: "outlook", label: "Microsoft Outlook", blurb: "Quản lý email và lịch làm việc Microsoft 365", domain: "outlook.office.com", logo: null, categories: ["Communication"] },
  { slug: "one_drive", label: "Microsoft OneDrive", blurb: "Lưu trữ và đồng bộ tài liệu Microsoft 365", domain: "onedrive.live.com", logo: null, categories: ["Files"] },
  { slug: "microsoft_teams", label: "Microsoft Teams", blurb: "Nhắn tin nội bộ, nhóm làm việc và họp trực tuyến", domain: "teams.microsoft.com", logo: null, categories: ["Communication"] },
  { slug: "excel", label: "Microsoft Excel", blurb: "Đọc, cập nhật bảng tính Excel (.xlsx), công thức và báo cáo tài chính", domain: "office.com", logo: "https://logos.composio.dev/api/excel", categories: ["Productivity"] },
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

export function curateVietnamCatalog(cards: readonly (Partial<VietnamCatalogCard> & { slug: string })[]): VietnamCatalogCard[] {
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

export interface VietnamBrowserApp {
  slug: string;
  label: string;
  blurb: string;
  url: string;
  domain: string;
  siteSuffix: string;
  logo: string | null;
  categories: string[];
}

const RAW_VIETNAM_BROWSER_APPS: readonly VietnamBrowserApp[] = [
  {
    slug: "vn-zalo-web",
    label: "Zalo Web",
    blurb: "Nhắn tin công việc, nhóm nội bộ và chăm sóc khách hàng qua Zalo",
    url: "https://chat.zalo.me",
    domain: "zalo.me",
    siteSuffix: "zalo.me",
    logo: null,
    categories: ["Communication"],
  },
  {
    slug: "vn-telegram-web",
    label: "Telegram",
    blurb: "Nhận báo cáo tự động, cảnh báo đơn hàng và nhắn tin nhóm tốc độ cao",
    url: "https://web.telegram.org/k/",
    domain: "telegram.org",
    siteSuffix: "telegram.org",
    logo: null,
    categories: ["Communication"],
  },
  {
    slug: "vn-tiktok-studio",
    label: "TikTok (Kênh & TikTok Studio)",
    blurb: "Đăng video, gắn giỏ hàng Affiliate, xem phân tích kênh và quản lý bình luận",
    url: "https://www.tiktok.com/tiktokstudio",
    domain: "tiktok.com",
    siteSuffix: "tiktok.com",
    logo: "https://logos.composio.dev/api/tiktok",
    categories: ["Social"],
  },
  {
    slug: "vn-tiktok-seller",
    label: "TikTok Shop Seller VN",
    blurb: "Quản lý đơn hàng, sản phẩm, Flash Sale và sức khỏe gian hàng",
    url: "https://seller-vn.tiktok.com",
    domain: "tiktok.com",
    siteSuffix: "tiktok.com",
    logo: null,
    categories: ["Sales and CRM"],
  },
  {
    slug: "vn-tiktok-affiliate",
    label: "TikTok Affiliate Center",
    blurb: "Tìm kiếm KOC/KOL, thiết lập hoa hồng và duyệt mẫu thử miễn phí",
    url: "https://affiliate.tiktok.com",
    domain: "tiktok.com",
    siteSuffix: "tiktok.com",
    logo: null,
    categories: ["Marketing"],
  },
  {
    slug: "vn-shopee-seller",
    label: "Shopee Kênh Người Bán",
    blurb: "Quản lý sản phẩm, đơn hàng, tồn kho và khuyến mãi trên sàn Shopee",
    url: "https://banhang.shopee.vn",
    domain: "shopee.vn",
    siteSuffix: "shopee.vn",
    logo: null,
    categories: ["Sales and CRM"],
  },
  {
    slug: "vn-lazada-seller",
    label: "Lazada Seller Center",
    blurb: "Quản lý gian hàng, sản phẩm, đơn hàng và chiến dịch khuyến mãi trên Lazada",
    url: "https://sellercenter.lazada.vn",
    domain: "lazada.vn",
    siteSuffix: "lazada.vn",
    logo: null,
    categories: ["Sales and CRM"],
  },
  {
    slug: "vn-meta-business",
    label: "Meta Business Suite",
    blurb: "Quản lý Fanpage Facebook, hộp thư khách hàng và quảng cáo Meta",
    url: "https://business.facebook.com",
    domain: "facebook.com",
    siteSuffix: "facebook.com",
    logo: null,
    categories: ["Social"],
  },
  {
    slug: "vn-lark-suite",
    label: "Lark Suite & Lark Base",
    blurb: "Không gian làm việc nhóm, tin nhắn nội bộ và bảng dữ liệu Lark Base",
    url: "https://www.larksuite.com",
    domain: "larksuite.com",
    siteSuffix: "larksuite.com",
    logo: null,
    categories: ["Productivity"],
  },
  {
    slug: "vn-kalodata",
    label: "Kalodata Việt Nam",
    blurb: "Phân tích doanh số TikTok Shop, nghiên cứu đối thủ và sản phẩm xu hướng",
    url: "https://www.kalodata.com",
    domain: "kalodata.com",
    siteSuffix: "kalodata.com",
    logo: null,
    categories: ["Analytics"],
  },
  {
    slug: "vn-pancake",
    label: "Pancake Đa Kênh",
    blurb: "Gộp tin nhắn Fanpage, Zalo, Shopee, TikTok và chốt đơn trực tiếp trên khung chat",
    url: "https://pancake.vn",
    domain: "pancake.vn",
    siteSuffix: "pancake.vn",
    logo: null,
    categories: ["Sales and CRM"],
  },
  {
    slug: "vn-kiotviet",
    label: "KiotViet Quản lý",
    blurb: "Quản lý bán hàng POS, đồng bộ tồn kho, giá vốn và doanh thu cửa hàng",
    url: "https://www.kiotviet.vn",
    domain: "kiotviet.vn",
    siteSuffix: "kiotviet.vn",
    logo: null,
    categories: ["Sales and CRM"],
  },
  {
    slug: "vn-thuvienphapluat",
    label: "Thư viện Pháp luật",
    blurb: "Tra cứu Luật, Nghị định, Thông tư thuế mới nhất, kiểm tra hiệu lực và tải biểu mẫu hợp đồng",
    url: "https://thuvienphapluat.vn",
    domain: "thuvienphapluat.vn",
    siteSuffix: "thuvienphapluat.vn",
    logo: null,
    categories: ["Productivity"],
  },
  {
    slug: "vn-vietqr",
    label: "VietQR",
    blurb: "Tạo mã QR chuyển khoản ngân hàng NAPAS 247 theo số tiền, nội dung đơn hàng và tra cứu MST",
    url: "https://vietqr.io",
    domain: "vietqr.io",
    siteSuffix: "vietqr.io",
    logo: null,
    categories: ["Finance"],
  },
  {
    slug: "vn-sepay",
    label: "SePay (Biến động số dư)",
    blurb: "Theo dõi tiền vào ngân hàng thời gian thực và tự động đối soát đơn hàng đã thanh toán",
    url: "https://my.sepay.vn",
    domain: "sepay.vn",
    siteSuffix: "sepay.vn",
    logo: null,
    categories: ["Finance"],
  },
  {
    slug: "vn-thue-dien-tu",
    label: "Hóa đơn Điện tử Thuế",
    blurb: "Tra cứu, đối soát hóa đơn đầu vào và đầu ra trên Cổng Tổng cục Thuế",
    url: "https://hoadondientu.gdt.gov.vn",
    domain: "gdt.gov.vn",
    siteSuffix: "gdt.gov.vn",
    logo: null,
    categories: ["Finance"],
  },
];

const VIETNAM_BROWSER_LOGOS: Readonly<Record<string, string>> = {
  "vn-meta-business": "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%20fill%3D%22none%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%230064E0%22%2F%3E%3Cpath%20d%3D%22M45.2%2021c-3.6%200-6.4%202.2-8.9%205.9L33.8%2030.6c-1.8-2.8-3.8-5.3-5.9-7.1C25.8%2021.8%2023.5%2021%2021%2021c-5.8%200-10%204.8-10%2011.4C11%2039.2%2015.1%2044%2020.6%2044c3.4%200%206.2-1.8%208.9-5.6l2.5-3.6c1.8%202.7%203.7%205.1%205.7%206.8%202.1%201.7%204.4%202.4%206.9%202.4%205.9%200%2010.4-4.9%2010.4-11.6C55%2025.7%2050.8%2021%2045.2%2021zm-24.4%2018c-3%200-5.1-2.7-5.1-6.6%200-4%202.2-6.6%205.3-6.6%202.5%200%204.7%201.7%207.6%206.1l1.1%201.7-1.5%202.1c-2.3%203.3-4.6%203.3-7.4%203.3zm23.8%200c-2.6%200-4.8-1.7-7.7-6l-1.2-1.8%201.6-2.3c2.4-3.4%204.7-3.1%207.5-3.1%203.1%200%205.4%202.7%205.4%206.6%200%204-2.3%206.6-5.6%206.6z%22%20fill%3D%22%23fff%22%2F%3E%3C%2Fsvg%3E",
  "vn-vietqr": "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%20fill%3D%22none%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%230F4C81%22%2F%3E%3Crect%20x%3D%2212%22%20y%3D%2212%22%20width%3D%2216%22%20height%3D%2216%22%20rx%3D%223%22%20stroke%3D%22%23FFF%22%20stroke-width%3D%223.5%22%2F%3E%3Crect%20x%3D%2217%22%20y%3D%2217%22%20width%3D%226%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%23EF4444%22%2F%3E%3Crect%20x%3D%2236%22%20y%3D%2212%22%20width%3D%2216%22%20height%3D%2216%22%20rx%3D%223%22%20stroke%3D%22%23FFF%22%20stroke-width%3D%223.5%22%2F%3E%3Crect%20x%3D%2241%22%20y%3D%2217%22%20width%3D%226%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%23FFF%22%2F%3E%3Crect%20x%3D%2212%22%20y%3D%2236%22%20width%3D%2216%22%20height%3D%2216%22%20rx%3D%223%22%20stroke%3D%22%23FFF%22%20stroke-width%3D%223.5%22%2F%3E%3Crect%20x%3D%2217%22%20y%3D%2241%22%20width%3D%226%22%20height%3D%226%22%20rx%3D%221%22%20fill%3D%22%23FFF%22%2F%3E%3Cpath%20d%3D%22M36%2036h7v7h-7zM46%2036h6v6h-6zM36%2046h6v6h-6zM45%2045h7v7h-7z%22%20fill%3D%22%2338BDF8%22%2F%3E%3C%2Fsvg%3E",
  "vn-sepay": "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%20fill%3D%22none%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%230284C7%22%2F%3E%3Cpath%20d%3D%22M18%2023c0-4.4%204-8%209.5-8h10c3.6%200%206.5%202.9%206.5%206.5h-5.5c0-1-.8-1.8-1.8-1.8h-9c-2.3%200-4%201.3-4%203.1%200%201.7%201.4%202.7%204.2%203.3l7.6%201.6c5.8%201.2%209%204.1%209%208.6%200%205.2-4.3%208.7-10.5%208.7H24c-4.1%200-7-2.9-7-7h5.5c0%201.3.9%202.2%202.3%202.2h9c2.9%200%204.9-1.5%204.9-3.6%200-1.8-1.3-2.9-4.5-3.6L26.6%2031c-5.4-1.2-8.6-3.9-8.6-8z%22%20fill%3D%22%23FFF%22%2F%3E%3Ccircle%20cx%3D%2247%22%20cy%3D%2217%22%20r%3D%226%22%20fill%3D%22%2322C55E%22%20stroke%3D%22%23FFF%22%20stroke-width%3D%222%22%2F%3E%3C%2Fsvg%3E",
  "vn-thue-dien-tu": "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%20fill%3D%22none%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2214%22%20fill%3D%22%23B91C1C%22%2F%3E%3Cpath%20d%3D%22M18%2014h22l10%2010v26a4%204%200%200%201-4%204H18a4%204%200%200%201-4-4V18a4%204%200%200%201%204-4z%22%20fill%3D%22%23FFFBEB%22%2F%3E%3Cpath%20d%3D%22M40%2014v10h10%22%20fill%3D%22%23FDE68A%22%2F%3E%3Cpolygon%20points%3D%2232%2C21%2033.9%2C25.2%2038.5%2C25.7%2035%2C28.8%2036%2C33.3%2032%2C31%2028%2C33.3%2029%2C28.8%2025.5%2C25.7%2030.1%2C25.2%22%20fill%3D%22%23D97706%22%2F%3E%3Crect%20x%3D%2221%22%20y%3D%2237%22%20width%3D%2222%22%20height%3D%223%22%20rx%3D%221.5%22%20fill%3D%22%23B91C1C%22%2F%3E%3Crect%20x%3D%2221%22%20y%3D%2243%22%20width%3D%2215%22%20height%3D%223%22%20rx%3D%221.5%22%20fill%3D%22%23D97706%22%2F%3E%3Ccircle%20cx%3D%2244%22%20cy%3D%2245%22%20r%3D%229%22%20fill%3D%22%2316A34A%22%20stroke%3D%22%23FFF%22%20stroke-width%3D%222.5%22%2F%3E%3Cpath%20d%3D%22M40.2%2045l2.5%202.5%205-5%22%20stroke%3D%22%23FFF%22%20stroke-width%3D%222.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%2F%3E%3C%2Fsvg%3E",
};

export const VIETNAM_BROWSER_APPS: readonly VietnamBrowserApp[] = RAW_VIETNAM_BROWSER_APPS.map((app) => ({
  ...app,
  logo: VIETNAM_BROWSER_LOGOS[app.slug] ?? app.logo,
}));

export const VN_BROWSER_SITES_KEY = "omb:vn-browser-sites";
export const VN_BROWSER_SITES_EVENT = "omb:vn-browser-sites-changed";

export function readConnectedVietnamSites(): string[] {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(VN_BROWSER_SITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
  } catch {
    return [];
  }
}

function writeConnectedVietnamSites(sites: string[]): string[] {
  const unique = [...new Set(sites.map((s) => s.toLowerCase().trim()).filter(Boolean))];
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      window.localStorage.setItem(VN_BROWSER_SITES_KEY, JSON.stringify(unique));
      window.dispatchEvent(new CustomEvent(VN_BROWSER_SITES_EVENT));
    } catch {}
  }
  return unique;
}

function appUrlHost(app: VietnamBrowserApp): string {
  try {
    return new URL(app.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return app.siteSuffix.toLowerCase();
  }
}

export function isVietnamAppConnected(app: VietnamBrowserApp, connectedEntries: readonly string[]): boolean {
  const appHost = appUrlHost(app);
  return connectedEntries.some((entry) => {
    const clean = entry.toLowerCase().replace(/^www\./, "");
    return clean === app.slug
      || clean === appHost
      || (appHost !== "tiktok.com" && (clean.endsWith(`.${appHost}`) || (app.siteSuffix !== "tiktok.com" && (clean === app.siteSuffix || clean.endsWith(`.${app.siteSuffix}`)))));
  });
}

export function noteVietnamBrowserSite(slugOrUrl: string): string[] {
  const trimmed = slugOrUrl.trim().toLowerCase();
  if (!trimmed) return readConnectedVietnamSites();
  const bySlug = VIETNAM_BROWSER_APPS.find((app) => app.slug === trimmed);
  if (bySlug) {
    const current = readConnectedVietnamSites();
    if (current.includes(bySlug.slug)) return current;
    return writeConnectedVietnamSites([...current, bySlug.slug]);
  }
  let host = trimmed;
  if (trimmed.includes("://")) {
    try {
      host = new URL(trimmed).hostname.toLowerCase();
    } catch {
      return readConnectedVietnamSites();
    }
  }
  host = host.replace(/^www\./, "");
  if (!host || host === "id.zalo.me") return readConnectedVietnamSites();
  const matched = VIETNAM_BROWSER_APPS.filter((app) => {
    const appHost = appUrlHost(app);
    return host === appHost || (appHost !== "tiktok.com" && (host.endsWith(`.${appHost}`) || (app.siteSuffix !== "tiktok.com" && host === app.siteSuffix)));
  });
  if (matched.length === 0) return readConnectedVietnamSites();
  const current = readConnectedVietnamSites();
  const next = [...current];
  let changed = false;
  for (const app of matched) {
    if (!next.includes(app.slug)) {
      next.push(app.slug);
      changed = true;
    }
  }
  return changed ? writeConnectedVietnamSites(next) : current;
}

export function removeVietnamBrowserSite(app: VietnamBrowserApp): string[] {
  const appHost = appUrlHost(app);
  const current = readConnectedVietnamSites();
  const next = current.filter((entry) => {
    const clean = entry.toLowerCase().replace(/^www\./, "");
    return clean !== app.slug && clean !== appHost;
  });
  return next.length !== current.length ? writeConnectedVietnamSites(next) : current;
}
