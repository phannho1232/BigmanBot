import {
  createVpsMmoOrder,
  getVpsMmoCloudOffer,
  getVpsMmoOrder,
  handleVpsMmoSePayWebhook,
  provisionVpsMmoOrder,
  updateVpsMmoCloudConfig,
} from "../vpsmmo-cloud.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createVpsMmoCloudRoutes(options: {
  customFile?: string;
  customPaymentsFile?: string;
  fetcher?: typeof globalThis.fetch;
} = {}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/vpsmmo-cloud" && !path.startsWith("/api/vpsmmo-cloud/")) return PASS;
    res.setHeader("Cache-Control", "no-store");

    if (path === "/api/vpsmmo-cloud/offer") {
      if (method === "GET") {
        return json(res, 200, getVpsMmoCloudOffer(options.customFile, options.customPaymentsFile));
      }
      return json(res, 405, { error: "method not allowed" });
    }

    if (path === "/api/vpsmmo-cloud/config") {
      if (!auth.scopes.includes("admin")) {
        return json(res, 403, { error: "Chỉ quản trị viên mới có quyền cập nhật cấu hình VPSMMO Reseller." });
      }
      if (method === "GET") {
        return json(res, 200, getVpsMmoCloudOffer(options.customFile, options.customPaymentsFile).config);
      }
      if (method === "PUT" || method === "POST") {
        const body = (await readBody(req, 16_384)) ?? {};
        const config = updateVpsMmoCloudConfig(
          {
            token: typeof body.token === "string" ? body.token : undefined,
            keypass: typeof body.keypass === "string" ? body.keypass : undefined,
            osId: typeof body.osId === "string" ? body.osId : undefined,
            planIds: body.planIds && typeof body.planIds === "object" ? (body.planIds as Record<string, string>) : undefined,
            timeOption: typeof body.timeOption === "number" || typeof body.timeOption === "string" ? Number(body.timeOption) : undefined,
            sandboxMode: typeof body.sandboxMode === "boolean" ? body.sandboxMode : undefined,
            customRootDomain: typeof body.customRootDomain === "string" ? body.customRootDomain : undefined,
            bankId: typeof body.bankId === "string" ? body.bankId : undefined,
            accountNo: typeof body.accountNo === "string" ? body.accountNo : undefined,
            accountName: typeof body.accountName === "string" ? body.accountName : undefined,
          },
          options.customFile,
          options.customPaymentsFile,
        );
        return json(res, 200, { ok: true, config });
      }
      return json(res, 405, { error: "method not allowed" });
    }

    if (path === "/api/vpsmmo-cloud/orders") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = (await readBody(req, 16_384)) ?? {};
      const result = createVpsMmoOrder(
        {
          tier: body.tier,
          email: body.email,
          cloudName: body.cloudName,
          color: body.color,
        },
        options.customFile,
        options.customPaymentsFile,
      );
      return result.ok ? json(res, 200, { order: result.order }) : json(res, result.status, { error: result.error });
    }

    if (path.startsWith("/api/vpsmmo-cloud/orders/")) {
      const rest = path.slice("/api/vpsmmo-cloud/orders/".length);
      if (rest.endsWith("/confirm-payment")) {
        if (method !== "POST") return json(res, 405, { error: "method not allowed" });
        const orderId = decodeURIComponent(rest.slice(0, -"/confirm-payment".length));
        const body = (await readBody(req, 8_192)) ?? {};
        const simulate = typeof body.simulate === "boolean" ? body.simulate : undefined;
        const result = await provisionVpsMmoOrder(orderId, {
          simulate,
          customFile: options.customFile,
          customPaymentsFile: options.customPaymentsFile,
          fetcher: options.fetcher,
        });
        return result.ok ? json(res, 200, { order: result.order }) : json(res, result.status, { error: result.error });
      }

      if (method === "GET") {
        const orderId = decodeURIComponent(rest);
        const order = getVpsMmoOrder(orderId, options.customFile);
        if (!order) return json(res, 404, { error: "Không tìm thấy đơn hàng VPS." });
        return json(res, 200, { order });
      }
      return json(res, 405, { error: "method not allowed" });
    }

    if (path === "/api/vpsmmo-cloud/webhook/sepay") {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = (await readBody(req, 32_768)) ?? {};
      const out = await handleVpsMmoSePayWebhook(body, {
        customFile: options.customFile,
        customPaymentsFile: options.customPaymentsFile,
        fetcher: options.fetcher,
      });
      return json(res, 200, out);
    }

    return json(res, 404, { error: "not found" });
  };
}
