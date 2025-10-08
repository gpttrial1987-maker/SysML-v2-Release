import type { ElementRecord } from '../generated/types';
import {
  type BlockConnectorGraph,
  type GraphEdge,
  type GraphEndpoint,
  type GraphNode,
  type GraphPort,
  type GraphPortKind,
  type SysMLElement,
  type TextLocation,
  type TextPosition,
} from './types';

export interface BuildBlockConnectorGraphOptions {
  filter?: (record: ElementRecord) => boolean;
}

export function buildBlockConnectorGraph(
  elements: ElementRecord[],
  options: BuildBlockConnectorGraphOptions = {},
): BlockConnectorGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const featureIndex = new Map<string, GraphEndpoint>();
  const connectors: Array<{ connector: SysMLElement; parentNodeId: string }> = [];
  const processedConnectorIds = new Set<string>();
  let generatedIdCounter = 0;

  const generateId = (prefix: string): string => {
    generatedIdCounter += 1;
    return `${prefix}-${generatedIdCounter}`;
  };

  for (const record of elements) {
    if (options.filter && !options.filter(record)) {
      continue;
    }

    const payload = record.payload;
    if (!isRecord(payload) || !isBlock(payload)) {
      continue;
    }

    const elementId = getElementId(payload, record.id || generateId('block'));
    const node: GraphNode = {
      id: elementId,
      elementId,
      label: getDeclaredName(payload) ?? record.name ?? elementId,
      kind: 'block',
      documentation: getString(payload['documentation']) ?? record.documentation,
      textLocation: extractTextLocation(payload),
      ports: [],
      raw: payload,
      record,
    };

    const relationships = toArray(payload['ownedRelationship']);
    for (const relationshipRaw of relationships) {
      if (!isRecord(relationshipRaw)) {
        continue;
      }

      if (isPart(relationshipRaw) || isPort(relationshipRaw)) {
        collectFeaturePorts({
          node,
          feature: relationshipRaw,
          featureIndex,
          generateId,
        });
      } else if (isConnector(relationshipRaw)) {
        connectors.push({ connector: relationshipRaw, parentNodeId: node.id });
      }

      const members = collectRelationshipMembers(relationshipRaw);
      for (const member of members) {
        if (isPart(member) || isPort(member)) {
          collectFeaturePorts({
            node,
            feature: member,
            featureIndex,
            generateId,
          });
        } else if (isConnector(member)) {
          connectors.push({ connector: member, parentNodeId: node.id });
        }
      }
    }

    nodes.push(node);
  }

  const elementIdToNodeId = new Map(nodes.map((node) => [node.elementId, node.id]));
  for (const node of nodes) {
    for (const port of node.ports) {
      if (port.typeRef) {
        port.targetNodeId = elementIdToNodeId.get(port.typeRef);
      }
    }
  }

  for (const { connector, parentNodeId } of connectors) {
    const connectorId = getElementId(connector, generateId(`${parentNodeId}#connector`));
    if (processedConnectorIds.has(connectorId)) {
      continue;
    }
    processedConnectorIds.add(connectorId);

    const endFeatureIds = unique(collectConnectorEndFeatureIds(connector));
    if (endFeatureIds.length < 2) {
      continue;
    }

    const label = getDeclaredName(connector);
    const textLocation = extractTextLocation(connector);

    const [firstEnd, ...rest] = endFeatureIds;
    const firstEndpoint = firstEnd ? featureIndex.get(firstEnd) : undefined;
    if (!firstEndpoint) {
      continue;
    }

    rest.forEach((featureId, index) => {
      if (!featureId) {
        return;
      }
      const endpoint = featureIndex.get(featureId);
      if (!endpoint) {
        return;
      }
      const edgeId = index === 0 ? connectorId : `${connectorId}::${index}`;
      edges.push({
        id: edgeId,
        connectorId,
        label,
        source: { ...firstEndpoint },
        target: { ...endpoint },
        textLocation,
        raw: connector,
      });
    });
  }

  nodes.sort((a, b) => a.label.localeCompare(b.label));
  for (const node of nodes) {
    node.ports.sort((a, b) => a.label.localeCompare(b.label));
  }
  edges.sort((a, b) => a.id.localeCompare(b.id));

  return { nodes, edges };
}

interface CollectFeaturePortsParams {
  node: GraphNode;
  feature: SysMLElement;
  featureIndex: Map<string, GraphEndpoint>;
  generateId: (prefix: string) => string;
  context?: PortContext;
}

interface PortContext {
  parentFeatureId?: string;
  parentLabel?: string;
}

