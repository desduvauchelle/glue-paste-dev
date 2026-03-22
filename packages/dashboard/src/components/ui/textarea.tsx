import * as React from "react"
import { cn } from "@/lib/utils"

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize, onChange, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null)
    const minHeightRef = React.useRef<number>(0)

    const setRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
      },
      [ref],
    )

    // Capture min-height from the initial rendered size (based on `rows` attribute)
    React.useLayoutEffect(() => {
      if (!autoResize || !innerRef.current) return
      minHeightRef.current = innerRef.current.offsetHeight
    }, [autoResize])

    // Resize whenever value changes
    React.useLayoutEffect(() => {
      if (!autoResize || !innerRef.current) return
      const el = innerRef.current
      el.style.height = "auto"
      el.style.height = `${Math.max(el.scrollHeight, minHeightRef.current)}px`
    }, [autoResize, props.value])

    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          autoResize && "resize-none overflow-hidden",
          className,
        )}
        ref={setRef}
        onChange={onChange}
        {...props}
      />
    )
  },
)
Textarea.displayName = "Textarea"

export { Textarea }
export type { TextareaProps }
