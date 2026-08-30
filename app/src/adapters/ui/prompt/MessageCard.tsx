import { ChevronDown, ChevronUp, Copy, Check, GripVertical, Trash2, CopyPlus } from 'lucide-react'
import { useState, type CSSProperties, type HTMLAttributes } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ROLES, type Message, type Role } from '@/core/prompt/promptModel'
import { cn } from '@/lib/utils'

export interface MessageDragProps {
  setNodeRef: (el: HTMLElement | null) => void
  style: CSSProperties
  isDragging: boolean
  handleProps: HTMLAttributes<HTMLButtonElement>
}

const ROLE_LABEL: Record<Role, string> = { system: 'System', user: 'User', assistant: 'Assistant' }

interface MessageCardProps {
  message: Message
  index: number
  count: number
  readOnly?: boolean
  drag?: MessageDragProps
  onChange: (patch: Partial<Pick<Message, 'role' | 'content'>>) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
}

export function MessageCard({
  message,
  index,
  count,
  readOnly,
  drag,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
}: MessageCardProps) {
  const [copied, setCopied] = useState(false)

  async function copyRaw() {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1000)
  }

  return (
    <div
      ref={drag?.setNodeRef}
      style={drag?.style}
      className={cn(
        'rounded-lg border border-border/60 bg-card',
        drag?.isDragging && 'z-10 opacity-80 shadow-lg ring-1 ring-border',
      )}
    >
      <div className="flex items-center gap-1 border-b border-border/60 px-2 py-1.5">
        {drag && !readOnly && (
          <button
            type="button"
            aria-label="Drag to reorder message"
            className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
            {...drag.handleProps}
          >
            <GripVertical className="size-3.5" />
          </button>
        )}
        {readOnly ? (
          <span className="px-1.5 text-xs font-medium text-muted-foreground">{ROLE_LABEL[message.role]}</span>
        ) : (
          <Select value={message.role} onValueChange={(v) => v && onChange({ role: v as Role })}>
            <SelectTrigger size="sm" className="border-0 font-medium shadow-none hover:bg-accent/40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Copy message text"
          onClick={copyRaw}
          title="Copy this message's text"
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
        </Button>
        {!readOnly && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Move up"
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ChevronUp className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Move down"
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ChevronDown className="size-3.5" />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Duplicate message" onClick={onDuplicate}>
              <CopyPlus className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete message"
              className="text-muted-foreground hover:text-destructive"
              disabled={count === 1}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>
      <Textarea
        value={message.content}
        readOnly={readOnly}
        onChange={(e) => onChange({ content: e.target.value })}
        placeholder={
          message.role === 'system'
            ? 'Instructions / context. Use {{VARIABLES}}.'
            : message.role === 'assistant'
              ? 'Example answer or prefill. Use {{VARIABLES}}.'
              : 'The request. Use {{VARIABLES}}.'
        }
        className={cn(
          'min-h-24 resize-none rounded-none border-0 bg-transparent font-mono text-[13px] focus-visible:ring-0',
          readOnly && 'text-muted-foreground',
        )}
      />
    </div>
  )
}
