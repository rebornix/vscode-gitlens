'use strict';
import { Disposable, Event, EventEmitter, TextDocument, TextDocumentChangeEvent, TextEditor, window, workspace } from 'vscode';
import { TextDocumentComparer } from '../comparers';
import { CommandContext, setCommandContext } from '../constants';
import { GitService, GitUri } from '../gitService';
import { Logger } from '../logger';

export interface BlameabilityChangeEvent {
    blameable: boolean;
    editor: TextEditor | undefined;
}

export class GitContextTracker extends Disposable {

    private _onDidBlameabilityChange = new EventEmitter<BlameabilityChangeEvent>();
    get onDidBlameabilityChange(): Event<BlameabilityChangeEvent> {
        return this._onDidBlameabilityChange.event;
    }

    private _disposable: Disposable;
    private _documentChangeDisposable: Disposable | undefined;
    private _editor: TextEditor | undefined;
    private _gitEnabled: boolean;
    private _isBlameable: boolean;

    constructor(private git: GitService) {
        super(() => this.dispose());

        const subscriptions: Disposable[] = [];

        subscriptions.push(window.onDidChangeActiveTextEditor(this._onActiveTextEditorChanged, this));
        subscriptions.push(workspace.onDidChangeConfiguration(this._onConfigurationChanged, this));
        subscriptions.push(workspace.onDidSaveTextDocument(this._onTextDocumentSaved, this));
        subscriptions.push(this.git.onDidBlameFail(this._onBlameFailed, this));

        this._disposable = Disposable.from(...subscriptions);

        setCommandContext(CommandContext.IsRepository, !!this.git.repoPath);

        this._onConfigurationChanged();
        this._onActiveTextEditorChanged(window.activeTextEditor);
    }

    dispose() {
        this._disposable && this._disposable.dispose();
        this._documentChangeDisposable && this._documentChangeDisposable.dispose();
    }

    _onConfigurationChanged() {
        const gitEnabled = workspace.getConfiguration('git').get<boolean>('enabled', true);
        if (this._gitEnabled !== gitEnabled) {
            this._gitEnabled = gitEnabled;
            setCommandContext(CommandContext.Enabled, gitEnabled);
            this._onActiveTextEditorChanged(window.activeTextEditor);
        }
    }

    private _onActiveTextEditorChanged(editor: TextEditor | undefined) {
        this._editor = editor;
        this._updateContext(this._gitEnabled ? editor : undefined);
        this._subscribeToDocumentChanges();
    }

    private _onBlameFailed(key: string) {
        if (this._editor === undefined || this._editor.document === undefined || this._editor.document.uri === undefined) return;
        if (key !== this.git.getCacheEntryKey(this._editor.document.uri)) return;

        this._updateBlameability(false);
    }

    private _onTextDocumentChanged(e: TextDocumentChangeEvent) {
        if (!TextDocumentComparer.equals(this._editor && this._editor.document, e && e.document)) return;

        // Can't unsubscribe here because undo doesn't trigger any other event
        // this._unsubscribeToDocumentChanges();
        // this.updateBlameability(false);

        // TODO: Rework this once https://github.com/Microsoft/vscode/issues/27231 is released in v1.13
        // We have to defer because isDirty is not reliable inside this event
        setTimeout(() => this._updateBlameability(!e.document.isDirty), 1);
    }

    private _onTextDocumentSaved(e: TextDocument) {
        if (!TextDocumentComparer.equals(this._editor && this._editor.document, e)) return;

        // Don't need to resubscribe as we aren't unsubscribing on document changes anymore
        // this._subscribeToDocumentChanges();
        this._updateBlameability(!e.isDirty);
    }

    private _subscribeToDocumentChanges() {
        this._unsubscribeToDocumentChanges();
        this._documentChangeDisposable = workspace.onDidChangeTextDocument(this._onTextDocumentChanged, this);
    }

    private _unsubscribeToDocumentChanges() {
        this._documentChangeDisposable && this._documentChangeDisposable.dispose();
        this._documentChangeDisposable = undefined;
    }

    private async _updateContext(editor: TextEditor | undefined) {
        try {
            const gitUri = editor === undefined ? undefined : await GitUri.fromUri(editor.document.uri, this.git);

            await Promise.all([
                this._updateEditorContext(gitUri, editor),
                this._updateContextHasRemotes(gitUri)
            ]);
        }
        catch (ex) {
            Logger.error(ex, 'GitEditorTracker._updateContext');
        }
    }

    private async _updateContextHasRemotes(uri: GitUri | undefined) {
        try {
            let repoPath = this.git.repoPath;
            if (uri !== undefined && this.git.isTrackable(uri)) {
                repoPath = uri.repoPath || this.git.repoPath;
            }

            let hasRemotes = false;
            if (repoPath) {
                const remotes = await this.git.getRemotes(repoPath);
                hasRemotes = remotes.length !== 0;
            }

            setCommandContext(CommandContext.HasRemotes, hasRemotes);
        }
        catch (ex) {
            Logger.error(ex, 'GitEditorTracker._updateContextHasRemotes');
        }
    }

    private async _updateEditorContext(uri: GitUri | undefined, editor: TextEditor | undefined) {
        try {
            const tracked = uri === undefined ? false : await this.git.isTracked(uri);
            setCommandContext(CommandContext.IsTracked, tracked);

            let blameable = tracked && (editor !== undefined && editor.document !== undefined && !editor.document.isDirty);
            if (blameable) {
                blameable =  uri === undefined ? false : await this.git.getBlameability(uri);
            }

            this._updateBlameability(blameable, true);
        }
        catch (ex) {
            Logger.error(ex, 'GitEditorTracker._updateEditorContext');
        }
    }

    private _updateBlameability(blameable: boolean, force: boolean = false) {
        if (!force && this._isBlameable === blameable) return;

        try {
            setCommandContext(CommandContext.IsBlameable, blameable);
            this._onDidBlameabilityChange.fire({
                blameable: blameable,
                editor: this._editor
            });
        }
        catch (ex) {
            Logger.error(ex, 'GitEditorTracker._updateBlameability');
        }
    }
}