import { createUniqueId, For, type ComponentProps } from "solid-js"
import { glyphs, offsets, stroke, word } from "../../components/logo"

// Caimex Desktop: the "CAIMEx" wordmark, in the glyphs of components/logo.tsx.
export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 163 36"
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
              {(letter, index) => {
                const glyph = glyphs[letter]
                // Traces are strokes; the x is solid. Outlined, both become 1px lines that draw on.
                return (
                  <path
                    pathLength={props.outline ? 1 : undefined}
                    d={"trace" in glyph ? glyph.trace : glyph.solid}
                    transform={`translate(${offsets[index()]} 0)`}
                    fill={props.outline || "trace" in glyph ? "none" : "currentColor"}
                    stroke={props.outline || "trace" in glyph ? "currentColor" : undefined}
                    stroke-width={props.outline ? 1 : "trace" in glyph ? stroke : undefined}
                  />
                )
              }}
            </For>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="163" height="36">
          <rect width="163" height="36" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="81.5" y1="18" x2="81.5" y2="36" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
