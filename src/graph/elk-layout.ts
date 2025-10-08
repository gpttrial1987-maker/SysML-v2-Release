import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkLabel, ElkNode, ElkPoint, ElkPort } from 'elkjs';
import type {
  BlockConnectorGraph,
  GraphPort,
  GraphLayout,
  LayoutConfig,
  LayoutEdge,
  LayoutLabel,
  LayoutNode,
  LayoutPoint,
  LayoutPort,
} from './types';

const DEFAULT_NODE_SIZE = { width: 220, height: 140 } as const;
const DEFAULT_PORT_SIZE = { width: 16, height: 16 } as const;
const DEFAULT_SPACING = {
  nodeNode: 80,
  edgeEdge: 40,
  nodeNodeBetweenLayers: 100,
} as const;

export async function layoutBlockConnectorGraph(
  graph: BlockConnectorGraph,
  config: LayoutConfig = {},
): Promise<GraphLayout> {
  const elk = new ELK();

  const nodeSize = config.nodeSize ?? DEFAULT_NODE_SIZE;
  const portSize = config.portSize ?? DEFAULT_PORT_SIZE;
  const spacing = {
    nodeNode: config.spacing?.nodeNode ?? DEFAULT_SPACING.nodeNode,
    edgeEdge: config.spacing?.edgeEdge ?? DEFAULT_SPACING.edgeEdge,
    nodeNodeBetweenLayers:
      config.spacing?.nodeNodeBetweenLayers ?? DEFAULT_SPACING.nodeNodeBetweenLayers,
  };
  const direction = config.direction ?? 'RIGHT';

  const elkGraph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction,
      'elk.portConstraints': 'FIXED_SIDE',
      'elk.spacing.nodeNode': spacing.nodeNode.toString(),
      'elk.spacing.edgeEdge': spacing.edgeEdge.toString(),
      'elk.spacing.nodeNodeBetweenLayers': spacing.nodeNodeBetweenLayers.toString(),
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
      ...config.layoutOptions,
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: nodeSize.width,
      height: nodeSize.height,
      layoutOptions: {
        portConstraints: 'FIXED_SIDE',
      },
      labels: node.label
        ? [
            {
              id: `${node.id}::label`,
              text: node.label,
            },
          ]
        : undefined,
      ports: node.ports.map((port) => ({
        id: port.id,
        width: portSize.width,
        height: portSize.height,
        properties: {
          'port.side': resolvePortSide(port.parentFeatureId, port.kind),
        },
        labels: port.label
          ? [
              {
                id: `${port.id}::label`,
                text: port.label,
              },
            ]
          : undefined,
      })),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [`${edge.source.nodeId}/${edge.source.portId}`],
      targets: [`${edge.target.nodeId}/${edge.target.portId}`],
      labels: edge.label
        ? [
            {
              id: `${edge.id}::label`,
              text: edge.label,
            },
          ]
        : undefined,
    })),
  };

  const layout = await elk.layout(elkGraph);
  return convertLayout(layout);
}

function resolvePortSide(parentFeatureId: string | undefined, kind: GraphPort['kind']): string {
  if (parentFeatureId) {
    return 'SOUTH';
  }
  return kind === 'part' ? 'WEST' : 'EAST';
}

function convertLayout(root: ElkNode): GraphLayout {
  const nodes: Record<string, LayoutNode> = {};
  for (const child of root.children ?? []) {
    collectNodeLayouts(child, nodes);
  }

  const edges: Record<string, LayoutEdge> = {};
  for (const edge of root.edges ?? []) {
    edges[edge.id] = convertEdge(edge);
  }

  return { nodes, edges };
}

function collectNodeLayouts(node: ElkNode, target: Record<string, LayoutNode>): void {
  const labels = (node.labels ?? []).map(convertLabel);
  const ports: Record<string, LayoutPort> = {};
  for (const port of node.ports ?? []) {
    ports[port.id] = convertPort(port, node);
  }

  target[node.id] = {
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width ?? 0,
    height: node.height ?? 0,
    labels,
    ports,
  };

  for (const child of node.children ?? []) {
    collectNodeLayouts(child, target);
  }
}

function convertLabel(label: ElkLabel): LayoutLabel {
  return {
    x: label.x ?? 0,
    y: label.y ?? 0,
    width: label.width ?? 0,
    height: label.height ?? 0,
    text: label.text ?? '',
  };
}

function convertPort(port: ElkPort, parent: ElkNode): LayoutPort {
  const parentX = parent.x ?? 0;
  const parentY = parent.y ?? 0;
  const side = (port.properties?.['port.side'] as string | undefined) ?? undefined;
  return {
    x: (port.x ?? 0) - parentX,
    y: (port.y ?? 0) - parentY,
    width: port.width ?? 0,
    height: port.height ?? 0,
    side,
  };
}

function convertEdge(edge: ElkExtendedEdge): LayoutEdge {
  const sections = (edge.sections ?? []).map((section) => ({
    startPoint: convertPoint(section.startPoint),
    endPoint: convertPoint(section.endPoint),
    bendPoints: (section.bendPoints ?? []).map(convertPoint),
  }));

  const labels = (edge.labels ?? []).map(convertLabel);

  return { sections, labels };
}

function convertPoint(point: ElkPoint | undefined): LayoutPoint {
  if (!point) {
    return { x: 0, y: 0 };
  }
  return { x: point.x ?? 0, y: point.y ?? 0 };
}
