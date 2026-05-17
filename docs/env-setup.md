# Environment Setup & Variable Configuration Guide

This guide describes how to configure the `INTEGRATION_LAYER_URL` environment parameter for the Prudential Claims jBPM Processes (`prudential-claims-bpm`). 

---

## 1. Overview
The jBPM process operates inside a Red Hat Decision Manager (RHDM) / jBPM KIE Server container. To execute downstream actions (e.g. validating policies, checking documents, finalizing payments), the process communicates with the **Neutrinos Integration Layer** via REST service tasks.

The integration layer's base URL is resolved at process startup via a system property called `INTEGRATION_LAYER_URL`.

---

## 2. Configuration Methods

### Method A: JVM System Property (Highly Recommended)
This is the standard and cleanest way to supply the integration layer's location to the container without modifying the BPMN definitions.

#### 1. Command Line / Startup Script
Pass the property during the start script of your application server (WildFly, JBoss EAP, WebSphere, WebLogic):

```bash
# For WildFly / JBoss EAP (standalone.sh)
./standalone.sh -c standalone-full.xml -DINTEGRATION_LAYER_URL=http://claims-integration-dev.prudential.com:3000
```

#### 2. Windows Service (standalone.conf.bat)
Append the property to the JVM options:
```cmd
set "JAVA_OPTS=%JAVA_OPTS% -DINTEGRATION_LAYER_URL=http://claims-integration-dev.prudential.com:3000"
```

#### 3. Red Hat OpenShift / Kubernetes
Add the environment variable to your KIE Server container deployment spec under `JAVA_OPTS_APPEND`:

```yaml
env:
  - name: JAVA_OPTS_APPEND
    value: "-DINTEGRATION_LAYER_URL=http://claims-integration-dev.prudential.com:3000"
```

---

### Method B: Standalone.xml / Server Configuration File
Instead of command-line flags, you can embed the property directly into your server's XML configuration.

For **WildFly / JBoss EAP** (`standalone.xml` or `standalone-full.xml`), add the following element inside the `<server>` root block (typically before `<extensions>`):

```xml
<system-properties>
    <property name="INTEGRATION_LAYER_URL" value="http://claims-integration-dev.prudential.com:3000"/>
</system-properties>
```

---

### Method C: Custom Fallback / Local Development (BPMN Level)
If no JVM System Property is present on the host, the process automatically bootstraps itself with a default fallback configured in the process's **Initialize Environment** (`Script_Bootstrap`) script task.

```java
// From pru-claim-internal-processing.bpmn (Initialize Environment)
String url = System.getProperty("INTEGRATION_LAYER_URL");
if (url == null || url.isEmpty()) {
    url = "http://localhost:3000"; // Local Dev Fallback
}
kcontext.setVariable("baseUrl", url);
System.out.println("Claim Journey Started. Environment Base URL: " + url);
```

To change the local default fallback, open the BPMN diagram in the KIE Workbench / Business Central editor, select the **Initialize Environment** Script Task, and modify the fallback string.

---

## 3. Verifying the Configuration
When a claims journey is triggered, the process logs the resolved URL to the server output:

```text
Claim Journey Started. Environment Base URL: http://claims-integration-dev.prudential.com:3000
```

If you see `http://localhost:3000` in your server logs instead of your intended environment host, ensure the `-DINTEGRATION_LAYER_URL` flag is properly parsed by your JVM runtime.
