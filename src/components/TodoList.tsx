import { Check, Circle, Loader2, Sparkles, X } from "@/lib/icons"
import { cn } from "@/lib/utils"

export type TodoListItem = {
  content?: string
  status?: string
  priority?: string
}

type TodoListProps = {
  todos: TodoListItem[]
  variant?: "message" | "panel"
  title?: string
}

type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

function normalizeStatus(status: string | undefined): TodoStatus {
  if (
    status === "completed" ||
    status === "in_progress" ||
    status === "cancelled" ||
    status === "pending"
  ) {
    return status
  }
  return "pending"
}

function isDone(status: string | undefined) {
  return status === "completed" || status === "cancelled"
}

export function TodoList({ todos, variant = "message", title }: TodoListProps) {
  const done = todos.filter((todo) => isDone(todo.status)).length

  return (
    <div
      className={cn(
        variant === "panel"
          ? ""
          : "overflow-hidden rounded-[8px] border border-codezal-strong bg-codezal-bg shadow-sm",
      )}
    >
      {title && (
        <div className="flex items-center justify-between border-b border-codezal-hair bg-codezal-chip-soft px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-codezal-accent" />
            <span className="truncate text-sm font-semibold text-codezal-text">{title}</span>
          </div>
          {todos.length > 0 && (
            <span className="shrink-0 text-sm tabular-nums text-codezal-mute">
              {done}/{todos.length}
            </span>
          )}
        </div>
      )}
      <ul className={cn("flex flex-col", variant === "panel" ? "gap-0.5 px-0 py-1" : "gap-1 px-3 py-2")}>
        {todos.map((todo, i) => {
          const status = normalizeStatus(todo.status)
          const StatusIcon =
            status === "completed"
              ? Check
              : status === "in_progress"
                ? Loader2
                : status === "cancelled"
                  ? X
                  : Circle
          const iconCls =
            status === "completed"
              ? "text-codezal-ok"
              : status === "in_progress"
                ? "text-codezal-accent"
                : status === "cancelled"
                  ? "text-red-500"
                  : "text-codezal-mute"
          const textCls =
            status === "completed"
              ? "text-codezal-dim line-through decoration-codezal-mute"
              : status === "cancelled"
                ? "text-codezal-mute line-through opacity-60"
                : status === "in_progress"
                  ? "font-medium text-codezal-text"
                  : "text-codezal-dim"

          return (
            <li
              key={i}
              className={cn(
                "grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2 rounded-[6px] px-1.5 py-1.5",
                status === "in_progress" && "bg-codezal-chip-soft",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                  iconCls,
                )}
              >
                <StatusIcon
                  className={cn("h-3 w-3", status === "in_progress" && "animate-spin")}
                />
              </span>
              <span
                className={cn(
                  "min-w-0 break-words leading-5",
                  variant === "panel" ? "text-sm" : "text-base",
                  textCls,
                )}
              >
                {todo.content}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
