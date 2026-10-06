import { Shape } from '@_linked/core/shapes/Shape';
import { literalProperty, objectProperty } from '@_linked/core/shapes/SHACL';
import * as mx from '../ontologies/matrix.js';
import { linkedShape } from '../package.js';

// Subject ↔ MXID mirror. The MXID is a one-way hash of the WebID, so reverse
// resolution (which safety audits need: room member → subject → policy band)
// is impossible without this graph record. Written at session issuance; carries
// no PII beyond the already-addressable subject IRI.
@linkedShape({
  description:
    'Mirror of a subject’s derived Matrix identity. Enables MXID→subject reverse lookup for ' +
    'safety audits and membership enforcement. (matrix id, chat identity)',
})
export class MatrixIdentityShape extends Shape {
  static targetClass = mx.MatrixIdentity;

  @objectProperty({
    path: mx.forSubject,
    required: true,
    maxCount: 1,
    order: 1,
    group: 'identity',
    name: 'Subject',
    description: 'The subject this Matrix identity belongs to.',
  })
  get forSubject(): string {
    return '';
  }

  @literalProperty({
    path: mx.mxid,
    required: true,
    maxCount: 1,
    order: 2,
    group: 'identity',
    name: 'MXID',
    description: 'Derived opaque Matrix user id (@p_…:<server name>).',
  })
  get mxid(): string {
    return '';
  }
}
