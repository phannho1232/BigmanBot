import type { CloudBackend } from "../../shared/wire";
import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { sameFields, useStoreSelector } from "@/state/store-select";

export function CloudBackendPicker({
  value,
  compact = false,
  onChange,
}: {
  value: CloudBackend;
  compact?: boolean;
  onChange: (backend: CloudBackend) => void;
}) {
  const state = useStoreSelector((s) => ({ config: s.config }), sameFields);
  useEffect(() => {
    if (!state.config?.cloudHome && value !== "vps") onChange("vps");
  }, [onChange, state.config?.cloudHome, value]);
  if (state.config?.cloudHome) return null;
  return (
    <div className="mt-3 rounded-lg bg-inset p-3">
      <div className="text-[12px] font-medium text-ink">{t("botAccess.cloud.selfHostedVps")}</div>
      <div className="mt-0.5 text-[12px] text-ink-secondary">
        {compact ? t("botAccess.cloud.vpsDescription") : t("botAccess.cloud.vpsAutoDescription")}
      </div>
    </div>
  );
}
