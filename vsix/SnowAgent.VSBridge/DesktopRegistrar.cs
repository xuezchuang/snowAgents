using System;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace SnowAgent.VSBridge
{
    internal sealed class DesktopRegistrar : IDisposable
    {
        private readonly HttpClient httpClient = new HttpClient();
        private readonly string desktopBaseUrl;
        private Timer heartbeatTimer;
        private string registeredInstanceId;
        private VsRegisterPayload lastPayload;

        public DesktopRegistrar()
        {
            httpClient.Timeout = TimeSpan.FromSeconds(2);
            desktopBaseUrl = Environment.GetEnvironmentVariable("SNOWAGENT_DESKTOP_URL");
            if (string.IsNullOrWhiteSpace(desktopBaseUrl))
            {
                desktopBaseUrl = "http://127.0.0.1:39000";
            }
            desktopBaseUrl = desktopBaseUrl.TrimEnd('/');
        }

        public async Task RegisterAsync(VsRegisterPayload payload)
        {
            await PostRegisterAsync(payload).ConfigureAwait(false);
            lastPayload = payload;
            registeredInstanceId = payload.InstanceId;
            heartbeatTimer?.Dispose();
            heartbeatTimer = new Timer(_ => _ = SendHeartbeatAsync(), null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(30));
        }

        public async Task UnregisterAsync()
        {
            var instanceId = registeredInstanceId;
            if (string.IsNullOrWhiteSpace(instanceId))
            {
                return;
            }

            registeredInstanceId = null;
            lastPayload = null;
            heartbeatTimer?.Dispose();
            heartbeatTimer = null;

            try
            {
                var payload = new HeartbeatPayload { InstanceId = instanceId };
                var json = JsonUtil.Serialize(payload);
                using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
                {
                    await httpClient.PostAsync(desktopBaseUrl + "/unregister_vs_instance", content).ConfigureAwait(false);
                }
            }
            catch
            {
                // Unregister is best-effort during Visual Studio shutdown.
            }
        }

        private async Task SendHeartbeatAsync()
        {
            if (string.IsNullOrWhiteSpace(registeredInstanceId))
            {
                return;
            }

            try
            {
                var payload = new HeartbeatPayload { InstanceId = registeredInstanceId };
                var json = JsonUtil.Serialize(payload);
                using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
                {
                    using (var response = await httpClient.PostAsync(desktopBaseUrl + "/heartbeat_vs_instance", content).ConfigureAwait(false))
                    {
                        if (!response.IsSuccessStatusCode && lastPayload != null)
                        {
                            await PostRegisterAsync(lastPayload).ConfigureAwait(false);
                        }
                    }
                }
            }
            catch
            {
                if (lastPayload != null)
                {
                    try
                    {
                        await PostRegisterAsync(lastPayload).ConfigureAwait(false);
                    }
                    catch
                    {
                        // SnowAgent Desktop may be down; the next heartbeat will retry.
                    }
                }
            }
        }

        private async Task PostRegisterAsync(VsRegisterPayload payload)
        {
            var json = JsonUtil.Serialize(payload);
            using (var content = new StringContent(json, Encoding.UTF8, "application/json"))
            {
                using (var response = await httpClient.PostAsync(desktopBaseUrl + "/register_vs_instance", content).ConfigureAwait(false))
                {
                    response.EnsureSuccessStatusCode();
                }
            }
        }

        public void Dispose()
        {
            heartbeatTimer?.Dispose();
            httpClient.Dispose();
        }
    }
}