function collectFeaturePorts({
  node,
  feature,
  featureIndex,
  generateId,
  context,
}: CollectFeaturePortsParams): void {
  if (isPart(feature)) {
    const partPort = createPort({
      node,
      feature,
      kind: 'part',
      generateId,
      context,
    });
    addPort(node, partPort, featureIndex);

    const nestedRelationships = toArray(feature['ownedRelationship']);
    for (const nested of nestedRelationships) {
      if (!isRecord(nested)) {
        continue;
      }

      if (isPort(nested)) {
        collectFeaturePorts({
          node,
          feature: nested,
          featureIndex,
          generateId,
          context: {
            parentFeatureId: partPort.featureId,
            parentLabel: partPort.label,
          },
        });
      }

      const nestedMembers = collectRelationshipMembers(nested);
      for (const nestedMember of nestedMembers) {
        if (isPort(nestedMember)) {
          collectFeaturePorts({
            node,
            feature: nestedMember,
            featureIndex,
            generateId,
            context: {
              parentFeatureId: partPort.featureId,
              parentLabel: partPort.label,
            },
          });
        }
      }
    }
  } else if (isPort(feature)) {
    const port = createPort({
      node,
      feature,
      kind: 'port',
      generateId,
      context,
    });
    addPort(node, port, featureIndex);
  }
}

interface CreatePortParams {
  node: GraphNode;
  feature: SysMLElement;
  kind: GraphPortKind;
  generateId: (prefix: string) => string;
  context?: PortContext;
}

function createPort({ node, feature, kind, generateId, context }: CreatePortParams): GraphPort {
  const featureId = getElementId(feature, generateId(`${node.id}#${kind}`));
  const name = getDeclaredName(feature) ?? featureId;
  const label = context?.parentLabel ? `${context.parentLabel}.${name}` : name;
  const typeRef =
    getReferenceId(feature['type']) ??
    getReferenceId(feature['definition']) ??
    getReferenceId(feature['declaredType']) ??
    getReferenceId(feature['classifier']) ??
    getReferenceId(feature['referencedFeature']) ??
    getReferenceId(feature['referencedElement']) ??
    getReferenceId(feature['typeRef']);

  return {
    id: featureId,
    featureId,
    kind,
    label,
    typeRef,
    parentFeatureId: context?.parentFeatureId,
    textLocation: extractTextLocation(feature),
    raw: feature,
  };
}

function addPort(node: GraphNode, port: GraphPort, featureIndex: Map<string, GraphEndpoint>): void {
  if (featureIndex.has(port.featureId)) {
    return;
  }
  node.ports.push(port);
  featureIndex.set(port.featureId, {
    nodeId: node.id,
    portId: port.id,
    featureId: port.featureId,
  });
}

function collectRelationshipMembers(relationship: SysMLElement): SysMLElement[] {
  const keys = [
    'ownedMember',
    'member',
    'ownedRelatedElement',
    'relatedElement',
    'ownedEnd',
    'ownedParticipant',
    'participant',
    'ownedConnectorEnd',
    'ownedMemberEnd',
    'ownedFeature',
    'feature',
  ];

  const members: SysMLElement[] = [];
  for (const key of keys) {
    const value = relationship[key];
    if (value === undefined) {
      continue;
    }
    for (const candidate of flattenElements(value)) {
      members.push(candidate);
    }
  }
  return members;
}

function collectConnectorEndFeatureIds(connector: SysMLElement): Array<string | undefined> {
  const featureIds: Array<string | undefined> = [];

  const relationships = toArray(connector['ownedRelationship']);
  for (const relationship of relationships) {
    if (!isRecord(relationship)) {
      continue;
    }

    if (isConnectorEnd(relationship)) {
      featureIds.push(getConnectorEndFeatureId(relationship));
    }

    const members = collectRelationshipMembers(relationship);
    for (const member of members) {
      if (isConnectorEnd(member)) {
        featureIds.push(getConnectorEndFeatureId(member));
      }
    }
  }

  const directKeys = ['ends', 'end', 'connectorEnd', 'ownedEnd', 'ownedConnectorEnd'];
  for (const key of directKeys) {
    const value = connector[key];
    if (value === undefined) {
      continue;
    }
    for (const candidate of flattenElements(value)) {
      if (isConnectorEnd(candidate)) {
        featureIds.push(getConnectorEndFeatureId(candidate));
      }
    }
  }

  return featureIds;
}

