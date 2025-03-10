/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/workbench/workbench.web.main';
import { main } from 'vs/workbench/browser/web.main';
import { UriComponents, URI } from 'vs/base/common/uri';
import { IWebSocketFactory, IWebSocket } from 'vs/platform/remote/browser/browserSocketFactory';
import { IURLCallbackProvider } from 'vs/workbench/services/url/browser/urlService';
import { LogLevel } from 'vs/platform/log/common/log';
import { IUpdateProvider, IUpdate } from 'vs/workbench/services/update/browser/updateService';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IWorkspaceProvider, IWorkspace } from 'vs/workbench/services/host/browser/browserHostService';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IProductConfiguration } from 'vs/base/common/product';
import { mark } from 'vs/base/common/performance';
import { ICredentialsProvider } from 'vs/workbench/services/credentials/common/credentials';
import { TunnelProviderFeatures } from 'vs/platform/remote/common/tunnel';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';

interface IResourceUriProvider {
	(uri: URI): URI;
}

/**
 * The identifier of an extension in the format: `PUBLISHER.NAME`.
 * For example: `vscode.csharp`
 */
type ExtensionId = string;

interface ICommonTelemetryPropertiesResolver {
	(): { [key: string]: any };
}

interface IExternalUriResolver {
	(uri: URI): Promise<URI>;
}

/**
 * External URL opener
 */
interface IExternalURLOpener {

	/**
	 * Overrides the behavior when an external URL is about to be opened.
	 * Returning false means that the URL wasn't handled, and the default
	 * handling behavior should be used: `window.open(href, '_blank', 'noopener');`
	 *
	 * @returns true if URL was handled, false otherwise.
	 */
	openExternal(href: string): boolean | Promise<boolean>;
}

interface ITunnelProvider {

	/**
	 * Support for creating tunnels.
	 */
	tunnelFactory?: ITunnelFactory;

	/**
	 * Support for filtering candidate ports.
	 */
	showPortCandidate?: IShowPortCandidate;

	/**
	 * The features that the tunnel provider supports.
	 */
	features?: TunnelProviderFeatures;
}

interface ITunnelFactory {
	(tunnelOptions: ITunnelOptions, tunnelCreationOptions: TunnelCreationOptions): Promise<ITunnel> | undefined;
}

interface ITunnelOptions {

	remoteAddress: { port: number, host: string };

	/**
	 * The desired local port. If this port can't be used, then another will be chosen.
	 */
	localAddressPort?: number;

	label?: string;

	/**
	 * @deprecated Use privacy instead
	 */
	public?: boolean;

	privacy?: string;

	protocol?: string;
}

interface TunnelCreationOptions {

	/**
	 * True when the local operating system will require elevation to use the requested local port.
	 */
	elevationRequired?: boolean;
}

interface ITunnel {

	remoteAddress: { port: number, host: string };

	/**
	 * The complete local address(ex. localhost:1234)
	 */
	localAddress: string;

	/**
	 * @deprecated Use privacy instead
	 */
	public?: boolean;

	privacy?: string;

	/**
	 * If protocol is not provided, it is assumed to be http, regardless of the localAddress
	 */
	protocol?: string;

	/**
	 * Implementers of Tunnel should fire onDidDispose when dispose is called.
	 */
	onDidDispose: Event<void>;

	dispose(): Promise<void> | void;
}

interface IShowPortCandidate {
	(host: string, port: number, detail: string): Promise<boolean>;
}

interface ICommand {

	/**
	 * An identifier for the command. Commands can be executed from extensions
	 * using the `vscode.commands.executeCommand` API using that command ID.
	 */
	id: string,

	/**
	 * The optional label of the command. If provided, the command will appear
	 * in the command palette.
	 */
	label?: string,

	/**
	 * A function that is being executed with any arguments passed over. The
	 * return type will be send back to the caller.
	 *
	 * Note: arguments and return type should be serializable so that they can
	 * be exchanged across processes boundaries.
	 */
	handler: (...args: any[]) => unknown;
}

