import ReactMarkdown from "react-markdown"
import { cn } from "@/lib/utils"

interface MarkdownProps {
	children: string
	className?: string
}

export function Markdown({ children, className }: MarkdownProps) {
	return (
		<div className={cn("prose-markdown", className)}>
			<ReactMarkdown
				components={{
					a: ({ children, href, ...props }) => (
						<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
							{children}
						</a>
					),
				}}
			>
				{children}
			</ReactMarkdown>
		</div>
	)
}
