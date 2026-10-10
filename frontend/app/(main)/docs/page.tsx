import path from "node:path";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import { getLocale, getTranslations } from "next-intl/server";
import { buildTree, readMarkdownFile } from "./tree";
import { DocTree } from "./doc-tree";

interface DocsPageSearchParams {
  file?: string;
}

function resolveDocLink(currentFile: string, href: string): string {
  const [file, hash] = href.split("#", 2);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(currentFile), file));
  return `/docs?file=${resolved}${hash ? `#${hash}` : ""}`;
}

type HastNode = { type: string; value?: string; children?: HastNode[] };

function textOf(node: HastNode | undefined): string {
  if (!node) return "";
  return node.type === "text" ? (node.value ?? "") : (node.children ?? []).map(textOf).join("");
}

/** GitHub-style heading ids, so `#section` links in the docs resolve. */
function makeSlugger() {
  const seen = new Map<string, number>();
  return (node: HastNode | undefined) => {
    const base = textOf(node).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

function makeMdComponents(currentFile: string): React.ComponentProps<typeof ReactMarkdown>["components"] {
  const slug = makeSlugger();
  return {
    h1: ({ node, children }) => <h1 id={slug(node)} className="mb-4 mt-8 text-3xl font-bold text-foreground first:mt-0">{children}</h1>,
    h2: ({ node, children }) => <h2 id={slug(node)} className="mb-3 mt-7 text-2xl font-semibold text-foreground border-b border-border pb-1">{children}</h2>,
    h3: ({ node, children }) => <h3 id={slug(node)} className="mb-2 mt-5 text-xl font-semibold text-foreground">{children}</h3>,
    h4: ({ node, children }) => <h4 id={slug(node)} className="mb-2 mt-4 text-base font-semibold text-foreground">{children}</h4>,
    p: ({ children }) => <p className="mb-4 leading-7 text-foreground/80">{children}</p>,
    a: ({ href, children }) => {
      const resolved = href && /\.md(#|$)/.test(href) && !/^[a-z]+:/i.test(href) ? resolveDocLink(currentFile, href) : href;
      return (
        <a href={resolved} className="text-blue-600 hover:underline dark:text-blue-400">
          {children}
        </a>
      );
    },
    ul: ({ children }) => <ul className="mb-4 ml-6 list-disc space-y-1 text-foreground/80">{children}</ul>,
    ol: ({ children }) => <ol className="mb-4 ml-6 list-decimal space-y-1 text-foreground/80">{children}</ol>,
    li: ({ children }) => <li className="leading-7">{children}</li>,
    blockquote: ({ children }) => <blockquote className="mb-4 border-l-4 border-border pl-4 italic text-muted-foreground">{children}</blockquote>,
    code: ({ className, children, ...props }) => {
      const isBlock = className?.includes("language-");
      return isBlock ? (
        <code className={`${className ?? ""} block`} {...props}>
          {children}
        </code>
      ) : (
        <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono text-foreground" {...props}>
          {children}
        </code>
      );
    },
    pre: ({ children }) => <pre className="mb-4 overflow-x-auto rounded-lg border border-border bg-muted/50 p-4 text-sm">{children}</pre>,
    table: ({ children }) => (
      <div className="mb-4 overflow-x-auto">
        <table className="w-full border-collapse text-sm text-foreground/80">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    th: ({ children }) => <th className="border border-border px-4 py-2 text-left font-semibold text-foreground">{children}</th>,
    td: ({ children }) => <td className="border border-border px-4 py-2">{children}</td>,
    hr: () => <hr className="my-6 border-border" />,
    strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  };
}

export default async function DocsPage({ searchParams }: { searchParams?: Promise<DocsPageSearchParams> }) {
  const params = await Promise.resolve(searchParams);
  const currentFile = params?.file ?? "index.md";

  const locale = await getLocale();
  const t = await getTranslations("docs");
  const tree = buildTree(locale);
  const content = readMarkdownFile(currentFile, locale);

  return (
    <div className="flex h-[calc(100vh-4rem)] bg-background">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-muted/50 px-3 py-4">
        <p className="mb-3 px-2 text-xs font-semibold tracking-wide text-muted-foreground/70 uppercase">{t("title")}</p>
        <DocTree tree={tree} currentFile={currentFile} />
      </aside>

      {/* Content */}
      <main className="min-w-0 flex-1 overflow-y-auto px-8 py-10">
        <article className="mx-auto max-w-6xl">
          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={makeMdComponents(currentFile)}>
            {content}
          </ReactMarkdown>
        </article>
      </main>
    </div>
  );
}
