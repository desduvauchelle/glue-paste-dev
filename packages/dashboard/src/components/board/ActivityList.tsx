import type { Comment, Execution } from "@/lib/api"
import { Markdown } from "@/components/ui/markdown"
import { cn } from "@/lib/utils"

interface ActivityListProps {
	comments: Comment[]
	executionMap: Record<string, Execution>
	onJumpToExecution?: (executionId: string) => void
}

function statusBadge(status: string): { label: string; className: string } {
	if (status === "running") return { label: "Live", className: "bg-green-500/20 text-green-400" }
	if (status === "success") return { label: "Done", className: "bg-blue-500/20 text-blue-400" }
	if (status === "failed") return { label: "Failed", className: "bg-red-500/20 text-red-400" }
	return { label: "Cancelled", className: "bg-muted text-muted-foreground" }
}

export function ActivityList({ comments, executionMap, onJumpToExecution }: ActivityListProps) {
	if (comments.length === 0) {
		return (
			<p className="text-xs text-muted-foreground py-2 text-center">
				No activity yet
			</p>
		)
	}

	return (
		<div className="space-y-2">
			{comments.map((comment) => {
				const execution = comment.execution_id ? executionMap[comment.execution_id] : null

				if (comment.author !== "system") {
					return (
						<div key={comment.id} className="text-xs border-l-2 pl-2 border-primary/40">
							<span className="font-semibold capitalize text-muted-foreground">{comment.author}</span>
							<span className="text-muted-foreground/60 ml-2">{new Date(comment.created_at).toLocaleString()}</span>
							<div className="mt-0.5">
								<Markdown>{comment.content}</Markdown>
							</div>
						</div>
					)
				}

				if (!execution) {
					return (
						<div key={comment.id} className="text-xs border-l-2 pl-2 border-muted-foreground/40">
							<span className="text-muted-foreground/60">{new Date(comment.created_at).toLocaleString()}</span>
							<div className="mt-0.5">
								<Markdown>{comment.content}</Markdown>
							</div>
						</div>
					)
				}

				const phaseLabel = execution.phase === "plan" ? "Plan" : "Execution"
				const badge = statusBadge(execution.status)
				const clickable = !!onJumpToExecution
				return (
					<button
						key={comment.id}
						type="button"
						onClick={() => onJumpToExecution?.(execution.id)}
						disabled={!clickable}
						className={cn(
							"w-full text-left text-xs border-l-2 pl-2 border-border block",
							clickable && "hover:bg-muted/40 rounded-r transition-colors cursor-pointer",
						)}
					>
						<div className="flex items-center gap-2">
							<span className="font-semibold text-muted-foreground">{phaseLabel}</span>
							<span
								className={cn(
									"inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full",
									badge.className,
								)}
							>
								{execution.status === "running" && (
									<span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
								)}
								{badge.label}
							</span>
							<span className="text-muted-foreground/60">—</span>
							<span className="flex-1 truncate text-muted-foreground">{comment.content}</span>
						</div>
						<span className="text-muted-foreground/60 text-[10px]">
							{new Date(comment.created_at).toLocaleString()}
						</span>
					</button>
				)
			})}
		</div>
	)
}
