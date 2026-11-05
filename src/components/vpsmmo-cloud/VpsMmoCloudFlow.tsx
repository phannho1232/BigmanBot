import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, Cpu, HardDrive, Loader2, QrCode, Server, Settings2, ShieldCheck, Sparkles, Wifi } from "lucide-react";
import {
  formatVnd,
  getVpsMmoPlan,
  VPSMMO_PLANS,
  type VpsMmoCloudOfferResponse,
  type VpsMmoCloudPublicConfig,
  type VpsMmoOrderPublic,
  type VpsMmoPlanSpec,
  type VpsMmoTier,
  type VpsMmoTimeOption,
} from "../../../shared/vpsmmo-cloud";
import { cn } from "@/lib/cn";
import { NightCard } from "../cloud-buy/NightCard";
import { BackLink, Checklist, FIELD, PRIMARY, ProgressBar, QUIET, SCREEN } from "../cloud-buy/parts";

type FlowScreen = "plans" | "checkout" | "provisioning" | "config";

const DEFAULT_CONFIG: VpsMmoCloudPublicConfig = {
  hasCredentials: false,
  osId: "100170",
  planIds: { starter: "2", pro: "3", max: "4", team: "6" },
  timeOption: 12,
  sandboxMode: true,
  customRootDomain: "",
  bank: {
    bankId: "MB",
    accountNo: "0988888888",
    accountName: "BIGMAN BOT CLOUD",
    fromVietnamPayments: false,
  },
};

async function fetchVpsMmoJson<T>(
  path: string,
  init?: RequestInit,
  customFetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<T> {
  const response = await customFetcher(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data?.error || `Yêu cầu thất bại (HTTP ${response.status}).`);
  }
  return data;
}

