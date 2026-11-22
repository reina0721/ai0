import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableContainer from "@mui/material/TableContainer";
import type { TableProps } from "@mui/material/Table";
import type { ComponentPropsWithoutRef, HTMLAttributes } from "react";

import { useConsole } from "../context/ConsoleContext.js";

export { default as WorkspaceTableBody } from "@mui/material/TableBody";
export { default as WorkspaceTableCell } from "@mui/material/TableCell";
export { default as WorkspaceTableHead } from "@mui/material/TableHead";
export { default as WorkspaceTableRow } from "@mui/material/TableRow";

type BlockProps = HTMLAttributes<HTMLElement>;
type BoxElement = "div" | "section" | "article" | "label" | "header" | "footer" | "span" | "small";

function classNames(base: string, className?: string): string {
  return className ? `${base} ${className}` : base;
}

export function WorkspacePage({ className, ...props }: BlockProps) {
  return <Box {...props} className={classNames("ai0-workspace", className)} />;
}

export function WorkspaceSection({ className, ...props }: BlockProps) {
  return <Paper component="section" variant="outlined" {...props}
    className={classNames("ai0-workspace-section", className)} />;
}

export function WorkspaceItem({ as = "div", className, ...props }: BlockProps & { as?: BoxElement }) {
  return <Box component={as} {...props} className={classNames("ai0-workspace-item", className)} />;
}

export function WorkspaceRow({ className, ...props }: BlockProps) {
  return <Box {...props} className={classNames("ai0-workspace-row", className)} />;
}

export function WorkspaceGrid({ as = "div", columns = 2, className, ...props }: BlockProps & {
  as?: "div" | "section" | "form";
  columns?: 2 | 3 | 4;
  onSubmit?: ComponentPropsWithoutRef<"form">["onSubmit"];
}) {
  return <Box component={as} {...props} data-columns={columns}
    className={classNames("ai0-workspace-grid", className)} />;
}

export function WorkspaceSplit({ className, ...props }: BlockProps) {
  return <Box {...props} className={classNames("ai0-workspace-split", className)} />;
}

export function WorkspaceField({ as = "div", className, ...props }: BlockProps & {
  as?: "div" | "label";
  htmlFor?: string;
}) {
  return <Box component={as} {...props} className={classNames("ai0-workspace-field", className)} />;
}

type StatusTone = "neutral" | "accent" | "info" | "good" | "warn" | "danger" | "live" | "sandbox";
type LabelProps = Omit<ComponentPropsWithoutRef<"span">, "color"> & { "data-tone"?: StatusTone };

export function WorkspaceStatus({ children, className, "data-tone": tone = "neutral", ...props }: LabelProps) {
  return <Chip component="span" size="small" {...props} label={children} data-tone={tone}
    className={classNames("ai0-workspace-status", className)} />;
}

export function WorkspaceTag({ className, ...props }: LabelProps) {
  return <WorkspaceStatus {...props} className={classNames("ai0-workspace-tag", className)} />;
}

export function WorkspaceLink({ href, className, onClick, ...props }: ComponentPropsWithoutRef<"a">) {
  const ctx = useConsole();
  const destination = href?.startsWith("/") ? ctx?.getConsoleHref(href) ?? href : href;
  return (
    <ButtonBase {...props} component="a" href={destination} className={classNames("ai0-workspace-link", className)}
      onClick={(event) => {
        if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
          onClick?.(event);
        }
      }} />
  );
}

type ChoiceProps = (ComponentPropsWithoutRef<"button"> & { href?: never }) |
  (ComponentPropsWithoutRef<"a"> & { href: string });

export function WorkspaceChoice(props: ChoiceProps) {
  if (props.href !== undefined) {
    const { className, ...anchor } = props;
    return <WorkspaceLink {...anchor} className={classNames("ai0-workspace-choice", className)} />;
  }
  const { type = "button", className, ...button } = props;
  return <ButtonBase {...button} type={type} className={classNames("ai0-workspace-choice", className)} />;
}

export function WorkspaceTable({ className, viewportHeight, ...props }: TableProps & { viewportHeight?: string }) {
  return (
    <TableContainer className="ai0-workspace-table-scroll" style={{ maxHeight: viewportHeight }}>
      <Table size="small" {...props} className={classNames("ai0-workspace-table", className)} />
    </TableContainer>
  );
}

export function WorkspaceCode({ className, ...props }: ComponentPropsWithoutRef<"pre">) {
  return <Box component="pre" {...props} className={classNames("ai0-workspace-code", className)} />;
}

export function WorkspaceDiff({ className, side, ...props }: BlockProps & { side: "before" | "after" }) {
  return <Box {...props} data-side={side} className={classNames("ai0-workspace-diff", className)} />;
}
