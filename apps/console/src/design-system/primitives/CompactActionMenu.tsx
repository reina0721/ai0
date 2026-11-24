import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { Ellipsis } from "lucide-react";
import { useId, useRef, useState } from "react";
import { RippleButton } from "./RippleButton.js";

export function CompactActionMenu({
  label,
  disabled,
  actions
}: {
  label: string;
  disabled?: boolean;
  actions: readonly { label: string; onSelect: () => void }[];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <RippleButton
        ref={trigger}
        variant="ghost"
        size="sm"
        disabled={disabled}
        title={label}
        ariaLabel={label}
        ariaExpanded={open}
        ariaHasPopup="menu"
        ariaControls={open ? id : undefined}
        onClick={() => setOpen(true)}
      >
        <Ellipsis size={16} />
      </RippleButton>
      <Menu
        anchorEl={trigger.current}
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{
          paper: { className: "ai0-compact-menu" },
          list: { id, "aria-label": label, className: "ai0-compact-menu__items" }
        }}
      >
        {actions.map((action) => (
          <MenuItem
            key={action.label}
            onClick={() => {
              setOpen(false);
              action.onSelect();
            }}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
