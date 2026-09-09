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

/**
 * "caimex code" on the block-letter grid: glyph 24 wide on a 30 pitch, stroke 6,
 * x-height band y 6 -> 36, ascenders (d, the i dot) at y 0. `m` takes a 30 advance
 * for its third stem, `i` a 6; the word gap is 18 (three strokes).
 *
 * Each glyph is a weak shadow filling its counter below y=18, then the letter itself:
 * "caimex" muted, "code" strong. Same alphabet as v2/components/wordmark-v2.tsx,
 * which draws it at 3.077x on a fractional grid.
 */
export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 294 36"
      fill="none"
      role="img"
      aria-label="caimex code"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        {/* c */}
        <path d="M24 30H6V18H24V30Z" fill="var(--icon-weak-base)" />
        <path d="M24 12H6V30H24V36H0V6H24V12Z" fill="var(--icon-base)" />
        {/* a */}
        <path d="M48 30H36V24H48V30Z" fill="var(--icon-weak-base)" />
        <path d="M48 24H36V30H48V24ZM30 6H54V36H30V18H48V12H30V6Z" fill="var(--icon-base)" />
        {/* i */}
        <path d="M66 6H60V0H66V6ZM66 36H60V12H66V36Z" fill="var(--icon-base)" />
        {/* m */}
        <path d="M84 36H78V18H84V36ZM96 36H90V18H96V36Z" fill="var(--icon-weak-base)" />
        <path d="M96 12H78V36H72V6H96V12ZM90 36H84V12H90V36ZM102 36H96V12H102V36Z" fill="var(--icon-base)" />
        {/* e */}
        <path d="M132 24V30H114V24H132Z" fill="var(--icon-weak-base)" />
        <path d="M132 24H114V30H132V36H108V6H132V24ZM114 18H126V12H114V18Z" fill="var(--icon-base)" />
        {/* x */}
        <path d="M150 26L156 36H144Z" fill="var(--icon-weak-base)" />
        <path d="M138 6H144L162 36H156ZM156 6H162L144 36H138Z" fill="var(--icon-base)" />
        {/* c */}
        <path d="M204 30H186V18H204V30Z" fill="var(--icon-weak-base)" />
        <path d="M204 12H186V30H204V36H180V6H204V12Z" fill="var(--icon-strong-base)" />
        {/* o */}
        <path d="M228 30H216V18H228V30Z" fill="var(--icon-weak-base)" />
        <path d="M228 12H216V30H228V12ZM234 36H210V6H234V36Z" fill="var(--icon-strong-base)" />
        {/* d */}
        <path d="M258 30H246V18H258V30Z" fill="var(--icon-weak-base)" />
        <path d="M258 12H246V30H258V12ZM264 36H240V6H258V0H264V36Z" fill="var(--icon-strong-base)" />
        {/* e */}
        <path d="M294 24V30H276V24H294Z" fill="var(--icon-weak-base)" />
        <path d="M294 24H276V30H294V36H270V6H294V24ZM276 18H288V12H276V18Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
