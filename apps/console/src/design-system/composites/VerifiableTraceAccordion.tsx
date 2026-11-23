import type { ReactElement } from "react";
import { CompactDisclosure, StatusBadge, SpoilerMask } from "../primitives/index.js";
import type { VerifiableTurnTrace } from "@ai0/protocol";

export interface VerifiableTraceAccordionProps {
  trace: VerifiableTurnTrace & {
    steps: VerifiableTurnTrace["steps"] & {
      step5_subtext_and_affect?: { theatrical_subtext?: TheatricalSubtext };
      step8_delivery_receipt: (VerifiableTurnTrace["steps"]["step8_delivery_receipt"] & {
        unsaid_remainder?: string;
      }) | null;
    };
  };
  openStep?: number;
  revealedSubtext?: boolean;
  unsaidRemainder?: string;
  onStepChange?: (step: number) => void;
  onRevealSubtext?: () => void;
}

interface TheatricalSubtext {
  masked_placeholder?: string;
  raw_text?: string;
}

const STEP_LABELS = ["Perception", "Gate & safety", "Memory recall", "Homeostasis", "Strategy & affect", "Tool authorization", "Emitted intent", "Delivery receipt"] as const;
const STEP_KEYS = ["step1_perception", "step2_gate_safety", "step3_memory_recall", "step4_homeostasis", "step5_strategy_proposal", "step6_tool_auth", "step7_emitted_intent", "step8_delivery_receipt"] as const;

function compact(value: unknown): string {
  const json = JSON.stringify(value) ?? "undefined";
  return json.length > 280 ? `${json.slice(0, 277)}…` : json;
}

export function VerifiableTraceAccordion(props: VerifiableTraceAccordionProps): ReactElement {
  const stepFive = props.trace.steps.step5_strategy_proposal;
  const theatricalSubtext = props.trace.steps.step5_subtext_and_affect?.theatrical_subtext
    ?? stepFive.theatrical_subtext;
  const receiptRemainder = props.trace.steps.step8_delivery_receipt?.unsaid_remainder;
  return <section className="ai0-verifiable-trace-accordion" aria-label="Verifiable turn trace"
    style={{ display: "grid", gap: "1px", background: "var(--ai0-border-subtle)" }}>
    <header style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px", background: "var(--ai0-surface-container-low)" }}>
      <StatusBadge tone="info">8-step trace</StatusBadge><code>{props.trace.trace_id}</code><small>{props.trace.target_instance}</small>
    </header>
    {STEP_KEYS.map((key, index) => {
      const step = props.trace.steps[key];
      const open = props.openStep === index + 1;
      return <CompactDisclosure key={key} expanded={props.openStep === undefined ? undefined : open}
        onChange={props.onStepChange ? () => props.onStepChange?.(index + 1) : undefined}
        summary={<><StatusBadge tone="neutral">{index + 1}</StatusBadge>{STEP_LABELS[index]}</>}>
        {key === "step5_strategy_proposal" ? <SpoilerMask revealed={props.revealedSubtext}
          label={theatricalSubtext.masked_placeholder} onReveal={props.onRevealSubtext}>
          <p>{theatricalSubtext.raw_text}</p>
        </SpoilerMask> : <pre style={{ margin: "7px 0 0", whiteSpace: "pre-wrap" }}>{compact(step)}</pre>}
        {key === "step8_delivery_receipt" && (props.unsaidRemainder ?? receiptRemainder) ? <mark style={{ display: "block", marginTop: "7px" }}>
          Unsaid remainder: {props.unsaidRemainder ?? receiptRemainder}
        </mark> : null}
      </CompactDisclosure>;
    })}
  </section>;
}
