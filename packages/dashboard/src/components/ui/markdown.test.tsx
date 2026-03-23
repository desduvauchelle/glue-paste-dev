import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import "@testing-library/jest-dom"
import { Markdown } from "./markdown"

describe("Markdown", () => {
	it("renders plain text", () => {
		render(<Markdown>Hello world</Markdown>)
		expect(screen.getByText("Hello world")).toBeInTheDocument()
	})

	it("renders bold text", () => {
		render(<Markdown>{"**bold text**"}</Markdown>)
		expect(screen.getByText("bold text").tagName).toBe("STRONG")
	})

	it("renders inline code", () => {
		render(<Markdown>{"`inline code`"}</Markdown>)
		expect(screen.getByText("inline code").tagName).toBe("CODE")
	})

	it("renders links with target=_blank", () => {
		render(<Markdown>{"[click here](https://example.com)"}</Markdown>)
		const link = screen.getByText("click here")
		expect(link.tagName).toBe("A")
		expect(link).toHaveAttribute("target", "_blank")
		expect(link).toHaveAttribute("rel", "noopener noreferrer")
	})

	it("renders unordered lists", () => {
		render(<Markdown>{"- item one\n- item two"}</Markdown>)
		expect(screen.getByText("item one")).toBeInTheDocument()
		expect(screen.getByText("item two")).toBeInTheDocument()
	})

	it("renders code blocks", () => {
		render(<Markdown>{"```\nconst x = 1\n```"}</Markdown>)
		expect(screen.getByText("const x = 1")).toBeInTheDocument()
	})

	it("applies prose-markdown class", () => {
		const { container } = render(<Markdown>test</Markdown>)
		expect(container.firstChild).toHaveClass("prose-markdown")
	})

	it("merges additional className", () => {
		const { container } = render(<Markdown className="extra">test</Markdown>)
		expect(container.firstChild).toHaveClass("prose-markdown")
		expect(container.firstChild).toHaveClass("extra")
	})
})
