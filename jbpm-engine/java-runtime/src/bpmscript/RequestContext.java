package bpmscript;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/** Everything about the calling instance/node a script/condition might read via kcontext, bundled
 *  into one object so ScriptRunner's method signatures don't balloon into a dozen positional
 *  parameters. Built once per /execute request in Server.java from the parsed JSON body. */
public final class RequestContext {
    public final String instanceId;
    public final String processId;
    public final String processName;
    public final String correlationKey;
    public final String parentInstanceId;
    public final int state;
    public final String nodeInstanceId;
    public final String nodeId;
    public final String nodeName;
    public final Map<String, String> env;
    public final List<KContext.NodeInstance> activeNodeInstances;

    public RequestContext(String instanceId, String processId, String processName, String correlationKey,
                           String parentInstanceId, int state, String nodeInstanceId, String nodeId,
                           String nodeName, Map<String, String> env, List<KContext.NodeInstance> activeNodeInstances) {
        this.instanceId = instanceId;
        this.processId = processId;
        this.processName = processName;
        this.correlationKey = correlationKey;
        this.parentInstanceId = parentInstanceId;
        this.state = state;
        this.nodeInstanceId = nodeInstanceId;
        this.nodeId = nodeId;
        this.nodeName = nodeName;
        this.env = env;
        this.activeNodeInstances = activeNodeInstances == null ? Collections.<KContext.NodeInstance>emptyList() : activeNodeInstances;
    }
}
