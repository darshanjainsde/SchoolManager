import { DirectoryService } from './directory.service';
export declare class DirectoryController {
    private readonly directory;
    constructor(directory: DirectoryService);
    /** Unauthenticated list of LIVE schools for the platform landing page. */
    list(): Promise<import("./directory.service").DirectoryEntry[]>;
}
//# sourceMappingURL=directory.controller.d.ts.map