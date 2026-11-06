// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VPSMMO_PLANS, type VpsMmoOrderPublic } from "../../../shared/vpsmmo-cloud";
import { VpsMmoCloudFlow } from "./VpsMmoCloudFlow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("VpsMmoCloudFlow UI (Bước 3)", () => {
  let host: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    host.remove();
    vi.restoreAllMocks();
  });

  const flush = () =>
    act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

  it("renders all 4 Vietnamese annual VPS plans (Starter, Pro, Max, Team) and walks through VietQR checkout to 3-step provisioning", async () => {
    const mockOrder: VpsMmoOrderPublic = {
      id: "ord-1",
      orderCode: "BMB998877",
      tier: "pro",
      planLabel: "Pro",
      portalPlanName: "VPS Linux · Plan 3",
      email: "dev@bigmanbot.vn",
      cloudName: "Bigman Cloud Pro",
      color: "teal",
      amountVnd: 4_680_000,
      monthlyEquivalentVnd: 390_000,
      billingMonths: 12,
      step: "waiting_payment",
      sandbox: true,
      createdAt: Date.now(),
      paidAt: null,
      readyAt: null,
      qrImageUrl: "https://img.vietqr.io/image/MB-0988888888-compact2.png?amount=4680000&addInfo=BMB998877",
      bank: {
        bankId: "MB",
        accountNo: "0988888888",
        accountName: "BIGMAN BOT CLOUD",
      },
    };

    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/vpsmmo-cloud/offer") {
        return new Response(
          JSON.stringify({
            plans: VPSMMO_PLANS,
            recommended: "pro",
            config: {
              hasCredentials: false,
              osId: "100170",
              planIds: { starter: "2", pro: "3", max: "4", team: "6" },
              timeOption: 12,
              sandboxMode: true,
              customRootDomain: "",
              bank: { bankId: "MB", accountNo: "0988888888", accountName: "BIGMAN BOT CLOUD", fromVietnamPayments: false },
            },
            recentOrders: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "/api/vpsmmo-cloud/orders" && init?.method === "POST") {
        return new Response(JSON.stringify({ order: mockOrder }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/confirm-payment") && init?.method === "POST") {
        const readyOrder: VpsMmoOrderPublic = {
          ...mockOrder,
          step: "ready",
          readyAt: Date.now(),
          vps: {
            vpsId: "SBX-8877",
            ip: "103.179.189.88",
            domain: "103-179-189-88.sslip.io",
            origin: "https://103-179-189-88.sslip.io",
            pairingUrl: "https://103-179-189-88.sslip.io/#pair=testtoken",
            serverName: "bigman-pro-bmb998877",
            dateStart: "2026-11-05 15:00:00",
            dateEnd: "2027-11-05 15:00:00",
          },
        };
        return new Response(JSON.stringify({ order: readyOrder }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const onClose = vi.fn();
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(VpsMmoCloudFlow, { profileEmail: "dev@bigmanbot.vn", onClose, fetcher }));
    });
    await flush();

    expect(host.querySelector('[data-cloud-add="vpsmmo-offer"]')).toBeTruthy();
    expect(host.textContent).toContain("Bigman Bot Cloud — Máy chủ VPS Việt Nam 24/7");
    expect(host.textContent).toContain("249.000đ");
    expect(host.textContent).toContain("2.990.000đ / năm");
    expect(host.textContent).toContain("390.000đ");
    expect(host.textContent).toContain("4.680.000đ / năm");
    expect(host.textContent).toContain("540.000đ");
    expect(host.textContent).toContain("6.480.000đ / năm");
    expect(host.textContent).toContain("999.000đ");
    expect(host.textContent).toContain("11.990.000đ / năm");
    expect(host.textContent).toContain("8 vCPU · 16 GB RAM DDR4");
    expect(host.querySelector("[data-vpsmmo-popular]")?.textContent).toBe("Phổ biến nhất");

    const selectProBtn = host.querySelector('[data-vpsmmo-select="pro"]') as HTMLButtonElement;
    expect(selectProBtn).toBeTruthy();
    await act(async () => {
      selectProBtn.click();
    });
    await flush();

    expect(host.querySelector('[data-cloud-add="vpsmmo-checkout"]')).toBeTruthy();
    expect(host.querySelector("[data-vpsmmo-order-code]")?.textContent).toBe("BMB998877");
    expect(host.textContent).toContain("4.680.000đ");

    const simulatePayBtn = host.querySelector("[data-vpsmmo-simulate-pay]") as HTMLButtonElement;
    expect(simulatePayBtn).toBeTruthy();
    await act(async () => {
      simulatePayBtn.click();
    });
    await flush();

    expect(host.querySelector('[data-cloud-add="vpsmmo-ready"]')).toBeTruthy();
    expect(host.querySelector("[data-vpsmmo-ip]")?.textContent).toBe("103.179.189.88");
    expect(host.querySelector("[data-vpsmmo-domain]")?.textContent).toBe("https://103-179-189-88.sslip.io");
    expect(host.textContent).toContain("SBX-8877");
  });
});
