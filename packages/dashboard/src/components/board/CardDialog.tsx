import { useState, useEffect } from "react"
import type { CardWithTags, CreateCard, UpdateCard } from "@/lib/api"
import { config as configApi } from "@/lib/api"
import { useComments } from "@/hooks/use-comments"
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Send, Play, Trash2, Eraser, Brain, Zap, ChevronRight, ChevronDown, Paperclip, FolderOpen, X } from "lucide-react"
import { FileBrowser } from "./FileBrowser"
import { useExecutions } from "@/hooks/use-executions"
import type { Execution } from "@/lib/api"

interface CardDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	card: CardWithTags | null
	boardId: string
	onCreate: (input: CreateCard) => Promise<unknown>
	onUpdate: (id: string, input: UpdateCard) => Promise<unknown>
	onDelete: (id: string) => Promise<unknown>
	onPlay: (id: string) => void
	defaultStatus?: string
}

export function CardDialog({
	open,
	onOpenChange,
	card,
	boardId,
	onCreate,
	onUpdate,
	onDelete,
	onPlay,
	defaultStatus,
}: CardDialogProps) {
	const [title, setTitle] = useState("")
	const [description, setDescription] = useState("")
	const [selectedTags, setSelectedTags] = useState<string[]>([])
	const [blocking, setBlocking] = useState(true)
	const [planThinking, setPlanThinking] = useState<"smart" | "basic" | null>(null)
	const [executeThinking, setExecuteThinking] = useState<"smart" | "basic" | null>(null)
	const [autoCommit, setAutoCommit] = useState<boolean | null>(null)
	const [configDefaults, setConfigDefaults] = useState<{ planThinking: "smart" | "basic" | null; executeThinking: "smart" | "basic"; autoCommit: boolean }>({ planThinking: "smart", executeThinking: "smart", autoCommit: true })
	const [files, setFiles] = useState<string[]>([])
	const [fileInput, setFileInput] = useState("")
	const [showFileBrowser, setShowFileBrowser] = useState(false)
	const [commentText, setCommentText] = useState("")
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set())
	const { comments, add: addComment, clear: clearComments } = useComments(card?.id ?? null)
	const { executions } = useExecutions(card?.id ?? null)

	const executionMap = Object.fromEntries(executions.map((e) => [e.id, e])) as Record<string, Execution>

	const toggleExecution = (id: string) => {
		setExpandedExecutions((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const isEditing = card !== null

	useEffect(() => {
		if (card) {
			setTitle(card.title)
			setDescription(card.description)
			setSelectedTags(card.tags)
			setFiles(card.files ?? [])
			setBlocking(card.blocking)
			setPlanThinking(card.plan_thinking)
			setExecuteThinking(card.execute_thinking)
			setAutoCommit(card.auto_commit)
		} else {
			setTitle("")
			setDescription("")
			setSelectedTags([])
			setFiles([])
			setBlocking(false)
			setPlanThinking(null)
			setExecuteThinking(null)
			setAutoCommit(null)
		}
		setShowFileBrowser(false)
		setConfirmDelete(false)
	}, [card, open])

	useEffect(() => {
		void configApi.getForBoard(boardId).then((c) => setConfigDefaults({ planThinking: c.planThinking, executeThinking: c.executeThinking, autoCommit: c.autoCommit }))
	}, [boardId])

	const handleSave = async () => {
		if (!title.trim()) return
		if (isEditing) {
			await onUpdate(card.id, {
				title: title.trim(),
				description: description.trim(),
				tags: selectedTags,
				files,
				blocking,
				plan_thinking: planThinking,
				execute_thinking: executeThinking,
				auto_commit: autoCommit,
			})
		} else {
			await onCreate({
				title: title.trim(),
				description: description.trim(),
				tags: selectedTags,
				files,
				blocking,
				plan_thinking: planThinking,
				execute_thinking: executeThinking,
				auto_commit: autoCommit,
				...(defaultStatus ? { status: defaultStatus as "todo" | "queued" } : {}),
			})
		}
		onOpenChange(false)
	}

	const handleDelete = async () => {
		if (!isEditing) return
		if (!confirmDelete) {
			setConfirmDelete(true)
			return
		}
		await onDelete(card.id)
		onOpenChange(false)
	}

	const handleAddComment = async () => {
		if (!commentText.trim()) return
		await addComment(commentText.trim())
		setCommentText("")
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>{isEditing ? "Edit Card" : "New Card"}</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 flex-1 overflow-y-auto py-2 px-1 -mx-1">
					{/* Title */}
					<div>
						<label className="text-sm font-medium mb-1 block">Title</label>
						<Input
							placeholder="Task title"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
						/>
					</div>

					{/* Description */}
					<div>
						<label className="text-sm font-medium mb-1 block">Description</label>
						<Textarea
							placeholder="Describe what needs to be done..."
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="min-h-[100px]"
						/>
					</div>

					{/* Blocking checkbox */}
					<div className="flex items-center gap-2">
						<input
							type="checkbox"
							id="blocking"
							checked={blocking}
							onChange={(e) => setBlocking(e.target.checked)}
							className="h-4 w-4 rounded border-border bg-background accent-primary"
						/>
						<label htmlFor="blocking" className="text-sm font-medium cursor-pointer">
							Blocking
						</label>
						<span className="text-xs text-muted-foreground">
							— If checked, Play All will stop if this card fails
						</span>
					</div>

					{/* Thinking Level */}
					<div>
						<label className="text-sm font-medium mb-2 block">Thinking Level</label>
						{/* Plan row — checkboxes, can deselect all (= no plan phase) */}
						<div className="flex items-center gap-3 mb-1.5">
							<span className="text-sm text-muted-foreground w-14">Plan</span>
							{(["smart", "basic"] as const).map((level) => {
								const effective = planThinking !== undefined ? planThinking : configDefaults.planThinking
								const isChecked = effective === level
								return (
									<label key={level} className="flex items-center gap-1.5 cursor-pointer select-none">
										<input
											type="checkbox"
											checked={isChecked}
											onChange={() => {
												if (isChecked) {
													// Uncheck = no plan phase
													setPlanThinking(null)
												} else {
													// Check this level (uncheck the other)
													setPlanThinking(level)
												}
											}}
											className="h-4 w-4 rounded border-border bg-background accent-primary"
										/>
										{level === "smart" ? (
											<span className="flex items-center gap-1 text-sm"><Brain className="w-3.5 h-3.5" /> Smart</span>
										) : (
											<span className="flex items-center gap-1 text-sm"><Zap className="w-3.5 h-3.5" /> Normal</span>
										)}
									</label>
								)
							})}
							{planThinking === null && (
								<span className="text-xs text-muted-foreground">— No plan, execute only</span>
							)}
						</div>
						{/* Execute row — radio buttons, must pick one */}
						<div className="flex items-center gap-3">
							<span className="text-sm text-muted-foreground w-14">Execute</span>
							{(["smart", "basic"] as const).map((level) => {
								const effective = executeThinking ?? configDefaults.executeThinking
								const isChecked = effective === level
								return (
									<label key={level} className="flex items-center gap-1.5 cursor-pointer select-none">
										<input
											type="radio"
											name="execute-thinking"
											checked={isChecked}
											onChange={() => setExecuteThinking(level)}
											className="h-4 w-4 border-border bg-background accent-primary"
										/>
										{level === "smart" ? (
											<span className="flex items-center gap-1 text-sm"><Brain className="w-3.5 h-3.5" /> Smart</span>
										) : (
											<span className="flex items-center gap-1 text-sm"><Zap className="w-3.5 h-3.5" /> Normal</span>
										)}
									</label>
								)
							})}
						</div>
					</div>

					{/* Auto-commit override */}
					<div>
						<label className="text-sm font-medium mb-2 block">Auto-commit</label>
						<div className="flex items-center gap-3">
							<label className="flex items-center gap-1.5 cursor-pointer select-none">
								<input
									type="radio"
									name="card-auto-commit"
									checked={autoCommit === null}
									onChange={() => setAutoCommit(null)}
									className="accent-primary"
								/>
								<span className="text-sm text-muted-foreground">Inherit ({configDefaults.autoCommit ? "on" : "off"})</span>
							</label>
							<label className="flex items-center gap-1.5 cursor-pointer select-none">
								<input
									type="radio"
									name="card-auto-commit"
									checked={autoCommit === true}
									onChange={() => setAutoCommit(true)}
									className="accent-primary"
								/>
								<span className="text-sm">On</span>
							</label>
							<label className="flex items-center gap-1.5 cursor-pointer select-none">
								<input
									type="radio"
									name="card-auto-commit"
									checked={autoCommit === false}
									onChange={() => setAutoCommit(false)}
									className="accent-primary"
								/>
								<span className="text-sm">Off</span>
							</label>
						</div>
					</div>

					{/* Reference Files */}
					<div>
						<label className="text-sm font-medium mb-1 block">
							<Paperclip className="w-3.5 h-3.5 inline mr-1" />
							Reference Files ({files.length})
						</label>
						{files.length > 0 && (
							<div className="flex flex-wrap gap-1 mb-2">
								{files.map((f) => (
									<span
										key={f}
										className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
									>
										<span className="truncate max-w-[200px]">{f}</span>
										<button
											type="button"
											className="hover:text-destructive"
											onClick={() => setFiles((prev) => prev.filter((p) => p !== f))}
										>
											<X className="w-3 h-3" />
										</button>
									</span>
								))}
							</div>
						)}
						<div className="flex gap-2">
							<Input
								placeholder="path/to/file (relative to project)"
								value={fileInput}
								onChange={(e) => setFileInput(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault()
										const val = fileInput.trim()
										if (val && !files.includes(val)) {
											setFiles((prev) => [...prev, val])
											setFileInput("")
										}
									}
								}}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={!fileInput.trim() || files.includes(fileInput.trim())}
								onClick={() => {
									const val = fileInput.trim()
									if (val && !files.includes(val)) {
										setFiles((prev) => [...prev, val])
										setFileInput("")
									}
								}}
							>
								Add
							</Button>
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={() => setShowFileBrowser(!showFileBrowser)}
								title="Browse project files"
							>
								<FolderOpen className="w-4 h-4" />
							</Button>
						</div>
						{showFileBrowser && (
							<div className="mt-2">
								<FileBrowser
									boardId={boardId}
									onSelect={(path) => {
										if (!files.includes(path)) {
											setFiles((prev) => [...prev, path])
										}
									}}
									onClose={() => setShowFileBrowser(false)}
								/>
							</div>
						)}
					</div>

					{/* Comments (only when editing) */}
					{isEditing && (
						<div>
							<div className="flex items-center justify-between mb-1">
								<label className="text-sm font-medium">
									Comments ({comments.length})
								</label>
								{comments.length > 0 && (
									<Button
										variant="ghost"
										size="icon"
										className="h-6 w-6"
										onClick={() => void clearComments()}
										title="Clear all comments"
									>
										<Eraser className="w-3.5 h-3.5 text-muted-foreground" />
									</Button>
								)}
							</div>
							<ScrollArea className="max-h-[200px] border rounded-md p-2">
								{comments.length === 0 ? (
									<p className="text-xs text-muted-foreground py-2 text-center">
										No comments yet
									</p>
								) : (
									<div className="space-y-2">
										{comments.map((comment) => {
											const execution = comment.execution_id ? executionMap[comment.execution_id] : null
											const isExpanded = comment.execution_id ? expandedExecutions.has(comment.execution_id) : false
											const hasOutput = execution && execution.output && execution.output.length > 0

											if (comment.author === "system" && execution) {
												const phaseLabel = execution.phase === "plan" ? "Plan" : "Execution"
												return (
													<div key={comment.id} className="text-xs border-l-2 pl-2 border-border">
														<button
															type="button"
															className="flex items-center gap-1.5 w-full text-left hover:text-foreground text-muted-foreground transition-colors"
															onClick={() => toggleExecution(execution.id)}
															disabled={!hasOutput}
														>
															{isExpanded ? (
																<ChevronDown className="w-3 h-3 shrink-0" />
															) : (
																<ChevronRight className="w-3 h-3 shrink-0" />
															)}
															<span className="font-semibold">{phaseLabel}</span>
															<span className="text-muted-foreground/60">—</span>
															<span className="flex-1">{comment.content}</span>
															<span className="text-muted-foreground/60 ml-2 shrink-0">
																{new Date(comment.created_at).toLocaleString()}
															</span>
														</button>
														{isExpanded && hasOutput && (
															<pre className="mt-1.5 text-xs overflow-auto max-h-48 bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
																{execution.output}
															</pre>
														)}
													</div>
												)
											}

											return (
												<div
													key={comment.id}
													className="text-xs border-l-2 pl-2 border-border"
												>
													<span className="font-semibold capitalize text-muted-foreground">
														{comment.author}
													</span>
													<span className="text-muted-foreground/60 ml-2">
														{new Date(comment.created_at).toLocaleString()}
													</span>
													<p className="mt-0.5 whitespace-pre-wrap">{comment.content}</p>
												</div>
											)
										})}
									</div>
								)}
							</ScrollArea>
							<div className="flex gap-2 mt-2">
								<Input
									placeholder="Add a comment..."
									value={commentText}
									onChange={(e) => setCommentText(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault()
											void handleAddComment()
										}
									}}
								/>
								<Button
									size="icon"
									variant="outline"
									onClick={() => void handleAddComment()}
									disabled={!commentText.trim()}
								>
									<Send className="w-4 h-4" />
								</Button>
							</div>
						</div>
					)}
				</div>

				<DialogFooter>
					{isEditing && (
						<Button
							variant="destructive"
							onClick={() => void handleDelete()}
							className="mr-auto"
						>
							<Trash2 className="w-4 h-4 mr-1" />
							{confirmDelete ? "Confirm Delete" : "Delete"}
						</Button>
					)}
					{isEditing && card.status === "todo" && (
						<Button
							variant="outline"
							onClick={() => {
								onPlay(card.id)
								onOpenChange(false)
							}}
						>
							<Play className="w-4 h-4 mr-2" />
							Execute
						</Button>
					)}
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={() => void handleSave()} disabled={!title.trim()}>
						{isEditing ? "Save" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
