/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IObservableValue } from 'vs/base/common/observableValue';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILoggerService } from 'vs/platform/log/common/log';
import { IProductService } from 'vs/platform/product/common/productService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { OneDataSystemWebAppender } from 'vs/platform/telemetry/browser/1dsAppender';
import { WebAppInsightsAppender } from 'vs/platform/telemetry/browser/appInsightsAppender';
import { ClassifiedEvent, GDPRClassification, StrictPropertyCheck } from 'vs/platform/telemetry/common/gdprTypings';
import { ITelemetryData, ITelemetryInfo, ITelemetryService, TelemetryLevel } from 'vs/platform/telemetry/common/telemetry';
import { TelemetryLogAppender } from 'vs/platform/telemetry/common/telemetryLogAppender';
import { ITelemetryServiceConfig, TelemetryService as BaseTelemetryService } from 'vs/platform/telemetry/common/telemetryService';
import { ITelemetryAppender, NullTelemetryService, supportsTelemetry } from 'vs/platform/telemetry/common/telemetryUtils';
import { IBrowserWorkbenchEnvironmentService } from 'vs/workbench/services/environment/browser/environmentService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { resolveWorkbenchCommonProperties } from 'vs/workbench/services/telemetry/browser/workbenchCommonProperties';
// eslint-disable-next-line code-import-patterns
import { GitpodInsightsAppender } from 'vs/gitpod/browser/gitpodInsightsAppender';

export class TelemetryService extends Disposable implements ITelemetryService {

	declare readonly _serviceBrand: undefined;

	private impl: ITelemetryService;
	public readonly sendErrorTelemetry = true;

	constructor(
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
		@ILoggerService loggerService: ILoggerService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IProductService productService: IProductService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService
	) {
		super();

		if (supportsTelemetry(productService, environmentService) && productService.aiConfig?.asimovKey && productService.aiConfig?.ariaKey) {
			// If remote server is present send telemetry through that, else use the client side appender
			const internalTesting = configurationService.getValue<boolean>('telemetry.internalTesting');
			const appenders = [];
			if (internalTesting || productService.aiConfig?.preferAria) {
				const telemetryProvider: ITelemetryAppender = remoteAgentService.getConnection() !== null ? { log: remoteAgentService.logTelemetry.bind(remoteAgentService), flush: remoteAgentService.flushTelemetry.bind(remoteAgentService) } : new OneDataSystemWebAppender('monacoworkbench', null, productService.aiConfig?.ariaKey);
				appenders.push(telemetryProvider);
			} else {
				const telemetryProvider: ITelemetryAppender = remoteAgentService.getConnection() !== null ? { log: remoteAgentService.logTelemetry.bind(remoteAgentService), flush: remoteAgentService.flushTelemetry.bind(remoteAgentService) } : new WebAppInsightsAppender('monacoworkbench', productService.aiConfig?.asimovKey);
				appenders.push(telemetryProvider);
			}
			appenders.push(new TelemetryLogAppender(loggerService, environmentService));
			const gitpodTelemetryProvider: ITelemetryAppender = new GitpodInsightsAppender(productService);
			appenders.push(gitpodTelemetryProvider);
			const config: ITelemetryServiceConfig = {
				appenders,
				commonProperties: resolveWorkbenchCommonProperties(storageService, productService.commit, productService.version, environmentService.remoteAuthority, productService.embedderIdentifier, productService.removeTelemetryMachineId, environmentService.options && environmentService.options.resolveCommonTelemetryProperties),
				sendErrorTelemetry: this.sendErrorTelemetry,
			};

			this.impl = this._register(new BaseTelemetryService(config, configurationService, productService));
		} else {
			this.impl = NullTelemetryService;
		}
	}

	setExperimentProperty(name: string, value: string): void {
		return this.impl.setExperimentProperty(name, value);
	}

	get telemetryLevel(): IObservableValue<TelemetryLevel> {
		return this.impl.telemetryLevel;
	}

	publicLog(eventName: string, data?: ITelemetryData, anonymizeFilePaths?: boolean): Promise<void> {
		return this.impl.publicLog(eventName, data, anonymizeFilePaths);
	}

	publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>, anonymizeFilePaths?: boolean) {
		return this.publicLog(eventName, data as ITelemetryData, anonymizeFilePaths);
	}

	publicLogError(errorEventName: string, data?: ITelemetryData): Promise<void> {
		return this.impl.publicLog(errorEventName, data);
	}

	publicLogError2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLogError(eventName, data as ITelemetryData);
	}

	getTelemetryInfo(): Promise<ITelemetryInfo> {
		return this.impl.getTelemetryInfo();
	}
}

registerSingleton(ITelemetryService, TelemetryService);
