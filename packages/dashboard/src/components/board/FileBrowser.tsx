import { useState, useEffect } from "react"
import { files as filesApi } from "@/lib/api"
import type { FileEntry } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Folder, File, ChevronLeft, X } from "lucide-react"

interface FileBrowserProps {
	boardId: string
	onSelect: (path: string) => void
	onClose: () => void
}

export function FileBrowser({ boardId, onSelect, onClose }: FileBrowserProps) {
	const [entries, setEntries] = useState<FileEntry[]>([])
	const [currentPath, setCurrentPath] = useState("")
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState("")

	useEffect(() => {
		setLoading(true)
		setError("")
		filesApi
			.browse(boardId, currentPath || undefined)
			.then(setEntries)
			.catch(() => setError("Failed to read directory"))
			.finally(() => setLoading(false))
	}, [boardId, currentPath])

	const navigateUp = () => {
		const parent = currentPath.split("/").slice(0, -1).join("/")
		setCurrentPath(parent)
	}

	const breadcrumbs = currentPath ? currentPath.split("/") : []

	return (
		<div className="border rounded-md p-2">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-1 text-sm text-muted-foreground min-w-0">
					<button
						type="button"
						className="hover:text-foreground shrink-0"
						onClick={() => setCurrentPath("")}
					>
						root
					</button>
					{breadcrumbs.map((part, i) => (
						<span key={i} className="flex items-center gap-1">
							<span>/</span>
							<button
								type="button"
								className="hover:text-foreground truncate"
								onClick={() =>
									setCurrentPath(breadcrumbs.slice(0, i + 1).join("/"))
								}
							>
								{part}
							</button>
						</span>
					))}
				</div>
				<Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={onClose}>
					<X className="w-3.5 h-3.5" />
				</Button>
			</div>

			<ScrollArea className="max-h-[200px]">
				{loading && (
					<p className="text-xs text-muted-foreground py-2 text-center">Loading...</p>
				)}
				{error && (
					<p className="text-xs text-destructive py-2 text-center">{error}</p>
				)}
				{!loading && !error && entries.length === 0 && (
					<p className="text-xs text-muted-foreground py-2 text-center">Empty directory</p>
				)}
				{!loading && !error && (
					<div className="space-y-0.5">
						{currentPath && (
							<button
								type="button"
								className="flex items-center gap-2 w-full text-left text-sm px-2 py-1 rounded hover:bg-muted/50"
								onClick={navigateUp}
							>
								<ChevronLeft className="w-3.5 h-3.5 text-muted-foreground" />
								<span className="text-muted-foreground">..</span>
							</button>
						)}
						{entries.map((entry) => (
							<button
								key={entry.path}
								type="button"
								className="flex items-center gap-2 w-full text-left text-sm px-2 py-1 rounded hover:bg-muted/50"
								onClick={() => {
									if (entry.type === "directory") {
										setCurrentPath(entry.path)
									} else {
										onSelect(entry.path)
									}
								}}
							>
								{entry.type === "directory" ? (
									<Folder className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
								) : (
									<File className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
								)}
								<span className="truncate">{entry.name}</span>
							</button>
						))}
					</div>
				)}
			</ScrollArea>
		</div>
	)
}
