export type VpsMmoTier = "starter" | "pro" | "max" | "team";

export type VpsMmoTimeOption = 1 | 3 | 6 | 12;

export type VpsMmoOrderStep = "waiting_payment" | "creating_vps" | "configuring_domain" | "ready" | "failed";

/** Public plan specification for the 12-month Vietnamese VPS Linux offering backed by portal.vpsmmo.vn. */
export interface VpsMmoPlanSpec {
  tier: VpsMmoTier;
  label: string;
  portalPlanName: string;
  popular?: boolean;
  monthlyVnd: number;
  yearlyVnd: number;
  portalMonthlyCostVnd: number;
  portalYearlyCostVnd: number;
  vcpu: number;
  ramGb: number;
  diskGb: number;
  ipCount: number;
  uplinkGbps: number;
  backupWeekly: number;
  tagline: string;
  highlights: readonly string[];
}

/** Public Reseller & VietQR status returned to the desktop client. Secret tokens are never exposed in full. */
export interface VpsMmoCloudPublicConfig {
  hasCredentials: boolean;
  maskedToken?: string;
  osId: string;
  planIds: Record<VpsMmoTier, string>;
  timeOption: VpsMmoTimeOption;
  sandboxMode: boolean;
  customRootDomain: string;
  bank: {
    bankId: string;
    accountNo: string;
    accountName: string;
    fromVietnamPayments: boolean;
  };
}

/** Public order state polled by the desktop client during VietQR payment and 3-step VPS provisioning. */
export interface VpsMmoOrderPublic {
  id: string;
  orderCode: string;
  tier: VpsMmoTier;
  planLabel: string;
  portalPlanName: string;
  email: string;
  cloudName: string;
  color: string;
  amountVnd: number;
  monthlyEquivalentVnd: number;
  billingMonths: number;
  step: VpsMmoOrderStep;
  sandbox: boolean;
  createdAt: number;
  paidAt: number | null;
  readyAt: number | null;
  qrImageUrl: string;
  bank: {
    bankId: string;
    accountNo: string;
    accountName: string;
  };
  vps?: {
    vpsId: string;
    ip: string;
    domain: string;
    origin: string;
    pairingUrl: string;
    serverName: string;
    dateStart: string;
    dateEnd: string;
  };
  error?: string;
}

/** Wire payload for `GET /api/vpsmmo-cloud/offer`. */
export interface VpsMmoCloudOfferResponse {
  plans: readonly VpsMmoPlanSpec[];
  recommended: VpsMmoTier;
  config: VpsMmoCloudPublicConfig;
  recentOrders: readonly VpsMmoOrderPublic[];
}

