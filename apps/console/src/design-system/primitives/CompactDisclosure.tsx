import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import { ChevronDown } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useId, type ReactNode } from "react";

export interface CompactDisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onChange?: (expanded: boolean) => void;
}

export function CompactDisclosure({ summary, children, defaultExpanded, expanded, onChange }: CompactDisclosureProps) {
  const id = useId();
  const reducedMotion = useReducedMotion();
  return (
    <Accordion disableGutters elevation={0} defaultExpanded={defaultExpanded} expanded={expanded}
      className="ai0-compact-disclosure" onChange={onChange ? (_, next) => onChange(next) : undefined}
      slotProps={{ transition: { timeout: reducedMotion ? 0 : 190 } }}
      sx={{
        minWidth: 0,
        border: "1px solid var(--ai0-line)",
        borderRadius: "8px",
        "&::before": { display: "none" },
        "& .MuiAccordionSummary-root": { minHeight: "var(--ai0-ctrl-height-md)", px: 1, fontSize: 12, fontWeight: 600 },
        "& .MuiAccordionSummary-root:hover": { backgroundColor: "var(--ai0-interaction-hover)" },
        "& .MuiAccordionSummary-root.Mui-expanded": { color: "var(--ai0-accent-ink)" },
        "& .MuiAccordionSummary-content": { alignItems: "center", gap: 0.75, minWidth: 0, my: 0.5, overflowWrap: "anywhere" },
        "& .MuiAccordionDetails-root": { display: "grid", gap: 0.75, minWidth: 0, borderTop: "1px solid var(--ai0-line)", p: 1 }
      }}>
      <AccordionSummary id={`${id}-summary`} aria-controls={`${id}-details`}
        expandIcon={<ChevronDown size={14} aria-hidden="true" />}>
        {summary}
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
