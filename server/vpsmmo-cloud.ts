import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  buildVpsHttpsDomain,
  getVpsMmoPlan,
  isVpsMmoTier,
  VPSMMO_PLANS,
  type VpsMmoCloudOfferResponse,
  type VpsMmoCloudPublicConfig,
  type VpsMmoOrderPublic,
  type VpsMmoOrderStep,
  type VpsMmoTier,
  type VpsMmoTimeOption,
} from "../shared/vpsmmo-cloud.ts";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { getVietnamPaymentsStatus } from "./vietnam-payments.ts";

/** Reseller API endpoints documented at https://vpsmmo.vn/api-document-cho-reseller-tai-vpsmmo/ */
export const VPSMMO_CREATE_VPS_URL = "https://portal.vpsmmo.vn/api/vps/createvps.php";
export const VPSMMO_INFO_VPS_URL = "https://portal.vpsmmo.vn/api/vps/infovps.php";

interface StoredVpsMmoConfig {
  token?: string;
  keypass?: string;
  osId?: string;
  planIds?: Partial<Record<VpsMmoTier, string>>;
  timeOption?: VpsMmoTimeOption;
  sandboxMode?: boolean;
  customRootDomain?: string;
  bankId?: string;
  accountNo?: string;
  accountName?: string;
  updatedAt?: number;
}

interface StoredVpsMmoOrder extends VpsMmoOrderPublic {
  serverPassword?: string;
  pairToken?: string;
}

interface StoredVpsMmoFile {
  config?: StoredVpsMmoConfig;
  orders?: StoredVpsMmoOrder[];
}

function storagePath(customFile?: string): string {
  return customFile ?? join(DATA_DIR, "vpsmmo-cloud.json");
}

function readStore(customFile?: string): StoredVpsMmoFile {
  const file = storagePath(customFile);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredVpsMmoFile) : {};
  } catch {
    return {};
  }
}

function writeStore(next: StoredVpsMmoFile, customFile?: string): void {
  const file = storagePath(customFile);
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(next, null, 2));
}

function validTimeOption(value: unknown): VpsMmoTimeOption {
  const num = Number(value);
  if (num === 1 || num === 3 || num === 6 || num === 12) return num;
  return 12;
}

function resolveEffectiveConfig(store: StoredVpsMmoFile, customPaymentsFile?: string): {
  token: string;
  keypass: string;
  publicConfig: VpsMmoCloudPublicConfig;
} {
  const cfg = store.config ?? {};
  const token = (cfg.token ?? process.env.VPSMMO_TOKEN ?? "").trim();
  const keypass = (cfg.keypass ?? process.env.VPSMMO_KEYPASS ?? "").trim();
  const hasCredentials = Boolean(token && keypass);
  const maskedToken = token.length > 8 ? `${token.slice(0, 4)}••••${token.slice(-4)}` : token ? "••••••••" : undefined;
  const osId = (cfg.osId ?? process.env.VPSMMO_OS_ID ?? "100170").trim() || "100170";
  const planIds: Record<VpsMmoTier, string> = {
    starter: (cfg.planIds?.starter ?? process.env.VPSMMO_PLAN_STARTER ?? "2").trim() || "2",
    pro: (cfg.planIds?.pro ?? process.env.VPSMMO_PLAN_PRO ?? "3").trim() || "3",
    max: (cfg.planIds?.max ?? process.env.VPSMMO_PLAN_MAX ?? "4").trim() || "4",
    team: (cfg.planIds?.team ?? process.env.VPSMMO_PLAN_TEAM ?? "6").trim() || "6",
  };
  const timeOption = validTimeOption(cfg.timeOption ?? process.env.VPSMMO_TIME_OPTION ?? 12);
  const sandboxMode = cfg.sandboxMode !== undefined ? Boolean(cfg.sandboxMode) : !hasCredentials;
  const customRootDomain = (cfg.customRootDomain ?? process.env.VPSMMO_ROOT_DOMAIN ?? "").trim();

  const vnPayments = getVietnamPaymentsStatus(customPaymentsFile);
  const primaryVietQr = vnPayments.vietqr.accounts[0];
  const configuredBankId = (cfg.bankId ?? process.env.VPSMMO_BANK_ID ?? "").trim().toUpperCase();
  const configuredAccountNo = (cfg.accountNo ?? process.env.VPSMMO_BANK_ACCOUNT ?? "").trim();
  const configuredAccountName = (cfg.accountName ?? process.env.VPSMMO_BANK_NAME ?? "").trim().toUpperCase();

  const bank = configuredBankId && configuredAccountNo
    ? {
        bankId: configuredBankId,
        accountNo: configuredAccountNo,
        accountName: configuredAccountName || "BIGMAN BOT CLOUD",
        fromVietnamPayments: false,
      }
    : primaryVietQr
      ? {
          bankId: primaryVietQr.bankId,
          accountNo: primaryVietQr.accountNo,
          accountName: primaryVietQr.accountName,
          fromVietnamPayments: true,
        }
      : {
          bankId: "MB",
          accountNo: "0988888888",
          accountName: "BIGMAN BOT CLOUD",
          fromVietnamPayments: false,
        };

  return {
    token,
    keypass,
    publicConfig: {
      hasCredentials,
      ...(maskedToken ? { maskedToken } : {}),
      osId,
      planIds,
      timeOption,
      sandboxMode,
      customRootDomain,
      bank,
    },
  };
}

