/**
 * Structured content blocks for BlogPost.sections (stored as Json).
 * Shared between the API (validation/serialization) and the web app
 * (rendering via components/blog/BlogBlocks.tsx).
 */
export type BlogBlock = {
    t: 'h';
    text: string;
} | {
    t: 'p';
    text: string;
} | {
    t: 'ul';
    items: string[];
} | {
    t: 'img';
    url: string;
    alt: string;
    caption?: string;
} | {
    t: 'stats';
    items: {
        value: string;
        label: string;
        tone?: 'good' | 'bad';
    }[];
} | {
    t: 'ranking';
    items: {
        label: string;
        value: string;
        pct: number;
    }[];
    source?: string;
} | {
    t: 'quiz';
    tag?: string;
    q: string;
    options: string[];
    correct: number;
    why: string;
};
//# sourceMappingURL=blog-blocks.d.ts.map