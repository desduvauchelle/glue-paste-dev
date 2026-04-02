import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface DialogContextValue {
	open: boolean
	setOpen: (open: boolean) => void
}

const DialogContext = React.createContext<DialogContextValue | null>(null)

function useDialog() {
	const context = React.useContext(DialogContext)
	if (!context) throw new Error("Dialog components must be used within a Dialog provider")
	return context
}

interface DialogProps {
	children: React.ReactNode
	open?: boolean
	onOpenChange?: (open: boolean) => void
}

function Dialog({ children, open: controlledOpen, onOpenChange }: DialogProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false)

	const isControlled = controlledOpen !== undefined
	const open = isControlled ? controlledOpen : uncontrolledOpen

	const setOpen = React.useCallback(
		(value: boolean) => {
			if (!isControlled) setUncontrolledOpen(value)
			onOpenChange?.(value)
		},
		[isControlled, onOpenChange],
	)

	// Lock body scroll when open
	React.useEffect(() => {
		if (open) {
			document.body.style.overflow = "hidden"
		} else {
			document.body.style.overflow = ""
		}
		return () => { document.body.style.overflow = "" }
	}, [open])

	return (
		<DialogContext.Provider value={{ open, setOpen }}>
			{children}
		</DialogContext.Provider>
	)
}

function DialogTrigger({
	children,
	className,
	...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
	const { setOpen } = useDialog()
	return (
		<button
			type="button"
			className={className}
			onClick={() => setOpen(true)}
			{...props}
		>
			{children}
		</button>
	)
}

const DialogContent = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
	const { open, setOpen } = useDialog()

	// Close on Escape
	React.useEffect(() => {
		if (!open) return
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false)
		}
		document.addEventListener("keydown", handler)
		return () => document.removeEventListener("keydown", handler)
	}, [open, setOpen])

	if (!open) return null

	return createPortal(
		<div
			className="fixed inset-0 z-50 flex items-center justify-center"
			aria-modal="true"
			role="dialog"
		>
			{/* Backdrop */}
			<div
				className="absolute inset-0 bg-black/20 backdrop-blur-sm"
				onClick={() => setOpen(false)}
			/>
			{/* Content */}
			<div
				ref={ref}
				className={cn(
					"relative z-10 w-full max-w-lg max-h-[90vh] flex flex-col rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg",
					className,
				)}
				onClick={(e) => e.stopPropagation()}
				{...props}
			>
				{children}
				<button
					type="button"
					className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring"
					onClick={() => setOpen(false)}
					aria-label="Close"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			</div>
		</div>,
		document.body
	)
})
DialogContent.displayName = "DialogContent"

function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("flex flex-col space-y-1.5 text-center sm:text-left mb-4", className)}
			{...props}
		/>
	)
}

function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-4", className)}
			{...props}
		/>
	)
}

function DialogTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h2
			className={cn("text-lg font-semibold leading-none tracking-tight", className)}
			{...props}
		/>
	)
}

function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
	return (
		<p className={cn("text-sm text-muted-foreground", className)} {...props} />
	)
}

export {
	Dialog,
	DialogTrigger,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogDescription,
}
