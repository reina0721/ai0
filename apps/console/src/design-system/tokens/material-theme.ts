import { createTheme } from "@mui/material/styles";

function consoleRoot(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.querySelector("[data-console-root]");
}

function createConsoleMaterialTheme(mode: "light" | "dark") {
  return createTheme({
    cssVariables: { cssVarPrefix: "ai0-mui", nativeColor: true },
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
        defaultProps: { container: consoleRoot, transitionDuration: 180 },
        styleOverrides: {
          paper: { border: "1px solid var(--ai0-line)", borderRadius: 14, boxShadow: "var(--ai0-shadow-float)" }
        }
      },
      MuiDrawer: {
        defaultProps: { ModalProps: { container: consoleRoot }, transitionDuration: 220 },
        styleOverrides: {
          paper: { borderColor: "var(--ai0-line)", boxShadow: "var(--ai0-shadow-float)" }
        }
      },
      MuiPopover: { defaultProps: { container: consoleRoot } },
      MuiPopper: { defaultProps: { container: consoleRoot } },
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
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            backgroundColor: "var(--ai0-surface-container-low)",
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "var(--ai0-on-surface-subtle)" },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--ai0-focus-ring)" }
          },
          notchedOutline: { borderColor: "var(--ai0-line)" }
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

export const consoleMaterialThemes = {
  light: createConsoleMaterialTheme("light"),
  dark: createConsoleMaterialTheme("dark")
};
