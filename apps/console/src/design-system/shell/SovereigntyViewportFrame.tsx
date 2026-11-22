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
      style={{
        height: "100vh",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: "0px",
        padding: "0px",
        overflow: "hidden",
        background: "var(--ai0-surface-frame-base)"
      }}
    >
      {props.topBar}
      {sandbox ? (
        <div className="ai0-sandbox-ribbon">
          <span>
            当前处于隔离沙盒环境（{props.targetInstance}）——所有时间推进、提示词调整与模拟事件均与正式存档完全隔离。
          </span>
          <a
            href="/sandbox/lab?mode=sandbox"
            onClick={(e) => {
              if (props.onNavigate) {
                e.preventDefault();
                props.onNavigate("/sandbox/lab?mode=sandbox");
              }
            }}
            style={{ color: "inherit", textDecoration: "underline", fontWeight: 600 }}
          >
            打开沙盒实验台
          </a>
        </div>
      ) : null}
      <div
        className="ai0-sovereignty-viewport-frame__workspace"
        style={{
          minHeight: 0,
          flex: 1,
          display: "grid",
          gridTemplateColumns: "auto minmax(0, 1fr) auto",
          gap: "0px",
          overflow: "hidden"
        }}
      >
        {props.navigationRail}
        {mainContent}
        {props.contextInspector}
      </div>
      {props.overlays}
    </div>
  );
}
