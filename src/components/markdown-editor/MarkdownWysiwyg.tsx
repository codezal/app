// WYSIWYG markdown editörü — Tiptap v3 + tiptap-markdown.
// Source/preview modlarıyla birlikte FileViewer'dan lazy yüklenir. Üstteki
// toolbar format komutlarını tetikler; gövde paylaşılan PROSE tipografisini
// kullanır (preview ile birebir aynı görünüm). Dış `value` yalnız diskten
// yeniden okuma / dosya değişiminde güncellenir; yazım sırasında markdown
// `onChange` ile yukarı aktarılır (dirty hesabı için).
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Table } from "@tiptap/extension-table"
import TableRow from "@tiptap/extension-table-row"
import TableCell from "@tiptap/extension-table-cell"
import TableHeader from "@tiptap/extension-table-header"
import Link from "@tiptap/extension-link"
import ImageExt from "@tiptap/extension-image"
import Placeholder from "@tiptap/extension-placeholder"
import { Markdown } from "tiptap-markdown"
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Strikethrough,
} from "@/lib/icons"
import { useT } from "@/lib/i18n/useT"
import { cn } from "@/lib/utils"
import { PROSE } from "../markdown-prose"
import "@/styles/markdown-wysiwyg.css"

// tiptap-markdown 0.9, `editor.storage.markdown` için tip augmentation
// sağlamıyor; round-trip serialize metodunu biz bildiriyoruz.
declare module "@tiptap/core" {
  interface Storage {
    markdown?: { getMarkdown: () => string }
  }
}

export type MarkdownWysiwygHandle = {
  getMarkdown: () => string
  focus: () => void
}

type Props = {
  value: string
  onChange: (markdown: string) => void
  readOnly?: boolean
  placeholder?: string
}

export const MarkdownWysiwyg = forwardRef<MarkdownWysiwygHandle, Props>(
  function MarkdownWysiwyg({ value, onChange, readOnly = false, placeholder }, ref) {
    const t = useT()
    const lastEmitted = useRef<string>(value)
    const onChangeRef = useRef(onChange)
    // İlk render (initial content parse) sırasında onUpdate tetiklenirse yanlış
    // dirty sinyali üretmesin; mount effect'inden sonra açılır.
    const readyRef = useRef(false)

    const editor = useEditor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Table.configure({ resizable: true }),
        TableRow,
        TableCell,
        TableHeader,
        Link.configure({
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: "noreferrer", target: "_blank" },
        }),
        ImageExt.configure({ inline: false, allowBase64: false }),
        Placeholder.configure({ placeholder: placeholder ?? "" }),
        Markdown.configure({
          html: true,
          tightLists: true,
          transformPastedText: true,
          transformCopiedText: false,
        }),
      ],
      content: value,
      editable: !readOnly,
      onUpdate: ({ editor: ed }) => {
        const md = ed.storage.markdown?.getMarkdown?.() ?? ""
        lastEmitted.current = md
        if (!readyRef.current) return
        onChangeRef.current(md)
      },
    })

    useImperativeHandle(
      ref,
      () => ({
        getMarkdown: () => editor?.storage.markdown?.getMarkdown?.() ?? value,
        focus: () => editor?.commands.focus(),
      }),
      [editor, value],
    )

    // Dış value değişimi (disk reload / path) → editörü senkronize et.
    useEffect(() => {
      if (!editor) return
      if (value === lastEmitted.current) return
      lastEmitted.current = value
      editor.commands.setContent(value, { emitUpdate: false })
    }, [value, editor])

    useEffect(() => {
      if (!editor) return
      editor.setEditable(!readOnly)
    }, [readOnly, editor])

    useEffect(() => {
      readyRef.current = true
      return () => {
        readyRef.current = false
      }
    }, [editor])

    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    function askLink() {
      if (!editor) return
      const prev = editor.getAttributes("link").href as string | undefined
      const url = window.prompt(t("fileViewer.mdLinkPrompt"), prev ?? "https://")
      if (url === null) return
      if (url.trim() === "") {
        editor.chain().focus().extendMarkRange("link").unsetLink().run()
      } else {
        editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run()
      }
    }

    function askImage() {
      if (!editor) return
      const url = window.prompt(t("fileViewer.mdImagePrompt"), "https://")
      if (url === null || url.trim() === "") return
      editor.chain().focus().setImage({ src: url.trim() }).run()
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Toolbar
          editor={editor}
          readOnly={readOnly}
          t={t}
          onLink={askLink}
          onImage={askImage}
        />
        <div className="min-h-0 flex-1 overflow-auto bg-codezal-bg">
          <EditorContent
            editor={editor}
            className={cn(
              "cz-md-wysiwyg h-full px-8 py-6",
              readOnly && "is-readonly",
              PROSE,
            )}
          />
        </div>
      </div>
    )
  },
)

type T = ReturnType<typeof useT>

function Toolbar({
  editor,
  readOnly,
  t,
  onLink,
  onImage,
}: {
  editor: ReturnType<typeof useEditor>
  readOnly: boolean
  t: T
  onLink: () => void
  onImage: () => void
}) {
  const disabled = !editor || readOnly
  return (
    <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-0.5 border-b border-codezal bg-codezal-panel/80 px-3 py-1.5 backdrop-blur-sm">
      <TBtn title={t("fileViewer.mdHeading1")} disabled={disabled} active={!!editor?.isActive("heading", { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
        <Heading1 className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdHeading2")} disabled={disabled} active={!!editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdHeading3")} disabled={disabled} active={!!editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdParagraph")} disabled={disabled} active={!!editor?.isActive("paragraph")} onClick={() => editor?.chain().focus().setParagraph().run()}>
        <Pilcrow className="h-4 w-4" />
      </TBtn>

      <Sep />

      <TBtn title={t("fileViewer.mdBold")} disabled={disabled} active={!!editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdItalic")} disabled={disabled} active={!!editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdStrike")} disabled={disabled} active={!!editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </TBtn>

      <Sep />

      <TBtn title={t("fileViewer.mdBulletList")} disabled={disabled} active={!!editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdOrderedList")} disabled={disabled} active={!!editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </TBtn>

      <Sep />

      <TBtn title={t("fileViewer.mdQuote")} disabled={disabled} active={!!editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdCodeBlock")} disabled={disabled} active={!!editor?.isActive("codeBlock")} onClick={() => editor?.chain().focus().toggleCodeBlock().run()}>
        <Code className="h-4 w-4" />
      </TBtn>

      <Sep />

      <TBtn title={t("fileViewer.mdLink")} disabled={disabled} active={!!editor?.isActive("link")} onClick={onLink}>
        <Link2 className="h-4 w-4" />
      </TBtn>
      <TBtn title={t("fileViewer.mdImage")} disabled={disabled} onClick={onImage}>
        <ImageIcon className="h-4 w-4" />
      </TBtn>
    </div>
  )
}

function TBtn({
  title,
  onClick,
  active,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md text-codezal-dim transition-all duration-150",
        "hover:bg-codezal-panel-2 hover:text-codezal-text",
        "active:scale-95",
        "disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-codezal-dim disabled:active:scale-100",
        active &&
          "bg-codezal-accent/15 text-codezal-accent ring-1 ring-inset ring-codezal-accent/30 hover:bg-codezal-accent/20",
      )}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="mx-1 h-4 w-px shrink-0 bg-codezal-hair" aria-hidden />
}
