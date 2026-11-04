import {
  connectSePay,
  connectVietQr,
  disconnectSePay,
  disconnectVietQr,
  getVietnamPaymentsStatus,
  listSePayTransactions,
} from "../vietnam-payments.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createVietnamPaymentsRoutes(customFile?: string): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/vietnam-payments" && !path.startsWith("/api/vietnam-payments/")) return PASS;
    if (!auth.scopes.includes("admin")) {
      return json(res, 403, { error: "Only the owner or an admin can manage Vietnam payment integrations." });
    }
    res.setHeader("Cache-Control", "no-store");

    if (path === "/api/vietnam-payments") {
      if (method === "GET") return json(res, 200, getVietnamPaymentsStatus(customFile));
      return json(res, 405, { error: "method not allowed" });
    }

    if (path === "/api/vietnam-payments/vietqr" || path.startsWith("/api/vietnam-payments/vietqr/")) {
      if (method === "DELETE") {
        const rawId = path.startsWith("/api/vietnam-payments/vietqr/")
          ? decodeURIComponent(path.slice("/api/vietnam-payments/vietqr/".length))
          : undefined;
        return json(res, 200, disconnectVietQr(customFile, rawId || undefined));
      }
      if (path !== "/api/vietnam-payments/vietqr" || method !== "POST") {
        return json(res, 405, { error: "method not allowed" });
      }
      const body = await readBody(req, 8_192);
      const bankId = typeof body?.bankId === "string" ? body.bankId : "";
      const accountNo = typeof body?.accountNo === "string" ? body.accountNo : "";
      const accountName = typeof body?.accountName === "string" ? body.accountName : "";
      const clientId = typeof body?.clientId === "string" ? body.clientId : undefined;
      const apiKey = typeof body?.apiKey === "string" ? body.apiKey : undefined;
      const result = await connectVietQr({ bankId, accountNo, accountName, clientId, apiKey }, customFile);
      return result.ok ? json(res, 200, result.status) : json(res, result.status, { error: result.error });
    }

    if (path === "/api/vietnam-payments/sepay") {
      if (method === "DELETE") {
        return json(res, 200, disconnectSePay(customFile));
      }
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = await readBody(req, 8_192);
      const apiToken = typeof body?.apiToken === "string" ? body.apiToken : "";
      const result = await connectSePay({ apiToken }, customFile);
      return result.ok ? json(res, 200, result.status) : json(res, result.status, { error: result.error });
    }

    if (path === "/api/vietnam-payments/sepay/transactions") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      const result = await listSePayTransactions(20, customFile);
      return result.ok ? json(res, 200, { transactions: result.transactions }) : json(res, result.status, { error: result.error });
    }

    return json(res, 404, { error: "not found" });
  };
}
