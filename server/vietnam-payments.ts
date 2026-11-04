import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import type { PromptPart } from "./system-prompt.ts";

export interface StoredVietQrConfig {
  id?: string;
  bankId: string;
  accountNo: string;
  accountName: string;
  clientId?: string;
  apiKey?: string;
  accountLabel: string;
  qrPreviewUrl: string;
  updatedAt: number;
}

export interface StoredSePayConfig {
  apiToken: string;
  accountLabel: string;
  updatedAt: number;
}

interface StoredVietnamPaymentsFile {
  vietqr?: StoredVietQrConfig;
  vietqrAccounts?: StoredVietQrConfig[];
  sepay?: StoredSePayConfig;
}

export interface VietQrPublicAccount {
  id: string;
  bankId: string;
  accountNo: string;
  accountName: string;
  accountLabel: string;
  qrPreviewUrl: string;
}

export interface VietnamPaymentsPublicStatus {
  vietqr: {
    connected: boolean;
    bankId?: string;
    accountNo?: string;
    accountName?: string;
    accountLabel?: string;
    qrPreviewUrl?: string;
    accounts: VietQrPublicAccount[];
  };
  sepay: {
    connected: boolean;
    accountLabel?: string;
  };
}

function storagePath(customFile?: string): string {
  return customFile ?? join(DATA_DIR, "vietnam-payments.json");
}

function readStore(customFile?: string): StoredVietnamPaymentsFile {
  const file = storagePath(customFile);
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as StoredVietnamPaymentsFile) : {};
  } catch {
    return {};
  }
}

function writeStore(next: StoredVietnamPaymentsFile, customFile?: string): void {
  const file = storagePath(customFile);
  mkdirSync(dirname(file), { recursive: true });
  writeFileAtomic(file, JSON.stringify(next, null, 2));
}

function normalizeVietQrAccounts(store: StoredVietnamPaymentsFile): StoredVietQrConfig[] {
  if (Array.isArray(store.vietqrAccounts) && store.vietqrAccounts.length > 0) {
    return store.vietqrAccounts.map((acc) => ({
      ...acc,
      id: acc.id || `${acc.bankId}-${acc.accountNo}`,
    }));
  }
  if (store.vietqr?.accountNo) {
    return [
      {
        ...store.vietqr,
        id: store.vietqr.id || `${store.vietqr.bankId}-${store.vietqr.accountNo}`,
      },
    ];
  }
  return [];
}

export function getVietnamPaymentsStatus(customFile?: string): VietnamPaymentsPublicStatus {
  const store = readStore(customFile);
  const accounts = normalizeVietQrAccounts(store).map((acc) => ({
    id: acc.id || `${acc.bankId}-${acc.accountNo}`,
    bankId: acc.bankId,
    accountNo: acc.accountNo,
    accountName: acc.accountName,
    accountLabel: acc.accountLabel,
    qrPreviewUrl: acc.qrPreviewUrl,
  }));
  const primary = accounts[0];
  return {
    vietqr: primary
      ? {
          connected: true,
          bankId: primary.bankId,
          accountNo: primary.accountNo,
          accountName: primary.accountName,
          accountLabel: primary.accountLabel,
          qrPreviewUrl: primary.qrPreviewUrl,
          accounts,
        }
      : { connected: false, accounts: [] },
    sepay: store.sepay
      ? {
          connected: true,
          accountLabel: store.sepay.accountLabel,
        }
      : { connected: false },
  };
}

