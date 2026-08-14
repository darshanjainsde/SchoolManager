/**
 * Hostname to attribute a SCHOOL-scope post to on the global blog: the
 * school's primary domain if it has one, else `<slug>.<platformHost>` — same
 * fallback DirectoryService uses for the platform school directory.
 */
export declare function schoolHost(school: {
    slug: string;
    domains: {
        hostname: string;
    }[];
}): string;
/** Absolute URL of a post on the platform (global) blog. */
export declare function platformBlogUrl(slug: string): string;
/** Absolute URL of a post on its own tenant host (the "self" canonical). */
export declare function tenantBlogUrl(hostname: string, slug: string): string;
//# sourceMappingURL=blog-host.util.d.ts.map