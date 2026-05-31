using System.Runtime.Serialization;

namespace SnowAgent.VSBridge
{
    [DataContract]
    internal sealed class OpenFileRequest
    {
        [DataMember(Name = "path")]
        public string Path { get; set; }

        [DataMember(Name = "line")]
        public int Line { get; set; }

        [DataMember(Name = "column")]
        public int? Column { get; set; }
    }

    [DataContract]
    internal sealed class BridgeResponse
    {
        [DataMember(Name = "ok")]
        public bool Ok { get; set; }

        [DataMember(Name = "message")]
        public string Message { get; set; }
    }

    [DataContract]
    internal sealed class VsRegisterPayload
    {
        [DataMember(Name = "instanceId")]
        public string InstanceId { get; set; }

        [DataMember(Name = "processId")]
        public int ProcessId { get; set; }

        [DataMember(Name = "solutionPath")]
        public string SolutionPath { get; set; }

        [DataMember(Name = "endpoint")]
        public string Endpoint { get; set; }
    }

    [DataContract]
    internal sealed class HeartbeatPayload
    {
        [DataMember(Name = "instanceId")]
        public string InstanceId { get; set; }
    }
}
