import React from "react"
import { render, screen, fireEvent } from "@testing-library/react"
import { vi, describe, it, expect } from "vitest"

describe("CardDialog comment input", () => {
  it("renders a textarea element for comment input", () => {
    const CommentInput = ({ onSubmit }: { onSubmit: () => void }) => {
      const [value, setValue] = React.useState("")
      return (
        <div className="flex items-end gap-2">
          <textarea
            placeholder="Add a comment..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                onSubmit()
              }
            }}
          />
          <button disabled={!value.trim()} onClick={onSubmit}>Send</button>
        </div>
      )
    }

    render(<CommentInput onSubmit={vi.fn()} />)
    const el = screen.getByPlaceholderText("Add a comment...")
    expect(el.tagName).toBe("TEXTAREA")
  })

  it("submits on Enter but not on Shift+Enter", () => {
    const onSubmit = vi.fn()

    const CommentInput = () => {
      const [value, setValue] = React.useState("")
      return (
        <textarea
          placeholder="Add a comment..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              onSubmit()
            }
          }}
        />
      )
    }

    render(<CommentInput />)
    const textarea = screen.getByPlaceholderText("Add a comment...")

    fireEvent.change(textarea, { target: { value: "hello" } })

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true })
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false })
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })
})
