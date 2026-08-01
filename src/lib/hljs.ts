// Slim highlight.js bundle — only the languages Codezal actually renders.
// The full highlight.js package ships ~190 grammars (~1 MB min); this pulls
// in ~25 and keeps the vendor chunk small.
//
// Usage: import { hljs } from "@/lib/hljs"
import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import c from "highlight.js/lib/languages/c"
import cpp from "highlight.js/lib/languages/cpp"
import csharp from "highlight.js/lib/languages/csharp"
import css from "highlight.js/lib/languages/css"
import go from "highlight.js/lib/languages/go"
import ini from "highlight.js/lib/languages/ini"
import java from "highlight.js/lib/languages/java"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import kotlin from "highlight.js/lib/languages/kotlin"
import less from "highlight.js/lib/languages/less"
import markdown from "highlight.js/lib/languages/markdown"
import php from "highlight.js/lib/languages/php"
import python from "highlight.js/lib/languages/python"
import ruby from "highlight.js/lib/languages/ruby"
import rust from "highlight.js/lib/languages/rust"
import scss from "highlight.js/lib/languages/scss"
import sql from "highlight.js/lib/languages/sql"
import swift from "highlight.js/lib/languages/swift"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("c", c)
hljs.registerLanguage("cpp", cpp)
hljs.registerLanguage("csharp", csharp)
hljs.registerLanguage("css", css)
hljs.registerLanguage("go", go)
hljs.registerLanguage("ini", ini)
hljs.registerLanguage("java", java)
hljs.registerLanguage("javascript", javascript)
hljs.registerLanguage("json", json)
hljs.registerLanguage("kotlin", kotlin)
hljs.registerLanguage("less", less)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("php", php)
hljs.registerLanguage("python", python)
hljs.registerLanguage("ruby", ruby)
hljs.registerLanguage("rust", rust)
hljs.registerLanguage("scss", scss)
hljs.registerLanguage("sql", sql)
hljs.registerLanguage("swift", swift)
hljs.registerLanguage("typescript", typescript)
hljs.registerLanguage("xml", xml)
hljs.registerLanguage("yaml", yaml)

// Common aliases so ```ts / ```js / ```sh etc. work in fenced code blocks.
hljs.registerAliases(["ts"], { languageName: "typescript" })
hljs.registerAliases(["js", "mjs", "cjs", "jsx"], { languageName: "javascript" })
hljs.registerAliases(["sh", "zsh", "shell"], { languageName: "bash" })
hljs.registerAliases(["html", "svg"], { languageName: "xml" })
hljs.registerAliases(["md", "mdx"], { languageName: "markdown" })
hljs.registerAliases(["yml"], { languageName: "yaml" })
hljs.registerAliases(["toml"], { languageName: "ini" })
hljs.registerAliases(["h"], { languageName: "c" })
hljs.registerAliases(["rs"], { languageName: "rust" })
hljs.registerAliases(["py"], { languageName: "python" })
hljs.registerAliases(["rb"], { languageName: "ruby" })
hljs.registerAliases(["kt"], { languageName: "kotlin" })
hljs.registerAliases(["cs"], { languageName: "csharp" })

export { hljs }