export function VpsMmoCloudFlow({
  profileEmail = null,
  onClose,
  onBack = null,
  fetcher = globalThis.fetch,
}: {
  profileEmail?: string | null;
  onClose: () => void;
  onBack?: (() => void) | null;
  fetcher?: typeof globalThis.fetch;
}) {
  const [screen, setScreen] = useState<FlowScreen>("plans");
  const [plans, setPlans] = useState<readonly VpsMmoPlanSpec[]>(VPSMMO_PLANS);
  const [config, setConfig] = useState<VpsMmoCloudPublicConfig>(DEFAULT_CONFIG);
  const [selectedTier, setSelectedTier] = useState<VpsMmoTier>("pro");
  const [cloudName, setCloudName] = useState("Bigman Cloud Pro");
  const [email, setEmail] = useState(profileEmail ?? "");
  const [order, setOrder] = useState<VpsMmoOrderPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [connectMessage, setConnectMessage] = useState<string | null>(null);

  const [cfgToken, setCfgToken] = useState("");
  const [cfgKeypass, setCfgKeypass] = useState("");
  const [cfgOsId, setCfgOsId] = useState("100170");
  const [cfgPlanStarter, setCfgPlanStarter] = useState("2");
  const [cfgPlanPro, setCfgPlanPro] = useState("3");
  const [cfgPlanMax, setCfgPlanMax] = useState("4");
  const [cfgPlanTeam, setCfgPlanTeam] = useState("6");
  const [cfgTimeOption, setCfgTimeOption] = useState<VpsMmoTimeOption>(12);
  const [cfgSandbox, setCfgSandbox] = useState(true);
  const [cfgRootDomain, setCfgRootDomain] = useState("");
  const [cfgBankId, setCfgBankId] = useState("MB");
  const [cfgAccountNo, setCfgAccountNo] = useState("0988888888");
  const [cfgAccountName, setCfgAccountName] = useState("BIGMAN BOT CLOUD");
  const [cfgSavedNote, setCfgSavedNote] = useState<string | null>(null);

  const syncFormFromConfig = (next: VpsMmoCloudPublicConfig) => {
    setConfig(next);
    setCfgOsId(next.osId);
    setCfgPlanStarter(next.planIds.starter);
    setCfgPlanPro(next.planIds.pro);
    setCfgPlanMax(next.planIds.max);
    setCfgPlanTeam(next.planIds.team);
    setCfgTimeOption(next.timeOption);
    setCfgSandbox(next.sandboxMode);
    setCfgRootDomain(next.customRootDomain);
    setCfgBankId(next.bank.bankId);
    setCfgAccountNo(next.bank.accountNo);
    setCfgAccountName(next.bank.accountName);
  };

  useEffect(() => {
    let alive = true;
    void fetchVpsMmoJson<VpsMmoCloudOfferResponse>("/api/vpsmmo-cloud/offer", undefined, fetcher)
      .then((res) => {
        if (!alive) return;
        if (Array.isArray(res.plans) && res.plans.length > 0) setPlans(res.plans);
        if (res.config) syncFormFromConfig(res.config);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [fetcher]);

  useEffect(() => {
    if (screen !== "checkout" || !order || order.step !== "waiting_payment") return;
    let alive = true;
    const timer = setInterval(() => {
      void fetchVpsMmoJson<{ order: VpsMmoOrderPublic }>(`/api/vpsmmo-cloud/orders/${encodeURIComponent(order.id)}`, undefined, fetcher)
        .then((res) => {
          if (!alive || !res.order) return;
          if (res.order.step !== "waiting_payment") {
            setOrder(res.order);
            setScreen("provisioning");
          }
        })
        .catch(() => {});
    }, 3_500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [screen, order, fetcher]);

  const copyText = (key: string, value: string) => {
    void navigator.clipboard?.writeText?.(value).catch(() => {});
    setCopiedField(key);
    setTimeout(() => {
      setCopiedField((cur) => (cur === key ? null : cur));
    }, 2_000);
  };

  const handleChoosePlan = async (tier: VpsMmoTier) => {
    const plan = getVpsMmoPlan(tier);
    const defaultCloudName = `Bigman Cloud ${plan.label}`;
    setSelectedTier(tier);
    setCloudName(defaultCloudName);
    setError(null);
    setBusy(true);
    try {
      const res = await fetchVpsMmoJson<{ order: VpsMmoOrderPublic }>(
        "/api/vpsmmo-cloud/orders",
        {
          method: "POST",
          body: JSON.stringify({
            tier,
            email: email.trim() || profileEmail || "khachhang@bigmanbot.vn",
            cloudName: defaultCloudName,
            color: "teal",
          }),
        },
        fetcher,
      );
      setOrder(res.order);
      setScreen("checkout");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể khởi tạo đơn hàng.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPayment = async (simulate: boolean) => {
    if (!order || busy) return;
    setError(null);
    setBusy(true);
    setScreen("provisioning");
    setOrder({
      ...order,
      cloudName: cloudName.trim() || order.cloudName,
      email: email.trim() || order.email,
      step: "creating_vps",
      sandbox: simulate,
    });
    try {
      const res = await fetchVpsMmoJson<{ order: VpsMmoOrderPublic }>(
        `/api/vpsmmo-cloud/orders/${encodeURIComponent(order.id)}/confirm-payment`,
        {
          method: "POST",
          body: JSON.stringify({ simulate }),
        },
        fetcher,
      );
      setOrder(res.order);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Không thể khởi tạo VPS.";
      setError(msg);
      setOrder((cur) => (cur ? { ...cur, step: "failed", error: msg } : cur));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveConfig = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setCfgSavedNote(null);
    try {
      const res = await fetchVpsMmoJson<{ ok: boolean; config: VpsMmoCloudPublicConfig }>(
        "/api/vpsmmo-cloud/config",
        {
          method: "PUT",
          body: JSON.stringify({
            ...(cfgToken.trim() ? { token: cfgToken.trim() } : {}),
            ...(cfgKeypass.trim() ? { keypass: cfgKeypass.trim() } : {}),
            osId: cfgOsId.trim() || "100170",
            planIds: {
              starter: cfgPlanStarter.trim() || "2",
              pro: cfgPlanPro.trim() || "3",
              max: cfgPlanMax.trim() || "4",
              team: cfgPlanTeam.trim() || "6",
            },
            timeOption: cfgTimeOption,
            sandboxMode: cfgSandbox,
            customRootDomain: cfgRootDomain.trim(),
            bankId: cfgBankId.trim(),
            accountNo: cfgAccountNo.trim(),
            accountName: cfgAccountName.trim(),
          }),
        },
        fetcher,
      );
      syncFormFromConfig(res.config);
      setCfgToken("");
      setCfgKeypass("");
      setCfgSavedNote("Đã lưu cấu hình API portal.vpsmmo.vn & VietQR thành công!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể lưu cấu hình.");
    } finally {
      setBusy(false);
    }
  };

  const handleConnectServer = async () => {
    if (!order?.vps) return;
    setConnectMessage(null);
    if (order.sandbox) {
      copyText("pairingUrl", order.vps.pairingUrl);
      setConnectMessage(
        "Đây là máy chủ giả lập (Sandbox 0đ) để kiểm thử quy trình. Liên kết ghép nối đã được sao chép! Khi tạo VPS thật qua API portal.vpsmmo.vn, nút này sẽ kết nối thẳng vào máy chủ của bạn.",
      );
      return;
    }
    try {
      const added = await window.ogb?.workspaces?.add?.("link", order.vps.pairingUrl);
      if (added !== false) {
        onClose();
      }
    } catch {
      copyText("pairingUrl", order.vps.pairingUrl);
      setConnectMessage("Đã sao chép đường dẫn ghép nối máy chủ vào bộ nhớ tạm.");
    }
  };

  const chosenPlan = getVpsMmoPlan(selectedTier);

  if (screen === "config") {
    return (
      <form data-cloud-add="vpsmmo-config" onSubmit={(e) => void handleSaveConfig(e)} className={SCREEN}>
        <div className="flex items-center justify-between gap-3">
          <BackLink label="Quay lại bảng giá" onClick={() => { setError(null); setCfgSavedNote(null); setScreen("plans"); }} />
          <span className="rounded-full bg-accent/12 px-3 py-1 text-[12px] font-medium text-accent-text">
            portal.vpsmmo.vn Reseller API
          </span>
        </div>
        <div>
          <h2 id="cloud-add-title" tabIndex={-1} className="text-[18px] font-semibold text-ink outline-none">
            Cấu hình Trạm API VPSMMO.vn & Cổng Thanh toán VietQR
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">
            Nhập mã <code>token</code>, <code>keypass</code>, <code>plan</code> và <code>os</code> do đội ngũ hỗ trợ{" "}
            <strong>vpsmmo.vn</strong> cung cấp. Khi bật <strong>Chế độ Sandbox (Dùng thử 0đ)</strong>, bạn có thể kiểm thử toàn bộ quy trình mua & khởi tạo VPS mà không bị trừ tiền.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
            <span>
              Reseller Token API{" "}
              {config.hasCredentials && (
                <span className="text-[12px] font-normal text-accent-text">(Đã lưu: {config.maskedToken})</span>
              )}
            </span>
            <input
              type="password"
              value={cfgToken}
              onChange={(e) => setCfgToken(e.target.value)}
              placeholder={config.hasCredentials ? "Để trống nếu giữ nguyên Token cũ" : "Nhập mã token từ vpsmmo.vn"}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
            <span>Reseller KeyPass API</span>
            <input
              type="password"
              value={cfgKeypass}
              onChange={(e) => setCfgKeypass(e.target.value)}
              placeholder={config.hasCredentials ? "Để trống nếu giữ nguyên KeyPass cũ" : "Nhập mã keypass từ vpsmmo.vn"}
              className={FIELD}
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
            <span>Mã OS / Golden Image Template ID</span>
            <input
              type="text"
              value={cfgOsId}
              onChange={(e) => setCfgOsId(e.target.value)}
              placeholder="100170"
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
            <span>Chu kỳ gọi API tạo VPS (time-option)</span>
            <select
              value={cfgTimeOption}
              onChange={(e) => setCfgTimeOption(Number(e.target.value) as VpsMmoTimeOption)}
              className={FIELD}
            >
              <option value={12}>12 tháng (Bán chính thức 1 năm)</option>
              <option value={6}>6 tháng</option>
              <option value={3}>3 tháng</option>
              <option value={1}>1 tháng (Dùng khi Dev test tạo VPS thật)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">
            <span>Tên miền gốc Cloudflare (Tuỳ chọn)</span>
            <input
              type="text"
              value={cfgRootDomain}
              onChange={(e) => setCfgRootDomain(e.target.value)}
              placeholder="Để trống = dùng sslip.io (Cách A)"
              className={FIELD}
            />
          </label>
        </div>

        <div className="rounded-xl border border-hairline/70 bg-inset/50 p-3.5">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-secondary">
            Mã Plan ID trên portal.vpsmmo.vn (Mục VPS Linux)
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>Starter (Plan 2)</span>
              <input value={cfgPlanStarter} onChange={(e) => setCfgPlanStarter(e.target.value)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>Pro (Plan 3)</span>
              <input value={cfgPlanPro} onChange={(e) => setCfgPlanPro(e.target.value)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>Max (Plan 4)</span>
              <input value={cfgPlanMax} onChange={(e) => setCfgPlanMax(e.target.value)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>Team (Plan 6)</span>
              <input value={cfgPlanTeam} onChange={(e) => setCfgPlanTeam(e.target.value)} className={FIELD} />
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-hairline/70 bg-inset/50 p-3.5">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-ink-secondary">
            Tài khoản Ngân hàng Nhận tiền VietQR
          </p>
          <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>Mã Ngân hàng (MB, VCB, TCB, ACB...)</span>
              <input value={cfgBankId} onChange={(e) => setCfgBankId(e.target.value)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>Số tài khoản</span>
              <input value={cfgAccountNo} onChange={(e) => setCfgAccountNo(e.target.value)} className={FIELD} />
            </label>
            <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
              <span>Tên chủ tài khoản (Không dấu)</span>
              <input value={cfgAccountName} onChange={(e) => setCfgAccountName(e.target.value)} className={FIELD} />
            </label>
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-hairline/70 bg-card px-4 py-3 text-[13px] text-ink">
          <input
            type="checkbox"
            checked={cfgSandbox}
            onChange={(e) => setCfgSandbox(e.target.checked)}
            className="size-4 accent-accent"
          />
          <div>
            <span className="font-semibold">Bật chế độ Dùng thử / Dev Sandbox (0đ)</span>
            <p className="text-[12px] text-ink-secondary">
              Cho phép giả lập thanh toán và kiểm thử toàn bộ quy trình 3 bước khởi tạo VPS mà không gọi trừ tiền thật trên portal.vpsmmo.vn.
            </p>
          </div>
        </label>

        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {cfgSavedNote && <p role="status" className="text-[13px] font-medium text-accent-text">{cfgSavedNote}</p>}

        <div className="flex items-center justify-end gap-3">
          <button type="button" className={QUIET} onClick={() => setScreen("plans")}>
            Quay lại
          </button>
          <button type="submit" disabled={busy} className={PRIMARY}>
            {busy ? "Đang lưu..." : "Lưu cấu hình"}
          </button>
        </div>
      </form>
    );
  }

  if (screen === "checkout" && order) {
    return (
      <div data-cloud-add="vpsmmo-checkout" className={SCREEN}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <BackLink label="Chọn gói khác" onClick={() => { setError(null); setScreen("plans"); }} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-3 py-1 text-[12px] font-medium text-accent-text">
            <QrCode size={13} /> Thanh toán VietQR NAPAS 247 · Chu kỳ 12 tháng
          </span>
        </div>

        <div>
          <h2 id="cloud-add-title" tabIndex={-1} className="text-[19px] font-semibold text-ink outline-none">
            Thanh toán & Khởi tạo Máy chủ Bigman Bot Cloud ({order.planLabel})
          </h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            Quét mã VietQR bên dưới bằng ứng dụng Ngân hàng hoặc dùng nút <strong>Giả lập Đã Thanh Toán (Sandbox 0đ)</strong> để kiểm thử ngay lập tức.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-hairline/80 bg-card p-4">
              <div className="flex items-baseline justify-between gap-2 border-b border-hairline/60 pb-3">
                <div>
                  <span className="text-[15px] font-semibold text-ink">Gói Bigman Bot Cloud {order.planLabel}</span>
                  <span className="ms-2 rounded-md bg-ink/[0.06] px-2 py-0.5 text-[11px] font-medium text-ink-secondary">
                    {order.portalPlanName}
                  </span>
                </div>
                <div className="text-end">
                  <span className="text-[18px] font-semibold text-ink">{formatVnd(order.amountVnd)}</span>
                  <span className="block text-[11px] text-ink-tertiary">
                    ({formatVnd(order.monthlyEquivalentVnd)}/tháng × 12 tháng)
                  </span>
                </div>
              </div>
              <ul className="mt-3 grid grid-cols-1 gap-1.5 text-[12.5px] text-ink-secondary sm:grid-cols-2">
                {chosenPlan.highlights.map((line) => (
                  <li key={line} className="flex items-center gap-1.5">
                    <Check size={13} className="shrink-0 text-accent-text" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-secondary">
                <span>Tên máy chủ hiển thị trên thanh bên trái</span>
                <input
                  value={cloudName}
                  onChange={(e) => setCloudName(e.target.value)}
                  placeholder="Bigman Cloud Pro"
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] font-medium text-ink-secondary">
                <span>Email nhận thông tin VPS & gia hạn</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ban@congty.vn"
                  className={FIELD}
                />
              </label>
            </div>

            <div className="rounded-xl border border-hairline/70 bg-inset/60 p-3.5 text-[13px]">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <span className="text-[11px] text-ink-tertiary">Ngân hàng thụ hưởng</span>
                  <p className="font-semibold text-ink">{order.bank.bankId}</p>
                </div>
                <div>
                  <span className="text-[11px] text-ink-tertiary">Chủ tài khoản</span>
                  <p className="font-semibold text-ink">{order.bank.accountName}</p>
                </div>
                <div>
                  <span className="text-[11px] text-ink-tertiary">Số tài khoản</span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-ink">{order.bank.accountNo}</span>
                    <button
                      type="button"
                      onClick={() => copyText("acc", order.bank.accountNo)}
                      className="inline-flex items-center gap-1 text-[11px] text-accent-text hover:underline"
                    >
                      <Copy size={11} /> {copiedField === "acc" ? "Đã chép" : "Chép"}
                    </button>
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-ink-tertiary">Nội dung chuyển khoản (Tự động duyệt)</span>
                  <div className="flex items-center gap-2">
                    <span data-vpsmmo-order-code className="rounded bg-accent/15 px-1.5 py-0.5 font-mono font-semibold text-accent-text">
                      {order.orderCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => copyText("code", order.orderCode)}
                      className="inline-flex items-center gap-1 text-[11px] text-accent-text hover:underline"
                    >
                      <Copy size={11} /> {copiedField === "code" ? "Đã chép" : "Chép"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 rounded-2xl border border-accent/30 bg-accent/[0.06] p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink">
                  Bảng Điều khiển Kiểm thử & Kích hoạt Nhanh (Dành cho Dev / Admin)
                </span>
                <button
                  type="button"
                  onClick={() => setScreen("config")}
                  className="text-[12px] font-medium text-accent-text underline underline-offset-2 hover:text-ink"
                >
                  Cấu hình Token API
                </button>
              </div>
              <p className="text-[12px] leading-relaxed text-ink-secondary">
                Bạn có thể bấm <strong>Giả lập Đã Thanh Toán (0đ)</strong> để chạy thử toàn bộ 3 bước khởi tạo VPS & cấp tên miền HTTPS{" "}
                <code>sslip.io</code> ngay bây giờ, hoặc gọi trực tiếp API <code>portal.vpsmmo.vn</code> khi đã nạp tiền & điền Token.
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  data-vpsmmo-simulate-pay
                  disabled={busy}
                  onClick={() => void handleConfirmPayment(true)}
                  className={cn(PRIMARY, "inline-flex items-center gap-2")}
                >
                  <Sparkles size={15} />
                  Giả lập Đã Thanh Toán (Dùng thử Sandbox 0đ)
                </button>
                <button
                  type="button"
                  data-vpsmmo-live-pay
                  disabled={busy}
                  onClick={() => {
                    if (!config.hasCredentials) {
                      setScreen("config");
                      setError("Vui lòng nhập Token và KeyPass API từ portal.vpsmmo.vn trước khi tạo VPS thật.");
                      return;
                    }
                    void handleConfirmPayment(false);
                  }}
                  className="ui-button inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-[13px] font-medium"
                >
                  <Server size={14} />
                  Gọi API portal.vpsmmo.vn Tạo VPS Thật ({config.timeOption} tháng)
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-center justify-center rounded-2xl border border-hairline/80 bg-card p-5 text-center">
            <span className="text-[12px] font-semibold uppercase tracking-wider text-ink-secondary">
              Quét mã VietQR bằng App Ngân hàng
            </span>
            <div className="my-3 overflow-hidden rounded-xl border border-hairline/60 bg-white p-2.5 shadow-sm">
              <img
                src={order.qrImageUrl}
                alt={`Mã VietQR thanh toán ${formatVnd(order.amountVnd)}`}
                className="mx-auto h-[230px] w-[230px] object-contain"
              />
            </div>
            <p className="text-[14px] font-semibold text-ink">{formatVnd(order.amountVnd)}</p>
            <p className="mt-0.5 text-[12px] text-ink-secondary">
              Nội dung CK: <strong className="font-mono text-ink">{order.orderCode}</strong>
            </p>
            <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-inset px-3 py-1.5 text-[12px] text-ink-secondary">
              <Loader2 size={13} className="animate-spin text-accent-text" />
              <span>Tự động kích hoạt VPS ngay khi nhận chuyển khoản</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "provisioning" && order) {
    const isReady = order.step === "ready";
    const isFailed = order.step === "failed";
    const stepIndex = isReady ? 3 : order.step === "configuring_domain" ? 1 : 0;
    const progressValue = isReady ? 1 : order.step === "configuring_domain" ? 0.68 : 0.35;

    return (
      <div data-cloud-add={isReady ? "vpsmmo-ready" : "vpsmmo-provisioning"} className={SCREEN}>
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/12 px-3 py-1 text-[12px] font-medium text-accent-text">
            {order.sandbox ? "Chế độ Kiểm thử Sandbox (0đ)" : "Kết nối API portal.vpsmmo.vn"} · Gói {order.planLabel}
          </span>
          {isFailed && (
            <BackLink label="Quay lại thanh toán" onClick={() => { setError(null); setScreen("checkout"); }} />
          )}
        </div>

        <div>
          <h2 id="cloud-add-title" tabIndex={-1} className="text-[19px] font-semibold text-ink outline-none">
            {isReady
              ? `Máy chủ “${order.cloudName}” đã sẵn sàng hoạt động 24/7!`
              : isFailed
                ? "Không thể hoàn tất khởi tạo máy chủ VPS"
                : `Đang khởi tạo máy chủ “${order.cloudName}” trên hạ tầng Việt Nam...`}
          </h2>
          <p className="mt-1 text-[13px] text-ink-secondary">
            {isReady
              ? "Máy chủ Linux của bạn đã được cấp địa chỉ IP Public Việt Nam và kích hoạt chứng chỉ bảo mật HTTPS tự động."
              : isFailed
                ? "Đã xảy ra lỗi khi gọi API khởi tạo VPS. Vui lòng kiểm tra lại cấu hình Token/KeyPass hoặc số dư Reseller trên portal.vpsmmo.vn."
                : "Quá trình cấp phát tài nguyên NVMe, IP Public VN và cấu hình HTTPS tự động chỉ mất vài giây."}
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <ProgressBar value={progressValue} label="Tiến trình khởi tạo máy chủ" />
          <Checklist
            label="Các bước khởi tạo"
            items={[
              {
                key: "creating_vps",
                title: `Gọi API portal.vpsmmo.vn khởi tạo ${order.portalPlanName} (${chosenPlan.vcpu} vCPU · ${chosenPlan.ramGb} GB RAM · ${chosenPlan.diskGb} GB NVMe)`,
                state: stepIndex > 0 ? "done" : isFailed ? "next" : "now",
              },
              {
                key: "configuring_domain",
                title: "Cấp phát IP Public Việt Nam (Uplink 10 Gbps) & kích hoạt chứng chỉ bảo mật HTTPS tự động",
                state: stepIndex > 1 ? "done" : stepIndex === 1 ? "now" : "next",
              },
              {
                key: "ready",
                title: "Khởi động Bigman Bot Server 24/7 & tạo đường dẫn ghép nối bảo mật",
                state: isReady ? "done" : "next",
              },
            ]}
          />
        </div>

        {isFailed && (order.error || error) && (
          <div role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-[13px] text-danger">
            <p className="font-semibold">Chi tiết phản hồi từ hệ thống:</p>
            <p className="mt-1">{order.error || error}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setScreen("config")} className="ui-button text-[12px]">
                Kiểm tra lại Token & Plan ID
              </button>
              <button type="button" onClick={() => void handleConfirmPayment(true)} className="ui-button text-[12px]">
                Chuyển sang Chế độ Giả lập Sandbox (0đ)
              </button>
            </div>
          </div>
        )}

        {isReady && order.vps && (
          <div data-vpsmmo-ready-card className="rounded-2xl border border-accent/35 bg-card p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <span className="text-[11px] uppercase tracking-wider text-ink-tertiary">Mã máy chủ VPS (ID)</span>
                <p className="font-mono text-[14px] font-semibold text-ink">{order.vps.vpsId}</p>
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-wider text-ink-tertiary">Địa chỉ IP Public Việt Nam</span>
                <p data-vpsmmo-ip className="font-mono text-[14px] font-semibold text-ink">{order.vps.ip}</p>
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-wider text-ink-tertiary">Địa chỉ kết nối bảo mật (HTTPS)</span>
                <p data-vpsmmo-domain className="font-mono text-[13px] font-semibold text-accent-text">{order.vps.origin}</p>
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-wider text-ink-tertiary">Thời hạn sử dụng (12 Tháng)</span>
                <p className="text-[13px] font-medium text-ink">
                  {order.vps.dateStart.slice(0, 10)} → {order.vps.dateEnd.slice(0, 10)}
                </p>
              </div>
            </div>

            <div className="mt-4 border-t border-hairline/60 pt-3.5">
              <span className="text-[12px] font-medium text-ink-secondary">
                Đường dẫn ghép nối máy chủ (Pairing Link):
              </span>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  readOnly
                  value={order.vps.pairingUrl}
                  className={cn(FIELD, "font-mono text-[12.5px]")}
                />
                <button
                  type="button"
                  onClick={() => copyText("pairingUrl", order.vps!.pairingUrl)}
                  className="ui-button shrink-0 px-3 py-2 text-[12.5px]"
                >
                  {copiedField === "pairingUrl" ? "Đã sao chép!" : "Sao chép"}
                </button>
              </div>
            </div>

            {connectMessage && (
              <p role="status" className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-[12.5px] text-accent-text">
                {connectMessage}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button type="button" className={QUIET} onClick={onClose}>
            Đóng
          </button>
          {isReady && order.vps && (
            <button
              type="button"
              data-vpsmmo-connect
              onClick={() => void handleConnectServer()}
              className={PRIMARY}
            >
              Kết nối “{order.cloudName}” vào Bigman Bot
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-cloud-add="vpsmmo-offer" className={SCREEN}>
      {onBack && (
        <div className="-mb-2">
          <BackLink label="Quay lại" onClick={onBack} />
        </div>
      )}

      <NightCard>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 id="cloud-add-title" tabIndex={-1} className="text-[18px] font-semibold leading-6 tracking-[-0.008em] outline-none!">
              Bigman Bot Cloud — Máy chủ VPS Việt Nam 24/7
            </h2>
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white/90">
              Chu kỳ 1 Năm (12 Tháng)
            </span>
          </div>
          <button
            type="button"
            data-vpsmmo-open-config
            onClick={() => { setError(null); setCfgSavedNote(null); setScreen("config"); }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/90 transition-colors hover:bg-white/20"
          >
            <Settings2 size={13} />
            <span>
              {config.sandboxMode
                ? "Chế độ Dùng thử Sandbox (0đ) · Cấu hình API"
                : "Đã nối API portal.vpsmmo.vn · Cấu hình"}
            </span>
          </button>
        </div>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/80">
          Chạy các bot, trình duyệt tự động và tác vụ định kỳ của bạn xuyên suốt 24/7 trên máy chủ VPS Linux tốc độ cao đặt tại Việt Nam (Uplink 10 Gbps · Ổ cứng NVMe · Backup tự động hàng tuần), ngay cả khi bạn đã tắt máy tính cá nhân.
        </p>
      </NightCard>

      {error && (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}

      <section aria-labelledby="vpsmmo-plans-heading">
        <h3 id="vpsmmo-plans-heading" className="sr-only">
          Chọn gói máy chủ Bigman Bot Cloud
        </h3>
        <ul className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((plan) => {
            const isPopular = Boolean(plan.popular);
            return (
              <li
                key={plan.tier}
                data-vpsmmo-plan={plan.tier}
                className={cn(
                  "flex flex-col justify-between gap-4 rounded-[16px] p-4 transition-colors",
                  isPopular
                    ? "border-[1.5px] border-accent/65 bg-card shadow-sm"
                    : "border border-hairline/80 bg-card/60 hover:border-hairline",
                )}
              >
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <h4 className="text-[16px] font-semibold text-ink">{plan.label}</h4>
                      {isPopular ? (
                        <span
                          data-vpsmmo-popular
                          className="rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold text-accent-text"
                        >
                          Phổ biến nhất
                        </span>
                      ) : (
                        <span className="rounded-md bg-ink/[0.05] px-2 py-0.5 text-[11px] text-ink-tertiary">
                          24/7 Cloud VN
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-[24px] font-bold tracking-tight text-ink tabular-nums">
                        {formatVnd(plan.monthlyVnd)}
                      </span>
                      <span className="text-[12.5px] text-ink-secondary">/tháng</span>
                    </div>
                    <p className="text-[12px] font-medium text-accent-text">
                      Thanh toán 1 năm: {formatVnd(plan.yearlyVnd)} / năm
                    </p>
                    <p className="mt-1 text-[12.5px] leading-snug text-ink-secondary">{plan.tagline}</p>
                  </div>

                  <ul className="flex flex-col gap-2 border-t border-hairline/60 pt-3 text-[12.5px] leading-snug text-ink">
                    {plan.highlights.map((feature) => (
                      <li key={feature} className="flex items-start gap-2">
                        <Check size={14} className="mt-0.5 shrink-0 text-accent-text" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col gap-1.5 pt-1">
                  <button
                    type="button"
                    data-vpsmmo-select={plan.tier}
                    disabled={busy}
                    onClick={() => void handleChoosePlan(plan.tier)}
                    className={cn(
                      "ui-button w-full justify-center rounded-[10px] px-3 py-2 text-[13px] font-semibold",
                      isPopular && "ui-button-primary",
                    )}
                  >
                    Chọn gói {plan.label}
                  </button>
                  <p className="text-center text-[11px] text-ink-tertiary">
                    Hoạt động 24/7 · Kích hoạt tự động qua VietQR
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="vpsmmo-includes-heading" className="flex flex-col gap-2.5">
        <h3 id="vpsmmo-includes-heading" className="text-[13px] font-semibold text-ink-secondary">
          Mọi gói máy chủ Bigman Bot Cloud đều bao gồm
        </h3>
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <li className="flex flex-col gap-1 rounded-[12px] bg-ink/[0.03] px-3.5 py-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Wifi size={14} className="text-accent-text" /> Datacenter Việt Nam 10 Gbps
            </span>
            <span className="text-[12px] leading-relaxed text-ink-secondary">
              Độ trễ cực thấp khi kết nối Zalo, Telegram, Facebook, TikTok và các trang web nội địa, không lo đứt cáp quang biển.
            </span>
          </li>
          <li className="flex flex-col gap-1 rounded-[12px] bg-ink/[0.03] px-3.5 py-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <ShieldCheck size={14} className="text-accent-text" /> Bảo mật riêng tư & Truy cập mọi nơi
            </span>
            <span className="text-[12px] leading-relaxed text-ink-secondary">
              Mã hoá kết nối SSL/HTTPS riêng biệt, giúp bạn và đội nhóm điều khiển Bot an toàn từ máy tính hoặc điện thoại ở bất kỳ đâu.
            </span>
          </li>
          <li className="flex flex-col gap-1 rounded-[12px] bg-ink/[0.03] px-3.5 py-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <Cpu size={14} className="text-accent-text" /> Tự động cài đặt & vận hành 24/7
            </span>
            <span className="text-[12px] leading-relaxed text-ink-secondary">
              Máy chủ được cài sẵn Bigman Bot Server và tự động khởi chạy liên tục 24/7 ngay khi hoàn tất thanh toán VietQR.
            </span>
          </li>
          <li className="flex flex-col gap-1 rounded-[12px] bg-ink/[0.03] px-3.5 py-3">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink">
              <HardDrive size={14} className="text-accent-text" /> Sao lưu tự động hàng tuần
            </span>
            <span className="text-[12px] leading-relaxed text-ink-secondary">
              Lưu trữ tự động 2 bản sao lưu (Backup) hàng tuần trên hạ tầng NVMe cùng cam kết không giới hạn băng thông.
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
