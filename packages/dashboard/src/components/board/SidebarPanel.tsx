import { useState, useRef, useEffect, type ReactNode } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface SidebarPanelProps {
	label: string
	icon?: ReactNode
	badge?: string | number
	defaultOpen?: boolean
	action?: ReactNode
	children: ReactNode
}

export function SidebarPanel({ label, icon, badge, defaultOpen = false, action, children }: SidebarPanelProps) {
	const [open, setOpen] = useState(defaultOpen)
	const contentRef = useRef<HTMLDivElement>(null)
	const [height, setHeight] = useState<number | undefined>(defaultOpen ? undefined : 0)

	useEffect(() => {
		if (!contentRef.current) return undefined
		if (open) {
			setHeight(contentRef.current.scrollHeight)
			const timer = setTimeout(() => setHeight(undefined), 200)
			return () => clearTimeout(timer)
		}
		setHeight(contentRef.current.scrollHeight)
		requestAnimationFrame(() => setHeight(0))
		return undefined
	}, [open])

	return (
		<div className="border border-border rounded-md">
			<button
				type="button"
				className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors rounded-md"
				onClick={() => setOpen(!open)}
			>
				<ChevronRight
					className={cn(
						"w-3.5 h-3.5 shrink-0 transition-transform duration-200",
						open && "rotate-90"
					)}
				/>
				{icon && <span className="shrink-0">{icon}</span>}
				<span className="flex-1 text-left">{label}</span>
				{badge !== undefined && badge !== 0 && (
					<span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
						{badge}
					</span>
				)}
				{action && (
					<span
						className="shrink-0"
						onClick={(e) => e.stopPropagation()}
					>
						{action}
					</span>
				)}
			</button>
			<div
				ref={contentRef}
				className="overflow-hidden transition-[height] duration-200 ease-in-out"
				style={{ height: height !== undefined ? `${height}px` : "auto" }}
			>
				<div className="px-3 pb-3 pt-1">
					{children}
				</div>
			</div>
		</div>
	)
}
