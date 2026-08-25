import { createUniqueId, type ComponentProps } from "solid-js"

// caimex: upstream draws "opencode" as hand-plotted blocky glyph paths. There is
// no Caimex equivalent of that artwork, and redrawing seven letters by hand in
// the same pixel grid would be guesswork, so this renders the wordmark as
// monospace text instead — the same approach the v1 mark in
// ../../components/logo.tsx already takes, so the two agree.
//
// Everything around the glyphs is kept: the viewBox, the 0.6/0.16 opacities and
// the top-to-bottom alpha mask are what make this read as a watermark behind
// the composer rather than a logo sitting on top of it.
export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 720 129"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16">
            <text
              x="360"
              y="92"
              text-anchor="middle"
              font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
              font-size="104"
              font-weight="700"
              letter-spacing="-4"
              fill="currentColor"
              opacity="0.7"
            >
              caimex
            </text>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="720" height="129">
          <rect width="720" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="360" y1="68" x2="360" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