function toPublicOrder(order: StoredVpsMmoOrder): VpsMmoOrderPublic {
  const { serverPassword: _pw, pairToken: _pt, ...rest } = order;
  return rest;
}

export function getVpsMmoCloudOffer(customFile?: string, customPaymentsFile?: string): VpsMmoCloudOfferResponse {
  const store = readStore(customFile);
  const { publicConfig } = resolveEffectiveConfig(store, customPaymentsFile);
  const recentOrders = (store.orders ?? []).slice(0, 10).map(toPublicOrder);
  return {
    plans: VPSMMO_PLANS,
    recommended: "pro",
    config: publicConfig,
    recentOrders,
  };
}

export function updateVpsMmoCloudConfig(
  patch: {
    token?: string;
    keypass?: string;
    osId?: string;
    planIds?: Partial<Record<VpsMmoTier, string>>;
    timeOption?: number;
    sandboxMode?: boolean;
    customRootDomain?: string;
    bankId?: string;
    accountNo?: string;
    accountName?: string;
  },
  customFile?: string,
  customPaymentsFile?: string,
): VpsMmoCloudPublicConfig {
  const store = readStore(customFile);
  const prev = store.config ?? {};
  const next: StoredVpsMmoConfig = {
    ...prev,
    ...(typeof patch.token === "string" ? { token: patch.token.trim() } : {}),
    ...(typeof patch.keypass === "string" ? { keypass: patch.keypass.trim() } : {}),
    ...(typeof patch.osId === "string" && patch.osId.trim() ? { osId: patch.osId.trim() } : {}),
    ...(patch.planIds && typeof patch.planIds === "object"
      ? {
          planIds: {
            ...prev.planIds,
            ...(typeof patch.planIds.starter === "string" && patch.planIds.starter.trim() ? { starter: patch.planIds.starter.trim() } : {}),
            ...(typeof patch.planIds.pro === "string" && patch.planIds.pro.trim() ? { pro: patch.planIds.pro.trim() } : {}),
            ...(typeof patch.planIds.max === "string" && patch.planIds.max.trim() ? { max: patch.planIds.max.trim() } : {}),
            ...(typeof patch.planIds.team === "string" && patch.planIds.team.trim() ? { team: patch.planIds.team.trim() } : {}),
          },
        }
      : {}),
    ...(patch.timeOption !== undefined ? { timeOption: validTimeOption(patch.timeOption) } : {}),
    ...(typeof patch.sandboxMode === "boolean" ? { sandboxMode: patch.sandboxMode } : {}),
    ...(typeof patch.customRootDomain === "string" ? { customRootDomain: patch.customRootDomain.trim() } : {}),
    ...(typeof patch.bankId === "string" ? { bankId: patch.bankId.trim().toUpperCase() } : {}),
    ...(typeof patch.accountNo === "string" ? { accountNo: patch.accountNo.trim().replace(/\s+/g, "") } : {}),
    ...(typeof patch.accountName === "string" ? { accountName: patch.accountName.trim().toUpperCase() } : {}),
    updatedAt: Date.now(),
  };
  store.config = next;
  writeStore(store, customFile);
  return resolveEffectiveConfig(store, customPaymentsFile).publicConfig;
}

