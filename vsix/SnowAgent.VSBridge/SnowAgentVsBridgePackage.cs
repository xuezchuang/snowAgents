using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using EnvDTE;
using EnvDTE80;
using Microsoft.VisualStudio;
using Microsoft.VisualStudio.Shell;
using Task = System.Threading.Tasks.Task;

namespace SnowAgent.VSBridge
{
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("SnowAgent VS Bridge", "Registers this Visual Studio instance with SnowAgent Desktop.", "0.1.0")]
    [ProvideAutoLoad(VSConstants.UICONTEXT.ShellInitialized_string, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideAutoLoad(VSConstants.UICONTEXT.NoSolution_string, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideAutoLoad(VSConstants.UICONTEXT.SolutionExists_string, PackageAutoLoadFlags.BackgroundLoad)]
    [Guid(ExtensionInfo.PackageGuidString)]
    public sealed class SnowAgentVsBridgePackage : AsyncPackage
    {
        private DTE2 dte;
        private SolutionEvents solutionEvents;
        private BridgeHttpServer bridgeServer;
        private DesktopRegistrar desktopRegistrar;
        private Timer registrationTimer;
        private string lastRegisteredSolutionPath;

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            ActivityLog.LogInformation("SnowAgent VS Bridge", "Package initialization started.");
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            var dteService = await GetServiceAsync(typeof(DTE)).ConfigureAwait(true);
            if (dteService == null)
            {
                ActivityLog.LogError("SnowAgent VS Bridge", "DTE service was not available.");
                return;
            }

            dte = dteService as DTE2;
            if (dte == null)
            {
                ActivityLog.LogError("SnowAgent VS Bridge", "DTE service did not resolve to DTE2.");
                return;
            }

            bridgeServer = new BridgeHttpServer(this);
            bridgeServer.Start();
            ActivityLog.LogInformation("SnowAgent VS Bridge", "Bridge server started at " + bridgeServer.Endpoint + ".");
            desktopRegistrar = new DesktopRegistrar();

            solutionEvents = dte.Events.SolutionEvents;
            solutionEvents.Opened += OnSolutionOpened;
            solutionEvents.AfterClosing += OnSolutionClosed;

            _ = JoinableTaskFactory.RunAsync(RegisterCurrentSolutionAsync);
            registrationTimer = new Timer(
                _ => _ = JoinableTaskFactory.RunAsync(RegisterCurrentSolutionAsync),
                null,
                TimeSpan.FromSeconds(5),
                TimeSpan.FromSeconds(10));
        }

        internal async Task<BridgeResponse> OpenFileAsync(OpenFileRequest request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.Path))
            {
                return new BridgeResponse { Ok = false, Message = "path is required" };
            }

            await JoinableTaskFactory.SwitchToMainThreadAsync();

            var fullPath = Path.GetFullPath(request.Path);
            if (!File.Exists(fullPath))
            {
                return new BridgeResponse { Ok = false, Message = "file does not exist: " + fullPath };
            }

            try
            {
                var window = dte.ItemOperations.OpenFile(fullPath);
                window?.Activate();

                var document = dte.ActiveDocument;
                document?.Activate();

                if (document?.Selection is TextSelection selection)
                {
                    var line = Math.Max(1, request.Line);
                    var column = Math.Max(1, request.Column ?? 1);
                    selection.MoveToLineAndOffset(line, column, false);
                }

                return new BridgeResponse { Ok = true, Message = "opened" };
            }
            catch (Exception ex)
            {
                return new BridgeResponse { Ok = false, Message = "openFile failed: " + ex.Message };
            }
        }

        private void OnSolutionOpened()
        {
            ActivityLog.LogInformation("SnowAgent VS Bridge", "Solution opened event received.");
            _ = JoinableTaskFactory.RunAsync(RegisterCurrentSolutionAsync);
        }

        private void OnSolutionClosed()
        {
            ActivityLog.LogInformation("SnowAgent VS Bridge", "Solution closed event received.");
            lastRegisteredSolutionPath = null;
            var registrar = desktopRegistrar;
            if (registrar != null)
            {
                _ = Task.Run(() => registrar.UnregisterAsync());
            }
        }

        private async Task RegisterCurrentSolutionAsync()
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync();

            var solutionPath = dte?.Solution?.FullName;
            if (string.IsNullOrWhiteSpace(solutionPath) || bridgeServer == null)
            {
                solutionPath = TryGetSolutionPathFromCommandLine();
                if (string.IsNullOrWhiteSpace(solutionPath) || bridgeServer == null)
                {
                    ActivityLog.LogInformation("SnowAgent VS Bridge", "Registration skipped because no solution is open yet.");
                    return;
                }

                ActivityLog.LogInformation(
                    "SnowAgent VS Bridge",
                    "Using command line solution path for registration: " + solutionPath + ".");
            }

            if (string.Equals(lastRegisteredSolutionPath, solutionPath, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            var processId = System.Diagnostics.Process.GetCurrentProcess().Id;
            var payload = new VsRegisterPayload
            {
                InstanceId = "vs-" + processId.ToString(CultureInfo.InvariantCulture),
                ProcessId = processId,
                SolutionPath = solutionPath,
                Endpoint = bridgeServer.Endpoint,
            };

            try
            {
                await desktopRegistrar.RegisterAsync(payload).ConfigureAwait(false);
                lastRegisteredSolutionPath = solutionPath;
                ActivityLog.LogInformation(
                    "SnowAgent VS Bridge",
                    "Registered " + payload.InstanceId + " for " + solutionPath + " at " + payload.Endpoint + ".");
            }
            catch (Exception ex)
            {
                // SnowAgent Desktop may not be running yet. Opening/reloading the solution retries registration.
                ActivityLog.LogWarning(
                    "SnowAgent VS Bridge",
                    "Registration failed for " + solutionPath + ": " + ex.Message);
            }
        }

        private static string TryGetSolutionPathFromCommandLine()
        {
            var commandLine = Environment.CommandLine;
            if (string.IsNullOrWhiteSpace(commandLine))
            {
                ActivityLog.LogInformation("SnowAgent VS Bridge", "Command line was empty.");
                return null;
            }

            ActivityLog.LogInformation("SnowAgent VS Bridge", "Command line is: " + commandLine);
            var match = Regex.Match(commandLine, @"(?<path>[A-Za-z]:\\.*?\.sln)", RegexOptions.IgnoreCase);
            if (!match.Success)
            {
                ActivityLog.LogInformation("SnowAgent VS Bridge", "No solution path was found in the command line.");
                return null;
            }

            var path = match.Groups["path"].Value.Trim().Trim('"');
            if (!File.Exists(path))
            {
                ActivityLog.LogInformation("SnowAgent VS Bridge", "Command line solution path does not exist: " + path);
                return null;
            }

            return Path.GetFullPath(path);
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                var events = solutionEvents;
                var registrar = desktopRegistrar;
                registrationTimer?.Dispose();

                JoinableTaskFactory.Run(async () =>
                {
                    await JoinableTaskFactory.SwitchToMainThreadAsync();

                    if (events != null)
                    {
                        events.Opened -= OnSolutionOpened;
                        events.AfterClosing -= OnSolutionClosed;
                    }

                    if (registrar != null)
                    {
                        await registrar.UnregisterAsync().ConfigureAwait(false);
                    }
                });

                desktopRegistrar?.Dispose();
                bridgeServer?.Dispose();

                solutionEvents = null;
                desktopRegistrar = null;
                bridgeServer = null;
            }

            base.Dispose(disposing);
        }
    }
}
