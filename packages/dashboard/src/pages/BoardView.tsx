import { useState, useEffect, useCallback, useRef } from "react"
import { useLocation } from "wouter"
import { boards as boardsApi, queue as queueApi, type Board, type CardWithTags } from "@/lib/api"
import { useCards } from "@/hooks/use-cards"
import { useWebSocket } from "@/lib/ws"
import { KanbanBoard } from "@/components/board/KanbanBoard"
import { CardDialog } from "@/components/board/CardDialog"
import { Button } from "@/components/ui/button"
import { BoardSettingsDialog } from "@/components/board/BoardSettingsDialog"
import { ProjectSwitcher } from "@/components/board/ProjectSwitcher"
import { CoPlanSidebar } from "@/components/board/CoPlanSidebar"
import { ArrowLeft, Plus, Pause, Square, Settings, ArrowLeftRight } from "lucide-react"
import { CaffeineToggle } from "@/components/CaffeineToggle"
import { getBoardColor } from "@/lib/colors"

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
	const [queueRunning, setQueueRunning] = useState(false)
	const [queuePaused, setQueuePaused] = useState(false)
	const [settingsOpen, setSettingsOpen] = useState(false)
	const [switcherOpen, setSwitcherOpen] = useState(false)
	const [coPlanCard, setCoPlanCard] = useState<CardWithTags | null>(null)
	const [autoRun, setAutoRun] = useState(() => {
		const stored = localStorage.getItem(`queue-autorun-${boardId}`)
		return stored === null ? true : stored === "true"
	})
	const autoRunRef = useRef(autoRun)
	autoRunRef.current = autoRun

	const { grouped, create, update, reorder, remove, execute, stop, loading } = useCards(boardId)

	const tryStartQueue = useCallback(async () => {
		if (!autoRunRef.current || queueRunning) return
		try {
			await queueApi.start(boardId)
			setQueueRunning(true)
		} catch {
			// 409 = already running, ignore
		}
	}, [boardId, queueRunning])

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
	})

	const handlePlayCard = async (id: string) => {
		await execute(id)
	}

	const handleStopCard = async (id: string) => {
		await stop(id)
	}

	const handleToggleAutoRun = () => {
		const next = !autoRun
		setAutoRun(next)
		localStorage.setItem(`queue-autorun-${boardId}`, String(next))
		if (!next && queueRunning) {
			void handleStopQueue()
		}
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
		const hasNewQueued = updates.some((u) => u.status === "queued")
		if (hasNewQueued && autoRun && !queueRunning) {
			void tryStartQueue()
		}
	}

	const handleClickCard = (card: CardWithTags) => {
		setSelectedCard(card)
		setDialogOpen(true)
	}

	const handleNewCard = () => {
		setSelectedCard(null)
		setNewCardStatus(undefined)
		setDialogOpen(true)
	}

	const handleNewCardWithStatus = (status: string) => {
		setSelectedCard(null)
		setNewCardStatus(status)
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
			{/* Project color accent bar */}
			{boardColor && (
				<div className="h-1.5 w-full shrink-0" style={{ backgroundColor: boardColor.bg }} />
			)}
			{/* Header */}
			<header className="border-b border-border px-4 py-3 flex items-center justify-between shrink-0">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
						<ArrowLeft className="w-4 h-4" />
					</Button>

					<button
						type="button"
						className="text-left hover:opacity-80 transition-opacity flex items-center gap-2"
						onClick={() => setSettingsOpen(true)}
					>
						{boardColor && (
							<span
								className="w-4 h-4 rounded-full shrink-0"
								style={{ backgroundColor: boardColor.bg }}
							/>
						)}
						<div>
							<h1 className="text-lg font-semibold">{board.name}</h1>
							{board.directory && (
								<p className="text-xs text-muted-foreground font-mono">{board.directory}</p>
							)}
						</div>
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
					<Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsOpen(true)}>
						<Settings className="w-4 h-4" />
					</Button>
					<Button variant="outline" size="sm" onClick={handleNewCard}>
						<Plus className="w-4 h-4 mr-1" />
						Add Card
						<kbd className="ml-1.5 px-1.5 py-0.5 text-[10px] font-mono bg-base-200 border border-base-300 rounded text-muted-foreground">⌘J</kbd>
					</Button>
					<Button
						variant={autoRun ? "default" : "outline"}
						size="sm"
						onClick={handleToggleAutoRun}
					>
						Queue: {autoRun ? "On" : "Off"}
					</Button>

					{queueRunning && (
						<>
							<Button variant="secondary" size="sm" onClick={() => void handlePauseQueue()}>
								<Pause className="w-4 h-4 mr-1" />
								{queuePaused ? "Resume" : "Pause"}
							</Button>
							<Button variant="destructive" size="sm" onClick={() => void handleStopQueue()}>
								<Square className="w-4 h-4 mr-1" />
								Stop
							</Button>
						</>
					)}
				</div>
			</header>

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
							onCoPlanCard={(card) => setCoPlanCard(card)}
							onReorderCards={(updates) => void handleReorderCards(updates)}
							onAddCard={handleNewCardWithStatus}
						/>
					)}
				</main>

				{coPlanCard && (
					<CoPlanSidebar
						card={coPlanCard}
						onClose={() => setCoPlanCard(null)}
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
			/>

			{/* Project Switcher */}
			{switcherOpen && (
				<ProjectSwitcher currentBoardId={boardId} onClose={() => setSwitcherOpen(false)} />
			)}

			{/* Board Settings Dialog */}
			<BoardSettingsDialog
				open={settingsOpen}
				onOpenChange={setSettingsOpen}
				board={board}
				onUpdated={setBoard}
			/>
		</div>
	)
}
