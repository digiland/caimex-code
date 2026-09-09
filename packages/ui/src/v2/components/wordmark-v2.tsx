import { createUniqueId, type ComponentProps } from "solid-js"

/**
 * "caimex code" drawn on the inherited block-letter grid:
 * glyph 73.8462 wide on a 92 pitch, stroke 18.4615, x-height band y 18 -> 110.143,
 * ascenders (d, the i dot) reach y 0. `m` gets a 92.3077 advance for its third stem,
 * `i` an 18.4615 one; the word gap is 55.3846 (three strokes).
 */
export function WordmarkV2(props: Pick<ComponentProps<"svg">, "class">) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 902.154 110.143"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g opacity="0.6">
        <g mask={`url(#${mask})`}>
          <g opacity="0.16">
            {/* c */}
            <path
              opacity="0.7"
              d="M73.8462 36.4286H18.4615V91.7143H73.8462V110.143H0V18H73.8462V36.4286Z"
              fill="currentColor"
            />
            {/* a */}
            <path
              opacity="0.7"
              d="M147.3846 73.2857H110.4615V91.7143H147.3846V73.2857ZM92 18H165.8462V110.143H92V54.8571H147.3846V36.4286H92V18Z"
              fill="currentColor"
            />
            {/* i */}
            <path
              opacity="0.7"
              d="M202.4615 18.4286H184V0H202.4615V18.4286ZM202.4615 110.143H184V36.4286H202.4615V110.143Z"
              fill="currentColor"
            />
            {/* m */}
            <path
              opacity="0.7"
              d="M294.4615 36.4286H239.0768V110.143H220.6153V18H294.4615V36.4286ZM276 110.143H257.5384V36.4286H276V110.143ZM312.923 110.143H294.4615V36.4286H312.923V110.143Z"
              fill="currentColor"
            />
            {/* e */}
            <path
              opacity="0.7"
              d="M404.923 73.2857H349.5383V91.7143H404.923V110.143H331.0768V18H404.923V73.2857ZM349.5383 54.8571H386.4614V36.4286H349.5383V54.8571Z"
              fill="currentColor"
            />
            {/* x */}
            <path
              opacity="0.7"
              d="M423.0768 18H441.5383L496.923 110.143H478.4614ZM478.4614 18H496.923L441.5383 110.143H423.0768Z"
              fill="currentColor"
            />
            {/* c */}
            <path
              opacity="0.7"
              d="M626.1538 36.4286H570.7691V91.7143H626.1538V110.143H552.3076V18H626.1538V36.4286Z"
              fill="currentColor"
            />
            {/* o */}
            <path
              opacity="0.7"
              d="M699.6922 36.4286H662.7691V91.7143H699.6922V36.4286ZM718.1538 110.143H644.3076V18H718.1538V110.143Z"
              fill="currentColor"
            />
            {/* d */}
            <path
              opacity="0.7"
              d="M791.6922 36.4286H754.7691V91.7143H791.6922V36.4286ZM810.1538 110.143H736.3076V18H791.6922V0H810.1538V110.143Z"
              fill="currentColor"
            />
            {/* e */}
            <path
              opacity="0.7"
              d="M902.1538 73.2857H846.7691V91.7143H902.1538V110.143H828.3076V18H902.1538V73.2857ZM846.7691 54.8571H883.6922V36.4286H846.7691V54.8571Z"
              fill="currentColor"
            />
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="902.154" height="110.143">
          <rect width="902.154" height="110.143" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="451.077" y1="68" x2="451.077" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
