import { createUniqueId, For, type ComponentProps } from "solid-js"
import { glyphPath, offsets, word, wordWidth } from "../../components/logo"

// Caimex Desktop: the "CAIMEx" wordmark, in the glyphs of components/logo.tsx.
export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${wordWidth} 10`}
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g opacity={props.muted === false ? 1 : 0.16 * 0.7}>
            <For each={word}>
              {(letter, index) => (
                // Outlined, each letter's pixels become 1px lines that draw on.
                <path
                  pathLength={props.outline ? 1 : undefined}
                  d={glyphPath(letter, offsets[index()])}
                  fill={props.outline ? "none" : "currentColor"}
                  stroke={props.outline ? "currentColor" : undefined}
                  stroke-width={props.outline ? 1 : undefined}
                />
              )}
            </For>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width={wordWidth} height="10">
          <rect width={wordWidth} height="10" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient
          id={maskGradient}
          x1={wordWidth / 2}
          y1="5"
          x2={wordWidth / 2}
          y2="10"
          gradientUnits="userSpaceOnUse"
        >
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
