import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X, FileCode } from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Execution, Comment } from "@/lib/api"
import { parseFilesChanged } from "@/lib/api"

interface ExecutionExpandedViewProps {
	open: boolean
	onClose: () => void
	systemComments: Comment[]
	executionMap: Record<string, Execution>
	expandedExecutions: Set<string>
	toggleExecution: (id: string) => void
}

export function ExecutionExpandedView({
	open,
	onClose,
	systemComments,
	executionMap,
	expandedExecutions,
	toggleExecution,
}: ExecutionExpandedViewProps) {
	const outputEndRef = useRef<HTMLDivElement>(null)

	// Close on Escape
	useEffect(() => {
		if (!open) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose()
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open, onClose])

	// Auto-scroll to bottom when any execution output changes (live streaming)
	useEffect(() => {
		if (!open) return
		outputEndRef.current?.scrollIntoView({ behavior: "smooth" })
	})

	if (!open) return null

	return createPortal(
		<div
			className="fixed inset-0 z-[60] flex items-center justify-center"
			aria-modal="true"
			role="dialog"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/40 backdrop-blur-sm"
				onClick={onClose}
			/>
			{/* Panel */}
			<div
				className="relative z-10 w-full max-w-4xl max-h-[80vh] mx-4 rounded-lg border border-border bg-card text-card-foreground shadow-xl flex flex-col"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
					<h3 className="text-sm font-semibold">Execution History</h3>
					<button
						type="button"
						className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
						onClick={onClose}
						aria-label="Close expanded view"
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				{/* Scrollable content */}
				<ScrollArea className="flex-1 overflow-auto">
					<div className="p-4 space-y-3">
						{systemComments.map((comment) => {
							const execution = comment.execution_id
								? executionMap[comment.execution_id]
								: null
							const isExpanded = comment.execution_id
								? expandedExecutions.has(comment.execution_id)
								: false
							const hasOutput =
								execution && execution.output && execution.output.length > 0

							if (!execution) {
								return (
									<div
										key={comment.id}
										className="text-sm border-l-2 pl-3 border-border"
									>
										<span className="text-muted-foreground/60 text-xs">
											{new Date(comment.created_at).toLocaleString()}
										</span>
										<p className="mt-0.5 whitespace-pre-wrap">
											{comment.content}
										</p>
									</div>
								)
							}

							const phaseLabel =
								execution.phase === "plan" ? "Plan" : "Execution"
							return (
								<div
									key={comment.id}
									className="text-sm border-l-2 pl-3 border-border"
								>
									<button
										type="button"
										className="flex items-center gap-2 w-full text-left hover:text-foreground text-muted-foreground transition-colors"
										onClick={() => toggleExecution(execution.id)}
										disabled={!hasOutput}
									>
										<span className="font-semibold">{phaseLabel}</span>
										<span
											className={cn(
												"inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full",
												execution.status === "running"
													? "bg-green-500/20 text-green-400"
													: execution.status === "success"
													? "bg-blue-500/20 text-blue-400"
													: execution.status === "failed"
													? "bg-red-500/20 text-red-400"
													: "bg-muted text-muted-foreground"
											)}
										>
											{execution.status === "running" && (
												<span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
											)}
											{execution.status === "running"
												? "Live"
												: execution.status === "success"
												? "Done"
												: execution.status === "failed"
												? "Failed"
												: "Cancelled"}
										</span>
										<span className="text-muted-foreground/60">{"\u2014"}</span>
										<span className="flex-1 truncate">{comment.content}</span>
									</button>
									<span className="text-muted-foreground/60 text-[10px]">
										{new Date(comment.created_at).toLocaleString()}
									</span>
									{isExpanded && hasOutput && (
										<pre className="mt-2 text-sm overflow-auto max-h-[50vh] bg-muted/50 rounded p-3 whitespace-pre-wrap break-words">
											{execution.output}
										</pre>
									)}
									{isExpanded &&
										(() => {
											const filesChanged = parseFilesChanged(
												execution.files_changed
											)
											if (filesChanged.length === 0) return null
											const totalAdd = filesChanged.reduce(
												(s, f) => s + f.additions,
												0
											)
											const totalDel = filesChanged.reduce(
												(s, f) => s + f.deletions,
												0
											)
											return (
												<div className="mt-2 text-sm bg-muted/50 rounded p-3">
													<div className="flex items-center gap-1.5 mb-1 font-semibold text-muted-foreground">
														<FileCode className="w-3.5 h-3.5" />
														{filesChanged.length}{" "}
														{filesChanged.length === 1 ? "file" : "files"}{" "}
														changed,{" "}
														<span className="text-green-400">
															{totalAdd} insertions(+)
														</span>
														,{" "}
														<span className="text-red-400">
															{totalDel} deletions(-)
														</span>
													</div>
													<div className="space-y-0.5">
														{filesChanged.map((f) => (
															<div
																key={f.path}
																className="flex items-center gap-2 font-mono"
															>
																<span className="text-green-400 w-10 text-right">
																	+{f.additions}
																</span>
																<span className="text-red-400 w-10 text-right">
																	-{f.deletions}
																</span>
																<span className="text-foreground truncate">
																	{f.path}
																</span>
															</div>
														))}
													</div>
												</div>
											)
										})()}
								</div>
							)
						})}
						<div ref={outputEndRef} />
					</div>
				</ScrollArea>
			</div>
		</div>,
		document.body
	)
}
