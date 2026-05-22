import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react"
import { Button } from "@/components/ui/button"
import { Copy, Check } from "lucide-react"
import type { Execution } from "@/lib/api"
import { cn } from "@/lib/utils"

export interface TerminalStreamHandle {
	scrollToExecution: (executionId: string) => void
}

interface TerminalStreamProps {
	executions: Execution[]
	maximized?: boolean
}

function phaseLabel(phase: string): string {
	return phase === "plan" ? "Plan" : "Execute"
}

function statusGlyph(status: string): { label: string; className: string } {
	if (status === "running") return { label: "● Live", className: "text-green-400" }
	if (status === "success") return { label: "✓ Done", className: "text-blue-400" }
	if (status === "failed") return { label: "✗ Failed", className: "text-red-400" }
	return { label: "Cancelled", className: "text-muted-foreground" }
}

function formatTime(iso: string): string {
	return new Date(iso).toLocaleTimeString()
}

function formatDuration(start: string, end: string | null): string | null {
	if (!end) return null
	const ms = new Date(end).getTime() - new Date(start).getTime()
	if (!Number.isFinite(ms) || ms < 0) return null
	const s = Math.round(ms / 1000)
	if (s < 60) return `${s}s`
	const m = Math.floor(s / 60)
	const rs = s % 60
	return `${m}m${rs ? ` ${rs}s` : ""}`
}

export const TerminalStream = forwardRef<TerminalStreamHandle, TerminalStreamProps>(function TerminalStream(
	{ executions, maximized = false },
	ref,
) {
	const sorted = [...executions].sort(
		(a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
	)
	const scrollRef = useRef<HTMLDivElement>(null)
	const headerRefs = useRef<Map<string, HTMLDivElement>>(new Map())
	const stickToBottomRef = useRef(true)
	const [copied, setCopied] = useState(false)

	useImperativeHandle(
		ref,
		() => ({
			scrollToExecution: (executionId: string) => {
				const el = headerRefs.current.get(executionId)
				if (el && scrollRef.current) {
					stickToBottomRef.current = false
					el.scrollIntoView({ behavior: "smooth", block: "start" })
				}
			},
		}),
		[],
	)

	const handleScroll = () => {
		const el = scrollRef.current
		if (!el) return
		const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
		stickToBottomRef.current = distanceFromBottom < 32
	}

	useEffect(() => {
		if (!stickToBottomRef.current) return
		const el = scrollRef.current
		if (!el) return
		el.scrollTop = el.scrollHeight
	}, [sorted, sorted.map((e) => e.output.length).join(",")])

	const buildCombined = (): string => {
		return sorted
			.map((e) => {
				const dur = formatDuration(e.started_at, e.finished_at)
				const header = `── ${phaseLabel(e.phase)} · ${formatTime(e.started_at)} · ${statusGlyph(e.status).label}${dur ? ` · ${dur}` : ""} ──`
				return `${header}\n${e.output ?? ""}`
			})
			.join("\n\n")
	}

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(buildCombined())
			setCopied(true)
			setTimeout(() => setCopied(false), 1500)
		} catch {
			// ignore
		}
	}

	if (sorted.length === 0) {
		return (
			<div className="text-xs text-muted-foreground py-6 text-center">
				No execution output yet.
			</div>
		)
	}

	return (
		<div className="relative h-full">
			<Button
				variant="ghost"
				size="icon"
				className="absolute top-1 right-1 h-6 w-6 z-10 bg-background/80 backdrop-blur"
				onClick={() => void handleCopy()}
				title="Copy all output"
			>
				{copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-muted-foreground" />}
			</Button>
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className={cn(
					"font-mono text-xs overflow-auto bg-muted/30 rounded p-3 whitespace-pre-wrap break-words",
					maximized ? "h-full" : "max-h-[400px] min-h-[200px]",
				)}
			>
				{sorted.map((e, idx) => {
					const dur = formatDuration(e.started_at, e.finished_at)
					const status = statusGlyph(e.status)
					return (
						<div key={e.id}>
							{idx > 0 && <div className="h-3" />}
							<div
								ref={(el) => {
									if (el) headerRefs.current.set(e.id, el)
									else headerRefs.current.delete(e.id)
								}}
								className="text-muted-foreground/80 select-none border-b border-border/40 pb-1 mb-2"
							>
								<span>── </span>
								<span className="font-semibold text-foreground">{phaseLabel(e.phase)}</span>
								<span> · </span>
								<span>{formatTime(e.started_at)}</span>
								<span> · </span>
								<span className={cn("font-medium", status.className)}>{status.label}</span>
								{dur && <span> · {dur}</span>}
								<span> ──</span>
							</div>
							<div>{e.output || <span className="text-muted-foreground/60">(no output)</span>}</div>
						</div>
					)
				})}
			</div>
		</div>
	)
})
