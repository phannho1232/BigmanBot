import { useEffect, useState } from "react";
import type { CloudAccountState, CloudPlanSnapshot } from "../../../electron/cloud-account.mjs";
import { cloudPlanLabel, cloudPlanView } from "@/lib/cloud-plan";
import { t } from "@/lib/i18n";
import { profileForSession, type SessionState } from "@/lib/session";
import { readSharedSessionState } from "@/lib/shared-session";
import { ensureCloudAccountSessionBridge, readStoredTemplateSession } from "@/lib/template-store";
import { useStoreSelector } from "@/state/store-select";

export interface AccountSummary {
  /** read from the account bridge, the plan bridge or the server session; null until it answers */
  signedIn: boolean | null;
  email: string | null;
  /** "Pro", "Free"; null where this page can't read the plan */
  plan: string | null;
  paid: boolean;
}

function fromAccount(account: CloudAccountState | null): AccountSummary {
  const view = cloudPlanView(account);
  if (!account || view.kind === "unknown") return { signedIn: null, email: null, plan: null, paid: false };
  const signedIn = ["connected", "unavailable", "reauth-required"].includes(account.status);
  const email = signedIn && "account" in account ? account.account?.email ?? null : null;
  const plan = view.kind === "paid" ? view.label : view.kind === "free" ? t("settings.account.free") : signedIn ? null : null;
  return { signedIn, email, plan, paid: view.kind === "paid" };
}

function fromPlan(plan: CloudPlanSnapshot | null): AccountSummary {
  if (!plan) return { signedIn: null, email: null, plan: null, paid: false };
  const paid = plan.status === "paid";
  return { signedIn: plan.status !== "none" && plan.status !== "signin", email: null, plan: paid ? cloudPlanLabel(plan.tier) : null, paid };
}

/** Who is signed in to MausBot on this device, as far as this page may know. */
export function useAccountSummary(): AccountSummary {
  const account = typeof window === "undefined" || window.ogb?.remoteClient?.active ? undefined : window.ogb?.cloudAccount;
  const planBridge = account ? undefined : typeof window === "undefined" ? undefined : window.ogb?.cloudPlan;
  const [summary, setSummary] = useState<AccountSummary>(() => {
    const stored = typeof window !== "undefined" ? readStoredTemplateSession() : null;
    return stored?.email ? { signedIn: true, email: stored.email, plan: null, paid: false } : { signedIn: null, email: null, plan: null, paid: false };
  });
  useEffect(() => {
    let alive = true;
    ensureCloudAccountSessionBridge();
    const withTemplateFallback = (base: AccountSummary): AccountSummary => {
      if (base.email) return base;
      const stored = typeof window !== "undefined" ? readStoredTemplateSession() : null;
      if (stored?.email) return { ...base, signedIn: true, email: stored.email };
      return base;
    };
    const syncTemplate = () => {
      if (!alive) return;
      const stored = typeof window !== "undefined" ? readStoredTemplateSession() : null;
      setSummary((prev) => {
        if (stored?.email) return { ...prev, signedIn: true, email: stored.email };
        if (!account && !planBridge) return { signedIn: null, email: null, plan: null, paid: false };
        return prev;
      });
    };
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("bigman-template-session-changed", syncTemplate);
    }
    if (account) {
      const off = account.onState((next) => { if (alive) setSummary(withTemplateFallback(fromAccount(next))); });
      void account.state().then((next) => { if (alive) setSummary(withTemplateFallback(fromAccount(next))); }).catch(() => {});
      return () => {
        alive = false;
        off();
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          window.removeEventListener("bigman-template-session-changed", syncTemplate);
        }
      };
    }
    if (planBridge) {
      void planBridge.state().then((next) => { if (alive) setSummary(withTemplateFallback(fromPlan(next))); }).catch(() => {});
      return () => {
        alive = false;
        if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
          window.removeEventListener("bigman-template-session-changed", syncTemplate);
        }
      };
    }
    syncTemplate();
    return () => {
      alive = false;
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("bigman-template-session-changed", syncTemplate);
      }
    };
  }, [account, planBridge]);
  return summary;
}

/** The name and photo the chrome shows for you, and the server session they came from. */
export function useYou(): { profile: { name?: string; email?: string; avatarUrl?: string } | undefined; session: SessionState | null } {
  const profile = useStoreSelector((state) => state.config?.profile);
  const [session, setSession] = useState<SessionState | null>(null);
  useEffect(() => {
    let alive = true;
    void readSharedSessionState().then((next) => { if (alive) setSession(next); });
    return () => { alive = false; };
  }, []);
  return { profile: profileForSession(profile, session), session };
}

/** "Pro · ada@example.com", "Not signed in"; in a browser, "Signed in to My Cloud". */
export function accountLine(summary: AccountSummary, { browser, place, openSource }: { browser: boolean; place: string; openSource: boolean }): string {
  if (browser) return summary.email ? `${summary.email} · ${t("settings.account.signedInTo", { place })}` : t("settings.account.signedInTo", { place });
  if (openSource) return summary.email ?? t("settings.account.onThisDevice");
  if (summary.signedIn === false) return t("settings.account.notSignedIn");
  return [summary.plan, summary.email].filter(Boolean).join(" · ") || t("settings.account.signedIn");
}
