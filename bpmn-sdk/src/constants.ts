// Controlled vocabulary + fixed strings — mirrors docs/bpm-nodes/_mappings-reference.md.

export const DEFINITIONS_ATTRS =
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.omg.org/bpmn20" ' +
  'xmlns:bpmn2="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" ' +
  'xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" ' +
  'xmlns:di="http://www.omg.org/spec/DD/20100524/DI" ' +
  'xmlns:drools="http://www.jboss.org/drools" ' +
  'xsi:schemaLocation="http://www.omg.org/spec/BPMN/20100524/MODEL BPMN20.xsd ' +
  'http://www.jboss.org/drools drools.xsd ' +
  'http://www.omg.org/spec/DD/20100524/DC DC.xsd ' +
  'http://www.omg.org/spec/DD/20100524/DI DI.xsd " ' +
  'exporter="jBPM Process Modeler" exporterVersion="2.0" targetNamespace="http://www.omg.org/bpmn20"';

export const REST_INPUTS = [
  'AcceptCharset', 'AcceptHeader', 'AuthType', 'AuthUrl', 'ConnectTimeout',
  'ContentData', 'ContentType', 'ContentTypeCharset', 'HandleResponseErrors', 'Headers',
  'Method', 'Password', 'ReadTimeout', 'ResultClass', 'Url', 'Username',
] as const;

export const JAVA = 'http://www.java.com/java';

export const ENUMS = {
  gatewayDirection: ['Unspecified', 'Converging', 'Diverging', 'Mixed'],
  processType: ['None', 'Public', 'Private'],
  method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
  scriptFormat: [JAVA, 'http://www.mvel.org/2.0'],
  eventType: ['none', 'message', 'timer', 'signal', 'error', 'escalation', 'conditional',
    'compensation', 'cancel', 'link', 'terminate', 'multiple', 'parallelMultiple'],
  workItem: ['Rest', 'WebService', 'Email', 'Log', 'Milestone', 'BusinessRuleTask', 'DecisionTask'],
  structureRef: ['String', 'Integer', 'Float', 'Boolean', 'Object', 'java.lang.String',
    'java.lang.Integer', 'java.lang.Long', 'java.lang.Float', 'java.lang.Double',
    'java.lang.Boolean', 'java.lang.Object', 'java.util.List', 'java.util.Map', 'java.util.Date'],
  fromKind: ['variable', 'constant', 'expression', 'loopItem', 'loopOutputItem'],
} as const;

export const BUILTIN_ERRORS = {
  WORK_ITEM: 'org.jbpm.bpmn2.handler.WorkItemHandlerRuntimeException',
  TERMINATE: 'TERMINATE_CASE',
} as const;
