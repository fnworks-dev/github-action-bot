import { type Client } from '@libsql/client';
import type { JobPost, RawPost, JobStatus, Profession, SidequestRunStage } from '../types.js';
export declare function getDb(): Client;
interface StartSidequestRunInput {
    githubRunId: string | null;
    trigger: string;
    stage: SidequestRunStage;
    latestJobCreatedAtBefore: string | null;
}
interface CompleteSidequestRunSuccessInput {
    fetchedCount: number;
    newJobsCount: number;
    stage: SidequestRunStage;
    latestJobCreatedAtAfter: string | null;
}
export declare function initDb(): Promise<void>;
export declare function getLatestJobCreatedAt(): Promise<string | null>;
export declare function startSidequestRun(input: StartSidequestRunInput): Promise<string>;
export declare function updateSidequestRunStage(runId: string, stage: SidequestRunStage): Promise<void>;
export declare function completeSidequestRunSuccess(runId: string, input: CompleteSidequestRunSuccessInput): Promise<void>;
export declare function completeSidequestRunFailure(runId: string, stage: SidequestRunStage, errorMessage: string): Promise<void>;
export declare function jobExists(source: string, sourceId: string): Promise<boolean>;
export declare function insertJob(post: RawPost, professions: Profession[], score: number | null, summary: string | null, analysis?: {
    project_type: string | null;
    tech_stack: string[] | null;
    scope: string | null;
    timeline_signal: string | null;
    budget_signal: string | null;
    red_flags: string[];
    green_flags: string[];
}): Promise<string>;
export declare function updateJobStatus(id: string, status: JobStatus): Promise<void>;
export declare function getJobs(status?: JobStatus): Promise<JobPost[]>;
export declare function getJobsByProfession(profession: Profession, status?: JobStatus): Promise<JobPost[]>;
export declare function deleteOldPosts(): Promise<number>;
export declare function getStats(): Promise<{
    total: number;
    byStatus: Record<JobStatus, number>;
    byProfession: Record<Profession, number>;
}>;
export {};