function buildVietQrImageUrl(bank: { bankId: string; accountNo: string; accountName: string }, amountVnd: number, orderCode: string): string {
  return `https://img.vietqr.io/image/${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.accountNo)}-compact2.png?amount=${Math.round(amountVnd)}&addInfo=${encodeURIComponent(orderCode)}&accountName=${encodeURIComponent(bank.accountName)}`;
}

function generateStrongVpsPassword(): string {
  const suffix = randomBytes(4).toString("hex");
  return `Bmb@${new Date().getFullYear()}${suffix}A!`;
}

export function createVpsMmoOrder(
  input: {
    tier: unknown;
    email?: unknown;
    cloudName?: unknown;
    color?: unknown;
  },
  customFile?: string,
  customPaymentsFile?: string,
): { ok: true; order: VpsMmoOrderPublic } | { ok: false; status: number; error: string } {
  if (!isVpsMmoTier(input.tier)) {
    return { ok: false, status: 400, error: "Gói VPS không hợp lệ. Vui lòng chọn Starter, Pro, Max hoặc Team." };
  }
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: "Địa chỉ Email nhận thông tin VPS không hợp lệ." };
  }
  const plan = getVpsMmoPlan(input.tier);
  const store = readStore(customFile);
  const { publicConfig } = resolveEffectiveConfig(store, customPaymentsFile);
  const id = randomUUID();
  const codeSuffix = randomBytes(3).toString("hex").toUpperCase();
  const orderCode = `BMB${codeSuffix}`;
  const cloudName =
    typeof input.cloudName === "string" && input.cloudName.trim()
      ? input.cloudName.trim().slice(0, 48)
      : `Bigman Cloud ${plan.label}`;
  const color = typeof input.color === "string" && input.color.trim() ? input.color.trim() : "teal";

  const order: StoredVpsMmoOrder = {
    id,
    orderCode,
    tier: plan.tier,
    planLabel: plan.label,
    portalPlanName: plan.portalPlanName,
    email: email || "khachhang@bigmanbot.vn",
    cloudName,
    color,
    amountVnd: plan.yearlyVnd,
    monthlyEquivalentVnd: plan.monthlyVnd,
    billingMonths: 12,
    step: "waiting_payment",
    sandbox: publicConfig.sandboxMode,
    createdAt: Date.now(),
    paidAt: null,
    readyAt: null,
    qrImageUrl: buildVietQrImageUrl(publicConfig.bank, plan.yearlyVnd, orderCode),
    bank: {
      bankId: publicConfig.bank.bankId,
      accountNo: publicConfig.bank.accountNo,
      accountName: publicConfig.bank.accountName,
    },
    serverPassword: generateStrongVpsPassword(),
    pairToken: randomBytes(16).toString("hex"),
  };

  const existing = Array.isArray(store.orders) ? store.orders : [];
  store.orders = [order, ...existing].slice(0, 50);
  writeStore(store, customFile);
  return { ok: true, order: toPublicOrder(order) };
}