interface IHomeIndicator {

	/**
	 * The link to open when clicking the home indicator.
	 */
	href: string;

	/**
	 * The icon name for the home indicator. This needs to be one of the existing
	 * icons from our Codicon icon set. For example `code`.
	 */
	icon: string;

	/**
	 * A tooltip that will appear while hovering over the home indicator.
	 */
	title: string;
}

interface IWelcomeBanner {

	/**
	 * Welcome banner message to appear as text.
	 */
	message: string;

	/**
	 * Optional icon for the banner. This is either the URL to an icon to use
	 * or the name of one of the existing icons from our Codicon icon set.
	 *
	 * If not provided a default icon will be used.
	 */
	icon?: string | UriComponents;

	/**
	 * Optional actions to appear as links after the welcome banner message.
	 */
	actions?: IWelcomeBannerAction[];
}

interface IWelcomeBannerAction {

	/**
	 * The link to open when clicking. Supports command invocation when
	 * using the `command:<commandId>` value.
	 */
	href: string;

	/**
	 * The label to show for the action link.
	 */
	label: string;

	/**
	 * A tooltip that will appear while hovering over the action link.
	 */
	title?: string;
}

interface IWindowIndicator {

	/**
	 * Triggering this event will cause the window indicator to update.
	 */
	readonly onDidChange?: Event<void>;

	/**
	 * Label of the window indicator may include octicons
	 * e.g. `$(remote) label`
	 */
	label: string;

	/**
	 * Tooltip of the window indicator should not include
	 * octicons and be descriptive.
	 */
	tooltip: string;

	/**
	 * If provided, overrides the default command that
	 * is executed when clicking on the window indicator.
	 */
	command?: string;
}

enum ColorScheme {
	DARK = 'dark',
	LIGHT = 'light',
	HIGH_CONTRAST = 'hc'
}

interface IInitialColorTheme {

	/**
	 * Initial color theme type.
	 */
	readonly themeType: ColorScheme;

	/**
	 * A list of workbench colors to apply initially.
	 */
	readonly colors?: { [colorId: string]: string };
}

interface IDefaultView {
	readonly id: string;
}

interface IPosition {
	readonly line: number;
	readonly column: number;
}

interface IRange {

	/**
	 * The start position. It is before or equal to end position.
	 */
	readonly start: IPosition;

	/**
	 * The end position. It is after or equal to start position.
	 */
	readonly end: IPosition;
}

interface IDefaultEditor {
	readonly uri: UriComponents;
	readonly selection?: IRange;
	readonly openOnlyIfExists?: boolean;
	readonly openWith?: string;
}

interface IDefaultLayout {
	readonly views?: IDefaultView[];
	readonly editors?: IDefaultEditor[];

	/**
	 * Forces this layout to be applied even if this isn't
	 * the first time the workspace has been opened
	 */
	readonly force?: boolean;
}

interface IProductQualityChangeHandler {

	/**
	 * Handler is being called when the user wants to switch between
	 * `insider` or `stable` product qualities.
	 */
	(newQuality: 'insider' | 'stable'): void;
}

/**
 * Settings sync options
 */
interface ISettingsSyncOptions {

	/**
	 * Is settings sync enabled
	 */
	readonly enabled: boolean;

	/**
	 * Version of extensions sync state.
	 * Extensions sync state will be reset if version is provided and different from previous version.
	 */
	readonly extensionsSyncStateVersion?: string;

	/**
	 * Handler is being called when the user changes Settings Sync enablement.
	 */
	enablementHandler?(enablement: boolean): void;
}

interface IWorkbenchConstructionOptions {

	//#region Connection related configuration

	/**
	 * The remote authority is the IP:PORT from where the workbench is served
	 * from. It is for example being used for the websocket connections as address.
	 */
	readonly remoteAuthority?: string;

