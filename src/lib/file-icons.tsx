// VS Code Material Icon Theme icons by file and folder type.
// Pure frontend code. generateManifest() builds extension/name/folder maps once;
// iconPath basenames are served from the copied public icon directory. Callers
// fall back to plain File/Folder icons when no match exists.
import { generateManifest } from "material-icon-theme"
import { File, Folder, FolderOpen } from "@/lib/icons"
import { cn } from "@/lib/utils"

// Minimal subset returned by generateManifest() that this module uses.
type IconMaps = {
  iconDefinitions?: Record<string, { iconPath?: string }>
  fileExtensions?: Record<string, string>
  fileNames?: Record<string, string>
  folderNames?: Record<string, string>
  folderNamesExpanded?: Record<string, string>
  file?: string
  folder?: string
  folderExpanded?: string
}

// SVGs are served from public/file-icons/ after scripts/copy-file-icons.mjs
// copies them during predev/prebuild. activeIconPack "" keeps framework-specific
// overrides neutral. The default folder theme remains "specific".
const MANIFEST = generateManifest({ activeIconPack: "" }) as IconMaps

// Icon name to public URL via iconPath basename.
function urlForIcon(name: string | undefined): string | undefined {
  const path = name ? MANIFEST.iconDefinitions?.[name]?.iconPath : undefined
  if (!path) return undefined
  // iconPath: "./../icons/typescript.svg" -> "/file-icons/typescript.svg"
  return `/file-icons/${path.slice(path.lastIndexOf("/") + 1)}`
}

// File name to icon URL. Prefer exact names, then longest extension, then default.
function fileIconUrl(fileName: string): string | undefined {
  const lower = fileName.toLowerCase()
  let name = MANIFEST.fileNames?.[lower]
  if (!name) {
    const parts = lower.split(".")
    for (let i = 1; i < parts.length; i++) {
      const hit = MANIFEST.fileExtensions?.[parts.slice(i).join(".")]
      if (hit) {
        name = hit
        break
      }
    }
  }
  return urlForIcon(name ?? MANIFEST.file)
}

// Folder name plus open/closed state to icon URL. Prefer named folders, then default.
function folderIconUrl(folderName: string, open: boolean): string | undefined {
  const lower = folderName.toLowerCase()
  const name =
    (open ? MANIFEST.folderNamesExpanded?.[lower] : MANIFEST.folderNames?.[lower]) ??
    (open ? MANIFEST.folderExpanded : MANIFEST.folder)
  return urlForIcon(name)
}

// Colored file icon with monochrome File fallback.
export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  const url = fileIconUrl(name)
  if (!url) return <File className={cn("h-4 w-4 shrink-0 text-codezal-mute", className)} />
  return <img src={url} alt="" aria-hidden draggable={false} className={cn("h-4 w-4 shrink-0", className)} />
}

// Colored folder icon with monochrome Folder/FolderOpen fallback.
export function FolderTypeIcon({
  name,
  open,
  className,
}: {
  name: string
  open: boolean
  className?: string
}) {
  const url = folderIconUrl(name, open)
  if (!url) {
    return open ? (
      <FolderOpen className={cn("h-4 w-4 shrink-0 text-codezal-mute", className)} />
    ) : (
      <Folder className={cn("h-4 w-4 shrink-0 text-codezal-mute", className)} />
    )
  }
  return <img src={url} alt="" aria-hidden draggable={false} className={cn("h-4 w-4 shrink-0", className)} />
}
