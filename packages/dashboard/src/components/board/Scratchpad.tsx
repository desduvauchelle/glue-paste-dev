import { useState, useEffect, useRef, useCallback } from "react"
import { boards as boardsApi, type Board } from "@/lib/api"
import { X } from "lucide-react"

interface ScratchpadProps {
	board: Board
	onClose: () => void
	onBoardUpdated: (board: Board) => void
}

export function Scratchpad({ board, onClose, onBoardUpdated }: ScratchpadProps) {
	const [content, setContent] = useState(board.scratchpad)
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const contentRef = useRef(content)
	contentRef.current = content

	const save = useCallback(async (text: string) => {
		try {
			const updated = await boardsApi.update(board.id, { scratchpad: text })
			onBoardUpdated(updated)
		} catch {
			// silent — auto-save best-effort
		}
	}, [board.id, onBoardUpdated])

	const scheduleSave = useCallback((text: string) => {
		if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
		saveTimerRef.current = setTimeout(() => {
			void save(text)
		}, 800)
	}, [save])

	const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const text = e.target.value
		setContent(text)
		scheduleSave(text)
	}

	// Save on close / unmount
	useEffect(() => {
		return () => {
			if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
			if (contentRef.current !== board.scratchpad) {
				void save(contentRef.current)
			}
		}
	}, [board.scratchpad, save])

	// Escape to close
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				onClose()
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [onClose])

	// Lock body scroll
	useEffect(() => {
		document.body.style.overflow = "hidden"
		return () => { document.body.style.overflow = "" }
	}, [])

	return (
		<div className="fixed inset-0 z-50 bg-background flex flex-col">
			<div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
				<div className="flex items-center gap-3">
					<h2 className="text-lg font-semibold">Scratchpad</h2>
					<span className="text-sm text-muted-foreground">{board.name}</span>
				</div>
				<div className="flex items-center gap-3">
					<kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-base-200 border border-base-300 rounded text-muted-foreground">ESC</kbd>
					<button
						type="button"
						onClick={onClose}
						className="p-1.5 rounded hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"
					>
						<X className="w-4 h-4" />
					</button>
				</div>
			</div>
			<textarea
				className="flex-1 w-full p-6 bg-background text-foreground resize-none outline-none font-mono text-sm leading-relaxed"
				value={content}
				onChange={handleChange}
				placeholder="Jot down notes, ideas, links, or anything you want to remember for this project..."
				autoFocus
			/>
		</div>
	)
}
