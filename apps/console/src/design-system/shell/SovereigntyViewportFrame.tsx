import Link from "@mui/material/Link";
import type { ReactElement, ReactNode } from "react";

export type SovereigntyTargetInstance = "live" | `sandbox:${string}`;
export type SandboxFenceAccent = "amber" | "violet";

export interface SovereigntyViewportFrameProps {
  targetInstance: SovereigntyTargetInstance;
  sandboxAccent?: SandboxFenceAccent;
  topBar?: ReactNode;
  navigationRail?: ReactNode;
  main?: ReactNode;
  contextInspector?: ReactNode;
  children?: ReactNode;
  overlays?: ReactNode;
  className?: string;
  onNavigate?: (path: string) => void;
}

function fenceColors(
  targetInstance: SovereigntyTargetInstance,
  sandboxAccent: SandboxFenceAccent
): { primary: string; secondary?: string } {
  if (targetInstance === "live") return { primary: "#10B981" };
  return sandboxAccent === "violet"
    ? { primary: "#8B5CF6", secondary: "#F59E0B" }
    : { primary: "#F59E0B", secondary: "#8B5CF6" };
}

export function SovereigntyViewportFrame(
  props: SovereigntyViewportFrameProps
): ReactElement {
  const sandbox = props.targetInstance.startsWith("sandbox:");
  const colors = fenceColors(props.targetInstance, props.sandboxAccent ?? "amber");
  const mainContent = props.main ?? props.children;

  return (
    <div
      data-target-instance={props.targetInstance}
      data-sovereignty={sandbox ? "sandbox" : "live"}
      data-sovereignty-color={colors.primary}
      className={`ai0-sovereignty-viewport-frame${props.className ? ` ${props.className}` : ""}`}
    >
      {props.topBar}
      {sandbox ? (
        <div className="ai0-sandbox-ribbon">
          <span>
            <strong>SANDBOX</strong> · 时钟推进与模拟事件写入隔离实例。
          </span>
          <Link
            color="inherit"
            underline="always"
            href="/sandbox/lab?mode=sandbox"
            onClick={(e) => {
              if (props.onNavigate && e.button === 0 && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                props.onNavigate("/sandbox/lab?mode=sandbox");
              }
            }}
          >
            打开沙盒实验台
          </Link>
        </div>
      ) : null}
      <div className="ai0-sovereignty-viewport-frame__workspace">
        {props.navigationRail}
        {mainContent}
        {props.contextInspector}
      </div>
      {props.overlays}
    </div>
  );
}
