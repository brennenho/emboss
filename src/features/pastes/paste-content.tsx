import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

const schema = {
  tagNames: [
    "p",
    "br",
    "hr",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "del",
    "code",
    "pre",
    "a",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
  ],
  attributes: {
    a: ["href", "title"],
    ol: ["start"],
    th: ["align"],
    td: ["align"],
  },
  protocols: { href: ["http", "https", "mailto"] },
};
export function PasteContent({
  body,
  format,
}: {
  body: string;
  format: string;
}) {
  if (format !== "markdown")
    return (
      <pre className="overflow-auto font-mono text-sm leading-7 break-words whitespace-pre-wrap">
        {body}
      </pre>
    );
  return (
    <div className="prose-paste">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        skipHtml
        urlTransform={(url) => (/^(https?:\/\/|mailto:)/i.test(url) ? url : "")}
        components={{
          a: ({ children, href }) =>
            href ? (
              <a href={href} rel="nofollow noreferrer" target="_blank">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
