// Validation rules for exporting an engine project back to a real jBPM kjar / BPMN 2.0 project.
// If the process or project contains constructs, languages, or features that a standard jBPM / KIE runtime
// cannot execute or compile (such as JavaScript code, raw fallback nodes, or unsupported features),
// the export is denied with an explicit, detailed diagnostic report.
import type { EngineProject, EngineNode, EngineFlow, EngineProcess } from '../../sdk/index.ts';
import { NODE_DEF_BY_TYPE } from '../../engine/nodes/index.ts';
import { validateJavaSupport } from '../../engine/java-compat.ts';

export type JbpmExportIssueKind = 'unsupported_code' | 'unsupported_node' | 'unsupported_feature';

export interface JbpmExportIssue {
  processId: string;
  processName?: string;
  nodeId?: string;
  nodeName?: string;
  flowId?: string;
  kind: JbpmExportIssueKind;
  rule: string;
  message: string;
  remedy?: string;
}

export interface JbpmExportValidationResult {
  valid: boolean;
  issues: JbpmExportIssue[];
}

const isJs = (lang?: string) => !lang || lang === 'js' || lang === 'javascript' || lang === 'ecmascript';

export function validateJbpmExport(engine: EngineProject): JbpmExportValidationResult {
  const issues: JbpmExportIssue[] = [];
  const processes = engine.processes || [];

  if (processes.length === 0) {
    issues.push({
      processId: (engine as any).id || 'project',
      kind: 'unsupported_feature',
      rule: 'no-processes',
      message: 'Project contains no processes to export.',
      remedy: 'Add at least one process to the project before exporting.',
    });
    return { valid: false, issues };
  }

  for (const p of processes) {
    const pLabel = p.name || p.id;
    const nodes = p.nodes || [];
    const flows = p.flows || [];
    const byId = new Map(nodes.map((n) => [n.id!, n]));

    // 1. Process must have at least one Start Event
    const starts = nodes.filter((n) => n.type === 'start');
    if (starts.length === 0) {
      issues.push({
        processId: p.id,
        processName: pLabel,
        kind: 'unsupported_feature',
        rule: 'missing-start-event',
        message: `Process "${pLabel}" has no Start Event. Real jBPM requires every executable process to have a Start Event.`,
        remedy: 'Add a Start Event to initiate process execution.',
      });
    }

    // 2. Process must have at least one End Event
    const ends = nodes.filter((n) => n.type === 'end');
    if (ends.length === 0) {
      issues.push({
        processId: p.id,
        processName: pLabel,
        kind: 'unsupported_feature',
        rule: 'missing-end-event',
        message: `Process "${pLabel}" has no End Event. Real jBPM requires every process execution path to terminate at an End Event.`,
        remedy: 'Add an End Event to terminate process execution.',
      });
    }

    // Recursive node inspector
    const inspectNode = (n: EngineNode) => {
      const nLabel = n.name || n.id || n.type;

      // 3. Check for unsupported/unrecognized node types
      if (n.type === 'raw') {
        issues.push({
          processId: p.id,
          processName: pLabel,
          nodeId: n.id,
          nodeName: nLabel,
          kind: 'unsupported_node',
          rule: 'unsupported-raw-node',
          message: `Node "${nLabel}" is an unmodeled raw construct (bpmnLocal: "${(n as any).bpmnLocal || 'unknown'}"). jBPM cannot represent or execute unparsed opaque blobs.`,
          remedy: 'Replace this raw node with a standard BPMN 2.0 activity or gateway.',
        });
      } else if (!NODE_DEF_BY_TYPE[n.type]) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          nodeId: n.id,
          nodeName: nLabel,
          kind: 'unsupported_node',
          rule: 'unrecognized-node-type',
          message: `Node "${nLabel}" uses engine type "${n.type}" which is not a recognized BPMN 2.0 / jBPM element.`,
          remedy: 'Use a standard jBPM node type (e.g. Script, User Task, Service Task, Gateway).',
        });
      }

      // 4. Script tasks: jBPM requires Java (or MVEL) dialect; JavaScript is NOT supported in real jBPM
      if (n.type === 'script') {
        const lang = (n as any).lang;
        if (isJs(lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: 'unsupported_code',
            rule: 'script-lang-javascript',
            message: `Script task "${nLabel}" is written in JavaScript (lang: "${lang || 'js'}"). Real jBPM only supports Java or MVEL dialects.`,
            remedy: 'Rewrite the script in Java dialect and set lang to "java", or run this process in the Node.js engine.',
          });
        } else if (lang === 'java' && (n as any).code) {
          const res = validateJavaSupport(String((n as any).code));
          if (res.errors.length > 0) {
            issues.push({
              processId: p.id,
              processName: pLabel,
              nodeId: n.id,
              nodeName: nLabel,
              kind: 'unsupported_code',
              rule: 'java-safety-violation',
              message: `Java script in "${nLabel}" contains forbidden construct: ${res.errors.join('; ')}`,
              remedy: 'Remove the forbidden construct to ensure compatibility with jBPM execution.',
            });
          }
        }
      }

      // 5. onEntry lifecycle actions
      if ((n as any).onEntry) {
        const lang = (n as any).onEntryLang;
        if (isJs(lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: 'unsupported_code',
            rule: 'on-entry-lang-javascript',
            message: `Node "${nLabel}" has an onEntry action script written in JavaScript. jBPM requires Java dialect for lifecycle actions.`,
            remedy: 'Rewrite the onEntry script in Java and set onEntryLang to "java".',
          });
        }
      }

      // 6. onExit lifecycle actions
      if ((n as any).onExit) {
        const lang = (n as any).onExitLang;
        if (isJs(lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: 'unsupported_code',
            rule: 'on-exit-lang-javascript',
            message: `Node "${nLabel}" has an onExit action script written in JavaScript. jBPM requires Java dialect for lifecycle actions.`,
            remedy: 'Rewrite the onExit script in Java and set onExitLang to "java".',
          });
        }
      }

      // 7. HTTP tasks with JavaScript payload handling
      if (n.type === 'http') {
        const a = n as any;
        if (isJs(a.lang)) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: 'unsupported_code',
            rule: 'http-lang-javascript',
            message: `Service task "${nLabel}" uses JavaScript payload mapping, which is not supported in jBPM.`,
            remedy: 'Configure the service task to use Java/Jackson mapping, or use a jBPM Rest WorkItemHandler.',
          });
        }
      }

      // 8. Work items
      if (n.type === 'workItem' && !(n as any).handler) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          nodeId: n.id,
          nodeName: nLabel,
          kind: 'unsupported_feature',
          rule: 'workitem-missing-handler',
          message: `Work item "${nLabel}" has no handler specified. jBPM requires a WorkItemHandler definition.`,
          remedy: 'Specify the registered jBPM WorkItemHandler name in the task properties.',
        });
      }

      // 9. Business rule tasks
      if (n.type === 'rule') {
        const a = n as any;
        if (!a.ruleflowGroup && !a.dmn && !a.decisionTree && !a.scorecard) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: 'unsupported_feature',
            rule: 'rule-missing-target',
            message: `Business rule task "${nLabel}" references no ruleflow group or decision asset.`,
            remedy: 'Specify a ruleflow-group name or bind a DMN decision model.',
          });
        }
      }

      // 10. Multi-instance tasks
      if (n.type === 'forEach') {
        const a = n as any;
        if (!a.process || !a.over) {
          issues.push({
            processId: p.id,
            processName: pLabel,
            nodeId: n.id,
            nodeName: nLabel,
            kind: 'unsupported_feature',
            rule: 'multi-instance-missing-config',
            message: `Multi-instance activity "${nLabel}" is missing target process or collection expression.`,
            remedy: 'Specify the called process and collection variable in properties.',
          });
        }
      }

      // Recurse into embedded subprocesses
      if (n.type === 'subprocess' && Array.isArray((n as any).nodes)) {
        for (const subNode of (n as any).nodes) {
          inspectNode(subNode);
        }
      }
    };

    for (const n of nodes) {
      inspectNode(n);
    }

    // 11. Sequence flow conditions
    for (const f of flows) {
      if (f.when) {
        const lang = f.lang;
        if (isJs(lang)) {
          const flowLabel = f.id || `${f.from} -> ${f.to}`;
          issues.push({
            processId: p.id,
            processName: pLabel,
            flowId: f.id,
            kind: 'unsupported_code',
            rule: 'condition-lang-javascript',
            message: `Sequence flow "${flowLabel}" uses a JavaScript condition expression. Real jBPM requires Java or MVEL dialect.`,
            remedy: 'Rewrite the condition expression in Java dialect (e.g. return amount > 1000;) and set condition language to "java".',
          });
        }
      }

      // 12. Broken flow endpoints
      if (!byId.has(f.from)) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          flowId: f.id,
          kind: 'unsupported_feature',
          rule: 'flow-broken-from',
          message: `Sequence flow "${f.id || 'unnamed'}" source node "${f.from}" does not exist.`,
          remedy: 'Connect the sequence flow to a valid existing node.',
        });
      }
      if (!byId.has(f.to)) {
        issues.push({
          processId: p.id,
          processName: pLabel,
          flowId: f.id,
          kind: 'unsupported_feature',
          rule: 'flow-broken-to',
          message: `Sequence flow "${f.id || 'unnamed'}" target node "${f.to}" does not exist.`,
          remedy: 'Connect the sequence flow to a valid existing node.',
        });
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
