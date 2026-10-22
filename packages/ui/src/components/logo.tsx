import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

// Caimex Desktop: the "CAIMEx" wordmark, matching the terminal one (packages/tui/src/logo.ts).
/**
 * Capitals drawn as one heavy 5-unit stroke with square corners and open terminals, on a
 * 36-unit cap height, letters 8 apart. The lowercase x sits on the baseline (x-height 20) and is
 * built from the same strokes; it takes the interactive (accent) colour. Same glyphs as
 * typography/wordmark/wordmark.tsx.
 */
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 165 36"
      fill="none"
      role="img"
      aria-label="CAIMEx"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      {/* C */}
      <path d="M22 5H5V31H22V36H0V0H22V5Z" fill="var(--icon-strong-base)" fill-rule="evenodd" />
      {/* A */}
      <path
        d="M30 36V0H52V36H47V19.5H35V36H30ZM35 5V14.5H47V5H35Z"
        fill="var(--icon-strong-base)"
        fill-rule="evenodd"
      />
      {/* I */}
      <path d="M60 0H65V36H60V0Z" fill="var(--icon-strong-base)" fill-rule="evenodd" />
      {/* M */}
      <path d="M73 36V0H107V36H102V5H92.5V36H87.5V5H78V36H73Z" fill="var(--icon-strong-base)" fill-rule="evenodd" />
      {/* E */}
      <path
        d="M137 5H120V14.5H132V19.5H120V31H137V36H115V0H137V5Z"
        fill="var(--icon-strong-base)"
        fill-rule="evenodd"
      />
      {/* x */}
      <path
        d="M145 16H150V20H160V16H165V25H157.5V27H165V36H160V32H150V36H145V27H152.5V25H145V16Z"
        fill="var(--icon-interactive-base)"
      />
    </svg>
  )
}
