import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVpsHttpsDomain, formatVnd, VPSMMO_PLANS } from "../shared/vpsmmo-cloud.ts";
import {
  createVpsMmoOrder,
  getVpsMmoCloudOffer,
  handleVpsMmoSePayWebhook,
  provisionVpsMmoOrder,
  updateVpsMmoCloudConfig,
  VPSMMO_CREATE_VPS_URL,
} from "./vpsmmo-cloud.ts";

describe("vpsmmo-cloud broker & pricing", () => {
  let tempDir = "";
  let storeFile = "";
  let paymentsFile = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vpsmmo-cloud-test-"));
    storeFile = join(tempDir, "vpsmmo-cloud.json");
    paymentsFile = join(tempDir, "vietnam-payments.json");
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("exposes the 4 locked-in annual Vietnamese VPS Linux plans (Plan 2, Plan 3, Plan 4, Plan 6)", () => {
    expect(VPSMMO_PLANS.map((p) => ({
      tier: p.tier,
      portal: p.portalPlanName,
      vcpu: p.vcpu,
      ramGb: p.ramGb,
      diskGb: p.diskGb,
      monthly: formatVnd(p.monthlyVnd),
      yearly: formatVnd(p.yearlyVnd),
      popular: Boolean(p.popular),
    }))).toEqual([
      {
        tier: "starter",
        portal: "VPS Linux · Plan 2",
        vcpu: 2,
        ramGb: 2,
        diskGb: 30,
        monthly: "249.000đ",
        yearly: "2.990.000đ",
        popular: false,
      },
      {
        tier: "pro",
        portal: "VPS Linux · Plan 3",
        vcpu: 3,
        ramGb: 5,
        diskGb: 40,
        monthly: "390.000đ",
        yearly: "4.680.000đ",
        popular: true,
      },
      {
        tier: "max",
        portal: "VPS Linux · Plan 4",
        vcpu: 4,
        ramGb: 8,
        diskGb: 50,
        monthly: "540.000đ",
        yearly: "6.480.000đ",
        popular: false,
      },
      {
        tier: "team",
        portal: "VPS Linux · Plan 6",
        vcpu: 8,
        ramGb: 16,
        diskGb: 60,
        monthly: "999.000đ",
        yearly: "11.990.000đ",
        popular: false,
      },
    ]);
  });

  it("builds automatic HTTPS domains via Cách A (sslip.io) or custom root domain", () => {
    expect(buildVpsHttpsDomain("103.179.189.88", "12345")).toBe("103-179-189-88.sslip.io");
    expect(buildVpsHttpsDomain("103.179.189.88", "12345", "bigmanbot.vn")).toBe("vps-12345.bigmanbot.vn");
  });

  it("creates an order with dynamic VietQR URL and provisions in Sandbox mode (0đ)", async () => {
    const created = createVpsMmoOrder(
      { tier: "pro", email: "dev@bigmanbot.vn", cloudName: "Bigman Pro 1" },
      storeFile,
      paymentsFile,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.order.amountVnd).toBe(4_680_000);
    expect(created.order.monthlyEquivalentVnd).toBe(390_000);
    expect(created.order.qrImageUrl).toContain("amount=4680000");
    expect(created.order.qrImageUrl).toContain(created.order.orderCode);
    expect(created.order.step).toBe("waiting_payment");

    const provisioned = await provisionVpsMmoOrder(created.order.id, {
      simulate: true,
      customFile: storeFile,
      customPaymentsFile: paymentsFile,
      stepDelayMs: 0,
    });
    expect(provisioned.ok).toBe(true);
    if (!provisioned.ok) return;

    expect(provisioned.order.step).toBe("ready");
    expect(provisioned.order.sandbox).toBe(true);
    expect(provisioned.order.vps?.ip).toMatch(/^103\.179\.189\.\d+$/);
    expect(provisioned.order.vps?.domain).toMatch(/^103-179-189-\d+\.sslip\.io$/);
    expect(provisioned.order.vps?.pairingUrl).toMatch(/^https:\/\/103-179-189-\d+\.sslip\.io\/#pair=/);
  });

  it("calls portal.vpsmmo.vn/api/vps/createvps.php in Live mode and handles SePay webhook", async () => {
    updateVpsMmoCloudConfig(
      {
        token: "reseller-secret-token-1234",
        keypass: "reseller-keypass-5678",
        osId: "100170",
        planIds: { starter: "102", pro: "103", max: "104", team: "106" },
        timeOption: 12,
        sandboxMode: false,
        bankId: "VCB",
        accountNo: "0123456789",
        accountName: "CONG TY BIGMAN",
      },
      storeFile,
      paymentsFile,
    );

    const offer = getVpsMmoCloudOffer(storeFile, paymentsFile);
    expect(offer.config.hasCredentials).toBe(true);
    expect(offer.config.maskedToken).toBe("rese••••1234");
    expect(offer.config.sandboxMode).toBe(false);

    const created = createVpsMmoOrder(
      { tier: "team", email: "team@bigmanbot.vn", cloudName: "Bigman Team" },
      storeFile,
      paymentsFile,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.order.amountVnd).toBe(11_990_000);

    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(VPSMMO_CREATE_VPS_URL);
      const params = new URLSearchParams(String(init?.body ?? ""));
      expect(params.get("token")).toBe("reseller-secret-token-1234");
      expect(params.get("keypass")).toBe("reseller-keypass-5678");
      expect(params.get("plan")).toBe("106");
      expect(params.get("os")).toBe("100170");
      expect(params.get("time-option")).toBe("12");
      return new Response(
        JSON.stringify({
          status: "success",
          message: "Tạo VPS thành công",
          data: {
            id: "88990",
            date_start: "2026-11-05 15:00:00",
            date_end: "2027-11-05 15:00:00",
            ip: "103.56.160.25",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof globalThis.fetch;

    const webhookOut = await handleVpsMmoSePayWebhook(
      {
        content: `Chuyen khoan thanh toan ${created.order.orderCode} nhanh`,
        transferAmount: 11_990_000,
      },
      {
        customFile: storeFile,
        customPaymentsFile: paymentsFile,
        fetcher,
      },
    );

    expect(webhookOut.matched).toBe(true);
    expect(webhookOut.order?.step).toBe("ready");
    expect(webhookOut.order?.sandbox).toBe(false);
    expect(webhookOut.order?.vps?.vpsId).toBe("88990");
    expect(webhookOut.order?.vps?.ip).toBe("103.56.160.25");
    expect(webhookOut.order?.vps?.origin).toBe("https://103-56-160-25.sslip.io");
  });
});
