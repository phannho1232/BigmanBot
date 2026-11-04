import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectSePay,
  connectVietQr,
  disconnectSePay,
  disconnectVietQr,
  getVietnamPaymentsStatus,
  listSePayTransactions,
} from "./vietnam-payments.ts";

describe("vietnam-payments", () => {
  const dirs: string[] = [];
  const tempStore = () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-vn-pay-"));
    dirs.push(dir);
    return join(dir, "vietnam-payments.json");
  };

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("validates multiple VietQR bank accounts and disconnects individual accounts in isolated storage", async () => {
    const file = tempStore();
    expect(getVietnamPaymentsStatus(file)).toEqual({
      vietqr: { connected: false, accounts: [] },
      sepay: { connected: false },
    });

    const badBank = await connectVietQr({ bankId: "!", accountNo: "123456", accountName: "NGUYEN VAN A" }, file);
    expect(badBank.ok).toBe(false);

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      );

    const first = await connectVietQr({ bankId: "mb", accountNo: "0987654321", accountName: "nguyen van a" }, file);
    expect(first.ok).toBe(true);

    const second = await connectVietQr({ bankId: "vcb", accountNo: "0123456789", accountName: "nguyen van a" }, file);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.status.vietqr.connected).toBe(true);
      expect(second.status.vietqr.accounts).toHaveLength(2);
      expect(second.status.vietqr.accounts.map((a) => a.id)).toEqual(["MB-0987654321", "VCB-0123456789"]);
    }

    const afterRemoveFirst = disconnectVietQr(file, "MB-0987654321");
    expect(afterRemoveFirst.vietqr.connected).toBe(true);
    expect(afterRemoveFirst.vietqr.accounts).toHaveLength(1);
    expect(afterRemoveFirst.vietqr.accounts[0]?.id).toBe("VCB-0123456789");

    const afterDisconnectAll = disconnectVietQr(file);
    expect(afterDisconnectAll.vietqr.connected).toBe(false);
    expect(afterDisconnectAll.vietqr.accounts).toEqual([]);
  });

  it("verifies SePay API token against my.sepay.vn and rejects invalid tokens", async () => {
    const file = tempStore();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 401, error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    const rejected = await connectSePay({ apiToken: "invalid_token_12345" }, file);
    expect(rejected.ok).toBe(false);
    expect(getVietnamPaymentsStatus(file).sepay.connected).toBe(false);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 200,
          bankaccounts: [{ bank_brand_name: "MBBank", account_number: "0123456789" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const connected = await connectSePay({ apiToken: "valid_sepay_token_12345" }, file);
    expect(connected.ok).toBe(true);
    if (connected.ok) {
      expect(connected.status.sepay).toEqual({
        connected: true,
        accountLabel: "MBBank · 0123456789",
      });
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: 200,
          transactions: [{ id: "tx_1", amount_in: "500000", transaction_content: "DH105" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const tx = await listSePayTransactions(10, file);
    expect(tx).toEqual({
      ok: true,
      transactions: [{ id: "tx_1", amount_in: "500000", transaction_content: "DH105" }],
    });

    expect(disconnectSePay(file).sepay.connected).toBe(false);
  });
});
