//   <workspace>/.codezal/sdd/<id>/
//     requirement.md   meta.json   plan.md   trace.json   img/   proto/

const SDD_ROOT = ".codezal/sdd"

function trimWs(ws: string): string {
  return ws.replace(/[\\/]+$/, "")
}

export function sddDraftDir(workspace: string, id: string): string {
  return `${trimWs(workspace)}/${SDD_ROOT}/${id}`
}
export function sddRequirementPath(workspace: string, id: string): string {
  return `${sddDraftDir(workspace, id)}/requirement.md`
}
export function sddMetaPath(workspace: string, id: string): string {
  return `${sddDraftDir(workspace, id)}/meta.json`
}
export function sddPlanPath(workspace: string, id: string): string {
  return `${sddDraftDir(workspace, id)}/plan.md`
}
export function sddImgDir(workspace: string, id: string): string {
  return `${sddDraftDir(workspace, id)}/img`
}
export function sddProtoDir(workspace: string, id: string): string {
  return `${sddDraftDir(workspace, id)}/proto`
}

export function defaultRequirementMarkdown(title: string): string {
  return [
    `# ${title}`,
    "",
    "## Arka plan",
    "",
    "",
    "## R-1 İlk gereksinim {draft}",
    "",
    "",
    "- [ ] Kabul kriteri 1",
    "",
  ].join("\n")
}
