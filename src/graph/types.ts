import type { ElementRecord } from '../generated/types';

export type SysMLElement = Record<string, unknown>;

export interface TextPosition {
  line: number;
  column: number;
  offset?: number;
}

export interface TextRange {
  start: TextPosition;
  end: TextPosition;
}

export interface TextLocation {
  uri: string;
  range?: TextRange;
}

export type GraphPortKind = 'part' | 'port';

export interface GraphPort {
  id: string;
  featureId: string;
  label: string;
  kind: GraphPortKind;
  typeRef?: string;
  targetNodeId?: string;
  parentFeatureId?: string;
  textLocation?: TextLocation;
  raw: SysMLElement;
}

export interface GraphNode {
  id: string;
  elementId: string;
  label: string;
  kind: 'block';
  documentation?: string;
  textLocation?: TextLocation;
  ports: GraphPort[];
  raw: SysMLElement;
  record: ElementRecord;
}

export interface GraphEndpoint {
  nodeId: string;
  portId: string;
  featureId: string;
}

export interface GraphEdge {
  id: string;
  connectorId: string;
  label?: string;
  source: GraphEndpoint;
  target: GraphEndpoint;
  textLocation?: TextLocation;
  raw: SysMLElement;
}

export interface BlockConnectorGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface LayoutSize {
  width: number;
  height: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutLabel extends LayoutSize, LayoutPoint {
  text: string;
}

export interface LayoutPort extends LayoutSize, LayoutPoint {
  side?: string;
}

export interface LayoutNode extends LayoutSize, LayoutPoint {
  labels: LayoutLabel[];
  ports: Record<string, LayoutPort>;
}

export interface LayoutSection {
  startPoint: LayoutPoint;
  endPoint: LayoutPoint;
  bendPoints: LayoutPoint[];
}

export interface LayoutEdge {
  sections: LayoutSection[];
  labels: LayoutLabel[];
}

export interface GraphLayout {
  nodes: Record<string, LayoutNode>;
  edges: Record<string, LayoutEdge>;
}

export interface LayoutSpacing {
  nodeNode?: number;
  edgeEdge?: number;
  nodeNodeBetweenLayers?: number;
}

export interface LayoutConfig {
  direction?: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
  nodeSize?: LayoutSize;
  portSize?: LayoutSize;
  spacing?: LayoutSpacing;
  layoutOptions?: Record<string, string>;
}
