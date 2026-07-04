//
//

export type McpCatalogCategory = "Kod" | "Görev" | "Gözlem"

export type McpCatalogEntry = {
  id: string
  name: string
  // HTTP MCP endpoint'i (StreamableHTTP). transport her zaman "http".
  url: string
  description: string
  category: McpCatalogCategory
  docsUrl?: string
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: "context7",
    name: "context7",
    url: "https://mcp.context7.com/mcp/oauth",
    description: "Güncel kütüphane/framework dökümanları + kod örnekleri",
    category: "Kod",
    docsUrl: "https://context7.com/docs/howto/oauth",
  },
  {
    id: "linear",
    name: "linear",
    url: "https://mcp.linear.app/mcp",
    description: "Issue/proje yönetimi (modern ekipler)",
    category: "Görev",
    docsUrl: "https://linear.app/docs",
  },
  {
    id: "notion",
    name: "notion",
    url: "https://mcp.notion.com/mcp",
    description: "Çalışma alanı, döküman, veritabanı",
    category: "Görev",
    docsUrl: "https://developers.notion.com",
  },
  {
    id: "atlassian",
    name: "atlassian",
    url: "https://mcp.atlassian.com/v1/mcp",
    description: "Jira + Confluence",
    category: "Görev",
    docsUrl: "https://www.atlassian.com/platform/remote-mcp-server",
  },
  {
    id: "sentry",
    name: "sentry",
    url: "https://mcp.sentry.dev/mcp",
    description: "Hata/issue analizi, stack trace",
    category: "Gözlem",
    docsUrl: "https://docs.sentry.io/product/sentry-mcp/",
  },
  {
    id: "datadog",
    name: "datadog",
    url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
    description: "Metrik, log, monitor",
    category: "Gözlem",
    docsUrl: "https://docs.datadoghq.com",
  },
]
