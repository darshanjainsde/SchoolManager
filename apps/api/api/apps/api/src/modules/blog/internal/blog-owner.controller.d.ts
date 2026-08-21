import type { BlogPost } from '@skoolos/db';
import { BlogOwnerService } from './blog-owner.service';
import { RejectPostDto } from './blog.dto';
export declare class BlogOwnerController {
    private readonly owner;
    constructor(owner: BlogOwnerService);
    pending(): Promise<{
        id: string;
        slug: string;
        title: string;
        description: string;
        heroImageUrl: string | null;
        readMinutes: number;
        sections: import("@skoolos/db").BlogBlock[];
        publishedAt: Date | null;
        updatedAt: Date;
        schoolName: string | null;
        schoolSlug: string | null;
    }[]>;
    approve(id: string): Promise<BlogPost>;
    reject(id: string, dto: RejectPostDto): Promise<BlogPost>;
}
//# sourceMappingURL=blog-owner.controller.d.ts.map