export const VPSMMO_PLANS: readonly VpsMmoPlanSpec[] = [
  {
    tier: "starter",
    label: "Starter",
    portalPlanName: "VPS Linux · Plan 2",
    monthlyVnd: 249_000,
    yearlyVnd: 2_990_000,
    portalMonthlyCostVnd: 169_000,
    portalYearlyCostVnd: 2_028_000,
    vcpu: 2,
    ramGb: 2,
    diskGb: 30,
    ipCount: 1,
    uplinkGbps: 10,
    backupWeekly: 2,
    tagline: "Máy chủ VPS riêng tại Việt Nam giúp bot hoạt động 24/7 ngay cả khi tắt máy tính cá nhân.",
    highlights: [
      "2 vCPU · 2 GB RAM DDR4",
      "30 GB ổ cứng NVMe tốc độ cao",
      "1 IP Public Việt Nam riêng · Uplink 10 Gbps",
      "Không giới hạn băng thông (Data Transfer)",
      "Backup tự động hàng tuần (lưu 2 bản)",
    ],
  },
  {
    tier: "pro",
    label: "Pro",
    portalPlanName: "VPS Linux · Plan 3",
    popular: true,
    monthlyVnd: 390_000,
    yearlyVnd: 4_680_000,
    portalMonthlyCostVnd: 259_000,
    portalYearlyCostVnd: 3_108_000,
    vcpu: 3,
    ramGb: 5,
    diskGb: 40,
    ipCount: 1,
    uplinkGbps: 10,
    backupWeekly: 2,
    tagline: "Cấu hình cân bằng hoàn hảo cho đa số người dùng chạy nhiều bot, trình duyệt và tác vụ tự động 24/7.",
    highlights: [
      "3 vCPU · 5 GB RAM DDR4",
      "40 GB ổ cứng NVMe tốc độ cao",
      "1 IP Public Việt Nam riêng · Uplink 10 Gbps",
      "Không giới hạn băng thông (Data Transfer)",
      "Backup tự động hàng tuần (lưu 2 bản)",
    ],
  },
  {
    tier: "max",
    label: "Max",
    portalPlanName: "VPS Linux · Plan 4",
    monthlyVnd: 540_000,
    yearlyVnd: 6_480_000,
    portalMonthlyCostVnd: 349_000,
    portalYearlyCostVnd: 4_188_000,
    vcpu: 4,
    ramGb: 8,
    diskGb: 50,
    ipCount: 1,
    uplinkGbps: 10,
    backupWeekly: 2,
    tagline: "Hiệu năng cao cho bot mở nhiều tab trình duyệt Chrome, xử lý dữ liệu lớn và làm việc cường độ cao suốt ngày đêm.",
    highlights: [
      "4 vCPU · 8 GB RAM DDR4",
      "50 GB ổ cứng NVMe tốc độ cao",
      "1 IP Public Việt Nam riêng · Uplink 10 Gbps",
      "Không giới hạn băng thông (Data Transfer)",
      "Backup tự động hàng tuần (lưu 2 bản)",
    ],
  },
  {
    tier: "team",
    label: "Team",
    portalPlanName: "VPS Linux · Plan 6",
    monthlyVnd: 999_000,
    yearlyVnd: 11_990_000,
    portalMonthlyCostVnd: 749_000,
    portalYearlyCostVnd: 8_988_000,
    vcpu: 8,
    ramGb: 16,
    diskGb: 60,
    ipCount: 1,
    uplinkGbps: 10,
    backupWeekly: 2,
    tagline: "Cỗ máy 8 nhân 16 GB RAM mạnh mẽ dành cho đội nhóm hoặc hệ thống đa bot quy mô lớn vận hành song song.",
    highlights: [
      "8 vCPU · 16 GB RAM DDR4",
      "60 GB ổ cứng NVMe tốc độ cao",
      "1 IP Public Việt Nam riêng · Uplink 10 Gbps",
      "Không giới hạn băng thông (Data Transfer)",
      "Backup tự động hàng tuần (lưu 2 bản)",
    ],
  },
] as const;

export function formatVnd(amount: number): string {
  return `${Math.round(amount).toLocaleString("vi-VN")}đ`;
}

export function isVpsMmoTier(value: unknown): value is VpsMmoTier {
  return value === "starter" || value === "pro" || value === "max" || value === "team";
}

export function getVpsMmoPlan(tier: VpsMmoTier): VpsMmoPlanSpec {
  return VPSMMO_PLANS.find((plan) => plan.tier === tier) ?? VPSMMO_PLANS[1]!;
}

/** sslip.io resolves `<ip-with-dashes>.sslip.io` directly to `<ip>`, allowing Caddy (`--domain`) to obtain a Let's Encrypt TLS certificate without custom DNS records. */
export function buildVpsHttpsDomain(ip: string, vpsId: string, customRootDomain?: string): string {
  const cleanIp = ip.trim();
  const root = (customRootDomain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (root && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(root)) {
    const cleanId = vpsId.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || cleanIp.replace(/[^0-9]/g, "");
    return `vps-${cleanId}.${root}`;
  }
  const dashedIp = cleanIp.replace(/\./g, "-").replace(/[^a-zA-Z0-9-]/g, "");
  return `${dashedIp || "103-179-189-88"}.sslip.io`;
}
