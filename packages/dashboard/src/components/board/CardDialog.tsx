import { useState, useEffect } from "react"
import type { CardWithTags, CreateCard, UpdateCard, Board } from "@/lib/api"
import { config as configApi, boards as boardsApi, cards as cardsApi } from "@/lib/api"
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
import { Send, Play, Trash2, Eraser, Brain, Zap, ChevronRight, ChevronDown, FolderOpen, X, FileCode, Settings, History, Bot, User } from "lucide-react"
import { FileBrowser } from "./FileBrowser"
import { FileSearchInput } from "./FileSearchInput"
import { SidebarPanel } from "./SidebarPanel"
import { useExecutions } from "@/hooks/use-executions"
import type { Execution } from "@/lib/api"
import { parseFilesChanged } from "@/lib/api"

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
	boardName?: string
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
	boardName,
}: CardDialogProps) {
	const [title, setTitle] = useState("")
	const [description, setDescription] = useState("")
	const [selectedTags, setSelectedTags] = useState<string[]>([])
	const [blocking, setBlocking] = useState(true)
	const [planThinking, setPlanThinking] = useState<"smart" | "basic" | "none" | null>(null)
	const [executeThinking, setExecuteThinking] = useState<"smart" | "basic" | null>(null)
	const [autoCommit, setAutoCommit] = useState<boolean | null>(null)
	const [autoPush, setAutoPush] = useState<boolean | null>(null)
	const [assignee, setAssignee] = useState<"ai" | "human">("ai")
	const [configDefaults, setConfigDefaults] = useState<{ planThinking: "smart" | "basic" | null; executeThinking: "smart" | "basic"; autoCommit: boolean; autoPush: boolean }>({ planThinking: "smart", executeThinking: "smart", autoCommit: false, autoPush: false })
	const [files, setFiles] = useState<string[]>([])
	const [showFileBrowser, setShowFileBrowser] = useState(false)
	const [commentText, setCommentText] = useState("")
	const [confirmDelete, setConfirmDelete] = useState(false)
	const [expandedExecutions, setExpandedExecutions] = useState<Set<string>>(new Set())
	const [allBoards, setAllBoards] = useState<Board[]>([])
	const [moveTargetBoardId, setMoveTargetBoardId] = useState("")
	const [isMoving, setIsMoving] = useState(false)
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

	// Split comments into system/execution comments for sidebar panel
	const systemComments = comments.filter((c) => c.author === "system")

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
			setAutoPush(card.auto_push)
			setAssignee(card.assignee ?? "ai")
		} else {
			setTitle("")
			setDescription("")
			setSelectedTags([])
			setFiles([])
			setBlocking(false)
			setPlanThinking(null)
			setExecuteThinking(null)
			setAutoCommit(null)
			setAutoPush(null)
			setAssignee("ai")
		}
		setShowFileBrowser(false)
		setConfirmDelete(false)
	}, [card, open])

	useEffect(() => {
		void configApi.getForBoard(boardId).then((c) => setConfigDefaults({ planThinking: c.planThinking, executeThinking: c.executeThinking, autoCommit: c.autoCommit, autoPush: c.autoPush }))
	}, [boardId])

	useEffect(() => {
		void boardsApi.list().then(setAllBoards)
	}, [])

	useEffect(() => {
		setMoveTargetBoardId("")
	}, [card, open])


	const handleSave = async () => {
		if (!title.trim() && !description.trim()) return
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
				auto_push: autoPush,
				assignee,
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
				auto_push: autoPush,
				assignee,
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

	const handleMoveToBoard = async () => {
		if (!isEditing || !moveTargetBoardId) return
		setIsMoving(true)
		await cardsApi.moveToBoard(card.id, moveTargetBoardId)
		setIsMoving(false)
		onOpenChange(false)
	}

	const handleAddComment = async () => {
		if (!commentText.trim()) return
		await addComment(commentText.trim())
		setCommentText("")
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>{isEditing ? "Edit Card" : "New Card"}{boardName && !isEditing ? ` — ${boardName}` : ""}</DialogTitle>
				</DialogHeader>

				<div className="flex-1 overflow-y-auto py-2 px-1 -mx-1">
					<div className="flex flex-col md:flex-row gap-6">
						{/* Left Column — Main Content */}
						<div className="flex-1 min-w-0 space-y-4">
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
									className="min-h-[120px]"
									autoFocus={!isEditing}
								/>
							</div>

							{/* Reference Files */}
							<div>
								<label className="text-sm font-medium mb-1 block">Reference Files</label>
								{files.length > 0 && (
									<div className="flex flex-wrap gap-1 mb-2">
										{files.map((f) => (
											<span
												key={f}
												className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded"
											>
												<span className="truncate max-w-[180px]">{f}</span>
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
								<div className="flex gap-1.5">
									<div className="flex-1 min-w-0">
										<FileSearchInput
											boardId={boardId}
											selectedFiles={files}
											onSelect={(path) => {
												if (!files.includes(path)) {
													setFiles((prev) => [...prev, path])
												}
											}}
										/>
									</div>
									<Button
										type="button"
										variant="outline"
										size="icon"
										className="h-8 w-8 shrink-0"
										onClick={() => setShowFileBrowser(!showFileBrowser)}
										title="Browse project files"
									>
										<FolderOpen className="w-3.5 h-3.5" />
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

							{/* Activity / User Comments (only when editing) */}
							{isEditing && (
								<div>
									<div className="flex items-center justify-between mb-1">
										<label className="text-sm font-medium">
											Activity ({comments.length})
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
												{comments.map((comment) => (
													<div
														key={comment.id}
														className={`text-xs border-l-2 pl-2 ${comment.author === "system" ? "border-muted-foreground/40" : "border-border"}`}
													>
														<span className="font-semibold capitalize text-muted-foreground">
															{comment.author}
														</span>
														<span className="text-muted-foreground/60 ml-2">
															{new Date(comment.created_at).toLocaleString()}
														</span>
														<p className="mt-0.5 whitespace-pre-wrap">{comment.content}</p>
													</div>
												))}
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

						{/* Right Column — Sidebar Panels */}
						<div className="w-full md:w-72 lg:w-80 shrink-0 space-y-3">
							{/* Settings Panel */}
							<SidebarPanel
								label="Settings"
								icon={<Settings className="w-3.5 h-3.5" />}
								defaultOpen
							>
								<div className="space-y-3">
									{/* Assignee toggle */}
									<div>
										<label className="text-xs font-medium mb-1.5 block text-muted-foreground uppercase tracking-wide">Assigned to</label>
										<div className="flex items-center gap-2">
											{(["ai", "human"] as const).map((val) => (
												<label key={val} className="flex items-center gap-1 cursor-pointer select-none">
													<input
														type="radio"
														name="card-assignee"
														checked={assignee === val}
														onChange={() => setAssignee(val)}
														className="accent-primary h-3.5 w-3.5"
													/>
													<span className="flex items-center gap-0.5 text-xs">
														{val === "ai" ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
														{val === "ai" ? "AI" : "Human"}
													</span>
												</label>
											))}
										</div>
										{assignee === "human" && (
											<p className="text-xs text-muted-foreground mt-1">
												AI will never process this card
											</p>
										)}
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
										<label htmlFor="blocking" className="text-sm cursor-pointer">
											Blocking
										</label>
									</div>
									<p className="text-xs text-muted-foreground -mt-1">
										Play All stops if this card fails
									</p>

									{/* Thinking Level */}
									<div>
										<label className="text-xs font-medium mb-1.5 block text-muted-foreground uppercase tracking-wide">Thinking</label>
										<div className="space-y-1.5">
											{/* Plan row */}
											<div className="flex items-center gap-2">
												<span className="text-xs text-muted-foreground w-11">Plan</span>
												{(["smart", "basic"] as const).map((level) => {
													const effective = planThinking === "none" ? null : (planThinking ?? configDefaults.planThinking)
													const isChecked = effective === level
													return (
														<label key={level} className="flex items-center gap-1 cursor-pointer select-none">
															<input
																type="checkbox"
																checked={isChecked}
																onChange={() => {
																	if (isChecked) setPlanThinking("none")
																	else setPlanThinking(level)
																}}
																className="h-3.5 w-3.5 rounded border-border bg-background accent-primary"
															/>
															{level === "smart" ? (
																<span className="flex items-center gap-0.5 text-xs"><Brain className="w-3 h-3" /> Smart</span>
															) : (
																<span className="flex items-center gap-0.5 text-xs"><Zap className="w-3 h-3" /> Normal</span>
															)}
														</label>
													)
												})}
												{planThinking === "none" && (
													<span className="text-xs text-muted-foreground italic">skip</span>
												)}
											</div>
											{/* Execute row */}
											<div className="flex items-center gap-2">
												<span className="text-xs text-muted-foreground w-11">Exec</span>
												{(["smart", "basic"] as const).map((level) => {
													const effective = executeThinking ?? configDefaults.executeThinking
													const isChecked = effective === level
													return (
														<label key={level} className="flex items-center gap-1 cursor-pointer select-none">
															<input
																type="radio"
																name="execute-thinking"
																checked={isChecked}
																onChange={() => setExecuteThinking(level)}
																className="h-3.5 w-3.5 border-border bg-background accent-primary"
															/>
															{level === "smart" ? (
																<span className="flex items-center gap-0.5 text-xs"><Brain className="w-3 h-3" /> Smart</span>
															) : (
																<span className="flex items-center gap-0.5 text-xs"><Zap className="w-3 h-3" /> Normal</span>
															)}
														</label>
													)
												})}
											</div>
										</div>
									</div>

									{/* Auto-commit */}
									<div>
										<label className="text-xs font-medium mb-1.5 block text-muted-foreground uppercase tracking-wide">Auto-commit</label>
										<div className="flex items-center gap-2">
											{([true, false] as const).map((val) => {
												const effective = autoCommit ?? configDefaults.autoCommit
												return (
													<label key={String(val)} className="flex items-center gap-1 cursor-pointer select-none">
														<input
															type="radio"
															name="card-auto-commit"
															checked={effective === val}
															onChange={() => setAutoCommit(val)}
															className="accent-primary h-3.5 w-3.5"
														/>
														<span className="text-xs">{val ? "On" : "Off"}</span>
													</label>
												)
											})}
										</div>
									</div>

									{/* Auto-push */}
									<div>
										<label className="text-xs font-medium mb-1.5 block text-muted-foreground uppercase tracking-wide">Auto-push</label>
										<div className="flex items-center gap-2">
											{([true, false] as const).map((val) => {
												const effective = autoPush ?? configDefaults.autoPush
												return (
													<label key={String(val)} className="flex items-center gap-1 cursor-pointer select-none">
														<input
															type="radio"
															name="card-auto-push"
															checked={effective === val}
															onChange={() => setAutoPush(val)}
															className="accent-primary h-3.5 w-3.5"
														/>
														<span className="text-xs">{val ? "On" : "Off"}</span>
													</label>
												)
											})}
										</div>
									</div>
								</div>
							</SidebarPanel>

								{/* Execution History Panel (only when editing and has executions) */}
							{isEditing && systemComments.length > 0 && (
								<SidebarPanel
									label="Execution History"
									icon={<History className="w-3.5 h-3.5" />}
									badge={systemComments.length}
								>
									<ScrollArea className="max-h-[300px]">
										<div className="space-y-2">
											{systemComments.map((comment) => {
												const execution = comment.execution_id ? executionMap[comment.execution_id] : null
												const isExpanded = comment.execution_id ? expandedExecutions.has(comment.execution_id) : false
												const hasOutput = execution && execution.output && execution.output.length > 0

												if (!execution) {
													return (
														<div key={comment.id} className="text-xs border-l-2 pl-2 border-border">
															<span className="text-muted-foreground/60">
																{new Date(comment.created_at).toLocaleString()}
															</span>
															<p className="mt-0.5 whitespace-pre-wrap">{comment.content}</p>
														</div>
													)
												}

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
															<span className="flex-1 truncate">{comment.content}</span>
														</button>
														<span className="text-muted-foreground/60 text-[10px] ml-5">
															{new Date(comment.created_at).toLocaleString()}
														</span>
														{isExpanded && hasOutput && (
															<pre className="mt-1.5 text-xs overflow-auto max-h-48 bg-muted/50 rounded p-2 whitespace-pre-wrap break-words">
																{execution.output}
															</pre>
														)}
														{isExpanded && (() => {
															const filesChanged = parseFilesChanged(execution.files_changed);
															if (filesChanged.length === 0) return null;
															const totalAdd = filesChanged.reduce((s, f) => s + f.additions, 0);
															const totalDel = filesChanged.reduce((s, f) => s + f.deletions, 0);
															return (
																<div className="mt-1.5 text-xs bg-muted/50 rounded p-2">
																	<div className="flex items-center gap-1.5 mb-1 font-semibold text-muted-foreground">
																		<FileCode className="w-3 h-3" />
																		{filesChanged.length} {filesChanged.length === 1 ? "file" : "files"} changed,{" "}
																		<span className="text-green-400">{totalAdd} insertions(+)</span>,{" "}
																		<span className="text-red-400">{totalDel} deletions(-)</span>
																	</div>
																	<div className="space-y-0.5">
																		{filesChanged.map((f) => (
																			<div key={f.path} className="flex items-center gap-2 font-mono">
																				<span className="text-green-400 w-10 text-right">+{f.additions}</span>
																				<span className="text-red-400 w-10 text-right">-{f.deletions}</span>
																				<span className="text-foreground truncate">{f.path}</span>
																			</div>
																		))}
																	</div>
																</div>
															);
														})()}
													</div>
												)
											})}
										</div>
									</ScrollArea>
								</SidebarPanel>
							)}

							{/* Advanced Panel (only when editing) */}
							{isEditing && (
								<SidebarPanel
									label="Advanced"
									icon={<Settings className="w-3.5 h-3.5" />}
									defaultOpen={false}
								>
									<div className="space-y-2">
										<label className="text-xs font-medium block text-muted-foreground uppercase tracking-wide">Move to project</label>
										{allBoards.filter((b) => b.id !== boardId).length === 0 ? (
											<p className="text-xs text-muted-foreground">No other projects available</p>
										) : (
											<div className="flex gap-2">
												<select
													className="flex-1 text-xs rounded border border-border bg-background px-2 py-1.5"
													value={moveTargetBoardId}
													onChange={(e) => setMoveTargetBoardId(e.target.value)}
												>
													<option value="">Select project...</option>
													{allBoards
														.filter((b) => b.id !== boardId)
														.map((b) => (
															<option key={b.id} value={b.id}>{b.name}</option>
														))}
												</select>
												<Button
													size="sm"
													variant="outline"
													disabled={isMoving || !moveTargetBoardId}
													onClick={() => void handleMoveToBoard()}
												>
													Move
												</Button>
											</div>
										)}
									</div>
								</SidebarPanel>
							)}
						</div>
					</div>
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
					{isEditing && card.status === "todo" && card.assignee !== "human" && (
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
					<Button onClick={() => void handleSave()} disabled={!title.trim() && !description.trim()}>
						{isEditing ? "Save" : "Create"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
