import { describe, expect, it } from 'vitest';
import { buildBlockConnectorGraph, layoutBlockConnectorGraph } from '../../src/graph';
import type { ElementRecord } from '../../src/generated/types';

const PROJECT_ID = 'project-1';
const COMMIT_ID = 'commit-1';

function textLocation(uri: string, startLine: number, startColumn: number, endLine: number, endColumn: number) {
  return {
    uri,
    range: {
      start: { line: startLine, column: startColumn },
      end: { line: endLine, column: endColumn },
    },
  } as const;
}

const wheelBlock: ElementRecord = {
  id: 'element-wheel',
  projectId: PROJECT_ID,
  commitId: COMMIT_ID,
  classifierId: 'sysml:BlockDefinition',
  name: 'Wheel',
  documentation: 'Wheel block definition',
  payload: {
    '@id': 'block.wheel',
    '@type': 'BlockDefinition',
    declaredName: 'Wheel',
    textLocation: textLocation('Wheel.sysml', 1, 1, 6, 1),
    ownedRelationship: [
      {
        '@id': 'block.wheel.rel.port.axle',
        '@type': 'FeatureMembership',
        ownedMember: {
          '@id': 'block.wheel.port.axle',
          '@type': 'PortUsage',
          declaredName: 'axle',
          direction: 'out',
          textLocation: textLocation('Wheel.sysml', 2, 3, 2, 20),
        },
      },
    ],
  },
};

const vehicleBlock: ElementRecord = {
  id: 'element-vehicle',
  projectId: PROJECT_ID,
  commitId: COMMIT_ID,
  classifierId: 'sysml:BlockDefinition',
  name: 'Vehicle',
  documentation: 'Vehicle block definition',
  payload: {
    '@id': 'block.vehicle',
    '@type': 'BlockDefinition',
    declaredName: 'Vehicle',
    textLocation: textLocation('Vehicle.sysml', 1, 1, 12, 1),
    ownedRelationship: [
      {
        '@id': 'block.vehicle.rel.part.frontWheel',
        '@type': 'FeatureMembership',
        ownedMember: {
          '@id': 'block.vehicle.part.frontWheel',
          '@type': 'PartUsage',
          declaredName: 'frontWheel',
          textLocation: textLocation('Vehicle.sysml', 3, 3, 3, 30),
          type: {
            '@id': 'block.wheel',
          },
          ownedRelationship: [
            {
              '@id': 'block.vehicle.part.frontWheel.rel.port.axle',
              '@type': 'FeatureMembership',
              ownedMember: {
                '@id': 'block.vehicle.part.frontWheel.port.axle',
                '@type': 'PortUsage',
                declaredName: 'axle',
                direction: 'out',
                textLocation: textLocation('Vehicle.sysml', 4, 5, 4, 35),
                referencedFeature: {
                  '@id': 'block.wheel.port.axle',
                },
              },
            },
          ],
        },
      },
      {
        '@id': 'block.vehicle.rel.port.axleInterface',
        '@type': 'FeatureMembership',
        ownedMember: {
          '@id': 'block.vehicle.port.axleInterface',
          '@type': 'PortUsage',
          declaredName: 'axleInterface',
          direction: 'in',
          textLocation: textLocation('Vehicle.sysml', 5, 3, 5, 36),
        },
      },
      {
        '@id': 'block.vehicle.rel.connector.axleLink',
        '@type': 'ConnectorMembership',
        ownedMember: {
          '@id': 'block.vehicle.connector.axleLink',
          '@type': 'ConnectorUsage',
          declaredName: 'axleLink',
          textLocation: textLocation('Vehicle.sysml', 7, 3, 9, 18),
          ownedRelationship: [
            {
              '@id': 'block.vehicle.connector.axleLink.rel.end.interface',
              '@type': 'ConnectorEndMembership',
              ownedMember: {
                '@id': 'block.vehicle.connector.axleLink.end.interface',
                '@type': 'ConnectorEnd',
                connectedFeature: {
                  '@id': 'block.vehicle.port.axleInterface',
                },
              },
            },
            {
              '@id': 'block.vehicle.connector.axleLink.rel.end.frontWheel',
              '@type': 'ConnectorEndMembership',
              ownedMember: {
                '@id': 'block.vehicle.connector.axleLink.end.frontWheel',
                '@type': 'ConnectorEnd',
                connectedFeature: {
                  '@id': 'block.vehicle.part.frontWheel.port.axle',
                },
              },
            },
          ],
        },
      },
    ],
  },
};

