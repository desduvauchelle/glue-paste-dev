import { useState, useEffect, useRef } from "react"
import { useLocation } from "wouter"
import { boards as boardsApi, type Board } from "@/lib/api"

interface ProjectSwitcherProps {
	currentBoardId?: string
	onClose: () => void
}

export function ProjectSwitcher({ currentBoardId, onClose }: ProjectSwitcherProps) {
	const [, setLocation] = useLocation()
	const [boardsList, setBoardsList] = useState<Board[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const listRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		void boardsApi.list().then((bs) => {
			setBoardsList(bs)
			const idx = bs.findIndex((b) => b.id === currentBoardId)
			setSelectedIndex(idx >= 0 ? idx : 0)
		})
	}, [currentBoardId])

	useEffect(() => {
		const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
		el?.scrollIntoView({ block: "nearest" })
	}, [selectedIndex])

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault()
				setSelectedIndex((i) => Math.min(i + 1, boardsList.length - 1))
			} else if (e.key === "ArrowUp") {
				e.preventDefault()
				setSelectedIndex((i) => Math.max(i - 1, 0))
			} else if (e.key === "Enter") {
				const board = boardsList[selectedIndex]
				if (board) {
					setLocation(`/boards/${board.id}`)
					onClose()
				}
			} else if (e.key === "Escape") {
				onClose()
			}
		}
		window.addEventListener("keydown", handler)
		return () => window.removeEventListener("keydown", handler)
	}, [boardsList, selectedIndex, setLocation, onClose])

	return (
		<div
			className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
			onClick={onClose}
		>
			<div
				className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="px-4 py-3 border-b border-border">
					<p className="text-sm text-muted-foreground">Switch project</p>
				</div>
				<div ref={listRef} className="max-h-80 overflow-y-auto">
					{boardsList.length === 0 ? (
						<p className="px-4 py-6 text-sm text-muted-foreground text-center">No projects found</p>
					) : (
						boardsList.map((board, i) => (
							<button
								key={board.id}
								type="button"
								className={`w-full text-left px-4 py-3 flex flex-col gap-0.5 transition-colors ${
									i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
								}`}
								onClick={() => {
									setLocation(`/boards/${board.id}`)
									onClose()
								}}
							>
								<span className="font-medium text-sm">{board.name}</span>
								{board.directory && (
									<span className="text-xs text-muted-foreground font-mono">{board.directory}</span>
								)}
							</button>
						))
					)}
				</div>
				<div className="px-4 py-2 border-t border-border flex gap-3 text-xs text-muted-foreground">
					<span>↑↓ navigate</span>
					<span>↵ select</span>
					<span>esc close</span>
				</div>
			</div>
		</div>
	)
}