export function getVpsMmoOrder(orderId: string, customFile?: string): VpsMmoOrderPublic | null {
  const store = readStore(customFile);
  const found = (store.orders ?? []).find((item) => item.id === orderId || item.orderCode === orderId);
  return found ? toPublicOrder(found) : null;
}

function updateOrderInStore(
  orderId: string,
  updater: (order: StoredVpsMmoOrder) => StoredVpsMmoOrder,
  customFile?: string,
): StoredVpsMmoOrder | null {
  const store = readStore(customFile);
  const orders = Array.isArray(store.orders) ? store.orders : [];
  const idx = orders.findIndex((item) => item.id === orderId || item.orderCode === orderId);
  if (idx < 0) return null;
  const updated = updater(orders[idx]!);
  orders[idx] = updated;
  store.orders = orders;
  writeStore(store, customFile);
  return updated;
}

function formatIsoDateForDisplay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function provisionVpsMmoOrder(
  orderId: string,
  options: {
    simulate?: boolean;
    customFile?: string;
    customPaymentsFile?: string;
    fetcher?: typeof globalThis.fetch;
    stepDelayMs?: number;
  } = {},
): Promise<{ ok: true; order: VpsMmoOrderPublic } | { ok: false; status: number; error: string }> {
  const store = readStore(options.customFile);
  const { token, keypass, publicConfig } = resolveEffectiveConfig(store, options.customPaymentsFile);
  const existing = (store.orders ?? []).find((item) => item.id === orderId || item.orderCode === orderId);
  if (!existing) {
    return { ok: false, status: 404, error: "Không tìm thấy đơn hàng VPS." };
  }
  if (existing.step === "ready" && existing.vps) {
    return { ok: true, order: toPublicOrder(existing) };
  }

  const useSandbox = options.simulate === true || (options.simulate === undefined && publicConfig.sandboxMode) || !token || !keypass;
  const fetcher = options.fetcher ?? globalThis.fetch;
  const delayMs = options.stepDelayMs ?? (useSandbox ? 650 : 200);

  const started = updateOrderInStore(
    existing.id,
    (cur) => ({
      ...cur,
      sandbox: useSandbox,
      paidAt: cur.paidAt ?? Date.now(),
      step: "creating_vps" as VpsMmoOrderStep,
      error: undefined,
    }),
    options.customFile,
  );
  if (!started) {
    return { ok: false, status: 404, error: "Không tìm thấy đơn hàng VPS." };
  }

  const serverName = `bigman-${started.tier}-${started.orderCode.toLowerCase()}`;
  const serverPassword = started.serverPassword || generateStrongVpsPassword();
  const pairToken = started.pairToken || randomBytes(16).toString("hex");

  if (useSandbox) {
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const octets = [103, 179, 189, ( parseInt(started.orderCode.slice(-2), 16) % 200 ) + 20];
    const mockIp = octets.join(".");
    const mockVpsId = `SBX-${started.orderCode.slice(-4)}`;
    const nowDate = new Date();
    const endDate = new Date(nowDate.getTime() + 365 * 86_400_000);
    const domain = buildVpsHttpsDomain(mockIp, mockVpsId, publicConfig.customRootDomain);
    const origin = `https://${domain}`;
    const pairingUrl = `${origin}/#pair=${pairToken}`;

    updateOrderInStore(
      started.id,
      (cur) => ({
        ...cur,
        step: "configuring_domain",
        vps: {
          vpsId: mockVpsId,
          ip: mockIp,
          domain,
          origin,
          pairingUrl,
          serverName,
          dateStart: formatIsoDateForDisplay(nowDate),
          dateEnd: formatIsoDateForDisplay(endDate),
        },
      }),
      options.customFile,
    );

    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const finalOrder = updateOrderInStore(
      started.id,
      (cur) => ({
        ...cur,
        step: "ready",
        readyAt: Date.now(),
      }),
      options.customFile,
    );
    return { ok: true, order: toPublicOrder(finalOrder ?? started) };
  }

  const planId = publicConfig.planIds[started.tier] || "3";
  const form = new URLSearchParams();
  form.set("token", token);
  form.set("keypass", keypass);
  form.set("plan", planId);
  form.set("os", publicConfig.osId);
  form.set("server_name", serverName);
  form.set("server_password", serverPassword);
  form.set("time-option", String(publicConfig.timeOption));
  form.append("features[]", "no");

  let apiBody: any = null;
  try {
    const response = await fetcher(VPSMMO_CREATE_VPS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
      signal: AbortSignal.timeout(30_000),
    });
    apiBody = await response.json().catch(() => null);
    if (!response.ok || apiBody?.status !== "success" || !apiBody?.data?.ip) {
      const reason =
        typeof apiBody?.message === "string" && apiBody.message.trim()
          ? apiBody.message.trim()
          : `Máy chủ portal.vpsmmo.vn trả về lỗi (HTTP ${response.status}).`;
      const failedOrder = updateOrderInStore(
        started.id,
        (cur) => ({
          ...cur,
          step: "failed",
          error: reason,
        }),
        options.customFile,
      );
      return {
        ok: false,
        status: 400,
        error: failedOrder?.error ?? reason,
      };
    }
  } catch (err) {
    const reason = `Không thể kết nối tới portal.vpsmmo.vn: ${err instanceof Error ? err.message : "lỗi mạng"}`;
    updateOrderInStore(
      started.id,
      (cur) => ({
        ...cur,
        step: "failed",
        error: reason,
      }),
      options.customFile,
    );
    return { ok: false, status: 502, error: reason };
  }

  const vpsId = String(apiBody.data.id ?? "").trim() || started.orderCode;
  const ip = String(apiBody.data.ip ?? "").trim();
  const dateStart = String(apiBody.data.date_start ?? formatIsoDateForDisplay(new Date()));
  const dateEnd = String(apiBody.data.date_end ?? formatIsoDateForDisplay(new Date(Date.now() + 365 * 86_400_000)));
  const domain = buildVpsHttpsDomain(ip, vpsId, publicConfig.customRootDomain);
  const origin = `https://${domain}`;
  const pairingUrl = `${origin}/#pair=${pairToken}`;

  updateOrderInStore(
    started.id,
    (cur) => ({
      ...cur,
      step: "configuring_domain",
      vps: {
        vpsId,
        ip,
        domain,
        origin,
        pairingUrl,
        serverName,
        dateStart,
        dateEnd,
      },
    }),
    options.customFile,
  );

  if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  const readyOrder = updateOrderInStore(
    started.id,
    (cur) => ({
      ...cur,
      step: "ready",
      readyAt: Date.now(),
    }),
    options.customFile,
  );
  return { ok: true, order: toPublicOrder(readyOrder ?? started) };
}

export async function handleVpsMmoSePayWebhook(
  payload: Record<string, unknown>,
  options: {
    customFile?: string;
    customPaymentsFile?: string;
    fetcher?: typeof globalThis.fetch;
  } = {},
): Promise<{ matched: boolean; order?: VpsMmoOrderPublic; error?: string }> {
  const content = String(payload.content ?? payload.description ?? "").toUpperCase();
  const transferAmount = Number(payload.transferAmount ?? payload.amount ?? 0);
  if (!content) return { matched: false };

  const store = readStore(options.customFile);
  const orders = Array.isArray(store.orders) ? store.orders : [];
  const pending = orders.find(
    (order) =>
      order.step === "waiting_payment"
      && content.includes(order.orderCode.toUpperCase())
      && (transferAmount <= 0 || transferAmount >= order.amountVnd),
  );
  if (!pending) return { matched: false };

  const result = await provisionVpsMmoOrder(pending.id, {
    customFile: options.customFile,
    customPaymentsFile: options.customPaymentsFile,
    fetcher: options.fetcher,
    stepDelayMs: 50,
  });
  return result.ok ? { matched: true, order: result.order } : { matched: true, error: result.error };
}
