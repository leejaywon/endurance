import { onCleanup, onMount } from "solid-js"

/** Reveal overflowing project names without moving the row's actions. */
export function ProjectName(props: { name: string; class?: string }) {
  let viewport!: HTMLSpanElement
  let text!: HTMLSpanElement
  let animation: Animation | undefined
  let hovered = false
  const reset = () => {
    animation?.cancel()
    animation = undefined
    text.style.width = ""
    text.style.overflow = "hidden"
  }
  const reveal = () => {
    reset()
    const distance = text.scrollWidth - viewport.clientWidth
    if (distance <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    text.style.width = "max-content"
    text.style.overflow = "visible"
    const travel = Math.max(1000, (distance / 35) * 1000)
    const duration = travel * 2 + 1800
    animation = text.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: 900 / duration },
        { transform: `translateX(-${distance}px)`, offset: (900 + travel) / duration },
        { transform: `translateX(-${distance}px)`, offset: (1800 + travel) / duration },
        { transform: "translateX(0)", offset: 1 },
      ],
      { duration, iterations: Infinity, easing: "linear" },
    )
  }
  onMount(() => {
    const observer = new ResizeObserver(() => {
      if (hovered) reveal()
    })
    observer.observe(viewport)
    onCleanup(() => observer.disconnect())
  })
  onCleanup(() => animation?.cancel())
  return (
    <span
      ref={viewport}
      class={`min-w-0 overflow-hidden ${props.class ?? ""}`}
      title={props.name}
      onMouseEnter={() => {
        hovered = true
        reveal()
      }}
      onMouseLeave={() => {
        hovered = false
        reset()
      }}
    >
      <span ref={text} class="block overflow-hidden text-ellipsis whitespace-nowrap">
        {props.name}
      </span>
    </span>
  )
}
