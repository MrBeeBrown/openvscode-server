/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Gitpod. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/// <reference path='../../../src/vscode-dts/vscode.d.ts'/>

import * as cp from 'child_process';
import { GitpodExtensionContext, registerTasks, setupGitpodContext, registerIpcHookCli } from 'gitpod-shared';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';

const EXTENSION_ID = 'gitpod.gitpod-remote-ssh';

let gitpodContext: GitpodExtensionContext | undefined;
export async function activate(context: vscode.ExtensionContext) {
	const packageJSON = vscode.extensions.getExtension(EXTENSION_ID)!.packageJSON;

	gitpodContext = await setupGitpodContext(context);
	if (!gitpodContext) {
		return;
	}

	if (vscode.extensions.getExtension('gitpod.gitpod')) {
		try {
			await util.promisify(cp.exec)('code --uninstall-extension gitpod.gitpod');
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		} catch (e) {
			gitpodContext.logger.error('failed to uninstall gitpod.gitpod:', e);
		}
		return;
	}

	registerTasks(gitpodContext);
	installInitialExtensions(gitpodContext);

	registerCLI(gitpodContext);
	// configure task terminals if Gitpod Code Server is running
	if (process.env.GITPOD_THEIA_PORT) {
		registerIpcHookCli(gitpodContext);
	}

	// For port tunneling we rely on Remote SSH capabilities
	// and gitpod.gitpod to disable auto tunneling from the current local machine.
	vscode.commands.executeCommand('gitpod.api.autoTunnel', gitpodContext.info.getGitpodHost(), gitpodContext.info.getInstanceId(), false);

	// For collecting logs, will be called by gitpod-desktop extension;
	context.subscriptions.push(vscode.commands.registerCommand('__gitpod.getGitpodRemoteLogsUri', () => {
		return context.logUri;
	}));
	context.subscriptions.push(vscode.commands.registerCommand('__gitpod.getGitpodRemoteVersion', () => {
		return packageJSON.version;
	}));

	// TODO
	// - auth?
	// - .gitpod.yml validations
	// - add to .gitpod.yml command
	// - cli integration
	//   - git credential helper
	await gitpodContext.active;
}

export function deactivate() {
	if (!gitpodContext) {
		return;
	}
	return gitpodContext.dispose();
}

/**
 * configure CLI in regular terminals
 */
export function registerCLI(context: GitpodExtensionContext): void {
	context.environmentVariableCollection.replace('EDITOR', 'code');
	context.environmentVariableCollection.replace('VISUAL', 'code');
	context.environmentVariableCollection.replace('GP_OPEN_EDITOR', 'code');
	context.environmentVariableCollection.replace('GIT_EDITOR', 'code --wait');
	context.environmentVariableCollection.replace('GP_PREVIEW_BROWSER', `${process.execPath} ${path.join(__dirname, 'cli.js')} --preview`);
	context.environmentVariableCollection.replace('GP_EXTERNAL_BROWSER', 'code --openExternal');

	const ipcHookCli = context.ipcHookCli;
	if (!ipcHookCli) {
		return;
	}
	context.environmentVariableCollection.replace('GITPOD_REMOTE_CLI_IPC', ipcHookCli);
}

export async function installInitialExtensions(context: GitpodExtensionContext): Promise<void> {
	context.logger.info('installing initial extensions...');
	const extensions: (vscode.Uri | string)[] = [];
	try {
		const workspaceContextUri = vscode.Uri.parse(context.info.getWorkspaceContextUrl());
		extensions.push('redhat.vscode-yaml');
		if (/github\.com/i.test(workspaceContextUri.authority)) {
			extensions.push('github.vscode-pull-request-github');
		}

		let config: { vscode?: { extensions?: string[] } } | undefined;
		try {
			const configUri = vscode.Uri.file(path.join(context.info.getCheckoutLocation(), '.gitpod.yml'));
			const buffer = await vscode.workspace.fs.readFile(configUri);
			const content = new util.TextDecoder('utf8').decode(buffer);
			const model = new context.config.GitpodPluginModel(content);
			config = model.document.toJSON();
		} catch { }
		if (config?.vscode?.extensions) {
			const extensionIdRegex = /^([^.]+\.[^@]+)(@(\d+\.\d+\.\d+(-.*)?))?$/;
			for (const extension of config.vscode.extensions) {
				let link: vscode.Uri | undefined;
				try {
					link = vscode.Uri.parse(extension.trim(), true);
					if (link.scheme !== 'http' && link.scheme !== 'https') {
						link = undefined;
					}
				} catch { }
				if (link) {
					extensions.push(link);
				} else {
					const normalizedExtension = extension.toLocaleLowerCase();
					if (extensionIdRegex.exec(normalizedExtension)) {
						extensions.push(normalizedExtension);
					}
				}
			}
		}
	} catch (e) {
		context.logger.error('failed to detect workspace context dependent extensions:', e);
		console.error('failed to detect workspace context dependent extensions:', e);
	}
	context.logger.info('initial extensions:', extensions);
	if (extensions.length) {
		let cause;
		try {
			const { stderr } = await util.promisify(cp.exec)('code ' + extensions.map(extension => '--install-extension ' + extension).join(' '));
			cause = stderr;
		} catch (e) {
			cause = e;
		}
		if (cause) {
			context.logger.error('failed to install initial extensions:', cause);
			console.error('failed to install initial extensions: ', cause);
		}
	}
	context.logger.info('initial extensions installed');
}
