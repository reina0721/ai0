import { createTheme, StyledEngineProvider, ThemeProvider } from "@mui/material/styles";
import { defineShellStageModule, type Ai0ShellStageHostBridge, type Ai0ShellStageHostState } from "@ai0/sdk";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { WebChatWorkspace } from "./WebChatWorkspace.js";
import "./webchat.css";

function createStageTheme(mode: "light" | "dark", fallbackContainer: HTMLElement) {
  const portalRoot = () => document.querySelector<HTMLElement>("[data-console-root]") ?? fallbackContainer;
  return createTheme({
    cssVariables: { cssVarPrefix: "ai0-webchat-mui", nativeColor: true },
    palette: {
      mode,
      primary: { main: "var(--ai0-action-fill)", contrastText: "var(--ai0-action-text)" },
      secondary: { main: "var(--ai0-accent-secondary)" },
      text: {
        primary: "var(--ai0-on-surface)",
        secondary: "var(--ai0-on-surface-muted)",
        disabled: "var(--ai0-interaction-disabled)"
      },
      background: {
        default: "var(--ai0-surface-frame-base)",
        paper: "var(--ai0-surface-main-card)"
      },
      divider: "var(--ai0-line)",
      action: {
        hover: "var(--ai0-interaction-hover)",
        selected: "var(--ai0-accent-tint)",
        disabled: "var(--ai0-interaction-disabled)",
        disabledBackground: "var(--ai0-interaction-hover)"
      },
      error: { main: "var(--ai0-danger)" },
      warning: { main: "var(--ai0-warning)" },
      success: { main: "var(--ai0-success)" }
    },
    typography: {
      fontFamily: "var(--ai0-font-sans)",
      fontSize: 13,
      button: { textTransform: "none", fontWeight: 560 }
    },
    shape: { borderRadius: 8 },
    components: {
      MuiBackdrop: {
        styleOverrides: { root: { "&:not(.MuiBackdrop-invisible)": { backgroundColor: "var(--ai0-overlay)" } } }
      },
      MuiDialog: {
        defaultProps: { container: portalRoot, transitionDuration: 180 },
        styleOverrides: {
          paper: { border: "1px solid var(--ai0-line)", borderRadius: 14, boxShadow: "var(--ai0-shadow-float)" }
        }
      },
      MuiDrawer: {
        defaultProps: { ModalProps: { container: portalRoot }, transitionDuration: 220 },
        styleOverrides: {
          paper: { borderColor: "var(--ai0-line)", boxShadow: "var(--ai0-shadow-float)" }
        }
      },
      MuiPopover: { defaultProps: { container: portalRoot } },
      MuiPopper: { defaultProps: { container: portalRoot } },
      MuiMenu: {
        styleOverrides: { paper: { border: "1px solid var(--ai0-line)", boxShadow: "var(--ai0-shadow-float)" } }
      },
      MuiMenuItem: {
        defaultProps: { dense: true },
        styleOverrides: { root: { minHeight: 32, fontSize: "12.5px" } }
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundColor: "var(--ai0-surface-main-card)", backgroundImage: "none", color: "var(--ai0-on-surface)" }
        }
      },
      MuiButtonBase: {
        styleOverrides: {
          root: {
            "&.Mui-focusVisible": { outline: "2px solid var(--ai0-focus-ring)", outlineOffset: "-2px" }
          }
        }
      },
      MuiButton: {
        defaultProps: { size: "small", disableElevation: true },
        styleOverrides: {
          root: { minHeight: "var(--ai0-ctrl-height-md)", fontSize: "12.5px" }
        }
      },
      MuiInputBase: {
        styleOverrides: {
          root: { color: "inherit", font: "inherit" },
          input: {
            font: "inherit",
            "&::placeholder": { color: "var(--ai0-on-surface-subtle)", opacity: 1 },
            "&.Mui-disabled": { WebkitTextFillColor: "var(--ai0-interaction-disabled)" }
          }
        }
      },
      MuiTableCell: {
        styleOverrides: { root: { borderColor: "var(--ai0-line)" } }
      },
      MuiTooltip: {
        defaultProps: { arrow: true, enterDelay: 300 },
        styleOverrides: {
          tooltip: {
            backgroundColor: "var(--ai0-surface-container-high)",
            color: "var(--ai0-on-surface)",
            border: "1px solid var(--ai0-line)",
            boxShadow: "var(--ai0-shadow-float)",
            fontSize: "12px"
          },
          arrow: { color: "var(--ai0-surface-container-high)" }
        }
      }
    }
  });
}

function MountedWebChatApp({ host, container }: { host: Ai0ShellStageHostBridge; container: HTMLElement }) {
  const [hostState, setHostState] = useState<Ai0ShellStageHostState>(() => host.getState());

  useEffect(() => {
    setHostState(host.getState());
    return host.subscribe(setHostState);
  }, [host]);

  const [themes] = useState(() => ({
    light: createStageTheme("light", container),
    dark: createStageTheme("dark", container)
  }));

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={themes[hostState.appearance]}>
        <MotionConfig reducedMotion="user">
          <LazyMotion features={domAnimation}>
            <WebChatWorkspace host={host} hostState={hostState} />
          </LazyMotion>
        </MotionConfig>
      </ThemeProvider>
    </StyledEngineProvider>
  );
}

const stageModule = defineShellStageModule<HTMLElement>({
  extensionId: "builtin.webchat",
  mountShellStage(container, host) {
    const root = createRoot(container);
    root.render(<MountedWebChatApp host={host} container={container} />);
    return {
      unmount() {
        root.unmount();
      }
    };
  }
});

export const mountShellStage = stageModule.mountShellStage;
export default stageModule;