function getConnectorEndFeatureId(end: SysMLElement): string | undefined {
  const candidates = [
    end['connectedFeature'],
    end['memberEnd'],
    end['feature'],
    end['role'],
    end['target'],
    end['source'],
    end['participant'],
  ];

  for (const candidate of candidates) {
    const referenceId = getReferenceId(candidate);
    if (referenceId) {
      return referenceId;
    }
  }

  return undefined;
}

function getElementId(element: SysMLElement, fallback: string): string {
  return getString(element['@id']) ?? getString(element['id']) ?? fallback;
}

function getDeclaredName(element: SysMLElement): string | undefined {
  return getString(element['declaredName']) ?? getString(element['name']);
}

function getType(element: SysMLElement): string | undefined {
  const rawType = element['@type'] ?? element['type'];
  if (Array.isArray(rawType)) {
    for (const value of rawType) {
      if (typeof value === 'string') {
        return value;
      }
    }
    return undefined;
  }
  return typeof rawType === 'string' ? rawType : undefined;
}

function isBlock(element: SysMLElement): boolean {
  const type = getType(element);
  return Boolean(type && /Block(Definition|Usage)?$/i.test(type));
}

function isPart(element: SysMLElement): boolean {
  const type = getType(element);
  return Boolean(type && /Part(Definition|Usage)$/i.test(type));
}

function isPort(element: SysMLElement): boolean {
  const type = getType(element);
  return Boolean(type && /Port(Definition|Usage)$/i.test(type));
}

function isConnector(element: SysMLElement): boolean {
  const type = getType(element);
  return Boolean(type && /Connector(Definition|Usage)?$/i.test(type));
}

function isConnectorEnd(element: SysMLElement): boolean {
  const type = getType(element);
  if (type && /ConnectorEnd$/i.test(type)) {
    return true;
  }
  return (
    element['connectedFeature'] !== undefined ||
    element['memberEnd'] !== undefined ||
    element['feature'] !== undefined ||
    element['participant'] !== undefined
  );
}

function extractTextLocation(element: SysMLElement): TextLocation | undefined {
  const candidates: unknown[] = [
    element['textLocation'],
    element['sourceLocation'],
    element['source'],
    getNested(element, ['metadata', 'textLocation']),
    getNested(element, ['metadata', 'source']),
    getNested(element, ['@metadata', 'textLocation']),
    getNested(element, ['@metadata', 'source']),
  ];

  for (const candidate of candidates) {
    const location = parseTextLocation(candidate);
    if (location) {
      return location;
    }
  }

  return undefined;
}

function parseTextLocation(value: unknown): TextLocation | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const uri = getString(value['uri']) ?? getString(value['path']) ?? getString(value['source']);
  if (!uri) {
    return undefined;
  }

  const rangeValue = value['range'];
  let start: TextPosition | undefined;
  let end: TextPosition | undefined;

  if (isRecord(rangeValue)) {
    start = parseTextPosition(rangeValue['start'] ?? rangeValue['from']);
    end = parseTextPosition(rangeValue['end'] ?? rangeValue['to']);
  }

  if (!start) {
    start = parseTextPosition(value['start']);
  }
  if (!end) {
    end = parseTextPosition(value['end']);
  }

  if (start && !end) {
    end = start;
  }
  if (end && !start) {
    start = end;
  }

  const range = start && end ? { start, end } : undefined;
  return { uri, range };
}

function parseTextPosition(value: unknown): TextPosition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const line = getNumber(value['line']);
  const column = getNumber(value['column']);
  if (line === undefined || column === undefined) {
    return undefined;
  }
  const offset = getNumber(value['offset']);
  return offset === undefined ? { line, column } : { line, column, offset };
}

function getNested(element: SysMLElement, path: string[]): unknown {
  let current: unknown = element;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

function getReferenceId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const result = getReferenceId(candidate);
      if (result) {
        return result;
      }
    }
    return undefined;
  }
  if (isRecord(value)) {
    return (
      getString(value['@id']) ??
      getString(value['id']) ??
      getReferenceId(value['element']) ??
      getReferenceId(value['referencedElement']) ??
      getReferenceId(value['feature']) ??
      getReferenceId(value['value']) ??
      getReferenceId(value['type'])
    );
  }
  return undefined;
}

function unique<T>(values: T[]): T[] {
  const seen = new Set<T>();
  const result: T[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

function flattenElements(value: unknown): SysMLElement[] {
  return toArray(value).filter(isRecord);
}

function toArray<T>(value: T | T[] | undefined): T[];
function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === undefined || value === null) {
    return [];
  }
  return [value];
}

function isRecord(value: unknown): value is SysMLElement {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
