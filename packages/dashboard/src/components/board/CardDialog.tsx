import { useState, useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
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
import { Switch } from "@/components/ui/switch"
import { Send, Play, Trash2, Eraser, Brain, Zap, FolderOpen, X, Settings, Bot, User, FileCode, Maximize2, Minimize2, GitCommit, ExternalLink } from "lucide-react"
import { FileBrowser } from "./FileBrowser"
import { FileSearchInput } from "./FileSearchInput"
import { SidebarPanel } from "./SidebarPanel"
import { useExecutions } from "@/hooks/use-executions"
import { useCommits } from "@/hooks/use-commits"
import type { Execution, Board as BoardType } from "@/lib/api"
import { parseFilesChanged } from "@/lib/api"
import { cn } from "@/lib/utils"
import { getBoardColor } from "@/lib/colors"

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
	defaultDescription?: string
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
	defaultDescription,
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
	const [targetBoardId, setTargetBoardId] = useState(boardId)
	const [activityMaximized, setActivityMaximized] = useState(false)
	const { comments, add: addComment, clear: clearComments } = useComments(card?.id ?? null)
	const { executions } = useExecutions(card?.id ?? null)
	const { commits } = useCommits(card?.id ?? null)
	const [currentBoard, setCurrentBoard] = useState<BoardType | null>(null)
	const activityEndRef = useRef<HTMLDivElement>(null)

	const executionMap = Object.fromEntries(executions.map((e) => [e.id, e])) as Record<string, Execution>

	const toggleExecution = (id: string) => {
		setExpandedExecutions((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	const LAST_STATUS_KEY = "card-dialog-last-status"
	const [selectedStatus, setSelectedStatus] = useState<"todo" | "queued">("queued")

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
			setAutoPush(card.auto_push)
			setAssignee(card.assignee ?? "ai")
		} else {
			setTitle("")
			setDescription(defaultDescription ?? "")
			setSelectedTags([])
			setFiles([])
			setBlocking(false)
			setPlanThinking(null)
			setExecuteThinking(null)
			setAutoCommit(null)
			setAutoPush(null)
			setAssignee("ai")
			// Set status: use defaultStatus from column click, or last remembered value
			let stored: string | null = null
			try { stored = localStorage.getItem(LAST_STATUS_KEY) } catch {}
			const initial = (defaultStatus as "todo" | "queued") ?? (stored as "todo" | "queued" | null) ?? "queued"
			setSelectedStatus(initial)
		}
		setShowFileBrowser(false)
		setConfirmDelete(false)
	}, [card, open, defaultDescription])

	useEffect(() => {
		void configApi.getForBoard(boardId).then((c) => setConfigDefaults({ planThinking: c.planThinking, executeThinking: c.executeThinking, autoCommit: c.autoCommit, autoPush: c.autoPush }))
	}, [boardId])

	useEffect(() => {
		void boardsApi.get(boardId).then(setCurrentBoard)
	}, [boardId])

	useEffect(() => {
		void boardsApi.list().then(setAllBoards)
	}, [])

	useEffect(() => {
		setMoveTargetBoardId("")
		setTargetBoardId(boardId)
	}, [card, open, boardId])

	useEffect(() => {
		activityEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [executions])

	// Close maximized activity on Escape
	useEffect(() => {
		if (!activityMaximized) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation()
				setActivityMaximized(false)
			}
		}
		document.addEventListener("keydown", handler, true)
		return () => document.removeEventListener("keydown", handler, true)
	}, [activityMaximized])

	// Reset maximized state when dialog closes
	useEffect(() => {
		if (!open) setActivityMaximized(false)
	}, [open])

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
			try { localStorage.setItem(LAST_STATUS_KEY, selectedStatus) } catch {}
			const input: CreateCard = {
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
				status: selectedStatus,
			}
			if (targetBoardId && targetBoardId !== boardId) {
				await cardsApi.create(targetBoardId, input)
			} else {
				await onCreate(input)
			}
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
						<DialogTitle>{isEditing ? "Edit Card" : "New Card"}{!isEditing ? ` — ${(targetBoardId && targetBoardId !== boardId ? allBoards.find((b) => b.id === targetBoardId)?.name : boardName) ?? ""}` : ""}</DialogTitle>
					</DialogHeader>

					<div className="flex-1 overflow-y-auto py-2 px-1 -mx-1">
						<div className="flex flex-col md:flex-row gap-6">
							{/* Left Column — Main Content */}
							<div className="flex-1 min-w-0 space-y-4">
								{/* Title field hidden — state kept for data model compatibility */}

								{/* Column selector (create mode only) */}
								{!isEditing && (
									<div>
										<label className="text-xs font-medium mb-1.5 block text-muted-foreground uppercase tracking-wide">Column</label>
										<div className="flex items-center gap-2">
											{([["todo", "To Do"], ["queued", "Queued"]] as const).map(([val, label]) => (
												<label key={val} className="flex items-center gap-1 cursor-pointer select-none">
													<input
														type="radio"
														name="card-status"
														checked={selectedStatus === val}
														onChange={() => setSelectedStatus(val)}
														className="accent-primary h-3.5 w-3.5"
													/>
													<span className="text-xs">{label}</span>
												</label>
											))}
										</div>
									</div>
								)}

								{/* Description */}
								<div>
									<label className="text-sm font-medium mb-1 block">Description</label>
									<Textarea
										placeholder="Describe what needs to be done..."
										value={description}
										onChange={(e) => setDescription(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter" && e.shiftKey) {
												e.preventDefault()
												void handleSave()
											}
										}}
										rows={3}
										autoResize
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
								{isEditing && (() => {
									const renderActivityList = (maximized: boolean): ReactNode => (
										<>
											{comments.length === 0 ? (
												<p className="text-xs text-muted-foreground py-2 text-center">
													No activity yet
												</p>
											) : (
												<div className="space-y-2">
													{comments.map((comment) => {
														const execution = comment.execution_id
															? executionMap[comment.execution_id]
															: null
														const isExpanded = comment.execution_id
															? expandedExecutions.has(comment.execution_id)
															: false
														const hasOutput = execution && execution.output && execution.output.length > 0

														if (comment.author !== "system") {
															return (
																<div key={comment.id} className="text-xs border-l-2 pl-2 border-primary/40">
																	<span className="font-semibold capitalize text-muted-foreground">{comment.author}</span>
																	<span className="text-muted-foreground/60 ml-2">{new Date(comment.created_at).toLocaleString()}</span>
																	<p className="mt-0.5 whitespace-pre-wrap">{comment.content}</p>
																</div>
															)
														}

														if (!execution) {
															return (
																<div key={comment.id} className="text-xs border-l-2 pl-2 border-muted-foreground/40">
																	<span className="text-muted-foreground/60">{new Date(comment.created_at).toLocaleString()}</span>
																	<p className="mt-0.5 whitespace-pre-wrap">{comment.content}</p>
																</div>
															)
														}

														const phaseLabel = execution.phase === "plan" ? "Plan" : "Execution"
														return (
															<div key={comment.id} className="text-xs border-l-2 pl-2 border-border">
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
																	<span className="text-muted-foreground/60">—</span>
																	<span className="flex-1 truncate">{comment.content}</span>
																</button>
																<span className="text-muted-foreground/60 text-[10px]">
																	{new Date(comment.created_at).toLocaleString()}
																</span>
																{isExpanded && hasOutput && (
																	<pre className={cn(
																		"mt-2 text-xs overflow-auto bg-muted/50 rounded p-3 whitespace-pre-wrap break-words",
																		!maximized && "max-h-[300px]"
																	)}>
																		{execution.output}
																	</pre>
																)}
																{isExpanded && (() => {
																	const filesChanged = parseFilesChanged(execution.files_changed)
																	if (filesChanged.length === 0) return null
																	const totalAdd = filesChanged.reduce((s, f) => s + f.additions, 0)
																	const totalDel = filesChanged.reduce((s, f) => s + f.deletions, 0)
																	return (
																		<div className="mt-2 text-xs bg-muted/50 rounded p-3">
																			<div className="flex items-center gap-1.5 mb-1 font-semibold text-muted-foreground">
																				<FileCode className="w-3.5 h-3.5" />
																				{filesChanged.length} {filesChanged.length === 1 ? "file" : "files"} changed,{" "}
																				<span className="text-green-400">{totalAdd} insertions(+)</span>,{" "}
																				<span className="text-red-400">{totalDel} deletions(-)</span>
																			</div>
																			<div className="space-y-0.5">
																				{filesChanged.map((f) => (
																					<div key={f.path} className="flex items-center gap-2 font-mono">
																						<span className="text-green-400 w-10 text-right">+{f.additions}</span>
																						<span className="text-red-400 w-10 text-right">-{f.deletions}</span>
																						<span className="truncate">{f.path}</span>
																					</div>
																				))}
																			</div>
																		</div>
																	)
																})()}
															</div>
														)
													})}
													<div ref={activityEndRef} />
												</div>
											)}
										</>
									)

									const renderCommentInput = () => (
										<div className="flex gap-2">
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
									)

									return (
										<div>
											<div className="flex items-center justify-between mb-1">
												<label className="text-sm font-medium">
													Activity ({comments.length})
												</label>
												<div className="flex items-center gap-1">
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
													<Button
														variant="ghost"
														size="icon"
														className="h-6 w-6"
														onClick={() => setActivityMaximized(true)}
														title="Maximize activity"
													>
														<Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />
													</Button>
												</div>
											</div>
											<ScrollArea className="max-h-[400px] border rounded-md p-2">
												{renderActivityList(false)}
											</ScrollArea>
											<div className="mt-2">
												{renderCommentInput()}
											</div>

											{activityMaximized && createPortal(
												<div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
													<div
														className="absolute inset-0 bg-black/40 backdrop-blur-sm"
														onClick={() => setActivityMaximized(false)}
													/>
													<div
														className="relative z-10 w-full h-full max-w-6xl rounded-lg border border-border bg-card text-card-foreground shadow-lg flex flex-col"
														onClick={(e) => e.stopPropagation()}
													>
														<div className="flex items-center justify-between px-4 py-3 border-b border-border">
															<span className="text-sm font-medium">Activity ({comments.length})</span>
															<Button
																variant="ghost"
																size="icon"
																className="h-7 w-7"
																onClick={() => setActivityMaximized(false)}
																title="Minimize"
															>
																<Minimize2 className="w-4 h-4" />
															</Button>
														</div>
														<ScrollArea className="flex-1 p-4">
															{renderActivityList(true)}
														</ScrollArea>
														<div className="px-4 py-3 border-t border-border">
															{renderCommentInput()}
														</div>
													</div>
												</div>,
												document.body
											)}
										</div>
									)
								})()}
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

										{/* Blocking toggle */}
										<div className="flex items-start gap-3">
											<Switch
												id="blocking"
												checked={blocking}
												onCheckedChange={setBlocking}
												className="mt-0.5"
											/>
											<div>
												<label htmlFor="blocking" className="text-xs font-medium block text-muted-foreground uppercase tracking-wide cursor-pointer">Blocking</label>
												<p className="text-xs text-muted-foreground mt-0.5">
													Play All stops if this card fails
												</p>
											</div>
										</div>

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
											<div className="flex items-center gap-2">
												<Switch
													checked={autoCommit ?? configDefaults.autoCommit}
													onCheckedChange={(v) => setAutoCommit(v)}
												/>
												<label className="text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer">Auto-commit</label>
											</div>
										</div>

										{/* Auto-push */}
										<div>
											<div className="flex items-center gap-2">
												<Switch
													checked={autoPush ?? configDefaults.autoPush}
													onCheckedChange={(v) => setAutoPush(v)}
												/>
												<label className="text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer">Auto-push</label>
											</div>
										</div>
									</div>
								</SidebarPanel>

								{/* Project selector (create mode only) */}
								{!isEditing && allBoards.length > 1 && (
									<SidebarPanel
										label="Project"
										icon={<FolderOpen className="w-3.5 h-3.5" />}
										defaultOpen
									>
										<div className="space-y-1.5">
											{allBoards.map((b) => {
												const color = getBoardColor(b.color)
												const isSelected = (targetBoardId || boardId) === b.id
												return (
													<label
														key={b.id}
														className={cn(
															"flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer select-none text-xs transition-colors",
															isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted"
														)}
													>
														<input
															type="radio"
															name="target-project"
															checked={isSelected}
															onChange={() => setTargetBoardId(b.id)}
															className="sr-only"
														/>
														<span
															className="w-2.5 h-2.5 rounded-full shrink-0"
															style={{ backgroundColor: color?.bg ?? "#64748b" }}
														/>
														<span className="truncate">{b.name}</span>
														{b.id === boardId && (
															<span className="text-[10px] text-muted-foreground ml-auto">(current)</span>
														)}
													</label>
												)
											})}
										</div>
									</SidebarPanel>
								)}

							{/* Commits Panel (only when editing and has commits) */}
								{isEditing && commits.length > 0 && (
									<SidebarPanel
										label={`Commits (${commits.length})`}
										icon={<GitCommit className="w-3.5 h-3.5" />}
										defaultOpen
									>
										<div className="space-y-2">
											{commits.map((commit) => {
												const shortSha = commit.sha.slice(0, 7)
												const githubUrl = currentBoard?.github_url
												const commitUrl = githubUrl
													? `${githubUrl.replace(/\/$/, "")}/commit/${commit.sha}`
													: null
												const commitFiles = parseFilesChanged(commit.files_changed)
												const totalAdd = commitFiles.reduce((s, f) => s + f.additions, 0)
												const totalDel = commitFiles.reduce((s, f) => s + f.deletions, 0)

												return (
													<div key={commit.id} className="text-xs border-l-2 pl-2 border-border">
														<div className="flex items-center gap-1.5">
															<code className="text-[10px] bg-muted px-1 py-0.5 rounded font-mono">
																{commitUrl ? (
																	<a
																		href={commitUrl}
																		target="_blank"
																		rel="noopener noreferrer"
																		className="text-primary hover:underline inline-flex items-center gap-0.5"
																		onClick={(e) => e.stopPropagation()}
																	>
																		{shortSha}
																		<ExternalLink className="w-2.5 h-2.5" />
																	</a>
																) : (
																	shortSha
																)}
															</code>
															{commitFiles.length > 0 && (
																<span className="text-muted-foreground">
																	{commitFiles.length} {commitFiles.length === 1 ? "file" : "files"}
																	{" "}
																	<span className="text-green-400">+{totalAdd}</span>
																	{" "}
																	<span className="text-red-400">-{totalDel}</span>
																</span>
															)}
														</div>
														<p className="mt-0.5 truncate text-muted-foreground" title={commit.message}>
															{commit.message}
														</p>
														{commitFiles.length > 0 && (
															<details className="mt-1">
																<summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
																	Show files
																</summary>
																<div className="mt-1 space-y-0.5 text-[10px] font-mono">
																	{commitFiles.map((f) => (
																		<div key={f.path} className="flex items-center gap-1.5">
																			<span className="text-green-400 w-7 text-right">+{f.additions}</span>
																			<span className="text-red-400 w-7 text-right">-{f.deletions}</span>
																			<span className="truncate">{f.path}</span>
																		</div>
																	))}
																</div>
															</details>
														)}
													</div>
												)
											})}
										</div>
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
								Add to Queue
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
