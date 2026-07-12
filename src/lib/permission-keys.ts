
export const PERMISSION_KEYS = [
  "read",
  "edit",
  "bash",
  "list",
  "grep",
  "glob",
  "webfetch",
  "websearch",
  "task",
  "skill",
  "todowrite",
  "question",
  "external_directory",
  "repo_clone",
  "repo_overview",
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

// olmayanlar (code_*, *_worktree, monitor, notify, schedule_task, remember, mcp_resource...)
const TOOL_PERMISSION_MAP: Record<string, string> = {
  // edit ailesi (opencode EDIT_TOOLS ile birebir)
  write_file: "edit",
  edit_file: "edit",
  apply_patch: "edit",
  notebook_edit: "edit",
  read_file: "read",
  list_dir: "list",
  grep: "grep",
  glob: "glob",
  // exec
  bash: "bash",
  bash_status: "bash",
  // web
  webfetch: "webfetch",
  websearch: "websearch",
  spawn_agent: "task",
  delegate_agents: "task",
  dispatch_workers: "task",
  load_skill: "skill",
  question: "question",
  todo_write: "todowrite",
  external_file_access: "external_directory",
  clone_repo: "repo_clone",
  repo_overview: "repo_overview",
}

export function permissionKey(tool: string): string {
  return TOOL_PERMISSION_MAP[tool] ?? tool
}