	/**
	 * The connection token to send to the server.
	 */
	readonly connectionToken?: string;

	/**
	 * An endpoint to serve iframe content ("webview") from. This is required
	 * to provide full security isolation from the workbench host.
	 */
	readonly webviewEndpoint?: string;

	/**
	 * An URL pointing to the web worker extension host <iframe> src.
	 * @deprecated. This will be removed soon.
	 */
	readonly webWorkerExtensionHostIframeSrc?: string;

	/**
	 * [TEMPORARY]: This will be removed soon.
	 * Use an unique origin for the web worker extension host.
	 * Defaults to true.
	 */
	readonly __uniqueWebWorkerExtensionHostOrigin?: boolean;

	/**
	 * A factory for web sockets.
	 */
	readonly webSocketFactory?: IWebSocketFactory;

	/**
	 * A provider for resource URIs.
	 */
	readonly resourceUriProvider?: IResourceUriProvider;

	/**
	 * Resolves an external uri before it is opened.
	 */
	readonly resolveExternalUri?: IExternalUriResolver;

	/**
	 * A provider for supplying tunneling functionality,
	 * such as creating tunnels and showing candidate ports to forward.
	 */
	readonly tunnelProvider?: ITunnelProvider;

	/**
	 * Endpoints to be used for proxying authentication code exchange calls in the browser.
	 */
	readonly codeExchangeProxyEndpoints?: { [providerId: string]: string }

	//#endregion


	//#region Workbench configuration

	/**
	 * A handler for opening workspaces and providing the initial workspace.
	 */
	readonly workspaceProvider?: IWorkspaceProvider;

	/**
	 * Settings sync options
	 */
	readonly settingsSyncOptions?: ISettingsSyncOptions;

	/**
	 * The credentials provider to store and retrieve secrets.
	 */
	readonly credentialsProvider?: ICredentialsProvider;

	/**
	 * Additional builtin extensions that cannot be uninstalled but only be disabled.
	 * It can be one of the following:
	 * 	- `ExtensionId`: id of the extension that is available in Marketplace
	 * 	- `UriComponents`: location of the extension where it is hosted.
	 */
	readonly additionalBuiltinExtensions?: readonly (ExtensionId | UriComponents)[];

	/**
	 * List of extensions to be enabled if they are installed.
	 * Note: This will not install extensions if not installed.
	 */
	readonly enabledExtensions?: readonly ExtensionId[];

	/**
	 * [TEMPORARY]: This will be removed soon.
	 * Enable inlined extensions.
	 * Defaults to true.
	 */
	readonly _enableBuiltinExtensions?: boolean;

	/**
	 * Additional domains allowed to open from the workbench without the
	 * link protection popup.
	 */
	readonly additionalTrustedDomains?: string[];

	/**
	 * Urls that will be opened externally that are allowed access
	 * to the opener window. This is primarily used to allow
	 * `window.close()` to be called from the newly opened window.
	 */
	readonly openerAllowedExternalUrlPrefixes?: string[];

	/**
	 * Support for URL callbacks.
	 */
	readonly urlCallbackProvider?: IURLCallbackProvider;

	/**
	 * Support adding additional properties to telemetry.
	 */
	readonly resolveCommonTelemetryProperties?: ICommonTelemetryPropertiesResolver;

	/**
	 * A set of optional commands that should be registered with the commands
	 * registry.
	 *
	 * Note: commands can be called from extensions if the identifier is known!
	 */
	readonly commands?: readonly ICommand[];

	/**
	 * Optional default layout to apply on first time the workspace is opened (uness `force` is specified).
	 */
	readonly defaultLayout?: IDefaultLayout;

	/**
	 * Optional configuration default overrides contributed to the workbench.
	 */
	readonly configurationDefaults?: Record<string, any>;

	//#endregion


	//#region Update/Quality related

	/**
	 * Support for update reporting
	 */
	readonly updateProvider?: IUpdateProvider;

