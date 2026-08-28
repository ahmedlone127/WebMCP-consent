import { useEffect, useRef, useState } from 'react';
import { createConsentLayer } from './consent.js';

/**
 * Create a consent layer tied to a component's lifetime. Tools unregister on
 * unmount, so the agent's capabilities track what is actually on screen.
 */
export function useConsentLayer(opts = {}) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createConsentLayer(opts);
  const layer = ref.current;

  const [state, setState] = useState(() => ({
    pending: layer.pending, audit: layer.audit, role: layer.role, tools: layer.toolNames,
  }));

  useEffect(() => layer.subscribe(setState), [layer]);
  useEffect(() => () => layer.destroy(), [layer]);
  useEffect(() => { if (opts.role) layer.setRole(opts.role); }, [layer, opts.role]);

  return { layer, ...state };
}
