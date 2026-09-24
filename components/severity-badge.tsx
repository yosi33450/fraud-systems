import { AlertTriangle, CircleAlert, CircleCheck, ShieldAlert } from "lucide-react";
import type { Severity } from "@/lib/types";

const config = {
  low: { label: "נמוך", Icon: CircleCheck },
  medium: { label: "בינוני", Icon: AlertTriangle },
  high: { label: "גבוה", Icon: CircleAlert },
  critical: { label: "קריטי", Icon: ShieldAlert },
} as const;

export function SeverityBadge({ severity, score }: { severity: Severity; score?: number }) {
  const { label, Icon } = config[severity];
  return (
    <span className={`severity severity-${severity}`}>
      <Icon aria-hidden="true" size={14} strokeWidth={2} />
      <span>{label}</span>
      {score === undefined ? null : <strong>{score}</strong>}
    </span>
  );
}
