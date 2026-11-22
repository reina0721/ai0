import { useEffect, useState, type ReactElement, type ReactNode } from "react";

export interface SpoilerMaskProps {
  children?: ReactNode;
  revealed?: boolean;
  label?: string;
  className?: string;
  onReveal?: () => void;
}

export function SpoilerMask(props: SpoilerMaskProps): ReactElement {
  const [localRevealed, setLocalRevealed] = useState(props.revealed === true);

  useEffect(() => {
    if (props.revealed !== undefined) {
      setLocalRevealed(props.revealed);
    }
  }, [props.revealed]);

  const revealed = props.onReveal ? props.revealed === true : localRevealed;

  const handleReveal = (): void => {
    setLocalRevealed(true);
    props.onReveal?.();
  };

  return (
    <section
      data-theatrical-subtext="true"
      data-revealed={revealed}
      className={`ai0-spoiler-mask${revealed ? " is-revealed" : ""}${props.className ? ` ${props.className}` : ""}`}
    >
      <div className="ai0-spoiler-mask__content" aria-hidden={!revealed}>
        {props.children}
      </div>
      {revealed ? null : (
        <button
          type="button"
          className="ai0-spoiler-mask__veil ai0-ripple-btn"
          aria-label={props.label ?? "Reveal theatrical subtext"}
          style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
          onClick={handleReveal}
        >
          <span aria-hidden="true">✦</span>
          <span>{props.label ?? "Reveal inner thought"}</span>
        </button>
      )}
    </section>
  );
}