	/**
	 * Support for product quality switching
	 */
	readonly productQualityChangeHandler?: IProductQualityChangeHandler;

	//#endregion


	//#region Branding

	/**
	 * Optional home indicator to appear above the hamburger menu in the activity bar.
	 */
	readonly homeIndicator?: IHomeIndicator;

	/**
	 * Optional welcome banner to appear above the workbench. Can be dismissed by the
	 * user.
	 */
	readonly welcomeBanner?: IWelcomeBanner;

	/**
	 * Optional override for the product configuration properties.
	 */
	readonly productConfiguration?: Partial<IProductConfiguration>;

	/**
	 * Optional override for properties of the window indicator in the status bar.
	 */
	readonly windowIndicator?: IWindowIndicator;

	/**
	 * Specifies the default theme type (LIGHT, DARK..) and allows to provide initial colors that are shown
	 * until the color theme that is specified in the settings (`editor.colorTheme`) is loaded and applied.
	 * Once there are persisted colors from a last run these will be used.
	 *
	 * The idea is that the colors match the main colors from the theme defined in the `configurationDefaults`.
	 */
	readonly initialColorTheme?: IInitialColorTheme;

	//#endregion


	//#region Development options

	readonly developmentOptions?: IDevelopmentOptions;

	//#endregion

}

interface IDevelopmentOptions {

	/**
	 * Current logging level. Default is `LogLevel.Info`.
	 */
	readonly logLevel?: LogLevel;

	/**
	 * Location of a module containing extension tests to run once the workbench is open.
	 */
	readonly extensionTestsPath?: UriComponents;

	/**
	 * Add extensions under development.
	 */
	readonly extensions?: readonly UriComponents[];

	/**
	 * Whether to enable the smoke test driver.
	 */
	readonly enableSmokeTestDriver?: boolean;
}

interface IPerformanceMark {

	/**
	 * The name of a performace marker.
	 */
	readonly name: string;

	/**
	 * The UNIX timestamp at which the marker has been set.
	 */
	readonly startTime: number;
}

interface IWorkbench {

	commands: {

		/**
		 * @see [executeCommand](#commands.executeCommand)
		 */
		executeCommand(command: string, ...args: any[]): Promise<unknown>;
	}

	env: {

		/**
		 * @see [getUriScheme](#env.getUriScheme)
		 */
		readonly uriScheme: string;

		/**
		 * @see [retrievePerformanceMarks](#commands.retrievePerformanceMarks)
		 */
		retrievePerformanceMarks(): Promise<[string, readonly IPerformanceMark[]][]>;

		/**
		 * @see [openUri](#env.openUri)
		 */
		openUri(target: URI): Promise<boolean>;
	}

	/**
	 * Triggers shutdown of the workbench programmatically. After this method is
	 * called, the workbench is not usable anymore and the page needs to reload
	 * or closed.
	 *
	 * This will also remove any `beforeUnload` handlers that would bring up a
	 * confirmation dialog.
	 */
	shutdown: () => void;
}

/**
 * Creates the workbench with the provided options in the provided container.
 *
 * @param domElement the container to create the workbench in
 * @param options for setting up the workbench
 */
let created = false;
let workbenchPromiseResolve: Function;
const workbenchPromise = new Promise<IWorkbench>(resolve => workbenchPromiseResolve = resolve);
function create(domElement: HTMLElement, options: IWorkbenchConstructionOptions): IDisposable {

	// Mark start of workbench
	mark('code/didLoadWorkbenchMain');

	// Assert that the workbench is not created more than once. We currently
	// do not support this and require a full context switch to clean-up.
	if (created) {
		throw new Error('Unable to create the VSCode workbench more than once.');
	} else {
		created = true;
	}

	// Register commands if any
	if (Array.isArray(options.commands)) {
		for (const c of options.commands) {
			const command: ICommand = c;

			CommandsRegistry.registerCommand(command.id, (accessor, ...args) => {
				// we currently only pass on the arguments but not the accessor
				// to the command to reduce our exposure of internal API.
				return command.handler(...args);
			});

			// Commands with labels appear in the command palette
			if (command.label) {
				MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: command.id, title: command.label } });
			}
		}
	}

	// Startup workbench and resolve waiters
	let instantiatedWorkbench: IWorkbench | undefined = undefined;
	main(domElement, options).then(workbench => {
		instantiatedWorkbench = workbench;
		workbenchPromiseResolve(workbench);
	});

	return toDisposable(() => {
		if (instantiatedWorkbench) {
			instantiatedWorkbench.shutdown();
		} else {
			workbenchPromise.then(instantiatedWorkbench => instantiatedWorkbench.shutdown());
		}
	});
}


