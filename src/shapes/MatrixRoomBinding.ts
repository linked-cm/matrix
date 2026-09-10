import { Shape } from '@_linked/core/shapes/Shape';
import { literalProperty, objectProperty } from '@_linked/core/shapes/SHACL';
import { xsd } from '@_linked/xsd/ontologies/xsd';
import * as mx from '../ontologies/matrix.js';
import { linkedShape } from '../package.js';

// Which Matrix room realizes which host entity. Written ONLY by the appservice
// when it provisions a room; the graph mirror lets the app resolve entity→room
// without asking the homeserver, and lets safety audits reconstruct a room's
// audience and tier from durable data rather than live room state.
@linkedShape({
  description:
    'Binding between a host entity (team/mission/event/conversation) and the Matrix room that ' +
    'realizes its conversation. Appservice-owned; audience/tier/encryption are stamped both here ' +
    'and in the room marker state event. (chat room, thread binding, matrix mapping)',
})
export class MatrixRoomBindingShape extends Shape {
  static targetClass = mx.MatrixRoomBinding;

  @objectProperty({
    path: mx.boundEntity,
    required: true,
    maxCount: 1,
    order: 1,
    group: 'binding',
    name: 'Bound entity',
    description: 'The host entity this room realizes.',
  })
  get boundEntity(): string {
    return '';
  }

  @literalProperty({
    path: mx.roomId,
    required: true,
    maxCount: 1,
    order: 2,
    group: 'binding',
    name: 'Matrix room id',
    description: 'Opaque Matrix room id, e.g. !abc:chat.example.org.',
  })
  get matrixRoomId(): string {
    return '';
  }

  @literalProperty({
    path: mx.channelKey,
    maxCount: 1,
    order: 3,
    group: 'binding',
    name: 'Channel key',
    description: 'Host taxonomy key for this channel within its space.',
  })
  get channelKey(): string {
    return '';
  }

  @literalProperty({
    path: mx.tier,
    required: true,
    maxCount: 1,
    order: 4,
    group: 'policy',
    name: 'Tier',
    description: 'public | team | personal — the privacy tier this room realizes.',
  })
  get tier(): string {
    return '';
  }

  @literalProperty({
    path: mx.audience,
    maxCount: 1,
    order: 5,
    group: 'policy',
    name: 'Audience',
    description: 'Host audience key — enforced as room membership by the appservice.',
  })
  get audience(): string {
    return '';
  }

  @literalProperty({
    path: mx.encrypted,
    maxCount: 1,
    datatype: xsd.boolean,
    order: 6,
    group: 'policy',
    name: 'Encrypted',
    description: 'True when the room carries m.room.encryption.',
  })
  get encrypted(): boolean {
    return false;
  }
}
