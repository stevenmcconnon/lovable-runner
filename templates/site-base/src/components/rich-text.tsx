import { Fragment } from 'react';
import type { ReactNode } from 'react';

type PortableTextMarkDef = {
  _key?: string;
  _type?: string;
  href?: string;
  [key: string]: unknown;
};

type PortableTextChild = {
  _type?: string;
  text?: string;
  marks?: string[];
};

export type PortableTextBlock = {
  _type?: string;
  style?: string;
  children?: PortableTextChild[];
  markDefs?: PortableTextMarkDef[];
};

export type PortableTextValue = string | PortableTextBlock[] | null | undefined;

const MARK_TAGS: Record<string, (children: ReactNode, mark?: PortableTextMarkDef) => ReactNode> = {
  strong: (children) => <strong>{children}</strong>,
  bold: (children) => <strong>{children}</strong>,
  em: (children) => <em>{children}</em>,
  italic: (children) => <em>{children}</em>,
  underline: (children) => <span className="underline">{children}</span>,
  strike: (children) => <span className="line-through">{children}</span>,
  strikethrough: (children) => <span className="line-through">{children}</span>,
  code: (children) => (
    <code className="rounded bg-slate-800/90 px-1 py-0.5 text-xs text-white">{children}</code>
  ),
};

const BLOCK_TAGS: Record<string, keyof JSX.IntrinsicElements> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  h5: 'h5',
  h6: 'h6',
  blockquote: 'blockquote',
  normal: 'p',
};

const resolveBlockTag = (
  style?: string,
  fallback: keyof JSX.IntrinsicElements = 'p'
): keyof JSX.IntrinsicElements => {
  if (!style) return fallback;
  return BLOCK_TAGS[style] || fallback;
};

const isPortableText = (value: PortableTextValue): value is PortableTextBlock[] =>
  Array.isArray(value) &&
  value.every((block) => typeof block === 'object' && block !== null && Array.isArray(block.children));

const applyMarks = (
  text: ReactNode,
  marks: string[] = [],
  markDefs: PortableTextMarkDef[] = []
): ReactNode => {
  return marks.reduce((output, mark) => {
    const knownMark = MARK_TAGS[mark];
    if (knownMark) {
      return knownMark(output);
    }
    const def = markDefs.find((item) => item._key === mark);
    if (def && def._type === 'link' && typeof def.href === 'string' && def.href.trim().length) {
      return (
        <a
          href={def.href}
          target="_blank"
          rel="noreferrer"
          className="text-[hsl(var(--brand))] underline decoration-[hsl(var(--brand))]/40 underline-offset-2"
        >
          {output}
        </a>
      );
    }
    return output;
  }, text);
};

export type RichTextProps = {
  value: PortableTextValue;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
  inline?: boolean;
};

export const RichText = ({ value, className, as, inline = false }: RichTextProps) => {
  if (value == null || value === '') return null;
  const DefaultTag = (inline ? 'span' : as || 'p') as keyof JSX.IntrinsicElements;

  if (!isPortableText(value)) {
    return <DefaultTag className={className}>{value}</DefaultTag>;
  }

  return (
    <>
      {value.map((block, idx) => {
        if (!Array.isArray(block.children)) return null;
        const Tag = (inline ? 'span' : as || resolveBlockTag(block.style)) as keyof JSX.IntrinsicElements;
        const nodes = block.children.map((child, childIdx) => {
          if (typeof child?.text !== 'string') return null;
          return (
            <Fragment key={`${idx}-${childIdx}`}>
              {applyMarks(child.text, child.marks, block.markDefs || [])}
            </Fragment>
          );
        });
        return (
          <Tag key={`${block._type || 'block'}-${idx}`} className={className}>
            {nodes}
          </Tag>
        );
      })}
    </>
  );
};
