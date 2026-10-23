/**
 * The matrix ontology follows the first-party namespace rule
 * (`https://linked.cm/ont/{slug}/`), ships its terms as Turtle, and the package's shapes agree
 * with that data under the shape check `linked build` runs.
 */
import { describe, expect, it } from 'vitest';
import { Prefix } from '@_linked/core/utils/Prefix';
import { definedTermsFromTurtle } from '@_linked/core/ontology/hierarchy';
import { checkShapeHierarchy } from '@_linked/core/shapes/checkShapeHierarchy';
import { getAllNodeShapes, getTargetClassId } from '@_linked/core/utils/ShapeClass';
import * as mx from '../src/ontologies/matrix.js';
import '../src/ontologies/matrix.register.js';
import '../src/shapes/index.js';
import { packageName } from '../src/package.js';

const NAMESPACE = 'https://linked.cm/ont/matrix/';
const termIris = Object.values(mx)
  .filter((v): v is { id: string } => !!v && typeof (v as { id?: unknown }).id === 'string')
  .map((v) => v.id)
  .filter((iri) => iri.startsWith(NAMESPACE));

describe('matrix ontology', () => {
  it('mints terms under https://linked.cm/ont/matrix/ and keeps the old namespace as an alias', () => {
    expect(mx._self.id).toBe(NAMESPACE);
    expect(mx.MatrixRoomBinding.id).toBe(`${NAMESPACE}MatrixRoomBinding`);
    expect(mx.roomId.id).toBe(`${NAMESPACE}roomId`);
    expect(mx.legacyNs('MatrixRoomBinding').id).toBe('https://id.linked.cm/matrix/MatrixRoomBinding');
  });

  it('registers the package slug as the prefix', () => {
    expect(Prefix.getFullURI('matrix')).toBe(NAMESPACE);
  });

  it('defines every exported term and every class a shape targets in its Turtle data', async () => {
    const defined = await definedTermsFromTurtle(await mx.loadData());
    const targets = [...getAllNodeShapes().values()]
      .map((shape) => getTargetClassId(shape))
      .filter((iri): iri is string => !!iri && iri.startsWith(NAMESPACE));
    expect(targets.length).toBeGreaterThan(0);
    expect([...termIris, ...targets].filter((iri) => !defined.has(iri))).toEqual([]);
  });

  it('passes the shape check', async () => {
    const findings = await checkShapeHierarchy({
      dependencies: { [packageName]: ['@_linked/core', '@_linked/xsd', '@linked.cm/messaging'] },
    });
    expect(
      findings
        .filter((f) => f.shape?.includes('/shape/matrix/'))
        .map((f) => `${f.severity} ${f.kind}: ${f.message}`)
    ).toEqual([]);
  });
});
