import { createUniqueId, type ComponentProps } from "solid-js"

// Caimex Desktop: the "caimex code" wordmark (glyphs from the Caimex CLI fork's Logo).
export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 294 36"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <path pathLength={props.outline ? 1 : undefined} d="M24 12H6V30H24V36H0V6H24V12Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M48 24H36V30H48V24ZM30 6H54V36H30V18H48V12H30V6Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M66 6H60V0H66V6ZM66 36H60V12H66V36Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M96 12H78V36H72V6H96V12ZM90 36H84V12H90V36ZM102 36H96V12H102V36Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M132 24H114V30H132V36H108V6H132V24ZM114 18H126V12H114V18Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M138 6H144L162 36H156ZM156 6H162L144 36H138Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M204 12H186V30H204V36H180V6H204V12Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M228 12H216V30H228V12ZM234 36H210V6H234V36Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M258 12H246V30H258V12ZM264 36H240V6H258V0H264V36Z" />
            <path pathLength={props.outline ? 1 : undefined} d="M294 24H276V30H294V36H270V6H294V24ZM276 18H288V12H276V18Z" />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="294" height="36">
          <rect width="294" height="36" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="147" y1="18" x2="147" y2="36" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
