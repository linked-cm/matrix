/**
 * Host namespace configuration. Everything a host stamps into Matrix — its room
 * marker, its card event types, its bot puppets — is a name the host chooses.
 * The transport reads them from here instead of hardcoding one product's
 * strings, which is the whole reason this package can serve more than one app.
 *
 * All fields have defaults, so the minimum a host must supply is `serverName`.
 */
export interface MatrixNamespaceConfig {
  /** Homeserver domain — the part after the colon in an MXID, e.g. 'chat.example.org'. */
  serverName: string;
  /**
   * State event the appservice stamps on every provisioned room, carrying the
   * bound entity IRI plus tier/audience. Reverse-DNS, e.g. 'org.example.room'.
   */
  roomMarkerType: string;
  /**
   * Prefix for custom timeline events that render as host cards, e.g. 'org.example.'.
   * A `${prefix}poll` event and its `${prefix}poll.response` / `${prefix}poll.close`
   * signals are recognised by the built-in poll aggregation.
   */
  cardEventPrefix: string;
  /** Content field carrying an inline card payload on an ordinary message. */
  cardContentField: string;
  /** Account-data type storing the subject's WebID on the Matrix account. */
  webIdAccountDataType: string;
  /** Bot/puppet MXIDs excluded from typing indicators and treated as bot authors. */
  botUserIds: readonly string[];
}

export const DEFAULT_MATRIX_NAMESPACE: Omit<MatrixNamespaceConfig, 'serverName'> = {
  roomMarkerType: 'cm.linked.room',
  cardEventPrefix: 'cm.linked.',
  cardContentField: 'cm.linked.card',
  webIdAccountDataType: 'cm.linked.webid',
  botUserIds: [],
};

/** Fill a partial host config with the package defaults. */
export function resolveMatrixNamespace(
  config: Partial<MatrixNamespaceConfig> & Pick<MatrixNamespaceConfig, 'serverName'>,
): MatrixNamespaceConfig {
  return { ...DEFAULT_MATRIX_NAMESPACE, ...config };
}

/** The three poll event types derived from a host's card prefix. */
export function pollTypesFor(config: Pick<MatrixNamespaceConfig, 'cardEventPrefix'>) {
  const poll = `${config.cardEventPrefix}poll`;
  return { poll, response: `${poll}.response`, close: `${poll}.close` } as const;
}
