import type { NodeInput, NodeOutput } from '../types/node.js';
import { arePinTypesCompatible } from './edge.js';
import type { WorkflowGraph } from './graph.js';
import { hasCycle } from './topo.js';

export interface GraphValidationIssue {
  code:
    | 'missing_node'
    | 'missing_output'
    | 'missing_input'
    | 'type_mismatch'
    | 'duplicate_input'
    | 'required_input'
    | 'cycle';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export function validateWorkflowGraph(graph: WorkflowGraph): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const connectedInputs = new Set<string>();

  for (const edge of graph.edges) {
    const source = graph.nodes.get(edge.sourceNodeId);
    const target = graph.nodes.get(edge.targetNodeId);
    if (!source) {
      issues.push({
        code: 'missing_node',
        edgeId: edge.id,
        message: `Edge ${edge.id} references missing source node ${edge.sourceNodeId}.`,
      });
      continue;
    }
    if (!target) {
      issues.push({
        code: 'missing_node',
        edgeId: edge.id,
        message: `Edge ${edge.id} references missing target node ${edge.targetNodeId}.`,
      });
      continue;
    }

    const output = source.outputs[edge.sourceOutput] as NodeOutput | undefined;
    const input = target.inputs[edge.targetInput] as NodeInput | undefined;
    if (!output) {
      issues.push({
        code: 'missing_output',
        edgeId: edge.id,
        nodeId: edge.sourceNodeId,
        message: `Output ${edge.sourceNodeId}.${edge.sourceOutput} does not exist.`,
      });
      continue;
    }
    if (!input) {
      issues.push({
        code: 'missing_input',
        edgeId: edge.id,
        nodeId: edge.targetNodeId,
        message: `Input ${edge.targetNodeId}.${edge.targetInput} does not exist.`,
      });
      continue;
    }
    if (!arePinTypesCompatible(output.type, input.type)) {
      issues.push({
        code: 'type_mismatch',
        edgeId: edge.id,
        nodeId: edge.targetNodeId,
        message: `Type mismatch: ${output.type} → ${input.type} on edge ${edge.id}.`,
      });
    }

    const inputKey = `${edge.targetNodeId}:${edge.targetInput}`;
    if (connectedInputs.has(inputKey)) {
      issues.push({
        code: 'duplicate_input',
        edgeId: edge.id,
        nodeId: edge.targetNodeId,
        message: `Input ${edge.targetNodeId}.${edge.targetInput} has multiple incoming edges.`,
      });
    }
    connectedInputs.add(inputKey);
  }

  for (const [nodeId, node] of graph.nodes) {
    for (const [inputName, input] of Object.entries(node.inputs)) {
      if (!input.optional && !connectedInputs.has(`${nodeId}:${inputName}`)) {
        issues.push({
          code: 'required_input',
          nodeId,
          message: `Required input ${node.displayName}.${inputName} is not connected.`,
        });
      }
    }
  }

  if (hasCycle(graph)) {
    issues.push({
      code: 'cycle',
      message: 'Workflow graph contains a cycle.',
    });
  }

  return issues;
}

export function assertValidWorkflowGraph(graph: WorkflowGraph): void {
  const issues = validateWorkflowGraph(graph);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow graph: ${issues.map(issue => issue.message).join(' ')}`);
  }
}

export function assertWorkflowGraphStructure(graph: WorkflowGraph): void {
  const issues = validateWorkflowGraph(graph).filter(
    issue => issue.code !== 'required_input',
  );
  if (issues.length > 0) {
    throw new Error(`Invalid workflow graph: ${issues.map(issue => issue.message).join(' ')}`);
  }
}
