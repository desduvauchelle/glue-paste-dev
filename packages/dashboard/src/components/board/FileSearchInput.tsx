import { useState, useEffect, useRef, useCallback } from "react"
import { files as filesApi } from "@/lib/api"
import type { FileEntry } from "@/lib/api"
import { Input } from "@/components/ui/input"
import { FileCode, Folder, Loader2 } from "lucide-react"

interface FileSearchInputProps {
	boardId: string
	selectedFiles: string[]
	onSelect: (path: string) => void
}

function fuzzyScore(query: string, entry: FileEntry): number {
	const q = query.toLowerCase()
	const name = entry.name.toLowerCase()
	const path = entry.path.toLowerCase()

	// Exact basename match
	if (name === q) return 100
	// Basename starts-with
	if (name.startsWith(q)) return 80
	// Basename contains
	if (name.includes(q)) return 60
	// Full path contains
	if (path.includes(q)) return 40
	// Subsequence match on path
	let qi = 0
	for (let i = 0; i < path.length && qi < q.length; i++) {
		if (path[i] === q[qi]) qi++
	}
	if (qi === q.length) return 20
	return -1
}

export function FileSearchInput({ boardId, selectedFiles, onSelect }: FileSearchInputProps) {
	const [query, setQuery] = useState("")
	const [tree, setTree] = useState<FileEntry[] | null>(null)
	const [loading, setLoading] = useState(false)
	const [showDropdown, setShowDropdown] = useState(false)
	const [activeIndex, setActiveIndex] = useState(0)
	const inputRef = useRef<HTMLInputElement>(null)
	const dropdownRef = useRef<HTMLDivElement>(null)

	const fetchTree = useCallback(async () => {
		if (tree !== null) return
		setLoading(true)
		try {
			const result = await filesApi.tree(boardId)
			setTree(result.entries)
		} catch {
			setTree([])
		} finally {
			setLoading(false)
		}
	}, [boardId, tree])

	// Click outside to close
	useEffect(() => {
		function handleClick(e: MouseEvent) {
			if (
				dropdownRef.current &&
				!dropdownRef.current.contains(e.target as Node) &&
				inputRef.current &&
				!inputRef.current.contains(e.target as Node)
			) {
				setShowDropdown(false)
			}
		}
		document.addEventListener("mousedown", handleClick)
		return () => document.removeEventListener("mousedown", handleClick)
	}, [])

	const selectedSet = new Set(selectedFiles)

	const results = (() => {
		if (!tree || !query.trim()) return []
		const q = query.trim()

		// Slash-based directory filtering
		const slashIdx = q.lastIndexOf("/")
		let dirPrefix = ""
		let searchPart = q
		if (slashIdx >= 0) {
			dirPrefix = q.slice(0, slashIdx + 1).toLowerCase()
			searchPart = q.slice(slashIdx + 1)
		}

		const scored: { entry: FileEntry; score: number }[] = []
		for (const entry of tree) {
			if (selectedSet.has(entry.path)) continue
			// Directory prefix filter
			if (dirPrefix && !entry.path.toLowerCase().startsWith(dirPrefix)) continue

			let score: number
			if (!searchPart) {
				// Just show entries in this directory prefix
				score = entry.type === "file" ? 50 : 45
			} else {
				const searchEntry = dirPrefix
					? { ...entry, name: entry.path.slice(dirPrefix.length).split("/").pop() || entry.name, path: entry.path.slice(dirPrefix.length) }
					: entry
				score = fuzzyScore(searchPart, searchEntry as FileEntry)
			}
			if (score < 0) continue
			// Files score slightly above directories
			if (entry.type === "file") score += 1
			// Shorter paths preferred
			score -= entry.path.length * 0.01
			scored.push({ entry, score })
		}

		scored.sort((a, b) => b.score - a.score)
		return scored.slice(0, 15).map((s) => s.entry)
	})()

	useEffect(() => {
		setActiveIndex(0)
	}, [query])

	// Scroll active item into view
	useEffect(() => {
		if (!dropdownRef.current) return
		const active = dropdownRef.current.querySelector("[data-active='true']")
		if (active) active.scrollIntoView({ block: "nearest" })
	}, [activeIndex])

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (!showDropdown || results.length === 0) {
			if (e.key === "Escape") {
				setShowDropdown(false)
			}
			return
		}
		if (e.key === "ArrowDown") {
			e.preventDefault()
			setActiveIndex((i) => (i + 1) % results.length)
		} else if (e.key === "ArrowUp") {
			e.preventDefault()
			setActiveIndex((i) => (i - 1 + results.length) % results.length)
		} else if (e.key === "Enter") {
			e.preventDefault()
			const selected = results[activeIndex]
			if (selected) {
				onSelect(selected.path)
				setQuery("")
				setShowDropdown(false)
			}
		} else if (e.key === "Escape") {
			setShowDropdown(false)
		}
	}

	const highlightMatch = (text: string, q: string) => {
		if (!q) return text
		const idx = text.toLowerCase().indexOf(q.toLowerCase())
		if (idx < 0) return text
		return (
			<>
				{text.slice(0, idx)}
				<span className="font-semibold text-foreground">{text.slice(idx, idx + q.length)}</span>
				{text.slice(idx + q.length)}
			</>
		)
	}

	return (
		<div className="relative">
			<Input
				ref={inputRef}
				placeholder="Search files..."
				value={query}
				onChange={(e) => {
					setQuery(e.target.value)
					setShowDropdown(true)
				}}
				onFocus={() => {
					void fetchTree()
					if (query.trim()) setShowDropdown(true)
				}}
				onKeyDown={handleKeyDown}
				className="text-xs h-8"
			/>
			{loading && (
				<Loader2 className="w-3 h-3 animate-spin absolute right-2.5 top-2.5 text-muted-foreground" />
			)}
			{showDropdown && query.trim() && (
				<div
					ref={dropdownRef}
					className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-md shadow-md max-h-[240px] overflow-y-auto"
				>
					{results.length === 0 ? (
						<div className="px-3 py-2 text-xs text-muted-foreground">
							{loading ? "Loading..." : "No matches"}
						</div>
					) : (
						results.map((entry, i) => (
							<button
								key={entry.path}
								type="button"
								data-active={i === activeIndex}
								className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-xs hover:bg-accent cursor-pointer ${
									i === activeIndex ? "bg-accent" : ""
								}`}
								onMouseEnter={() => setActiveIndex(i)}
								onClick={() => {
									onSelect(entry.path)
									setQuery("")
									setShowDropdown(false)
									inputRef.current?.focus()
								}}
							>
								{entry.type === "directory" ? (
									<Folder className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
								) : (
									<FileCode className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
								)}
								<span className="truncate text-muted-foreground">
									{highlightMatch(entry.path, query.trim().split("/").pop() || query.trim())}
								</span>
							</button>
						))
					)}
				</div>
			)}
		</div>
	)
}