//#region API Facade

namespace commands {

	/**
	* Allows to execute any command if known with the provided arguments.
	*
	* @param command Identifier of the command to execute.
	* @param rest Parameters passed to the command function.
	* @return A promise that resolves to the returned value of the given command.
	*/
	export async function executeCommand(command: string, ...args: any[]): Promise<unknown> {
		const workbench = await workbenchPromise;

		return workbench.commands.executeCommand(command, ...args);
	}
}

namespace env {

	/**
	 * Retrieve performance marks that have been collected during startup. This function
	 * returns tuples of source and marks. A source is a dedicated context, like
	 * the renderer or an extension host.
	 *
	 * *Note* that marks can be collected on different machines and in different processes
	 * and that therefore "different clocks" are used. So, comparing `startTime`-properties
	 * across contexts should be taken with a grain of salt.
	 *
	 * @returns A promise that resolves to tuples of source and marks.
	 */
	export async function retrievePerformanceMarks(): Promise<[string, readonly IPerformanceMark[]][]> {
		const workbench = await workbenchPromise;

		return workbench.env.retrievePerformanceMarks();
	}

	/**
	 * @returns the scheme to use for opening the associated desktop
	 * experience via protocol handler.
	 */
	export async function getUriScheme(): Promise<string> {
		const workbench = await workbenchPromise;

		return workbench.env.uriScheme;
	}

	/**
	 * Allows to open a `URI` with the standard opener service of the
	 * workbench.
	 */
	export async function openUri(target: URI): Promise<boolean> {
		const workbench = await workbenchPromise;

		return workbench.env.openUri(target);
	}
}

export {

	// Factory
	create,
	IWorkbenchConstructionOptions,
	IWorkbench,

	// Basic Types
	URI,
	UriComponents,
	Event,
	Emitter,
	IDisposable,
	Disposable,

	// Workspace
	IWorkspace,
	IWorkspaceProvider,

	// WebSockets
	IWebSocketFactory,
	IWebSocket,

	// Resources
	IResourceUriProvider,

	// Credentials
	ICredentialsProvider,

	// Callbacks
	IURLCallbackProvider,

	// LogLevel
	LogLevel,

	// SettingsSync
	ISettingsSyncOptions,

	// Updates/Quality
	IUpdateProvider,
	IUpdate,
	IProductQualityChangeHandler,

	// Telemetry
	ICommonTelemetryPropertiesResolver,

	// External Uris
	IExternalUriResolver,

	// External URL Opener
	IExternalURLOpener,

	// Tunnel
	ITunnelProvider,
	ITunnelFactory,
	ITunnel,
	ITunnelOptions,

	// Ports
	IShowPortCandidate,

	// Commands
	ICommand,
	commands,

	// Branding
	IHomeIndicator,
	IWelcomeBanner,
	IWelcomeBannerAction,
	IProductConfiguration,
	IWindowIndicator,
	IInitialColorTheme,

	// Default layout
	IDefaultView,
	IDefaultEditor,
	IDefaultLayout,
	IPosition,
	IRange as ISelection,

	// Env
	IPerformanceMark,
	env,

	// Development
	IDevelopmentOptions
};

//#endregion
