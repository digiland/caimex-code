import { createUniqueId, type ComponentProps } from "solid-js"

// Caimex Desktop: the "CAIMEx" wordmark (same glyphs as components/logo.tsx).
export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 165 36"
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
            <path pathLength={props.outline ? 1 : undefined} fill-rule="evenodd" d="M22 5H5V31H22V36H0V0H22V5Z" />
            <path pathLength={props.outline ? 1 : undefined} fill-rule="evenodd" d="M30 36V0H52V36H47V19.5H35V36H30ZM35 5V14.5H47V5H35Z" />
            <path pathLength={props.outline ? 1 : undefined} fill-rule="evenodd" d="M60 0H65V36H60V0Z" />
            <path pathLength={props.outline ? 1 : undefined} fill-rule="evenodd" d="M73 36V0H107V36H102V5H92.5V36H87.5V5H78V36H73Z" />
            <path pathLength={props.outline ? 1 : undefined} fill-rule="evenodd" d="M137 5H120V14.5H132V19.5H120V31H137V36H115V0H137V5Z" />
            <path pathLength={props.outline ? 1 : undefined} fill-rule="evenodd" d="M145 16H150V20H160V16H165V25H157.5V27H165V36H160V32H150V36H145V27H152.5V25H145V16Z" />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="165" height="36">
          <rect width="165" height="36" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="82.5" y1="18" x2="82.5" y2="36" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
