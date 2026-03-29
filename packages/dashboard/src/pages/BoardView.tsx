import { useState, useEffect, useCallback, useRef } from "react"
import { useLocation } from "wouter"
import { boards as boardsApi, queue as queueApi, type Board, type CardWithTags } from "@/lib/api"
import { useCards } from "@/hooks/use-cards"
import { useWebSocket } from "@/lib/ws"
import { KanbanBoard } from "@/components/board/KanbanBoard"
import { CardDialog } from "@/components/board/CardDialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog"
import { ProjectSwitcher } from "@/components/board/ProjectSwitcher"
import { BrainstormPanel } from "@/components/board/BrainstormPanel"
import { ArrowLeft, Plus, Pause, Square, Settings, ArrowLeftRight, StickyNote, Copy, FolderOpen, Check } from "lucide-react"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CaffeineToggle } from "@/components/CaffeineToggle"
import { Scratchpad } from "@/components/board/Scratchpad"
import { getBoardColor } from "@/lib/colors"
import type { DefaultSuggestion } from "@/components/board/DefaultSuggestionCard"

interface BoardViewProps {
	params: { boardId: string }
}

export function BoardView({ params }: BoardViewProps) {
	const { boardId } = params
	const [, setLocation] = useLocation()
	const [board, setBoard] = useState<Board | null>(null)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [selectedCard, setSelectedCard] = useState<CardWithTags | null>(null)
	const [newCardStatus, setNewCardStatus] = useState<string | undefined>(undefined)
	const [newCardDescription, setNewCardDescription] = useState<string | undefined>(undefined)
	const [queueRunning, setQueueRunning] = useState(false)
	const [queuePaused, setQueuePaused] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [switcherOpen, setSwitcherOpen] = useState(false)
	const [scratchpadOpen, setScratchpadOpen] = useState(false)
	const [copiedPath, setCopiedPath] = useState(false)
	const [brainstormCard, setBrainstormCard] = useState<CardWithTags | null | "fresh">(null)
	const [autoRun, setAutoRun] = useState(() => {
		const stored = localStorage.getItem(`queue-autorun-${boardId}`)
		return stored === null ? true : stored === "true"
	})
	const autoRunRef = useRef(autoRun)
	autoRunRef.current = autoRun
	const queueRunningRef = useRef(queueRunning)
	queueRunningRef.current = queueRunning

	const { grouped, create, update, reorder, remove, execute, stop, loading, doneHasMore, loadMoreDone } = useCards(boardId)

	const prevQueuedCountRef = useRef(grouped.queued?.length ?? 0)

	const tryStartQueue = useCallback(async () => {
		if (!autoRunRef.current || queueRunningRef.current) return
		try {
			await queueApi.start(boardId)
			setQueueRunning(true)
		} catch {
			// 409 = already running, ignore
		}
	}, [boardId])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault()
				setSwitcherOpen((v) => !v)
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "j" && !dialogOpen && !settingsOpen) {
				e.preventDefault()
				handleNewCard()
			}
			if ((e.metaKey || e.ctrlKey) && e.key === "." && !dialogOpen && !settingsOpen) {
				e.preventDefault()
				setScratchpadOpen((v) => !v)
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [dialogOpen, settingsOpen])

	useEffect(() => {
		void boardsApi.get(boardId).then(setBoard)
		void queueApi.status(boardId).then((s) => {
			setQueueRunning(s.isRunning)
			setQueuePaused(s.isPaused)
		})
	}, [boardId])

	useEffect(() => {
		if (board) {
			document.title = `${board.name} — Glue Paste`
		}
		return () => { document.title = "Glue Paste" }
	}, [board])


	// When auto-run is toggled ON, start queue if there are queued cards
	useEffect(() => {
		if (autoRun && !queueRunning && (grouped.queued?.length ?? 0) > 0) {
			void tryStartQueue()
		}
	}, [autoRun])

	// Auto-start queue when new queued cards appear (e.g., card created directly as "queued")
	useEffect(() => {
		const currentCount = grouped.queued?.length ?? 0
		const hadNew = currentCount > prevQueuedCountRef.current
		prevQueuedCountRef.current = currentCount
		if (hadNew && autoRunRef.current && !queueRunningRef.current) {
			void tryStartQueue()
		}
	}, [grouped.queued?.length, tryStartQueue])

	useWebSocket((event) => {
		if (event.type === "queue:updated") {
			setQueueRunning(true)
			setQueuePaused(!!(event.payload as Record<string, unknown>)?.isPaused)
		}
		if (event.type === "queue:stopped") {
			setQueueRunning(false)
			setQueuePaused(false)
			// Auto-restart if there are still queued cards
			if (autoRunRef.current) {
				setTimeout(() => void tryStartQueue(), 500)
			}
		}
		if (event.type === "ws:reconnected") {
			void queueApi.status(boardId).then((s) => {
				setQueueRunning(s.isRunning)
				setQueuePaused(s.isPaused)
			})
		}
	})

	const handlePlayCard = async (id: string) => {
		const allCards = Object.values(grouped).flat()
		const card = allCards.find((c) => c.id === id)
		if (!card) return

		if (card.status === "todo") {
			await update(id, { status: "queued" })
		}
		// Always start the queue to process the card (409 if already running is fine)
		try {
			await queueApi.start(boardId)
			setQueueRunning(true)
		} catch {
			// 409 = already running, advanceQueue will pick up the new card
		}
	}

	const handleStopCard = async (id: string) => {
		await stop(id)
	}

	const handlePauseQueue = async () => {
		if (queuePaused) {
			await queueApi.resume(boardId)
			setQueuePaused(false)
		} else {
			await queueApi.pause(boardId)
			setQueuePaused(true)
		}
	}

	const handleStopQueue = async () => {
		await queueApi.stop(boardId)
		setQueueRunning(false)
		setQueuePaused(false)
	}

	const handleReorderCards = async (updates: Array<{ id: string; status: string; position: number }>) => {
		await reorder(updates)

		// If a card was moved to "in-progress", execute it
		const movedToInProgress = updates.find((u) => u.status === "in-progress")
		if (movedToInProgress) {
			const wasAlreadyInProgress = grouped["in-progress"]?.some((c) => c.id === movedToInProgress.id)
			if (!wasAlreadyInProgress) {
				void execute(movedToInProgress.id)
			}
		}

		// If a card was moved to "queued", try to start the queue
		const hasNewQueued = updates.some((u) => u.status === "queued")
		if (hasNewQueued && autoRunRef.current && !queueRunningRef.current) {
			void tryStartQueue()
		}
	}

	const handleClickCard = (card: CardWithTags) => {
		setSelectedCard(card)
		setDialogOpen(true)
	}

	const handleDeleteBoard = async (boardId: string) => {
		await boardsApi.delete(boardId)
		setLocation("/")
	}

	const handleNewCard = () => {
		setSelectedCard(null)
		setNewCardStatus(undefined)
		setNewCardDescription(undefined)
		setDialogOpen(true)
	}

	const handleNewCardWithStatus = (status: string) => {
		setSelectedCard(null)
		setNewCardStatus(status)
		setNewCardDescription(undefined)
		setDialogOpen(true)
	}

	const handleSuggestionClick = (suggestion: DefaultSuggestion) => {
		setSelectedCard(null)
		setNewCardStatus("todo")
		setNewCardDescription(suggestion.description)
		setDialogOpen(true)
	}

	if (!board) {
		return (
			<div className="flex items-center justify-center h-screen text-muted-foreground">
				Loading board...
			</div>
		)
	}

	const boardColor = getBoardColor(board.color)

	return (
		<div className="flex flex-col h-screen">
			{/* Header */}
			<header
				className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0"
				style={boardColor ? { borderTopWidth: "4px", borderTopColor: boardColor.bg } : undefined}
			>
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
						<ArrowLeft className="w-4 h-4" />
					</Button>

					<button
						type="button"
						className="text-left hover:opacity-80 transition-opacity flex items-center gap-2"
						onClick={() => setSwitcherOpen(true)}
					>
						{boardColor && (
							<span
								className="w-4 h-4 rounded-full shrink-0"
								style={{ backgroundColor: boardColor.bg }}
							/>
						)}
						<h1 className="text-lg font-semibold">{board.name}</h1>
					</button>
					<button
						type="button"
						className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
						onClick={() => setSwitcherOpen(true)}
						title="Switch project"
					>
						<ArrowLeftRight className="w-3.5 h-3.5" />
						<kbd className="px-1 py-0.5 text-[10px] font-mono bg-base-200 border border-base-300 rounded text-muted-foreground">⌘K</kbd>
					</button>
				</div>
				<div className="flex items-center gap-2">
					<CaffeineToggle />
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
									onClick={() => setScratchpadOpen(true)}
								>
									<StickyNote className="w-4 h-4" />
									<kbd className="px-1 py-0.5 text-[10px] font-mono bg-base-200 border border-base-300 rounded text-muted-foreground">⌘.</kbd>
								</button>
							</TooltipTrigger>
							<TooltipContent>Scratchpad</TooltipContent>
						</Tooltip>
					</TooltipProvider>
					<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsOpen(true)}>
						<Settings className="w-4 h-4" />
					</Button>
					<Button variant="outline" size="sm" onClick={handleNewCard}>
						<Plus className="w-4 h-4 mr-1" />
						Add Card
						<kbd className="ml-1.5 px-1.5 py-0.5 text-[10px] font-mono bg-base-200 border border-base-300 rounded text-muted-foreground">⌘J</kbd>
					</Button>
					<div className="flex items-center gap-2">
						<span className={`text-sm font-medium transition-colors ${autoRun ? "text-foreground" : "text-muted-foreground"}`}>Q</span>
						<Switch
							checked={autoRun}
							onCheckedChange={(checked) => {
								setAutoRun(checked)
								localStorage.setItem(`queue-autorun-${boardId}`, String(checked))
								if (!checked && queueRunning) {
									void handleStopQueue()
								} else if (checked && !queueRunning) {
									void tryStartQueue()
								}
							}}
							checkedClassName="bg-emerald-500"
						/>
					</div>

					{queueRunning && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="secondary" size="icon" className="h-8 w-8" onClick={() => void handlePauseQueue()}>
										<Pause className="w-4 h-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>{queuePaused ? "Resume" : "Pause"}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button variant="destructive" size="icon" className="h-8 w-8" onClick={() => void handleStopQueue()}>
										<Square className="w-4 h-4" />
									</Button>
								</TooltipTrigger>
								<TooltipContent>Stop</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
				</div>
			</header>

			{/* Project Path Bar */}
			{board.directory && (
				<div className="border-b border-border px-4 py-1 flex items-center gap-2 shrink-0 bg-muted/30">
					<span className="text-xs text-muted-foreground font-mono truncate">{board.directory}</span>
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground shrink-0"
									onClick={() => {
										void navigator.clipboard.writeText(board.directory!)
										setCopiedPath(true)
										setTimeout(() => setCopiedPath(false), 2000)
									}}
								>
									{copiedPath ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
								</button>
							</TooltipTrigger>
							<TooltipContent>{copiedPath ? "Copied!" : "Copy path"}</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									type="button"
									className="p-0.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground shrink-0"
									onClick={() => {
										void fetch(`/api/system/open-folder`, {
											method: "POST",
											headers: { "Content-Type": "application/json" },
											body: JSON.stringify({ path: board.directory }),
										})
									}}
								>
									<FolderOpen className="w-3 h-3" />
								</button>
							</TooltipTrigger>
							<TooltipContent>Open in Finder</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				</div>
			)}

			{/* Kanban Board + Co-Plan Sidebar */}
			<div className="flex-1 flex overflow-hidden">
				<main className="flex-1 overflow-hidden pt-4">
					{loading ? (
						<p className="text-muted-foreground">Loading cards...</p>
					) : (
						<KanbanBoard
							grouped={grouped}
							onPlayCard={(id) => void handlePlayCard(id)}
							onStopCard={(id) => void handleStopCard(id)}
							onClickCard={handleClickCard}
							onCoPlanCard={(card) => setBrainstormCard(card)}
							onReorderCards={(updates) => void handleReorderCards(updates)}
							onAddCard={handleNewCardWithStatus}
							onBrainstorm={() => setBrainstormCard("fresh")}
							onSuggestionClick={handleSuggestionClick}
							doneHasMore={doneHasMore}
							onLoadMoreDone={loadMoreDone}
						/>
					)}
				</main>

				{brainstormCard && (
					<BrainstormPanel
						card={brainstormCard === "fresh" ? null : brainstormCard}
						boardId={boardId}
						onClose={() => setBrainstormCard(null)}
						onCardCreated={() => setBrainstormCard(null)}
					/>
				)}
			</div>

			{/* Card Dialog */}
			<CardDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				card={selectedCard}
				boardId={boardId}
				boardName={board?.name}
				onCreate={create}
				onUpdate={update}
				onDelete={remove}
				onPlay={(id) => void handlePlayCard(id)}
				defaultStatus={newCardStatus}
				defaultDescription={newCardDescription}
			/>

			{/* Project Switcher */}
			{switcherOpen && (
				<ProjectSwitcher currentBoardId={boardId} onClose={() => setSwitcherOpen(false)} />
			)}

			{/* Scratchpad */}
			{scratchpadOpen && board && (
				<Scratchpad
					board={board}
					onClose={() => setScratchpadOpen(false)}
					onBoardUpdated={setBoard}
				/>
			)}

			{/* Board Settings Dialog */}
			<BoardSettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				board={board}
				onUpdated={setBoard}
				onDelete={handleDeleteBoard}
			/>
		</div>
	)
}
