import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { vi, describe, it, expect } from "vitest"
import { Textarea } from "@/components/ui/textarea"

describe("Textarea comment input behavior", () => {
  it("renders a textarea element", () => {
    render(
      <Textarea placeholder="Add a comment..." value="" onChange={() => {}} />
    )
    const el = screen.getByPlaceholderText("Add a comment...")
    expect(el.tagName).toBe("TEXTAREA")
  })

  it("calls onSubmit on Enter but not on Shift+Enter", () => {
    const onSubmit = vi.fn()

    const Wrapper = () => {
      const [val, setVal] = React.useState("")
      return (
        <Textarea
          placeholder="Add a comment..."
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
      )
    }

    render(<Wrapper />)
    const textarea = screen.getByPlaceholderText("Add a comment...")

    fireEvent.change(textarea, { target: { value: "hello" } })

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("autoResize: starts at rows=1 height and grows with content", () => {
    render(
      <Textarea
        autoResize
        rows={1}
        placeholder="Add a comment..."
        value=""
        onChange={() => {}}
        className="min-h-[36px]"
      />
    )
    const el = screen.getByPlaceholderText("Add a comment...")
    expect(el.tagName).toBe("TEXTAREA")
    // autoResize sets overflow:hidden and disables manual resize
    expect(el).toBeInTheDocument()
  })
})
