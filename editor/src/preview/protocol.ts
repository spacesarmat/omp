import type { InteractionTrace } from '../../../design/interaction.ts';
import {
  INTERACTION_ACTION_TYPES,
  type DesignTarget,
  type DesignFormat,
  type DesignState,
  type FlowDocument,
  type ThemeDocument,
  type InteractionAction,
} from '../../../design/schema.ts';
import { isDesktopRouteId, type DesktopRouteId } from '../../../desktop/src/shell/routes';

interface Envelope {
  messageId: string;
  sessionId: string;
}

export interface PreviewConfiguration {
  target: DesignTarget;
  route: DesktopRouteId;
  format: DesignFormat;
  language: 'ru' | 'en';
  mode: 'design' | 'logic' | 'simulate';
  serverConnected: boolean;
  state: DesignState;
  theme: ThemeDocument;
  flow: FlowDocument;
}

export type PreviewMessage = Envelope & (
  | { type: 'ready' }
  | { type: 'element-selected'; elementId: string }
  | { type: 'navigated'; route: DesktopRouteId }
  | { type: 'trace'; trace: InteractionTrace[] }
  | { type: 'error'; message: string }
);

export type PreviewCommand = Envelope & (
  | { type: 'init'; props: PreviewConfiguration }
  | { type: 'navigate'; route: DesktopRouteId }
  | { type: 'simulate'; elementId: string }
);

type WithoutEnvelope<T> = T extends unknown ? Omit<T, keyof Envelope> : never;
export type PreviewMessageInput = WithoutEnvelope<PreviewMessage>;
export type PreviewCommandInput = WithoutEnvelope<PreviewCommand>;

let messageCounter = 0;

export function newMessageId(): string {
  messageCounter += 1;
  return `preview-${Date.now().toString(36)}-${messageCounter}`;
}

export function createSessionId(): string {
  return crypto.randomUUID();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Preview message must be an object');
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new Error(`Invalid ${name}`);
  return value;
}

function envelope(value: unknown, allowed: string[]): Record<string, unknown> & Envelope {
  const source = record(value);
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new Error(`Unknown preview field ${key}`);
  }
  return {
    ...source,
    messageId: text(source.messageId, 'messageId', 128),
    sessionId: text(source.sessionId, 'sessionId', 128),
  };
}

function trace(value: unknown): InteractionTrace[] {
  if (!Array.isArray(value)) throw new Error('Invalid trace');
  return value.map((entry) => {
    const source = record(entry);
    const action = text(source.action, 'trace action', 20);
    if (!INTERACTION_ACTION_TYPES.includes(action as InteractionAction['type'])) throw new Error('Invalid trace action');
    return {
      ...source,
      ruleId: text(source.ruleId, 'ruleId', 64),
      event: 'click',
      action,
    } as InteractionTrace;
  });
}

export function parsePreviewMessage(value: unknown): PreviewMessage {
  const type = record(value).type;
  if (type === 'ready') return { ...envelope(value, ['messageId', 'sessionId', 'type']), type: 'ready' };
  if (type === 'element-selected') {
    const source = envelope(value, ['messageId', 'sessionId', 'type', 'elementId']);
    return { ...source, type, elementId: text(source.elementId, 'elementId', 64) } as PreviewMessage;
  }
  if (type === 'navigated') {
    const source = envelope(value, ['messageId', 'sessionId', 'type', 'route']);
    const route = text(source.route, 'route', 64);
    if (!isDesktopRouteId(route)) throw new Error('Unknown preview route');
    return { ...source, type, route } as PreviewMessage;
  }
  if (type === 'trace') {
    const source = envelope(value, ['messageId', 'sessionId', 'type', 'trace']);
    return { ...source, type, trace: trace(source.trace) } as PreviewMessage;
  }
  if (type === 'error') {
    const source = envelope(value, ['messageId', 'sessionId', 'type', 'message']);
    return { ...source, type, message: text(source.message, 'message', 500) } as PreviewMessage;
  }
  throw new Error('Unknown preview message');
}

export function isTrustedPreviewEvent(
  event: MessageEvent,
  origin: string,
  source: MessageEventSource | null,
  sessionId: string,
): boolean {
  if (source === null || event.origin !== origin || event.source !== source) return false;
  try {
    return parsePreviewMessage(event.data).sessionId === sessionId;
  } catch {
    return false;
  }
}

export function sendPreviewCommand(iframe: HTMLIFrameElement, command: PreviewCommand, origin: string): void {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.origin !== origin || !iframe.contentWindow) {
    throw new Error('Preview command requires a loopback iframe');
  }
  iframe.contentWindow.postMessage(command, origin);
}
