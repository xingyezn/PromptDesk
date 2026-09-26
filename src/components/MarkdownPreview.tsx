import ReactMarkdown from 'react-markdown';
export function MarkdownPreview({ body }: { body: string }) {
  return (
    <div className="markdown-preview">
      <ReactMarkdown
        skipHtml
        components={{
          img: () => null,
          a: ({ href, children }) =>
            href && /^https?:\/\//i.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {body || '*还没有正文*'}
      </ReactMarkdown>
    </div>
  );
}
