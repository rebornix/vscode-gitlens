'use strict';
import { Uri } from 'vscode';
import { Git } from '../git';
import { GitUri } from '../gitUri';
import * as path from 'path';

export interface GitAuthor {
    name: string;
    lineCount: number;
}

export interface GitCommitLine {
    sha: string;
    previousSha?: string;
    line: number;
    originalLine: number;
    code?: string;
}

export type GitCommitType = 'blame' | 'branch' | 'file'  | 'stash';

export class GitCommit {

    type: GitCommitType;
    // lines: GitCommitLine[];
    originalFileName?: string;
    previousSha?: string;
    previousFileName?: string;
    workingFileName?: string;
    private _isUncommitted: boolean | undefined;

    constructor(
        type: GitCommitType,
        public repoPath: string,
        public sha: string,
        public fileName: string,
        public author: string,
        public date: Date,
        public message: string,
        // lines?: GitCommitLine[],
        originalFileName?: string,
        previousSha?: string,
        previousFileName?: string
    ) {
        this.type = type;
        this.fileName = this.fileName && this.fileName.replace(/, ?$/, '');

        // this.lines = lines || [];
        this.originalFileName = originalFileName;
        this.previousSha = previousSha;
        this.previousFileName = previousFileName;
    }

    get shortSha() {
        return this.sha.substring(0, 8);
    }

    get isUncommitted(): boolean {
        if (this._isUncommitted === undefined) {
            this._isUncommitted = Git.isUncommitted(this.sha);
        }
        return this._isUncommitted;
    }

    get previousShortSha() {
        return this.previousSha && this.previousSha.substring(0, 8);
    }

    get previousUri(): Uri {
        return this.previousFileName ? Uri.file(path.resolve(this.repoPath, this.previousFileName)) : this.uri;
    }

    get uri(): Uri {
        return Uri.file(path.resolve(this.repoPath, this.originalFileName || this.fileName));
    }

    getFormattedPath(separator: string = ' \u00a0\u2022\u00a0 '): string {
        return GitUri.getFormattedPath(this.fileName, separator);
    }
}