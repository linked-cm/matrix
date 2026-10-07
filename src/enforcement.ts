/** Server-issued proof that visible events must use a mandatory relay route. */
export interface MatrixEnforcementSession {
  mode: 'relay';
  /** Stable host policy identifier, useful when clients require a particular policy. */
  policyId: string;
  /** Authenticated host route backed by `createMatrixEnforcedSendHandler`. */
  sendRoute: string;
  /** Trusted logical-author field stamped by the relay. */
  actorContentField?: string;
}

export interface MatrixEnforcementRequirement {
  /** `true` accepts any active relay policy; a string requires that policy id. */
  policyId?: string;
}

export function assertMatrixEnforcement(
  session: { enforcement?: MatrixEnforcementSession },
  requirement: boolean | MatrixEnforcementRequirement | undefined
): void {
  if (!requirement) return;
  const enforcement = session.enforcement;
  if (!enforcement || enforcement.mode !== 'relay' || !enforcement.sendRoute) {
    throw new Error('matrix enforcement is required but unavailable');
  }
  const policyId =
    typeof requirement === 'object' ? requirement.policyId : undefined;
  if (policyId && enforcement.policyId !== policyId) {
    throw new Error(`matrix enforcement policy mismatch: expected ${policyId}`);
  }
}