const elements: ElementRecord[] = [vehicleBlock, wheelBlock];

describe('buildBlockConnectorGraph', () => {
  it('creates nodes, ports, and edges from SysML API payloads', () => {
    const graph = buildBlockConnectorGraph(elements);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);

    const vehicleNode = graph.nodes.find((node) => node.elementId === 'block.vehicle');
    const wheelNode = graph.nodes.find((node) => node.elementId === 'block.wheel');
    expect(vehicleNode).toBeDefined();
    expect(wheelNode).toBeDefined();
    if (!vehicleNode || !wheelNode) {
      throw new Error('Expected nodes to be defined');
    }

    expect(vehicleNode.textLocation).toEqual(textLocation('Vehicle.sysml', 1, 1, 12, 1));
    expect(wheelNode.textLocation).toEqual(textLocation('Wheel.sysml', 1, 1, 6, 1));

    const partPort = vehicleNode.ports.find((port) => port.featureId === 'block.vehicle.part.frontWheel');
    expect(partPort).toBeDefined();
    expect(partPort?.kind).toBe('part');
    expect(partPort?.typeRef).toBe('block.wheel');
    expect(partPort?.targetNodeId).toBe('block.wheel');

    const nestedPort = vehicleNode.ports.find(
      (port) => port.featureId === 'block.vehicle.part.frontWheel.port.axle',
    );
    expect(nestedPort).toBeDefined();
    expect(nestedPort?.kind).toBe('port');
    expect(nestedPort?.parentFeatureId).toBe('block.vehicle.part.frontWheel');

    const blockPort = vehicleNode.ports.find(
      (port) => port.featureId === 'block.vehicle.port.axleInterface',
    );
    expect(blockPort).toBeDefined();
    expect(blockPort?.kind).toBe('port');

    const wheelPort = wheelNode.ports.find((port) => port.featureId === 'block.wheel.port.axle');
    expect(wheelPort).toBeDefined();
    expect(wheelPort?.kind).toBe('port');

    const [edge] = graph.edges;
    expect(edge.source.nodeId).toBe(vehicleNode.id);
    expect(edge.target.nodeId).toBe(vehicleNode.id);
    expect(edge.source.portId).toBe('block.vehicle.port.axleInterface');
    expect(edge.target.portId).toBe('block.vehicle.part.frontWheel.port.axle');
    expect(edge.textLocation).toEqual(textLocation('Vehicle.sysml', 7, 3, 9, 18));
  });
});

describe('layoutBlockConnectorGraph', () => {
  it('produces ELK.js layout information for the thin graph', async () => {
    const graph = buildBlockConnectorGraph(elements);
    const layout = await layoutBlockConnectorGraph(graph, {
      direction: 'RIGHT',
    });

    const vehicleLayout = layout.nodes['block.vehicle'];
    const wheelLayout = layout.nodes['block.wheel'];
    expect(vehicleLayout).toBeDefined();
    expect(wheelLayout).toBeDefined();
    if (!vehicleLayout || !wheelLayout) {
      throw new Error('Expected layout nodes');
    }

    expect(Number.isFinite(vehicleLayout.x)).toBe(true);
    expect(Number.isFinite(vehicleLayout.y)).toBe(true);
    expect(vehicleLayout.width).toBeGreaterThan(0);
    expect(vehicleLayout.height).toBeGreaterThan(0);

    const vehiclePorts = vehicleLayout.ports;
    expect(vehiclePorts['block.vehicle.part.frontWheel']).toBeDefined();
    expect(vehiclePorts['block.vehicle.port.axleInterface']).toBeDefined();

    const edgeLayout = layout.edges[graph.edges[0].id];
    expect(edgeLayout).toBeDefined();
    expect(edgeLayout.sections.length).toBeGreaterThan(0);
    for (const section of edgeLayout.sections) {
      expect(Number.isFinite(section.startPoint.x)).toBe(true);
      expect(Number.isFinite(section.startPoint.y)).toBe(true);
      expect(Number.isFinite(section.endPoint.x)).toBe(true);
      expect(Number.isFinite(section.endPoint.y)).toBe(true);
    }
  });
});
