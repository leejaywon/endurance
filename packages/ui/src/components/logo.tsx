import { type ComponentProps } from "solid-js"

const Ring = () => (
  <g>
    <circle cx="24" cy="24" r="17" stroke="var(--icon-weak-base)" stroke-width="1.5" />
    {Array.from({ length: 12 }, (_, index) => (
      <rect
        x="20.5"
        y="2"
        width="7"
        height="8"
        rx="1"
        transform={`rotate(${index * 30} 24 24)`}
        fill="var(--icon-strong-base)"
      />
    ))}
    <path d="M24 10V19M24 29V38M10 24H19M29 24H38" stroke="var(--icon-weak-base)" stroke-width="1.5" />
    <circle cx="24" cy="24" r="5" stroke="var(--icon-strong-base)" stroke-width="2" />
  </g>
)

export const Mark = (props: { class?: string }) => (
  <svg
    data-component="logo-mark"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <Ring />
  </svg>
)

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <svg
    ref={props.ref}
    data-component="logo-splash"
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <Ring />
  </svg>
)

export const Logo = (props: { class?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 234 42"
    fill="none"
    aria-hidden="true"
    classList={{ [props.class ?? ""]: !!props.class }}
  >
    <g transform="translate(0 1) scale(.83)">
      <Ring />
    </g>
    <text
      x="50"
      y="30"
      fill="var(--icon-strong-base)"
      font-family="Arial, sans-serif"
      font-size="24"
      font-weight="600"
      letter-spacing="1.4"
    >
      ENDURANCE
    </text>
  </svg>
)