export async function connectVietQr(
  input: {
    bankId: string;
    accountNo: string;
    accountName: string;
    clientId?: string;
    apiKey?: string;
  },
  customFile?: string,
): Promise<{ ok: true; status: VietnamPaymentsPublicStatus } | { ok: false; status: number; error: string }> {
  const bankId = input.bankId.trim().toUpperCase();
  const accountNo = input.accountNo.trim().replace(/\s+/g, "");
  const accountName = input.accountName.trim().toUpperCase();
  const clientId = input.clientId?.trim() || undefined;
  const apiKey = input.apiKey?.trim() || undefined;

  if (!/^[A-Z0-9]{2,20}$/.test(bankId)) {
    return { ok: false, status: 400, error: "Mã ngân hàng không hợp lệ (ví dụ: MB, VCB, TCB, ACB, BIDV, ICB)." };
  }
  if (!/^[A-Za-z0-9]{4,30}$/.test(accountNo)) {
    return { ok: false, status: 400, error: "Số tài khoản ngân hàng không hợp lệ." };
  }
  if (accountName.length < 2 || accountName.length > 80) {
    return { ok: false, status: 400, error: "Vui lòng nhập tên chủ tài khoản (không dấu, in hoa)." };
  }

  const qrPreviewUrl = `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(accountNo)}-compact2.png?accountName=${encodeURIComponent(accountName)}`;

  try {
    if (clientId && apiKey) {
      const banksRes = await fetch("https://api.vietqr.io/v2/banks", {
        headers: { "x-client-id": clientId, "x-api-key": apiKey },
        signal: AbortSignal.timeout(12_000),
      });
      if (!banksRes.ok) {
        return { ok: false, status: 400, error: `Không thể kết nối api.vietqr.io (HTTP ${banksRes.status}).` };
      }
      const banksJson: any = await banksRes.json();
      const matchedBank = Array.isArray(banksJson?.data)
        ? banksJson.data.find((b: any) =>
            String(b.shortName ?? "").toUpperCase() === bankId
            || String(b.code ?? "").toUpperCase() === bankId
            || String(b.bin ?? "") === bankId,
          )
        : null;
      if (!matchedBank?.bin) {
        return { ok: false, status: 400, error: `Không tìm thấy ngân hàng "${bankId}" trong danh mục NAPAS VietQR.` };
      }
      const genRes = await fetch("https://api.vietqr.io/v2/generate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-client-id": clientId,
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          accountNo,
          accountName,
          acqId: Number(matchedBank.bin),
          template: "compact2",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      const genJson: any = await genRes.json().catch(() => null);
      if (!genRes.ok || genJson?.code !== "00") {
        return { ok: false, status: 400, error: genJson?.desc || "Client ID hoặc API Key của VietQR không hợp lệ." };
      }
    } else {
      const checkRes = await fetch(qrPreviewUrl, {
        method: "GET",
        signal: AbortSignal.timeout(12_000),
      });
      const contentType = checkRes.headers.get("content-type") ?? "";
      if (!checkRes.ok || !contentType.startsWith("image/")) {
        return { ok: false, status: 400, error: `Mã ngân hàng "${bankId}" hoặc số tài khoản không tạo được mã VietQR hợp lệ.` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Không thể kết nối tới máy chủ VietQR: ${err instanceof Error ? err.message : "lỗi mạng"}`,
    };
  }

  const store = readStore(customFile);
  const id = `${bankId}-${accountNo}`;
  const entry: StoredVietQrConfig = {
    id,
    bankId,
    accountNo,
    accountName,
    ...(clientId ? { clientId } : {}),
    ...(apiKey ? { apiKey } : {}),
    accountLabel: `${bankId} · ${accountNo} (${accountName})`,
    qrPreviewUrl,
    updatedAt: Date.now(),
  };
  const existing = normalizeVietQrAccounts(store);
  const idx = existing.findIndex((item) => (item.id || `${item.bankId}-${item.accountNo}`) === id);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  store.vietqrAccounts = existing;
  store.vietqr = existing[0];
  writeStore(store, customFile);
  return { ok: true, status: getVietnamPaymentsStatus(customFile) };
}

export function disconnectVietQr(customFile?: string, accountId?: string): VietnamPaymentsPublicStatus {
  const store = readStore(customFile);
  if (accountId) {
    const remaining = normalizeVietQrAccounts(store).filter(
      (item) => (item.id || `${item.bankId}-${item.accountNo}`) !== accountId,
    );
    if (remaining.length > 0) {
      store.vietqrAccounts = remaining;
      store.vietqr = remaining[0];
    } else {
      delete store.vietqrAccounts;
      delete store.vietqr;
    }
  } else {
    delete store.vietqrAccounts;
    delete store.vietqr;
  }
  writeStore(store, customFile);
  return getVietnamPaymentsStatus(customFile);
}

export async function connectSePay(
  input: { apiToken: string },
  customFile?: string,
): Promise<{ ok: true; status: VietnamPaymentsPublicStatus } | { ok: false; status: number; error: string }> {
  const apiToken = input.apiToken.trim();
  if (!apiToken || apiToken.length < 10 || /\s/.test(apiToken)) {
    return { ok: false, status: 400, error: "Vui lòng nhập SePay API Token hợp lệ (không chứa khoảng trắng)." };
  }

  let accountLabel = "SePay API";
  try {
    const res = await fetch("https://my.sepay.vn/userapi/bankaccounts/list", {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || body?.status === 401 || body?.error) {
      return {
        ok: false,
        status: 400,
        error: "SePay API Token không hợp lệ hoặc bị từ chối. Hãy kiểm tra lại tại my.sepay.vn → Cấu hình Công ty → API Access.",
      };
    }
    const list = Array.isArray(body?.bankaccounts) ? body.bankaccounts : [];
    if (list.length > 0) {
      const first = list[0];
      const brand = String(first.bank_brand_name ?? first.bank_short_name ?? "Ngân hàng").trim();
      const acc = String(first.account_number ?? "").trim();
      accountLabel = list.length > 1 ? `${brand} · ${acc} (+${list.length - 1} TK)` : `${brand} · ${acc}`;
    }
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Không thể kết nối tới máy chủ SePay (my.sepay.vn): ${err instanceof Error ? err.message : "lỗi mạng"}`,
    };
  }

  const store = readStore(customFile);
  store.sepay = {
    apiToken,
    accountLabel,
    updatedAt: Date.now(),
  };
  writeStore(store, customFile);
  return { ok: true, status: getVietnamPaymentsStatus(customFile) };
}

export function disconnectSePay(customFile?: string): VietnamPaymentsPublicStatus {
  const store = readStore(customFile);
  delete store.sepay;
  writeStore(store, customFile);
  return getVietnamPaymentsStatus(customFile);
}

export async function listSePayTransactions(
  limit = 20,
  customFile?: string,
): Promise<{ ok: true; transactions: unknown[] } | { ok: false; status: number; error: string }> {
  const store = readStore(customFile);
  if (!store.sepay?.apiToken) {
    return { ok: false, status: 400, error: "Chưa kết nối SePay API Token." };
  }
  const capped = Math.max(1, Math.min(100, Math.floor(limit)));
  try {
    const res = await fetch(`https://my.sepay.vn/userapi/transactions/list?limit=${capped}`, {
      headers: {
        Authorization: `Bearer ${store.sepay.apiToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || body?.status === 401) {
      return { ok: false, status: 400, error: "Không thể lấy danh sách giao dịch từ SePay." };
    }
    return { ok: true, transactions: Array.isArray(body?.transactions) ? body.transactions : [] };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: `Lỗi kết nối SePay: ${err instanceof Error ? err.message : "lỗi mạng"}`,
    };
  }
}

export function vietnamPaymentsPromptPart(customFile?: string): PromptPart {
  const store = readStore(customFile);
  const filePath = storagePath(customFile).replace(/\\/g, "/");
  const lines: string[] = [];

  if (store.sepay?.apiToken) {
    lines.push(
      `### SePay Open API (ĐÃ KẾT NỐI: ${store.sepay.accountLabel})`,
      `- Người dùng ĐÃ KẾT NỐI và xác thực thành công **SePay API Token** cho tài khoản **${store.sepay.accountLabel}**.`,
      `- **TUYỆT ĐỐI KHÔNG** mở trình duyệt vào \`my.sepay.vn\` và **TUYỆT ĐỐI KHÔNG** gọi \`request_secret\` để xin lại SePay API Token.`,
      `- Token đã được lưu sẵn tại tệp cấu hình máy chủ: \`${filePath}\` (trường \`sepay.apiToken\`).`,
      `- Khi người dùng yêu cầu kiểm tra giao dịch chuyển khoản, liệt kê tiền vào hoặc tính tổng doanh thu trên SePay, hãy chạy lệnh đọc \`sepay.apiToken\` từ \`${filePath}\` và gọi trực tiếp REST API chính thức của SePay:`,
      `  - Danh sách giao dịch: \`GET https://my.sepay.vn/userapi/transactions/list?limit=50\` (Header: \`Authorization: Bearer <apiToken>\`, \`Accept: application/json\`).`,
      `  - Danh sách tài khoản ngân hàng: \`GET https://my.sepay.vn/userapi/bankaccounts/list\` (Header: \`Authorization: Bearer <apiToken>\`).`,
    );
  }

  const vietqrList = normalizeVietQrAccounts(store);
  if (vietqrList.length > 0) {
    lines.push(
      `### VietQR NAPAS 247 (ĐÃ KẾT NỐI ${vietqrList.length} TÀI KHOẢN)`,
      `- Người dùng ĐÃ CẤU HÌNH danh sách tài khoản nhận tiền VietQR (tài khoản đầu tiên là mặc định khi không chỉ định ngân hàng):`,
      ...vietqrList.map(
        (acc, index) =>
          `  ${index + 1}. **${acc.bankId}** · STK **${acc.accountNo}** · Chủ TK **${acc.accountName}**${index === 0 ? " *(Mặc định)*" : ""} → mẫu ảnh QR: \`https://img.vietqr.io/image/${encodeURIComponent(acc.bankId)}-${encodeURIComponent(acc.accountNo)}-compact2.png?amount=<SO_TIEN>&addInfo=<NOI_DUNG_CHUYEN_KHOAN>&accountName=${encodeURIComponent(acc.accountName)}\``,
      ),
      `- Khi người dùng yêu cầu tạo mã QR chuyển khoản (VietQR), không cần hỏi lại số tài khoản; hãy chọn đúng ngân hàng người dùng yêu cầu (hoặc dùng tài khoản mặc định số 1) để tạo ngay đường dẫn ảnh QR chuẩn NAPAS.`,
    );
  }

  return {
    id: "vietnam-payments",
    label: "Vietnam Payments (SePay & VietQR)",
    text: lines.length > 0 ? `\n\n## Kết nối Thanh toán & Ngân hàng Việt Nam (SePay / VietQR)\n\n${lines.join("\n")}` : "",
  };
}
